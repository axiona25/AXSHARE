"""Test modulo KDF Argon2id — TASK 2.5"""
import os
import pytest

from app.crypto.kdf import (
    derive_key_from_password,
    derive_key_deterministic,
    hash_password_for_storage,
    verify_password,
    needs_rehash,
    generate_salt,
    secure_compare,
    ARGON2_HASH_LEN,
    ARGON2_SALT_LEN,
)


def test_generate_salt():
    salt = generate_salt()
    assert len(salt) == ARGON2_SALT_LEN
    assert generate_salt() != generate_salt()


def test_derive_key_argon2id():
    result = derive_key_from_password("password-sicura-2026")
    assert len(result.key) == ARGON2_HASH_LEN
    assert len(result.salt) == ARGON2_SALT_LEN
    assert result.algorithm == "argon2id"


def test_derive_key_deterministic():
    """Stessa password + stesso salt = stessa chiave."""
    salt = generate_salt()
    k1 = derive_key_deterministic("mia-password", salt)
    k2 = derive_key_deterministic("mia-password", salt)
    assert k1 == k2


def test_derive_key_different_passwords():
    """Password diverse producono chiavi diverse."""
    salt = generate_salt()
    k1 = derive_key_deterministic("password-A", salt)
    k2 = derive_key_deterministic("password-B", salt)
    assert k1 != k2


def test_derive_key_different_salts():
    """Salt diversi producono chiavi diverse (anche con stessa password)."""
    password = "stessa-password"
    k1 = derive_key_deterministic(password, generate_salt())
    k2 = derive_key_deterministic(password, generate_salt())
    assert k1 != k2


def test_derive_key_pbkdf2_fallback():
    result = derive_key_from_password("password", algorithm="pbkdf2")
    assert len(result.key) == 32
    assert result.algorithm == "pbkdf2"


def test_derive_key_invalid_algorithm():
    with pytest.raises(ValueError):
        derive_key_from_password("password", algorithm="md5")


def test_hash_password_for_storage():
    pw_hash = hash_password_for_storage("mia-password")
    assert pw_hash.startswith("$argon2id$")


def test_verify_password_correct():
    password = "password-corretta-2026"
    pw_hash = hash_password_for_storage(password)
    assert verify_password(password, pw_hash) is True


def test_verify_password_wrong():
    pw_hash = hash_password_for_storage("password-corretta")
    assert verify_password("password-sbagliata", pw_hash) is False


def test_needs_rehash():
    pw_hash = hash_password_for_storage("password")
    assert needs_rehash(pw_hash) is False


def test_secure_compare():
    a = os.urandom(32)
    b = os.urandom(32)
    assert secure_compare(a, a) is True
    assert secure_compare(a, b) is False


def test_kek_workflow():
    """
    Test workflow completo KEK:
    Registrazione -> salva salt nel DB
    Login -> ri-deriva KEK dalla password
    Usa KEK per cifrare/decifrare chiave privata RSA
    """
    from app.crypto.rsa import (
        generate_keypair,
        encrypt_private_key,
        decrypt_private_key,
    )

    password = "password-utente-sicura-2026!"

    # Registrazione: deriva KEK e genera keypair
    derived = derive_key_from_password(password)
    kek = derived.key
    salt = derived.salt  # salvare nel DB

    keypair = generate_keypair()
    private_pem = keypair.private_key_pem()

    # Cifra la chiave privata con la KEK
    encrypted_private = encrypt_private_key(private_pem, kek)

    # Login: ri-deriva KEK dallo stesso salt
    kek_recovered = derive_key_deterministic(password, salt)
    assert kek_recovered == kek

    # Decifra la chiave privata con la KEK recuperata
    decrypted_private = decrypt_private_key(encrypted_private, kek_recovered)
    assert decrypted_private == private_pem
