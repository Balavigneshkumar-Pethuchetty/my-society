"""Application-level encryption for PII columns (users.phone, users.email —
see PII_PRIVACY_PLAN.md). AES-256-GCM gives a reversible ciphertext, decrypted
in memory only when the plaintext is legitimately needed (sending an OTP/
notification, calling Keycloak's admin API). A separate HMAC-SHA256 blind
index lets lookups (login, uniqueness checks) match by value without ever
sending plaintext into a SQL WHERE clause. Both keys live only in this
service's env/secret, never in Postgres — not a config table, not a function
body, not a query literal."""
import base64
import hashlib
import hmac
import os
from typing import Optional

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.config import settings

_NONCE_LEN = 12  # bytes — standard AES-GCM nonce size


def _aes_key() -> bytes:
    key = base64.b64decode(settings.pii_encryption_key)
    if len(key) != 32:
        raise RuntimeError("PII_ENCRYPTION_KEY must base64-decode to exactly 32 bytes (AES-256)")
    return key


def encrypt(plaintext: Optional[str]) -> Optional[str]:
    """Returns base64(nonce || ciphertext || tag); None in, None out (so a
    NULL phone/email stays NULL, not an encrypted empty string)."""
    if not plaintext:
        return None
    nonce = os.urandom(_NONCE_LEN)
    ct = AESGCM(_aes_key()).encrypt(nonce, plaintext.encode(), None)
    return base64.b64encode(nonce + ct).decode()


def decrypt(ciphertext: Optional[str]) -> Optional[str]:
    """Reverse of encrypt(); None in, None out."""
    if not ciphertext:
        return None
    raw = base64.b64decode(ciphertext)
    nonce, ct = raw[:_NONCE_LEN], raw[_NONCE_LEN:]
    return AESGCM(_aes_key()).decrypt(nonce, ct, None).decode()


def blind_index(value: Optional[str]) -> Optional[str]:
    """Deterministic HMAC-SHA256, keyed separately from the AES key. Query
    `WHERE <field>_hash = blind_index(input)` instead of decrypting every row
    to find a match. Normalizes nothing — callers must pass the same
    normalized form (e.g. already .strip()'d) they encrypt, or lookups won't
    match what was stored."""
    if not value:
        return None
    return hmac.new(settings.pii_hash_key.encode(), value.encode(), hashlib.sha256).hexdigest()
