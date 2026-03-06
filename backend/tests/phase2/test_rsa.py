"""Test modulo RSA-4096 — TASK 2.2"""

import pytest

from app.crypto.aes import generate_file_key
from app.crypto.rsa import (
    RSAKeyPair,
    decrypt_private_key,
    decrypt_with_private_key,
    encrypt_private_key,
    encrypt_with_public_key,
    generate_keypair,
    sign_data,
    verify_signature,
)


@pytest.fixture(scope="module")
def keypair() -> RSAKeyPair:
    """Genera keypair RSA una volta per tutti i test del modulo."""
    return generate_keypair()


def test_generate_keypair(keypair):
    assert keypair.private_key is not None
    assert keypair.public_key is not None
    pem = keypair.public_key_pem()
    assert pem.startswith("-----BEGIN PUBLIC KEY-----")
    priv_pem = keypair.private_key_pem()
    assert priv_pem.startswith("-----BEGIN PRIVATE KEY-----")


def test_keypair_uniqueness():
    """Due keypair generati devono essere diversi."""
    kp1 = generate_keypair()
    kp2 = generate_keypair()
    assert kp1.public_key_pem() != kp2.public_key_pem()


def test_encrypt_decrypt_file_key(keypair):
    """Cifra e decifra una file_key con RSA."""
    file_key = generate_file_key()  # 32 bytes
    encrypted = encrypt_with_public_key(file_key, keypair.public_key_pem())
    decrypted = decrypt_with_private_key(encrypted, keypair.private_key_pem())
    assert decrypted == file_key


def test_encrypt_decrypt_roundtrip(keypair):
    """Roundtrip con dati arbitrari."""
    data = b"chiave segreta da condividere"
    encrypted = encrypt_with_public_key(data, keypair.public_key_pem())
    assert isinstance(encrypted, str)
    decrypted = decrypt_with_private_key(encrypted, keypair.private_key_pem())
    assert decrypted == data


def test_wrong_private_key_fails():
    """Decifratura con chiave privata sbagliata deve fallire."""
    kp1 = generate_keypair()
    kp2 = generate_keypair()
    encrypted = encrypt_with_public_key(b"data", kp1.public_key_pem())
    with pytest.raises(Exception):
        decrypt_with_private_key(encrypted, kp2.private_key_pem())


def test_encrypt_decrypt_private_key(keypair):
    """La chiave privata cifrata con AES deve essere recuperabile."""
    aes_key = generate_file_key()
    private_pem = keypair.private_key_pem()
    encrypted_priv = encrypt_private_key(private_pem, aes_key)
    assert isinstance(encrypted_priv, str)
    decrypted_priv = decrypt_private_key(encrypted_priv, aes_key)
    assert decrypted_priv == private_pem


def test_decrypt_private_key_wrong_aes_key_fails(keypair):
    """Chiave privata cifrata non decifra con AES key sbagliata."""
    aes_key = generate_file_key()
    wrong_key = generate_file_key()
    encrypted_priv = encrypt_private_key(keypair.private_key_pem(), aes_key)
    with pytest.raises(Exception):
        decrypt_private_key(encrypted_priv, wrong_key)


def test_sign_verify(keypair):
    """Firma e verifica dati."""
    data = b"documento da firmare"
    signature = sign_data(data, keypair.private_key_pem())
    assert verify_signature(data, signature, keypair.public_key_pem()) is True


def test_verify_wrong_data_fails(keypair):
    """Verifica deve fallire se i dati sono stati modificati."""
    data = b"documento originale"
    signature = sign_data(data, keypair.private_key_pem())
    assert (
        verify_signature(b"documento modificato", signature, keypair.public_key_pem())
        is False
    )


def test_verify_wrong_key_fails(keypair):
    """Verifica deve fallire con chiave pubblica sbagliata."""
    data = b"test"
    signature = sign_data(data, keypair.private_key_pem())
    wrong_kp = generate_keypair()
    assert verify_signature(data, signature, wrong_kp.public_key_pem()) is False


def test_e2e_file_sharing_flow():
    """
    Simula il flusso E2E completo:
    Utente A carica file -> cifra file_key con pubkey di B -> B decifra e accede al file
    """
    user_a = generate_keypair()
    user_b = generate_keypair()

    # A genera chiave del file
    file_key = generate_file_key()

    # A cifra il file (simulato)
    from app.crypto.aes import EncryptedData, decrypt as aes_decrypt, encrypt as aes_encrypt

    plaintext = b"contenuto del file riservato"
    encrypted_file = aes_encrypt(plaintext, file_key)

    # A condivide con B: cifra file_key con pubkey di B
    file_key_for_b = encrypt_with_public_key(file_key, user_b.public_key_pem())

    # B riceve e decifra la file_key con la propria chiave privata
    recovered_file_key = decrypt_with_private_key(file_key_for_b, user_b.private_key_pem())
    assert recovered_file_key == file_key

    # B decifra il file
    enc_with_b_key = EncryptedData(
        ciphertext=encrypted_file.ciphertext,
        nonce=encrypted_file.nonce,
        key=recovered_file_key,
    )
    decrypted = aes_decrypt(enc_with_b_key)
    assert decrypted == plaintext
