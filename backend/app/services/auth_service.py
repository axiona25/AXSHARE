"""Auth service — TOTP (pyotp) e JWT RS256 (python-jose)."""

import hashlib
import uuid
from datetime import datetime, timedelta

import pyotp
from jose import JWTError, jwt

from app.config import get_settings
from app.crypto.aes import decrypt_string, encrypt_string

TOTP_ENCRYPTION_INFO = b"axshare-totp-secret"


def _totp_storage_key() -> bytes:
    """Chiave per cifrare il secret TOTP in DB (derivata da secret_key)."""
    settings = get_settings()
    return hashlib.sha256(settings.secret_key.encode()).digest()


class AuthService:
    def generate_totp_secret(self) -> str:
        return pyotp.random_base32()

    def get_totp_uri(self, secret: str, email: str) -> str:
        totp = pyotp.TOTP(secret)
        return totp.provisioning_uri(name=email, issuer_name="AXSHARE")

    def verify_totp(self, secret: str, code: str) -> bool:
        totp = pyotp.TOTP(secret)
        return totp.verify(code, valid_window=1)

    def encrypt_totp_secret_for_storage(self, secret: str) -> str:
        """Cifra il secret TOTP prima di salvare nel DB."""
        key = _totp_storage_key()
        return encrypt_string(secret, key)

    def decrypt_totp_secret_from_storage(self, encrypted: str) -> str:
        """Decifra il secret TOTP dal DB."""
        key = _totp_storage_key()
        return decrypt_string(encrypted, key)

    def _load_private_key(self) -> str:
        settings = get_settings()
        with open(settings.jwt_private_key_path, "r") as f:
            return f.read()

    def _load_public_key(self) -> str:
        settings = get_settings()
        with open(settings.jwt_public_key_path, "r") as f:
            return f.read()

    def create_access_token(self, user_id: uuid.UUID, role: str) -> str:
        settings = get_settings()
        expire = datetime.utcnow() + timedelta(
            minutes=settings.jwt_access_token_expire_minutes
        )
        payload = {
            "sub": str(user_id),
            "role": role,
            "exp": expire,
            "type": "access",
            "iat": datetime.utcnow(),
        }
        # jose/jwt expect numeric timestamps
        payload["exp"] = int(payload["exp"].timestamp())
        payload["iat"] = int(payload["iat"].timestamp())
        return jwt.encode(
            payload,
            self._load_private_key(),
            algorithm=settings.jwt_algorithm,
        )

    def create_refresh_token(self, user_id: uuid.UUID) -> str:
        settings = get_settings()
        expire = datetime.utcnow() + timedelta(
            days=settings.jwt_refresh_token_expire_days
        )
        payload = {
            "sub": str(user_id),
            "exp": expire,
            "type": "refresh",
        }
        payload["exp"] = int(payload["exp"].timestamp())
        return jwt.encode(
            payload,
            self._load_private_key(),
            algorithm=settings.jwt_algorithm,
        )

    def decode_token(self, token: str) -> dict:
        settings = get_settings()
        return jwt.decode(
            token,
            self._load_public_key(),
            algorithms=[settings.jwt_algorithm],
        )

    def refresh_access_token(
        self, refresh_token: str, user_id: uuid.UUID, role: str
    ) -> str:
        payload = self.decode_token(refresh_token)
        if payload.get("type") != "refresh":
            raise ValueError("Token non e' un refresh token")
        if payload.get("sub") != str(user_id):
            raise ValueError("Refresh token non appartiene all'utente")
        return self.create_access_token(user_id, role)


auth_service = AuthService()
