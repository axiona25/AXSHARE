"""
Test KEK wrapping/unwrapping su Vault — TASK 2.4
Richiede Vault in esecuzione su localhost:8200
Eseguire con: pytest tests/phase2/test_vault_kek.py -v
"""
import uuid
import pytest

from app.crypto.aes import generate_file_key
from app.crypto.vault import get_vault_service


@pytest.fixture(scope="module")
def vault():
    return get_vault_service()


def test_vault_authenticated(vault):
    assert vault.client.is_authenticated()


def test_wrap_unwrap_file_key(vault):
    """Wrap e unwrap di una file_key AES-256."""
    file_key = generate_file_key()
    ciphertext = vault.wrap_key(file_key)
    assert ciphertext.startswith("vault:v")
    recovered = vault.unwrap_key(ciphertext)
    assert recovered == file_key


def test_store_retrieve_file_key(vault):
    """Store e retrieve di file_key via KV + Transit."""
    file_id = str(uuid.uuid4())
    file_key = generate_file_key()
    vault.store_file_key_wrapped(file_id, file_key)
    recovered = vault.retrieve_file_key(file_id)
    assert recovered == file_key
    # Cleanup
    vault.delete_file_key(file_id)


def test_delete_file_key(vault):
    """Dopo delete, la file_key non deve essere recuperabile."""
    file_id = str(uuid.uuid4())
    file_key = generate_file_key()
    vault.store_file_key_wrapped(file_id, file_key)
    vault.delete_file_key(file_id)
    with pytest.raises(KeyError):
        vault.retrieve_file_key(file_id)


def test_store_retrieve_group_key(vault):
    """Store e retrieve di group master key."""
    group_id = str(uuid.uuid4())
    group_key = generate_file_key()
    vault.store_group_master_key(group_id, group_key)
    recovered = vault.retrieve_group_master_key(group_id)
    assert recovered == group_key
    # Cleanup
    vault.delete_group_keys(group_id)


def test_delete_group_keys(vault):
    """Dopo delete, la group key non deve essere recuperabile."""
    group_id = str(uuid.uuid4())
    vault.store_group_master_key(group_id, generate_file_key())
    vault.delete_group_keys(group_id)
    with pytest.raises(KeyError):
        vault.retrieve_group_master_key(group_id)


def test_rewrap_file_key(vault):
    """Re-wrap di una file_key deve restituire la stessa chiave."""
    file_id = str(uuid.uuid4())
    file_key = generate_file_key()
    vault.store_file_key_wrapped(file_id, file_key)
    vault.rewrap_file_key(file_id)
    recovered = vault.retrieve_file_key(file_id)
    assert recovered == file_key
    # Cleanup
    vault.delete_file_key(file_id)


def test_gdpr_erasure(vault):
    """GDPR erasure deve eliminare tutti i segreti dell'utente."""
    user_id = str(uuid.uuid4())
    # Crea alcune chiavi per l'utente
    vault.store_user_public_key(user_id, "fake-public-key-pem", key_type="rsa")
    result = vault.erase_all_user_data(user_id)
    assert result["status"] == "erased"
    assert "public_keys" in result["deleted"]
    # Verifica che le chiavi siano state eliminate
    assert vault.get_user_public_key(user_id) is None


def test_wrap_unwrap_roundtrip_multiple_keys(vault):
    """Test con piu' chiavi diverse — nessuna collisione."""
    keys = [generate_file_key() for _ in range(5)]
    wrapped = [vault.wrap_key(k) for k in keys]
    # Tutti i ciphertext devono essere diversi
    assert len(set(wrapped)) == 5
    # Tutti devono essere recuperabili correttamente
    for original, ciphertext in zip(keys, wrapped):
        recovered = vault.unwrap_key(ciphertext)
        assert recovered == original
