"""AES-256-GCM helpers for the credentials vault.

Master key lives only in /etc/kiron/backend.env as VAULT_MASTER_KEY
(base64-encoded 32 raw bytes). Per-row nonce is random 12 bytes. The
resulting ciphertext bytes include the 16-byte GCM auth tag at the
end, so we can store them in a single ``bytea`` column.

A DB dump leak yields ciphertext only — without the master key in env,
the secrets are useless. Lose the master key and every credential is
unrecoverable; rotation is the user's responsibility.
"""
from __future__ import annotations

import base64
import os
from functools import lru_cache

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from .config import settings


class VaultNotConfigured(RuntimeError):
    """VAULT_MASTER_KEY missing / malformed. Refuse to operate rather
    than fall back to a weak default — that would let an admin
    accidentally save plaintext to the DB and notice only at decrypt."""


@lru_cache(maxsize=1)
def _key() -> bytes:
    raw = settings.vault_master_key.strip()
    if not raw:
        raise VaultNotConfigured(
            "VAULT_MASTER_KEY is not set. Generate one and add it to "
            "/etc/kiron/backend.env: "
            "python -c \"import base64,os; print(base64.b64encode(os.urandom(32)).decode())\""
        )
    try:
        decoded = base64.b64decode(raw, validate=True)
    except Exception as e:  # noqa: BLE001
        raise VaultNotConfigured(f"VAULT_MASTER_KEY is not valid base64: {e}") from e
    if len(decoded) != 32:
        raise VaultNotConfigured(
            f"VAULT_MASTER_KEY must decode to exactly 32 bytes (got {len(decoded)})."
        )
    return decoded


def encrypt(plaintext: str) -> tuple[bytes, bytes]:
    """Return (ciphertext_with_tag, nonce). Both are raw bytes for the
    DB ``bytea`` columns. Plaintext is the secret string."""
    if plaintext is None:
        plaintext = ""
    aes = AESGCM(_key())
    nonce = os.urandom(12)
    ct = aes.encrypt(nonce, plaintext.encode("utf-8"), associated_data=None)
    return ct, nonce


def decrypt(ciphertext: bytes, nonce: bytes) -> str:
    """Recover the plaintext. Raises if the master key is wrong, the
    ciphertext has been tampered with, or the inputs aren't bytes."""
    aes = AESGCM(_key())
    pt = aes.decrypt(bytes(nonce), bytes(ciphertext), associated_data=None)
    return pt.decode("utf-8")
