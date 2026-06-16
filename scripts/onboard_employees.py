#!/usr/bin/env python3
"""One-shot onboarding script for the 26 Kiron Group employees.

Run on the VM after the 5 group entities have been added via Settings →
Companies. Each employee's home company is derived from the email
domain (innomaxsol.com → Innomax IT, healtourin.com → Healtour, etc.),
matched against `companies.domain`.

    cd /opt/kiron
    sudo -u kiron .venv/bin/python scripts/onboard_employees.py \\
        --base http://127.0.0.1:8787 \\
        --email kiran@kirongroup.in

The script will:
  1. Log in as the super_admin (prompts for password)
  2. Fetch /bootstrap and map company domains → company_id
  3. Loop through the hardcoded 26-person roster
  4. POST /users for each, capturing the generated temporary password
  5. Write `scripts/temp_passwords.csv` so Kiran can distribute them
     PRIVATELY (DM, never group chat — see deploy/ROLLOUT_CHECKLIST.md)

Idempotent: if a user already exists (409), the script skips and notes
it in the CSV with status='exists'. Re-running is safe — only missing
people get created.

SECURITY:
  - `temp_passwords.csv` is sensitive. After distributing the passwords,
    delete the file (`shred -u scripts/temp_passwords.csv`).
  - All accounts are created with must_change_password=true, so even
    if a temp password leaks the joiner is forced to pick a real one on
    first sign-in.
"""
import argparse
import csv
import getpass
import json
import secrets
import string
import sys
import urllib.error
import urllib.request
from pathlib import Path


# (full_name, email, role, employment_type, designation)
# Source: project_employees_roster_2026_06_12 memory (Kiran shared
# 2026-06-12). Three rows have role/employment overrides — flagged inline.
ROSTER: list[tuple[str, str, str, str, str]] = [
    ("M Kishore Kumar",                    "kishorekumar.m@innomaxsol.com",            "employee", "full_time", "Junior Digital Marketing Executive"),
    ("Maram Sri Venkata Ramcharan",        "m.ramcharan@innomaxsol.com",               "employee", "full_time", "Software Engineer"),
    ("Pinjari Jakeer Ahmad",               "jakeerahmad@innomaxsol.com",               "employee", "full_time", "IT Recruiter"),
    ("Bandi Veera Venkata Satyanarayana",  "bandivenkatasatyanarayana@innomaxsol.com", "intern",   "intern",    "AI Engineer Intern"),
    ("Rudraraju Sameer Anirudh Varma",     "anirudh@healtourin.com",                   "employee", "full_time", "Lead — Hospital Partnerships & Alliances"),
    ("Chinni Gopikrishnasai",              "chinnigopikrishnasai@innomaxsol.com",      "employee", "full_time", "Python Full Stack Developer"),
    ("Shyam B",                            "shyamb@innomaxsol.com",                    "intern",   "intern",    "AI Engineer Intern"),
    # Jayaram → founder_office_coordinator (override) — needs company-management rights
    ("Vantipalli Jayaram Praveen Chowdary", "vantipallijayaram@innomaxsol.com",        "founder_office_coordinator", "full_time", "Executive Assistant to CEO"),
    ("Vantaku Hari Prasad",                "vantakuhariprasad@innomaxsol.com",         "intern",   "intern",    "Java Full Stack Intern"),
    ("Biradar Omkar",                      "biradaromkar@innomaxsol.com",              "employee", "full_time", "Junior Java Developer"),
    # Roja → founder_office_coordinator (override)
    ("Kotoju Rojasri",                     "kotojurojasri@innomaxsol.com",             "founder_office_coordinator", "full_time", "Executive Assistant to CEO"),
    ("Swati Patil",                        "swatipatil@innomaxsol.com",                "employee", "full_time", "Data Analytics"),
    ("Dasari Poorna Chandrika",            "dasaripoornachandrika@innomaxsol.com",     "employee", "full_time", "Java Full Stack Developer"),
    ("Gonepalli Pallavi",                  "pallavi@innomaxsol.com",                   "employee", "full_time", "Python Full Stack Developer"),
    ("Kunchanapalli Lalitha Aswani",       "klalithaaswani@innomaxsol.com",            "employee", "full_time", "Talent Acquisition Partner — IT and Non-IT"),
    # Karunya → hr_admin (override) — the real HR admin (the demo anita@kirongroup.in stand-in gets deactivated separately)
    ("Balerao Karunya",                    "baleraokarunya@innomaxskills.com",         "hr_admin", "full_time", "HR & Admin"),
    ("Varsha Cheriyala",                   "varsha.a@innomaxsol.com",                  "employee", "full_time", "TA Specialist"),
    ("K. Nabeela Fatima",                  "knabeela@innomaxsol.com",                  "employee", "full_time", "PHP Developer"),
    ("Rupa K",                             "rupak@sgholidaysresorts.com",              "intern",   "intern",    "Tourism Operations Intern"),
    ("Goutham V",                          "gouthamv@sgholidaysresorts.com",           "intern",   "intern",    "Tourism Operations Intern"),
    ("Sayani Bhattacharjya",               "sayanibhattacharjya@healtourin.com",       "intern",   "intern",    "Financial Research & Business Insights"),
    # Vinay Kumar → contract (override)
    ("Korakoppula Vinay Kumar",            "vinaykumar@innomaxsol.com",                "employee", "contract",  "Junior PHP Developer"),
    ("Sankarshana Karnam",                 "sankarshana@ongolebullsinvest.com",        "intern",   "intern",    "Financial Research Intern (Mutual Funds and PMS)"),
    ("Meghana Talapaneni",                 "meghanatalapaneni@innomaxsol.com",         "employee", "full_time", "Junior AI Engineer"),
    ("Gandham Kiran",                      "gandhamkiran@innomaxsol.com",              "employee", "full_time", "Junior AI Engineer"),
    ("Namala Pranav",                      "namalapranav@innomaxsol.com",              "employee", "full_time", "Junior AI Engineer"),
]


