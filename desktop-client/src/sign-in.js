// Kiron Presence sign-in — plain JS, no bundler.
//
// Session 3 shipped: sign-in form, keychain-backed skip on relaunch,
// signed-in confirmation view.
// Session 4 additions: after a successful sign-in, hide the window
// into the tray (the tracker starts on the Rust side automatically),
// and poll `get_status` while the window is visible so the signed-in
// view surfaces live "checked in at Xh Ym" data.

import { invoke } from "@tauri-apps/api/core";

const $ = (id) => document.getElementById(id);

const signedOutView = $("signed-out");
const signedInView = $("signed-in");
const signedInEmail = $("signed-in-email");
const errorEl = $("error");
const form = $("signin-form");
const emailInput = $("email");
const passwordInput = $("password");
const submitBtn = $("submit");
const signOutBtn = $("signout");

// Optional status detail — rendered under the "signed in as" line when
// the tracker has posted a check-in. Created lazily so we don't need
// to edit index.html for every status field we add later.
let statusEl = null;
const ensureStatusEl = () => {
  if (statusEl) return statusEl;
  statusEl = document.createElement("p");
  statusEl.className = "hint";
  statusEl.id = "status-detail";
  signedInView.insertBefore(statusEl, signOutBtn);
  return statusEl;
};

const showSignedIn = (email) => {
  signedInEmail.textContent = email || "your account";
  signedOutView.hidden = true;
  signedInView.hidden = false;
  errorEl.textContent = "";
  startStatusPolling();
};

const showSignedOut = (message) => {
  signedInView.hidden = true;
  signedOutView.hidden = false;
  errorEl.textContent = message || "";
  passwordInput.value = "";
  emailInput.focus();
  stopStatusPolling();
};

// ---- Status polling (only while the window is visible) ----

let statusTimer = null;
const startStatusPolling = () => {
  if (statusTimer) return;
  const tick = async () => {
    try {
      const s = await invoke("get_status");
      renderStatus(s);
    } catch (e) {
      console.warn("get_status failed:", e);
    }
  };
  void tick();
  statusTimer = setInterval(tick, 10_000);
};

const stopStatusPolling = () => {
  if (statusTimer) {
    clearInterval(statusTimer);
    statusTimer = null;
  }
};

const renderStatus = (s) => {
  if (!s) return;
  const el = ensureStatusEl();
  if (!s.signed_in) {
    // Refresh token was rejected mid-session — bounce back to the form.
    showSignedOut("Your session expired. Sign in again.");
    return;
  }
  if (!s.checked_in) {
    el.textContent =
      "Presence tracking is active. You'll auto check-in on your first activity of the day.";
    return;
  }
  const parts = [];
  if (s.active_duration_label) parts.push(`Checked in · ${s.active_duration_label} active`);
  if (s.is_idle) parts.push("currently idle");
  el.textContent = parts.join(" · ") || "Checked in.";
};

// On boot, if the keychain already has a session, skip the form and
// let the Rust side handle starting the tracker.
(async () => {
  try {
    const session = await invoke("current_session");
    if (session?.signed_in) {
      showSignedIn(null);
    }
  } catch (e) {
    console.warn("current_session failed:", e);
  }
})();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  if (!email || !password) {
    errorEl.textContent = "Enter your email and password.";
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Signing in…";
  errorEl.textContent = "";

  try {
    const result = await invoke("sign_in", { payload: { email, password } });
    showSignedIn(result?.email || email);
    // Drop into the tray after a moment so the user sees the "signed
    // in" confirmation, then the window disappears and only the tray
    // icon remains.
    setTimeout(() => {
      void invoke("hide_window");
    }, 1200);
  } catch (err) {
    errorEl.textContent = typeof err === "string" ? err : "Sign-in failed.";
    passwordInput.select();
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Sign in";
  }
});

signOutBtn.addEventListener("click", async () => {
  signOutBtn.disabled = true;
  try {
    await invoke("sign_out");
    showSignedOut("");
  } catch (err) {
    errorEl.textContent = typeof err === "string" ? err : "Sign-out failed.";
  } finally {
    signOutBtn.disabled = false;
  }
});
