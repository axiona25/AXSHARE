"""Test modulo AES-256-GCM — TASK 2.1"""

import os

import pytest
from cryptography.exceptions import InvalidTag

from app.crypto.aes import (
    AES_KEY_SIZE,
    AES_NONCE_SIZE,
    EncryptedData,
    decrypt,
    decrypt_key,
    decrypt_raw,
    decrypt_string,
    derive_key_from_bytes,
    encrypt,
    encrypt_key,
    encrypt_string,
    generate_file_key,
    generate_nonce,
)


def test_generate_file_key():
    key = generate_file_key()
    assert len(key) == AES_KEY_SIZE
    assert generate_file_key() != generate_file_key()


def test_generate_nonce():
    nonce = generate_nonce()
    assert len(nonce) == AES_NONCE_SIZE
    assert generate_nonce() != generate_nonce()


def test_encrypt_decrypt_roundtrip():
    key = generate_file_key()
    plaintext = b"AXSHARE test content cifrato"
    assert decrypt(encrypt(plaintext, key)) == plaintext


def test_encrypt_decrypt_with_aad():
    key = generate_file_key()
    plaintext = b"file content"
    aad = b"file-id-12345"
    assert decrypt(encrypt(plaintext, key, aad=aad), aad=aad) == plaintext


def test_decrypt_wrong_aad_fails():
    key = generate_file_key()
    encrypted = encrypt(b"data", key, aad=b"correct")
    with pytest.raises(InvalidTag):
        decrypt(encrypted, aad=b"wrong")


def test_decrypt_wrong_key_fails():
    key = generate_file_key()
    wrong_key = generate_file_key()
    encrypted = encrypt(b"data", key)
    wrong = EncryptedData(
        ciphertext=encrypted.ciphertext,
        nonce=encrypted.nonce,
        key=wrong_key,
    )
    with pytest.raises(InvalidTag):
        decrypt(wrong)


def test_decrypt_tampered_ciphertext_fails():
    key = generate_file_key()
    encrypted = encrypt(b"original", key)
    tampered = bytearray(encrypted.ciphertext)
    tampered[0] ^= 0xFF
    bad = EncryptedData(
        ciphertext=bytes(tampered),
        nonce=encrypted.nonce,
        key=key,
    )
    with pytest.raises(InvalidTag):
        decrypt(bad)


def test_nonce_uniqueness():
    key = generate_file_key()
    enc1 = encrypt(b"same", key)
    enc2 = encrypt(b"same", key)
    assert enc1.nonce != enc2.nonce
    assert enc1.ciphertext != enc2.ciphertext


def test_storage_format_roundtrip():
    key = generate_file_key()
    plaintext = b"test storage"
    encrypted = encrypt(plaintext, key)
    stored = encrypted.to_storage_format()
    recovered = EncryptedData.from_storage_format(stored, key)
    assert decrypt(recovered) == plaintext


def test_encrypt_decrypt_string():
    key = generate_file_key()
    original = "documento_segreto_2026.pdf"
    assert decrypt_string(encrypt_string(original, key), key) == original


def test_encrypt_decrypt_key():
    wrapping_key = generate_file_key()
    file_key = generate_file_key()
    assert decrypt_key(encrypt_key(file_key, wrapping_key), wrapping_key) == file_key


def test_derive_key_from_bytes():
    master = os.urandom(32)
    salt = os.urandom(32)
    k1 = derive_key_from_bytes(master, salt)
    k2 = derive_key_from_bytes(master, salt)
    assert k1 == k2
    assert len(k1) == AES_KEY_SIZE
    assert k1 != derive_key_from_bytes(master, os.urandom(32))


def test_invalid_key_size():
    with pytest.raises(ValueError):
        encrypt(b"data", b"short")


def test_large_file_encryption():
    key = generate_file_key()
    large = os.urandom(10 * 1024 * 1024)
    assert decrypt(encrypt(large, key)) == large


def test_decrypt_raw():
    key = generate_file_key()
    plaintext = b"decrypt raw test"
    enc = encrypt(plaintext, key)
    assert decrypt_raw(enc.ciphertext, enc.nonce, key) == plaintext
