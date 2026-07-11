// Kiron Presence sign-in — plain JS, no bundler. Loaded once by
// index.html at startup. Talks to Rust exclusively via `invoke()`; the
// backend URL, keychain writes, and HTTP handshake all live on the
// Rust side (see src-tauri/src/commands.rs).
//
// Session 3 scope: sign in, show a "you're signed in" state, sign out.
// Session 4 will wire the transition-to-tray + activity polling.

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

const showSignedIn = (email) => {
  signedInEmail.textContent = email || "your account";
  signedOutView.hidden = true;
  signedInView.hidden = false;
  errorEl.textContent = "";
};

const showSignedOut = (message) => {
  signedInView.hidden = true;
  signedOutView.hidden = false;
  errorEl.textContent = message || "";
  passwordInput.value = "";
  emailInput.focus();
};

// On boot, if the keychain already has a session, skip the form.
(async () => {
  try {
    const session = await invoke("current_session");
    if (session?.signed_in) {
      // We don't have the email string in the keychain (only user_id),
      // so fall back to "your account" text. The status popup in
      // Session 4 will fetch and display the real name.
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
