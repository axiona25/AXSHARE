"""
AES-256-GCM per cifratura simmetrica di file e chiavi.
Cuore della cifratura E2E: ogni file ha chiave propria, IV random, tag GCM per integrità.
"""

import os
import base64
from dataclasses import dataclass
from typing import Optional

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

AES_KEY_SIZE = 32       # 256 bit
AES_NONCE_SIZE = 12     # 96 bit (standard GCM)
AES_TAG_SIZE = 16       # 128 bit (tag autenticazione GCM)


@dataclass
class EncryptedData:
    """Contenitore per dati cifrati con AES-256-GCM."""
    ciphertext: bytes
    nonce: bytes
    key: bytes

    def to_storage_format(self) -> bytes:
        """Formato: [12 bytes nonce][N bytes ciphertext+tag]"""
        return self.nonce + self.ciphertext

    @classmethod
    def from_storage_format(cls, data: bytes, key: bytes) -> "EncryptedData":
        nonce = data[:AES_NONCE_SIZE]
        ciphertext = data[AES_NONCE_SIZE:]
        return cls(ciphertext=ciphertext, nonce=nonce, key=key)

    def nonce_b64(self) -> str:
        return base64.b64encode(self.nonce).decode("utf-8")

    def key_b64(self) -> str:
        return base64.b64encode(self.key).decode("utf-8")


def generate_file_key() -> bytes:
    """Genera chiave AES-256 random. Ogni file DEVE avere la propria chiave."""
    return os.urandom(AES_KEY_SIZE)


def generate_nonce() -> bytes:
    """Genera nonce random per AES-GCM. MAI riutilizzare."""
    return os.urandom(AES_NONCE_SIZE)


def encrypt(plaintext: bytes, key: bytes, aad: Optional[bytes] = None) -> EncryptedData:
    """
    Cifra dati con AES-256-GCM.
    aad: Additional Authenticated Data — non cifrata ma autenticata.
    Usare file_id come aad per legare il ciphertext al file specifico.
    """
    if len(key) != AES_KEY_SIZE:
        raise ValueError(f"Chiave AES deve essere {AES_KEY_SIZE} bytes, ricevuto {len(key)}")
    nonce = generate_nonce()
    aesgcm = AESGCM(key)
    ciphertext = aesgcm.encrypt(nonce, plaintext, aad)
    return EncryptedData(ciphertext=ciphertext, nonce=nonce, key=key)


def decrypt(encrypted: EncryptedData, aad: Optional[bytes] = None) -> bytes:
    """
    Decifra dati con AES-256-GCM.
    Solleva InvalidTag se dati manomessi, chiave sbagliata o AAD errato.
    """
    aesgcm = AESGCM(encrypted.key)
    return aesgcm.decrypt(encrypted.nonce, encrypted.ciphertext, aad)


def decrypt_raw(ciphertext: bytes, nonce: bytes, key: bytes, aad: Optional[bytes] = None) -> bytes:
    """Decifra passando ciphertext, nonce e key separatamente."""
    aesgcm = AESGCM(key)
    return aesgcm.decrypt(nonce, ciphertext, aad)


def encrypt_string(plaintext: str, key: bytes, aad: Optional[bytes] = None) -> str:
    """Cifra stringa, restituisce base64(nonce+ciphertext). Per nomi file e metadati."""
    encrypted = encrypt(plaintext.encode("utf-8"), key, aad)
    return base64.b64encode(encrypted.to_storage_format()).decode("utf-8")


def decrypt_string(encrypted_b64: str, key: bytes, aad: Optional[bytes] = None) -> str:
    """Decifra stringa cifrata con encrypt_string."""
    data = base64.b64decode(encrypted_b64)
    encrypted = EncryptedData.from_storage_format(data, key)
    return decrypt(encrypted, aad).decode("utf-8")


def encrypt_key(key_to_wrap: bytes, wrapping_key: bytes) -> str:
    """Key wrapping locale: cifra una chiave con un'altra. Restituisce base64."""
    encrypted = encrypt(key_to_wrap, wrapping_key)
    return base64.b64encode(encrypted.to_storage_format()).decode("utf-8")


def decrypt_key(wrapped_key_b64: str, wrapping_key: bytes) -> bytes:
    """Decifra una chiave wrappata con encrypt_key."""
    data = base64.b64decode(wrapped_key_b64)
    encrypted = EncryptedData.from_storage_format(data, wrapping_key)
    return decrypt(encrypted)


def derive_key_from_bytes(
    master: bytes, salt: bytes, info: bytes = b"axshare-file-key"
) -> bytes:
    """Deriva chiave AES-256 da master secret con HKDF-SHA256."""
    from cryptography.hazmat.primitives.kdf.hkdf import HKDF
    from cryptography.hazmat.primitives import hashes

    hkdf = HKDF(
        algorithm=hashes.SHA256(),
        length=AES_KEY_SIZE,
        salt=salt,
        info=info,
    )
    return hkdf.derive(master)


class AESCipher:
    """
    Facade per cifratura file chunked (E2E). Usa AES-256-GCM; formato: [nonce][ciphertext+tag].
    Per test e client: generate_key() + encrypt_file_chunked(plaintext, key, file_id).
    """

    @staticmethod
    def generate_key() -> bytes:
        """Genera DEK AES-256 per un file."""
        return generate_file_key()

    @staticmethod
    def encrypt_file_chunked(
        plaintext: bytes, key: bytes, file_id: str
    ) -> bytes:
        """
        Cifra il contenuto (o un chunk) con AAD=file_id.
        Restituisce bytes in formato storage: [12 bytes nonce][ciphertext+tag].
        """
        aad = file_id.encode("utf-8") if file_id else None
        encrypted = encrypt(plaintext, key, aad=aad)
        return encrypted.to_storage_format()