def gen_temp_password(n: int = 14) -> str:
    """Random alpha-numeric + a few symbols. 14 chars is comfortably
    above the backend's min_length=6 and gives ~78 bits of entropy.
    must_change_password=true is set by the backend so this is one-shot."""
    alphabet = string.ascii_letters + string.digits + "!@#$%"
    return "".join(secrets.choice(alphabet) for _ in range(n))


def http_json(method: str, url: str, token: str | None = None, body: dict | None = None):
    """Minimal HTTP helper using stdlib — no third-party deps."""
    req = urllib.request.Request(url, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    data = None if body is None else json.dumps(body).encode()
    try:
        with urllib.request.urlopen(req, data=data) as resp:
            return resp.getcode(), json.loads(resp.read())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, {"detail": e.reason}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="http://127.0.0.1:8787",
                        help="API base URL (default: localhost backend port)")
    parser.add_argument("--email", required=True,
                        help="Super-admin email used for the API session")
    args = parser.parse_args()

    pw = getpass.getpass(f"Password for {args.email}: ")

    # 1. Login
    status, body = http_json("POST", f"{args.base}/auth/login",
                             body={"email": args.email, "password": pw})
    if status != 200:
        print(f"Login failed [{status}]: {body}", file=sys.stderr)
        return 1
    token = body["access_token"]
    print(f"Signed in as {args.email}")

    # 2. Map domain → company_id via bootstrap (no separate /companies list endpoint)
    status, boot = http_json("GET", f"{args.base}/bootstrap", token=token)
    if status != 200:
        print(f"Bootstrap failed [{status}]: {boot}", file=sys.stderr)
        return 1
    by_domain: dict[str, str] = {}
    for c in boot.get("companies", []):
        d = (c.get("domain") or "").strip().lower()
        if d:
            by_domain[d] = c["id"]
    print(f"Mapped {len(by_domain)} company domain(s):")
    for d, cid in sorted(by_domain.items()):
        print(f"  {d:30}  →  {cid}")

    # 3. Pre-flight: every email's domain must resolve
    unresolved = sorted({email.split('@')[1].lower() for _, email, *_ in ROSTER}
                        - set(by_domain.keys()))
    if unresolved:
        print("\nERROR: these email domains have no matching company.domain:")
        for d in unresolved:
            print(f"  {d}")
        print("Set the domain on each company via Settings → Companies → Edit "
              "before re-running this script.")
        return 1

    # 4. Onboard
    results: list[dict[str, str]] = []
    for full_name, email, role, employment_type, designation in ROSTER:
        domain = email.split("@")[1].lower()
        company_id = by_domain[domain]
        temp = gen_temp_password()
        status, body = http_json("POST", f"{args.base}/users", token=token, body={
            "full_name": full_name,
            "email": email,
            "password": temp,
            "home_company_id": company_id,
            "designation": designation,
            "role": role,
            "employment_type": employment_type,
        })
        if status == 201:
            print(f"  CREATED  {email:45}  ({role}/{employment_type})")
            results.append({
                "email": email, "name": full_name,
                "role": role, "company_domain": domain,
                "status": "created", "temp_password": temp,
            })
        elif status == 409:
            print(f"  EXISTS   {email}")
            results.append({
                "email": email, "name": full_name,
                "role": role, "company_domain": domain,
                "status": "exists", "temp_password": "",
            })
        else:
            detail = body.get("detail") if isinstance(body, dict) else body
            print(f"  FAILED   {email}  [{status}]  {detail}", file=sys.stderr)
            results.append({
                "email": email, "name": full_name,
                "role": role, "company_domain": domain,
                "status": f"error_{status}", "temp_password": "",
            })

    # 5. CSV with the temp passwords for Kiran to distribute privately
    out = Path(__file__).resolve().parent / "temp_passwords.csv"
    with out.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["email", "name", "role", "company_domain", "status", "temp_password"])
        w.writeheader()
        w.writerows(results)

    created = sum(1 for r in results if r["status"] == "created")
    existed = sum(1 for r in results if r["status"] == "exists")
    failed = sum(1 for r in results if r["status"].startswith("error"))
    print(f"\nDone. {created} created · {existed} already existed · {failed} failed")
    print(f"Temp passwords saved to: {out}")
    print("⚠ DELETE this file after distributing the passwords (`shred -u`).")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
