# Signing + notarization runbook

Everything the CI pipeline can't do for you — buying certs, generating
keys, wiring them into GitHub secrets, and the one-time Apple/Windows
paperwork. Follow this once, then subsequent releases are `git tag +
push`.

**Why signing matters:** Windows SmartScreen and macOS Gatekeeper block
unsigned installers by default. Employees who install an unsigned build
see "Windows protected your PC" or "cannot be opened because it is from
an unidentified developer" — that's a permission dialog we do NOT want
Karunya having to walk 26 people through. Signing turns those into
seamless installs.

**Total setup cost:** ~₹8-25k/yr for the Windows cert, ~$99/yr for the
Apple Developer account. One-time work: ~2-3 hours.

---

## 1. Tauri update-signing key (do this first — no purchases needed)

The updater plugin verifies each downloaded release against an ed25519
signature. Generate the key pair once, commit the public key, keep the
private key in a password manager + GitHub secrets.

```bash
cd desktop-client
npx @tauri-apps/cli signer generate -w tauri-signing-key
```

Produces two files (both `.gitignore`d):

- `tauri-signing-key` — private key. Never commit. Add to your
  password manager immediately.
- `tauri-signing-key.pub` — public key. Copy its contents into
  `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`.

Add these GitHub repo secrets (Settings → Secrets and variables →
Actions):

- `TAURI_SIGNING_PRIVATE_KEY` — full contents of `tauri-signing-key`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — the password you set when
  generating

Verify: on next build, GitHub Actions logs show
`Signed msi.zip and generated its signature file`.

---

## 2. Windows code signing certificate

**Recommended:** Sectigo OV Code Signing certificate, 1-year, ~₹8-12k
via Indian resellers (or ~$60 via ssls.com). Do NOT get a Standard
Code Signing cert — Windows now requires OV or higher for automatic
SmartScreen trust.

**Not recommended** unless you're at scale: EV Code Signing (~₹40k+/yr).
Only worth it if you're seeing SmartScreen warnings even after OV;
usually those clear on their own after ~10 successful installs.

### Ordering + issuance

1. Sign up with a reseller (ssls.com, jscape, or an Indian one like
   Certera). Buy 1-year OV Code Signing.
2. Complete organization validation — they call the Innomax Solutions
   phone number listed publicly + verify GST/CIN. Takes 1-3 business
   days.
3. They deliver a `.pfx` file (private key + cert) with a password
   you set during ordering.

### Wiring into GitHub Actions

```bash
# Base64-encode the .pfx (Actions doesn't accept binary secrets).
base64 -w0 innomax-codesigning.pfx > cert.b64
```

Add repo secrets:

- `KIRON_CODE_SIGN_CERT_BASE64` — contents of `cert.b64`
- `KIRON_CODE_SIGN_PASSWORD` — .pfx password

The workflow decodes it back to disk at build time + sets
`KIRON_CODE_SIGN_CERT` env var pointing at the file, which the
`signCommand` block in `tauri.conf.json` picks up.

### Rotating annually

Certs expire yearly. Buy the renewal ~2 weeks before expiry, update
the two secrets, retag. Old cert still validates already-installed
copies — signing is only checked at install time.

---

## 3. macOS code signing + notarization

**Prerequisite:** Apple Developer Program account. $99/yr, sign up at
developer.apple.com. Requires Innomax to have an Apple ID
associated with the org (individual or company enrolment both work).

### Certificate

1. In App Store Connect → Certificates → create a **Developer ID
   Application** certificate. Download the `.cer`.
2. Double-click → keychain imports it. Then in Keychain Access, right-
   click → Export as `.p12` with a password.
3. Base64:
   ```bash
   base64 -i developer-id.p12 -o cert.b64
   ```

Add repo secrets:

- `APPLE_CERTIFICATE` — contents of `cert.b64`
- `APPLE_CERTIFICATE_PASSWORD` — .p12 password
- `APPLE_SIGNING_IDENTITY` — the exact string from Keychain Access
  (usually `"Developer ID Application: Innomax Solutions (TEAMID)"`)

### Notarization

Apple requires every distributed macOS app to be uploaded to their
notary service for a virus scan. Failure = Gatekeeper block.

1. Generate an app-specific password: appleid.apple.com → Sign-In and
   Security → App-Specific Passwords → +. Name it "Kiron Presence CI".
2. Find your team ID: developer.apple.com → Membership → Team ID
   (10-character alphanumeric).

Add repo secrets:

- `APPLE_ID` — your Apple ID email
- `APPLE_APP_PASSWORD` — the app-specific password
- `APPLE_TEAM_ID` — the 10-char team ID

Tauri's bundler runs `xcrun notarytool submit --wait` automatically
when these are set. First submission takes ~10-15 min; subsequent
usually 2-5 min.

### Stapling

The workflow calls `xcrun stapler staple` on the notarized .dmg so
Gatekeeper can validate offline. If a user's Mac is airgapped from
Apple's notary server on first launch (unusual), stapling saves them.

---

## 4. Release checklist

For every new release:

1. **Update `Cargo.toml` + `tauri.conf.json` version** to the new
   semver (e.g. `0.2.0` → `0.2.1`). These MUST match — the client's
   check is against `CARGO_PKG_VERSION`, the manifest reads
   `tauri.conf.json`.
2. Commit + push to main.
3. **Tag + push:**
   ```bash
   git tag desktop-v0.2.1
   git push origin desktop-v0.2.1
   ```
4. GitHub Actions runs, produces `.msi` + `.dmg` + `.sig` files on
   the release page after ~15 min.
5. **Download the artifacts + upload to the VM:**
   ```bash
   # From your workstation, download the release assets:
   gh release download desktop-v0.2.1 --dir /tmp/kiron-release
   # Upload to the VM:
   scp /tmp/kiron-release/* root@66-116-207-71.webhostbox.net:/home/crminnomaxsol/desktop-artifacts/
   ```
6. **Edit `latest.json` from `desktop-client/scripts/latest.json.template`:**
   - Bump `version` to `0.2.1`.
   - Copy the contents of `KironPresence_0.2.1_x64_en-US.msi.zip.sig`
     into `platforms.windows-x86_64.signature`.
   - Same for the macOS `.app.tar.gz.sig`.
   - Update `url` fields to the new filename.
   - `pub_date` = the current UTC ISO 8601 timestamp.
7. **Upload the manifest:**
   ```bash
   scp latest.json root@…:/home/crminnomaxsol/desktop-artifacts/
   ```
8. **Sanity check:** in an incognito browser, hit
   `https://crm.innomaxsol.com/desktop/latest.json` — should return
   the JSON you just uploaded, `Cache-Control: no-cache` header set.
9. Wait ~4 hours (the client's polling cadence). Confirm at least
   one machine in the fleet auto-updated via
   `journalctl -u kiron-api | grep 'client_version.*0.2.1'` (or the
   Desktop agents dashboard in Settings once the PWA piece deploys).

---

## 5. Emergency rollback

If a release breaks something on real hardware:

1. Overwrite `latest.json` with the previous version's manifest —
   the client compares versions and won't downgrade, but stopping
   the drumbeat prevents new machines pulling the bad build.
2. Push a bugfix as `desktop-v0.2.2` — clients auto-heal within 4h.
3. For users already on the bad version: they can uninstall via
   Add/Remove Programs (Windows) or drag to Trash (macOS). Reinstall
   with the fixed installer.

No client-side "roll me back" mechanism — updater only moves forward.
If you need one, add it in a V2.
