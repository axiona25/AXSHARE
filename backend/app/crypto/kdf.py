"""
KDF (Key Derivation Function) — Argon2id per derivazione KEK dalla password.
Punto critico del sistema zero-knowledge: il server non conosce la password.
"""

import hashlib
import hmac
import os
from dataclasses import dataclass
from typing import Optional

from argon2.low_level import Type, hash_secret_raw

# Parametri Argon2id OWASP 2024
ARGON2_MEMORY_COST = 65536  # 64 MB (in kibibytes)
ARGON2_TIME_COST = 3  # 3 iterazioni
ARGON2_PARALLELISM = 4  # 4 thread paralleli
ARGON2_HASH_LEN = 32  # 256 bit output (AES-256 key)
ARGON2_SALT_LEN = 32  # 256 bit salt

# Parametri PBKDF2 fallback
PBKDF2_ITERATIONS = 600_000  # OWASP 2024 raccomandazione
PBKDF2_HASH_LEN = 32


@dataclass
class DerivedKey:
    """Risultato della derivazione della chiave."""
    key: bytes  # chiave AES-256 derivata (32 bytes)
    salt: bytes  # salt usato (da salvare nel DB)
    algorithm: str  # "argon2id" o "pbkdf2"


def generate_salt() -> bytes:
    """Genera salt random per KDF. Deve essere unico per ogni utente."""
    return os.urandom(ARGON2_SALT_LEN)


def derive_key_from_password(
    password: str,
    salt: Optional[bytes] = None,
    algorithm: str = "argon2id",
) -> DerivedKey:
    """
    Deriva una chiave AES-256 dalla password utente.

    IMPORTANTE: questa chiave viene usata per cifrare le chiavi private
    RSA e X25519 dell'utente. Non viene mai inviata al server.

    Args:
        password: password utente in chiaro (solo in memoria client-side)
        salt: salt da usare (se None viene generato automaticamente)
              Usare il salt salvato nel DB per ri-derivare la stessa chiave
        algorithm: "argon2id" (default) o "pbkdf2" (fallback)

    Returns:
        DerivedKey con key, salt e algorithm usato
    """
    if salt is None:
        salt = generate_salt()

    if algorithm == "argon2id":
        key = hash_secret_raw(
            secret=password.encode("utf-8"),
            salt=salt,
            time_cost=ARGON2_TIME_COST,
            memory_cost=ARGON2_MEMORY_COST,
            parallelism=ARGON2_PARALLELISM,
            hash_len=ARGON2_HASH_LEN,
            type=Type.ID,
        )
    elif algorithm == "pbkdf2":
        key = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            salt,
            PBKDF2_ITERATIONS,
            dklen=PBKDF2_HASH_LEN,
        )
    else:
        raise ValueError(f"Algoritmo KDF non supportato: {algorithm}")

    return DerivedKey(key=key, salt=salt, algorithm=algorithm)


def derive_key_deterministic(
    password: str,
    salt: bytes,
    algorithm: str = "argon2id",
) -> bytes:
    """
    Deriva la stessa chiave dalla password e dal salt salvato nel DB.
    Usare per: ri-derivare la KEK al login per decifrare le chiavi private.

    Args:
        password: password utente
        salt: salt salvato nel DB alla registrazione (MAI cambiare)

    Returns:
        chiave AES-256 (stessa prodotta alla registrazione)
    """
    result = derive_key_from_password(password, salt=salt, algorithm=algorithm)
    return result.key


def hash_password_for_storage(password: str) -> str:
    """
    Hash della password per verifica login (separato dalla KEK derivation).
    Usa argon2-cffi che produce un hash con parametri embedded.

    NOTA: questo hash e' usato SOLO per verificare la password al login.
    NON e' la KEK — la KEK viene derivata separatamente con derive_key_from_password.

    Returns:
        hash Argon2id con formato "$argon2id$v=19$..."
    """
    from argon2 import PasswordHasher

    ph = PasswordHasher(
        memory_cost=ARGON2_MEMORY_COST,
        time_cost=ARGON2_TIME_COST,
        parallelism=ARGON2_PARALLELISM,
    )
    return ph.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    """
    Verifica la password contro l'hash salvato nel DB.

    Returns:
        True se la password e' corretta
    """
    from argon2 import PasswordHasher
    from argon2.exceptions import VerifyMismatchError, VerificationError

    ph = PasswordHasher()
    try:
        ph.verify(password_hash, password)
        return True
    except (VerifyMismatchError, VerificationError):
        return False


def needs_rehash(password_hash: str) -> bool:
    """
    Verifica se l'hash deve essere aggiornato (parametri obsoleti).
    Chiamare dopo ogni login riuscito.
    """
    from argon2 import PasswordHasher

    ph = PasswordHasher(
        memory_cost=ARGON2_MEMORY_COST,
        time_cost=ARGON2_TIME_COST,
        parallelism=ARGON2_PARALLELISM,
    )
    return ph.check_needs_rehash(password_hash)


def derive_session_key(
    user_id: str, session_id: str, master_secret: bytes
) -> bytes:
    """
    Deriva una chiave di sessione effimera usando HMAC-SHA256.
    Usata per cifrare dati di sessione temporanei.
    Non e' persistente — viene ricalcolata ad ogni sessione.
    """
    message = f"{user_id}:{session_id}".encode("utf-8")
    return hmac.new(master_secret, message, hashlib.sha256).digest()


def secure_compare(a: bytes, b: bytes) -> bool:
    """
    Confronto di byte array in tempo costante.
    Previene timing attacks nella verifica di chiavi/token.
    """
    return hmac.compare_digest(a, b)
