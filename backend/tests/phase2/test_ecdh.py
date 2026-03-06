"""Test modulo X25519 ECDH — TASK 2.3"""
import os
import pytest
from cryptography.hazmat.primitives import serialization

from app.crypto.aes import generate_file_key
from app.crypto.ecdh import (
    generate_x25519_keypair,
    compute_shared_secret,
    derive_group_key,
    encrypt_x25519_private_key,
    decrypt_x25519_private_key,
    load_public_key_from_b64,
    X25519KeyPair,
)


def test_generate_keypair():
    kp = generate_x25519_keypair()
    assert len(kp.public_key_bytes()) == 32
    assert len(kp.private_key_bytes()) == 32


def test_keypair_uniqueness():
    kp1 = generate_x25519_keypair()
    kp2 = generate_x25519_keypair()
    assert kp1.public_key_b64() != kp2.public_key_b64()


def test_shared_secret_symmetry():
    """Alice e Bob devono ottenere lo stesso shared secret."""
    alice = generate_x25519_keypair()
    bob = generate_x25519_keypair()
    secret_alice = compute_shared_secret(
        alice.private_key,
        bob.public_key,
    )
    secret_bob = compute_shared_secret(
        bob.private_key,
        alice.public_key,
    )
    assert secret_alice == secret_bob
    assert len(secret_alice) == 32


def test_shared_secret_from_bytes():
    """Shared secret calcolabile anche da bytes raw."""
    alice = generate_x25519_keypair()
    bob = generate_x25519_keypair()
    secret1 = compute_shared_secret(
        alice.private_key_bytes(),
        bob.public_key_bytes(),
    )
    secret2 = compute_shared_secret(
        alice.private_key,
        bob.public_key,
    )
    assert secret1 == secret2


def test_different_pairs_different_secrets():
    """Coppie diverse producono shared secret diversi."""
    alice = generate_x25519_keypair()
    bob = generate_x25519_keypair()
    carol = generate_x25519_keypair()
    secret_ab = compute_shared_secret(alice.private_key, bob.public_key)
    secret_ac = compute_shared_secret(alice.private_key, carol.public_key)
    assert secret_ab != secret_ac


def test_derive_group_key():
    """Derivazione chiave gruppo da shared secret."""
    alice = generate_x25519_keypair()
    bob = generate_x25519_keypair()
    shared = compute_shared_secret(alice.private_key, bob.public_key)
    group_id = "gruppo-test-123"
    key, salt = derive_group_key(shared, group_id)
    assert len(key) == 32
    assert len(salt) == 32


def test_derive_group_key_deterministic():
    """Stessi input producono stessa chiave (deterministica con salt fisso)."""
    alice = generate_x25519_keypair()
    bob = generate_x25519_keypair()
    shared = compute_shared_secret(alice.private_key, bob.public_key)
    salt = os.urandom(32)
    key1, _ = derive_group_key(shared, "gruppo-123", salt=salt)
    key2, _ = derive_group_key(shared, "gruppo-123", salt=salt)
    assert key1 == key2


def test_derive_group_key_different_groups():
    """Gruppi diversi producono chiavi diverse (anche con stesso shared secret)."""
    alice = generate_x25519_keypair()
    bob = generate_x25519_keypair()
    shared = compute_shared_secret(alice.private_key, bob.public_key)
    salt = os.urandom(32)
    key1, _ = derive_group_key(shared, "gruppo-A", salt=salt)
    key2, _ = derive_group_key(shared, "gruppo-B", salt=salt)
    assert key1 != key2


def test_encrypt_decrypt_private_key():
    """Chiave privata X25519 cifrata con AES deve essere recuperabile."""
    kp = generate_x25519_keypair()
    aes_key = generate_file_key()
    encrypted = encrypt_x25519_private_key(kp.private_key_bytes(), aes_key)
    recovered = decrypt_x25519_private_key(encrypted, aes_key)
    assert recovered == kp.private_key_bytes()


def test_load_public_key_from_b64():
    """Caricamento chiave pubblica da base64."""
    kp = generate_x25519_keypair()
    b64 = kp.public_key_b64()
    loaded = load_public_key_from_b64(b64)
    raw_loaded = loaded.public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    assert raw_loaded == kp.public_key_bytes()


def test_e2e_group_flow():
    """
    Simula flusso completo gruppo con 3 membri:
    - Alice crea il gruppo e genera la chiave gruppo
    - Bob e Carol ricevono la chiave cifrata con ECDH
    - Tutti decifrano e ottengono la stessa chiave gruppo
    """
    alice = generate_x25519_keypair()
    bob = generate_x25519_keypair()
    carol = generate_x25519_keypair()

    group_id = "gruppo-progetto-x"

    # Alice calcola shared secret con Bob e deriva la group key per Bob
    secret_ab = compute_shared_secret(alice.private_key, bob.public_key)
    salt_b = os.urandom(32)
    group_key_for_b, _ = derive_group_key(secret_ab, group_id, salt=salt_b)

    # Alice calcola shared secret con Carol e deriva la group key per Carol
    secret_ac = compute_shared_secret(alice.private_key, carol.public_key)
    salt_c = os.urandom(32)
    group_key_for_c, _ = derive_group_key(secret_ac, group_id, salt=salt_c)

    # Cifra il file con la group key di Alice (come owner)
    from app.crypto.aes import generate_file_key, encrypt_key, decrypt_key

    file_key = generate_file_key()
    file_key_for_b = encrypt_key(file_key, group_key_for_b)
    file_key_for_c = encrypt_key(file_key, group_key_for_c)

    # Bob recupera la group key e decifra la file_key
    secret_ba = compute_shared_secret(bob.private_key, alice.public_key)
    group_key_b_recovered, _ = derive_group_key(secret_ba, group_id, salt=salt_b)
    assert decrypt_key(file_key_for_b, group_key_b_recovered) == file_key

    # Carol recupera la group key e decifra la file_key
    secret_ca = compute_shared_secret(carol.private_key, alice.public_key)
    group_key_c_recovered, _ = derive_group_key(secret_ca, group_id, salt=salt_c)
    assert decrypt_key(file_key_for_c, group_key_c_recovered) == file_key
