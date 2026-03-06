"""Verifica firma RSA-PSS lato server."""

import base64
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.serialization import load_pem_public_key
from cryptography.exceptions import InvalidSignature


class SignatureService:
    """Verifica firma RSA-PSS SHA-256 (payload: file_hash:file_id:version)."""

    @staticmethod
    def verify_rsa_pss(
        signature_b64: str,
        file_hash_sha256: str,
        file_id: str,
        version: int,
        public_key_pem: str,
    ) -> bool:
        """
        Verifica firma RSA-PSS SHA-256.
        Payload firmato: '{file_hash}:{file_id}:{version}'
        """
        try:
            payload = f"{file_hash_sha256}:{file_id}:{version}".encode("utf-8")
            signature = base64.b64decode(signature_b64)
            pub_key = load_pem_public_key(public_key_pem.encode())
            pub_key.verify(
                signature,
                payload,
                padding.PSS(
                    mgf=padding.MGF1(hashes.SHA256()),
                    salt_length=32,
                ),
                hashes.SHA256(),
            )
            return True
        except (InvalidSignature, Exception):
            return False
