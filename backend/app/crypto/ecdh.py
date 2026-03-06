"""
X25519 ECDH per scambio chiavi nei gruppi e condivisione E2E.
Shared secret + HKDF per derivare chiavi AES di gruppo.
"""

import os
import base64
from dataclasses import dataclass
from typing import Optional, Tuple, Union

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.x25519 import (
    X25519PrivateKey,
    X25519PublicKey,
)


@dataclass
class X25519KeyPair:
    """Coppia di chiavi X25519 per ECDH."""
    private_key: X25519PrivateKey
    public_key: X25519PublicKey

    def public_key_bytes(self) -> bytes:
        """Chiave pubblica raw (32 bytes) — salvabile nel DB in chiaro."""
        return self.public_key.public_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PublicFormat.Raw,
        )

    def public_key_b64(self) -> str:
        """Chiave pubblica in base64 per storage nel DB."""
        return base64.b64encode(self.public_key_bytes()).decode("utf-8")

    def private_key_bytes(self) -> bytes:
        """
        Chiave privata raw (32 bytes).
        MAI salvare in chiaro — cifrare con AES prima di salvare nel DB.
        """
        return self.private_key.private_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PrivateFormat.Raw,
            encryption_algorithm=serialization.NoEncryption(),
        )

    def private_key_b64(self) -> str:
        """Chiave privata in base64 — solo in memoria, mai salvare cosi'."""
        return base64.b64encode(self.private_key_bytes()).decode("utf-8")


def generate_x25519_keypair() -> X25519KeyPair:
    """
    Genera coppia di chiavi X25519 per un utente.
    Molto piu' veloce di RSA-4096.
    Generare una volta per utente, come per RSA.
    """
    private_key = X25519PrivateKey.generate()
    return X25519KeyPair(
        private_key=private_key,
        public_key=private_key.public_key(),
    )


def compute_shared_secret(
    my_private_key: Union[X25519PrivateKey, bytes],
    their_public_key: Union[X25519PublicKey, bytes],
) -> bytes:
    """
    Calcola lo shared secret ECDH tra due parti.

    Il shared secret e' lo stesso per entrambe le parti:
    Alice: compute(alice_private, bob_public) == secret
    Bob:   compute(bob_private, alice_public) == secret

    Il server non conosce mai le chiavi private, quindi
    non puo' calcolare il shared secret.

    Args:
        my_private_key: chiave privata X25519 (oggetto o bytes raw)
        their_public_key: chiave pubblica X25519 dell'altro (oggetto o bytes raw)

    Returns:
        shared secret (32 bytes) — usare con HKDF per derivare chiave AES
    """
    if isinstance(my_private_key, bytes):
        my_private_key = X25519PrivateKey.from_private_bytes(my_private_key)
    if isinstance(their_public_key, bytes):
        their_public_key = X25519PublicKey.from_public_bytes(their_public_key)

    return my_private_key.exchange(their_public_key)


def derive_group_key(
    shared_secret: bytes,
    group_id: str,
    salt: Optional[bytes] = None,
) -> Tuple[bytes, bytes]:
    """
    Deriva una chiave AES-256 per un gruppo dal shared secret ECDH.

    Args:
        shared_secret: output di compute_shared_secret
        group_id: ID del gruppo (usato come contesto HKDF)
        salt: salt random (se None viene generato automaticamente)

    Returns:
        tuple (group_key: bytes, salt: bytes)
        Il salt DEVE essere salvato nel DB per permettere la ri-derivazione.
    """
    from app.crypto.aes import derive_key_from_bytes

    if salt is None:
        salt = os.urandom(32)
    info = f"axshare-group-{group_id}".encode("utf-8")
    group_key = derive_key_from_bytes(shared_secret, salt, info)
    return group_key, salt


def encrypt_x25519_private_key(private_key_bytes: bytes, aes_key: bytes) -> str:
    """
    Cifra la chiave privata X25519 con AES-256-GCM prima del salvataggio.
    L'AES key viene derivata dalla password utente.
    """
    from app.crypto.aes import encrypt as aes_encrypt

    encrypted = aes_encrypt(private_key_bytes, aes_key)
    return base64.b64encode(encrypted.to_storage_format()).decode("utf-8")


def decrypt_x25519_private_key(encrypted_b64: str, aes_key: bytes) -> bytes:
    """
    Decifra la chiave privata X25519 dal DB.
    Restituisce i bytes raw della chiave privata.
    """
    from app.crypto.aes import EncryptedData, decrypt as aes_decrypt

    data = base64.b64decode(encrypted_b64)
    encrypted = EncryptedData.from_storage_format(data, aes_key)
    return aes_decrypt(encrypted)


def load_public_key_from_bytes(raw: bytes) -> X25519PublicKey:
    """Carica chiave pubblica X25519 da bytes raw."""
    return X25519PublicKey.from_public_bytes(raw)


def load_public_key_from_b64(b64: str) -> X25519PublicKey:
    """Carica chiave pubblica X25519 da base64."""
    return load_public_key_from_bytes(base64.b64decode(b64))


def load_private_key_from_bytes(raw: bytes) -> X25519PrivateKey:
    """Carica chiave privata X25519 da bytes raw."""
    return X25519PrivateKey.from_private_bytes(raw)
