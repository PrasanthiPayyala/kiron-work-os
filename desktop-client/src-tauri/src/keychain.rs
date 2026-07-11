// OS keychain — Windows Credential Manager / macOS Keychain / Linux
// Secret Service — via the `keyring` crate.
//
// Stores three entries under the same service name so an uninstall
// (or a manual "sign out") clears them all at once:
//   access_token, refresh_token, user_id
//
// Kept deliberately narrow — three functions total. The rest of the
// app never touches OS keychain APIs directly, so if we ever migrate
// to a different backend (e.g. keyring::CredentialBuilder with a
// custom scheme) it's a one-file change.

use anyhow::{Context, Result};
use keyring::Entry;

const SERVICE: &str = "in.innomaxsol.kiron.presence";

const KEY_ACCESS: &str = "access_token";
const KEY_REFRESH: &str = "refresh_token";
const KEY_USER: &str = "user_id";

/// A signed-in session as it lives in the OS keychain.
#[derive(Debug, Clone)]
pub struct Session {
    pub access_token: String,
    pub refresh_token: String,
    pub user_id: String,
}

/// Store all three tokens. Overwrites any existing entries (that's
/// what a fresh sign-in should do).
pub fn store(session: &Session) -> Result<()> {
    entry(KEY_ACCESS)?
        .set_password(&session.access_token)
        .context("write access_token to keychain")?;
    entry(KEY_REFRESH)?
        .set_password(&session.refresh_token)
        .context("write refresh_token to keychain")?;
    entry(KEY_USER)?
        .set_password(&session.user_id)
        .context("write user_id to keychain")?;
    Ok(())
}

/// Load the current session, if any. Returns None if any entry is
/// missing — a half-set session is treated as no session.
pub fn load() -> Result<Option<Session>> {
    let access = match entry(KEY_ACCESS)?.get_password() {
        Ok(v) => v,
        Err(keyring::Error::NoEntry) => return Ok(None),
        Err(e) => return Err(anyhow::Error::from(e).context("read access_token")),
    };
    let refresh = match entry(KEY_REFRESH)?.get_password() {
        Ok(v) => v,
        Err(keyring::Error::NoEntry) => return Ok(None),
        Err(e) => return Err(anyhow::Error::from(e).context("read refresh_token")),
    };
    let user_id = match entry(KEY_USER)?.get_password() {
        Ok(v) => v,
        Err(keyring::Error::NoEntry) => return Ok(None),
        Err(e) => return Err(anyhow::Error::from(e).context("read user_id")),
    };
    Ok(Some(Session {
        access_token: access,
        refresh_token: refresh,
        user_id,
    }))
}

/// Wipe all three entries. Called on explicit sign-out. Missing entries
/// are not an error — the goal is "nothing left after this returns".
pub fn clear() -> Result<()> {
    for key in [KEY_ACCESS, KEY_REFRESH, KEY_USER] {
        match entry(key)?.delete_credential() {
            Ok(()) => {}
            Err(keyring::Error::NoEntry) => {}
            Err(e) => log::warn!("[keychain] delete {key} failed: {e}"),
        }
    }
    Ok(())
}

fn entry(key: &str) -> Result<Entry> {
    Entry::new(SERVICE, key).context("construct keychain entry")
}
