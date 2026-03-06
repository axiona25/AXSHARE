"""
RSA-4096 per keypair utente, cifratura file_key per condivisione E2E,
storage cifrato della chiave privata (AES-GCM da password).
"""

import base64
from dataclasses import dataclass

from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPrivateKey, RSAPublicKey

RSA_KEY_SIZE = 4096
RSA_PUBLIC_EXPONENT = 65537


@dataclass
class RSAKeyPair:
    """Keypair RSA-4096 per un utente AXSHARE."""
    private_key: RSAPrivateKey
    public_key: RSAPublicKey

    def public_key_pem(self) -> str:
        """Chiave pubblica in formato PEM — salvabile nel DB in chiaro."""
        return self.public_key.public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        ).decode("utf-8")

    def private_key_pem(self) -> str:
        """
        Chiave privata in PEM NON cifrata.
        ATTENZIONE: usare solo in memoria, mai salvare in questa forma.
        Chiamare encrypt_private_key() prima di salvare.
        """
        return self.private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        ).decode("utf-8")


def generate_keypair() -> RSAKeyPair:
    """
    Genera keypair RSA-4096 per un nuovo utente.
    Chiamare una volta sola alla registrazione.
    La generazione richiede ~1-2 secondi — e' normale.
    """
    private_key = rsa.generate_private_key(
        public_exponent=RSA_PUBLIC_EXPONENT,
        key_size=RSA_KEY_SIZE,
        backend=default_backend(),
    )
    return RSAKeyPair(
        private_key=private_key,
        public_key=private_key.public_key(),
    )


def encrypt_with_public_key(plaintext: bytes, public_key_pem: str) -> str:
    """
    Cifra dati con chiave pubblica RSA (OAEP + SHA-256).
    USO: cifrare la file_key per un destinatario specifico.
    Limiti: max ~446 bytes per RSA-4096. Per file key (32 bytes) e' perfetto.

    Returns:
        ciphertext in base64
    """
    public_key = serialization.load_pem_public_key(
        public_key_pem.encode("utf-8"),
        backend=default_backend(),
    )
    ciphertext = public_key.encrypt(
        plaintext,
        padding.OAEP(
            mgf=padding.MGF1(algorithm=hashes.SHA256()),
            algorithm=hashes.SHA256(),
            label=None,
        ),
    )
    return base64.b64encode(ciphertext).decode("utf-8")


def decrypt_with_private_key(ciphertext_b64: str, private_key_pem: str) -> bytes:
    """
    Decifra dati con chiave privata RSA (OAEP + SHA-256).
    USO: recuperare la file_key cifrata con la propria chiave pubblica.

    Args:
        ciphertext_b64: ciphertext in base64
        private_key_pem: chiave privata PEM NON cifrata (gia' decifrata in memoria)
    """
    private_key = serialization.load_pem_private_key(
        private_key_pem.encode("utf-8"),
        password=None,
        backend=default_backend(),
    )
    ciphertext = base64.b64decode(ciphertext_b64)
    return private_key.decrypt(
        ciphertext,
        padding.OAEP(
            mgf=padding.MGF1(algorithm=hashes.SHA256()),
            algorithm=hashes.SHA256(),
            label=None,
        ),
    )


def encrypt_private_key(private_key_pem: str, aes_key: bytes) -> str:
    """
    Cifra la chiave privata RSA con AES-256-GCM prima di salvarla nel DB.
    L'AES key viene derivata dalla password utente (mai nota al server).

    Returns:
        chiave privata cifrata in base64 (nonce + ciphertext)
    """
    from app.crypto.aes import encrypt as aes_encrypt

    encrypted = aes_encrypt(private_key_pem.encode("utf-8"), aes_key)
    return base64.b64encode(encrypted.to_storage_format()).decode("utf-8")


def decrypt_private_key(encrypted_private_key_b64: str, aes_key: bytes) -> str:
    """
    Decifra la chiave privata RSA dal DB usando la AES key derivata dalla password.
    Restituisce il PEM della chiave privata — usare solo in memoria.

    Args:
        encrypted_private_key_b64: chiave privata cifrata (dal DB)
        aes_key: chiave AES derivata dalla password utente

    Returns:
        PEM della chiave privata in chiaro (solo in memoria!)
    """
    from app.crypto.aes import EncryptedData, decrypt as aes_decrypt

    data = base64.b64decode(encrypted_private_key_b64)
    encrypted = EncryptedData.from_storage_format(data, aes_key)
    return aes_decrypt(encrypted).decode("utf-8")


def load_public_key_from_pem(pem: str) -> RSAPublicKey:
    """Carica chiave pubblica da PEM."""
    return serialization.load_pem_public_key(
        pem.encode("utf-8"),
        backend=default_backend(),
    )


def load_private_key_from_pem(pem: str) -> RSAPrivateKey:
    """Carica chiave privata da PEM (non cifrata, gia' in memoria)."""
    return serialization.load_pem_private_key(
        pem.encode("utf-8"),
        password=None,
        backend=default_backend(),
    )


def sign_data(data: bytes, private_key_pem: str) -> str:
    """
    Firma dati con RSA-PSS + SHA-256.
    Usare per firme leggere su hash — per firma PDF completa usare pyHanko (Fase 9).

    Returns:
        firma in base64
    """
    private_key = load_private_key_from_pem(private_key_pem)
    signature = private_key.sign(
        data,
        padding.PSS(
            mgf=padding.MGF1(hashes.SHA256()),
            salt_length=padding.PSS.MAX_LENGTH,
        ),
        hashes.SHA256(),
    )
    return base64.b64encode(signature).decode("utf-8")


def verify_signature(data: bytes, signature_b64: str, public_key_pem: str) -> bool:
    """
    Verifica firma RSA-PSS.

    Returns:
        True se la firma e' valida, False altrimenti
    """
    from cryptography.exceptions import InvalidSignature

    public_key = load_public_key_from_pem(public_key_pem)
    signature = base64.b64decode(signature_b64)
    try:
        public_key.verify(
            signature,
            data,
            padding.PSS(
                mgf=padding.MGF1(hashes.SHA256()),
                salt_length=padding.PSS.MAX_LENGTH,
            ),
            hashes.SHA256(),
        )
        return True
    except InvalidSignature:
        return False
