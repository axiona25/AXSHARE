"""WebAuthn (Passkey) registration and authentication service."""

import json
import uuid
from typing import Tuple

import structlog
from webauthn import (
    generate_registration_options,
    verify_registration_response,
    generate_authentication_options,
    verify_authentication_response,
    options_to_json,
)
from webauthn.helpers import base64url_to_bytes
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    UserVerificationRequirement,
    ResidentKeyRequirement,
    PublicKeyCredentialDescriptor,
)

from app.config import get_settings
from app.models.user import User

logger = structlog.get_logger()


class WebAuthnService:
    def get_registration_options(self, user: User) -> dict:
        """Opzioni per registrare un passkey per un utente esistente."""
        settings = get_settings()
        options = generate_registration_options(
            rp_id=settings.webauthn_rp_id,
            rp_name=settings.webauthn_rp_name,
            user_id=user.id.bytes,
            user_name=user.email,
            user_display_name=user.email,
            authenticator_selection=AuthenticatorSelectionCriteria(
                resident_key=ResidentKeyRequirement.PREFERRED,
                user_verification=UserVerificationRequirement.REQUIRED,
            ),
        )
        return json.loads(options_to_json(options))

    def get_registration_options_for_email(
        self, email: str
    ) -> Tuple[dict, bytes, uuid.UUID]:
        """
        Opzioni per registrazione con sola email (utente non ancora in DB).
        Restituisce (options_dict, challenge_bytes, user_id_uuid) da salvare in Redis.
        """
        settings = get_settings()
        user_handle = uuid.uuid4()
        options = generate_registration_options(
            rp_id=settings.webauthn_rp_id,
            rp_name=settings.webauthn_rp_name,
            user_id=user_handle.bytes,
            user_name=email,
            user_display_name=email,
            authenticator_selection=AuthenticatorSelectionCriteria(
                resident_key=ResidentKeyRequirement.PREFERRED,
                user_verification=UserVerificationRequirement.REQUIRED,
            ),
        )
        options_dict = json.loads(options_to_json(options))
        return options_dict, options.challenge, user_handle

    def verify_registration(
        self,
        credential: dict,
        expected_challenge: bytes,
    ) -> dict:
        """Verifica la risposta di registrazione e restituisce il credential da salvare."""
        settings = get_settings()
        verification = verify_registration_response(
            credential=credential,
            expected_challenge=expected_challenge,
            expected_rp_id=settings.webauthn_rp_id,
            expected_origin=settings.webauthn_origin,
            require_user_verification=True,
        )
        new_credential = {
            "id": verification.credential_id.hex(),
            "public_key": verification.credential_public_key.hex(),
            "sign_count": verification.sign_count,
            "transports": [],
        }
        return new_credential

    def get_authentication_options(self, user: User) -> dict:
        """Opzioni per autenticazione con passkey."""
        settings = get_settings()
        credentials = user.webauthn_credentials or []
        if isinstance(credentials, dict):
            credentials = list(credentials.values()) if credentials else []
        allow_credentials = []
        for c in credentials:
            cred_id = c.get("id") if isinstance(c, dict) else getattr(c, "id", None)
            if cred_id:
                bid = bytes.fromhex(cred_id) if isinstance(cred_id, str) and len(cred_id) % 2 == 0 else base64url_to_bytes(cred_id)
                allow_credentials.append(PublicKeyCredentialDescriptor(id=bid))
        options = generate_authentication_options(
            rp_id=settings.webauthn_rp_id,
            allow_credentials=allow_credentials or None,
            user_verification=UserVerificationRequirement.REQUIRED,
        )
        return json.loads(options_to_json(options))

    def verify_authentication(
        self,
        user: User,
        credential: dict,
        expected_challenge: bytes,
    ) -> bool:
        """
        Verifica la risposta di autenticazione.
        Aggiorna sign_count nel credential salvato (il caller deve persistere user).
        """
        settings = get_settings()
        stored_list = user.webauthn_credentials
        if stored_list is None:
            stored_list = []
        if isinstance(stored_list, dict):
            stored_list = list(stored_list.values()) if stored_list else []
        cred_id_from_client = credential.get("id")
        if not cred_id_from_client:
            return False
        try:
            cred_id_bytes = base64url_to_bytes(cred_id_from_client)
        except Exception:
            cred_id_bytes = bytes.fromhex(cred_id_from_client) if isinstance(cred_id_from_client, str) else None
        if not cred_id_bytes:
            return False
        cred_id_hex = cred_id_bytes.hex()
        stored = next((c for c in stored_list if (c.get("id") == cred_id_hex or c.get("id") == cred_id_from_client)), None)
        if not stored:
            return False
        verification = verify_authentication_response(
            credential=credential,
            expected_challenge=expected_challenge,
            expected_rp_id=settings.webauthn_rp_id,
            expected_origin=settings.webauthn_origin,
            credential_public_key=bytes.fromhex(stored["public_key"]),
            credential_current_sign_count=stored["sign_count"],
            require_user_verification=True,
        )
        stored["sign_count"] = verification.new_sign_count
        return True


webauthn_service = WebAuthnService()
