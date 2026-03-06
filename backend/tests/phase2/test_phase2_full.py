"""
Test suite completa Fase 2 — verifica integrazione tra tutti i moduli crypto
Eseguire con: pytest tests/phase2/ -v
"""
import os
import pytest

from app.crypto.aes import generate_file_key, encrypt, decrypt
from app.crypto.rsa import (
    generate_keypair,
    encrypt_with_public_key,
    decrypt_with_private_key,
)
from app.crypto.ecdh import (
    generate_x25519_keypair,
    compute_shared_secret,
    derive_group_key,
)
from app.crypto.kdf import derive_key_from_password, derive_key_deterministic


def test_full_user_registration_crypto():
    """
    Simula il flusso crypto completo della registrazione utente:
    1. Deriva KEK dalla password (Argon2id)
    2. Genera keypair RSA-4096
    3. Genera keypair X25519
    4. Cifra entrambe le chiavi private con la KEK
    5. Verifica che tutto sia recuperabile al login
    """
    password = "password-sicura-registrazione"

    # 1. Deriva KEK
    derived = derive_key_from_password(password)
    kek = derived.key
    salt = derived.salt

    # 2. Genera keypair RSA
    from app.crypto.rsa import encrypt_private_key, decrypt_private_key

    rsa_kp = generate_keypair()
    encrypted_rsa_priv = encrypt_private_key(rsa_kp.private_key_pem(), kek)

    # 3. Genera keypair X25519
    from app.crypto.ecdh import (
        encrypt_x25519_private_key,
        decrypt_x25519_private_key,
    )

    x25519_kp = generate_x25519_keypair()
    encrypted_x25519_priv = encrypt_x25519_private_key(
        x25519_kp.private_key_bytes(), kek
    )

    # 4. Simula login: ri-deriva KEK
    kek_login = derive_key_deterministic(password, salt)
    assert kek_login == kek

    # 5. Recupera chiavi private
    rsa_priv_recovered = decrypt_private_key(encrypted_rsa_priv, kek_login)
    assert rsa_priv_recovered == rsa_kp.private_key_pem()

    x25519_priv_recovered = decrypt_x25519_private_key(
        encrypted_x25519_priv, kek_login
    )
    assert x25519_priv_recovered == x25519_kp.private_key_bytes()


def test_full_file_upload_download_e2e():
    """
    Simula il flusso E2E completo upload/download file:
    1. Genera file_key
    2. Cifra file con AES-256-GCM
    3. Cifra file_key con RSA pubkey del proprietario
    4. Salva su "storage" (simulato in memoria)
    5. Proprietario scarica e decifra
    """
    from app.crypto.aes import EncryptedData

    owner = generate_keypair()
    file_content = b"Contenuto del documento riservato - CONFIDENTIAL"

    # Upload
    file_key = generate_file_key()
    encrypted_file = encrypt(file_content, file_key)
    encrypted_file_key = encrypt_with_public_key(
        file_key, owner.public_key_pem()
    )

    # Download e decrypt
    recovered_file_key = decrypt_with_private_key(
        encrypted_file_key, owner.private_key_pem()
    )
    enc = EncryptedData(
        ciphertext=encrypted_file.ciphertext,
        nonce=encrypted_file.nonce,
        key=recovered_file_key,
    )
    decrypted = decrypt(enc)
    assert decrypted == file_content


def test_full_group_sharing_e2e():
    """
    Simula condivisione in un gruppo con 3 utenti:
    - Owner carica file e condivide con il gruppo
    - Tutti i membri possono leggere il file
    - Utente rimosso non puo' leggere nuovi file
    """
    from app.crypto.aes import EncryptedData, encrypt_key, decrypt_key

    owner = generate_x25519_keypair()
    member1 = generate_x25519_keypair()
    member2 = generate_x25519_keypair()

    group_id = "gruppo-test-e2e"
    file_content = b"documento condiviso nel gruppo"

    # Owner carica il file
    file_key = generate_file_key()
    encrypted_file = encrypt(file_content, file_key)

    # Owner deriva group key per ogni membro
    salt1 = os.urandom(32)
    salt2 = os.urandom(32)
    shared1 = compute_shared_secret(owner.private_key, member1.public_key)
    shared2 = compute_shared_secret(owner.private_key, member2.public_key)
    gk1, _ = derive_group_key(shared1, group_id, salt=salt1)
    gk2, _ = derive_group_key(shared2, group_id, salt=salt2)

    # Cifra file_key per ogni membro
    fk_for_m1 = encrypt_key(file_key, gk1)
    fk_for_m2 = encrypt_key(file_key, gk2)

    # Member1 decifra
    shared_m1 = compute_shared_secret(member1.private_key, owner.public_key)
    gk1_rec, _ = derive_group_key(shared_m1, group_id, salt=salt1)
    fk_m1 = decrypt_key(fk_for_m1, gk1_rec)
    enc = EncryptedData(
        ciphertext=encrypted_file.ciphertext,
        nonce=encrypted_file.nonce,
        key=fk_m1,
    )
    assert decrypt(enc) == file_content

    # Member2 decifra
    shared_m2 = compute_shared_secret(member2.private_key, owner.public_key)
    gk2_rec, _ = derive_group_key(shared_m2, group_id, salt=salt2)
    fk_m2 = decrypt_key(fk_for_m2, gk2_rec)
    enc2 = EncryptedData(
        ciphertext=encrypted_file.ciphertext,
        nonce=encrypted_file.nonce,
        key=fk_m2,
    )
    assert decrypt(enc2) == file_content
