import pytest
from Crypto.PublicKey import RSA

from libs import gmpy2_pkcs10aep_cipher, rsa
from libs.key_providers.rsa_key_provider import RSAKeyProvider


def test_gmpy2_pkcs10aep_cipher() -> None:
    rsa_key = RSA.generate(2048)
    public_key = rsa_key.publickey().export_key(format="PEM")
    private_key = rsa_key.export_key(format="PEM")

    public_rsa_key = RSA.import_key(public_key)
    public_cipher_rsa2 = gmpy2_pkcs10aep_cipher.new(public_rsa_key)

    private_rsa_key = RSA.import_key(private_key)
    private_cipher_rsa = gmpy2_pkcs10aep_cipher.new(private_rsa_key)

    raw_text = "raw_text"
    raw_text_bytes = raw_text.encode()

    # RSA encryption by public key and decryption by private key
    encrypted_by_pub_key = public_cipher_rsa2.encrypt(message=raw_text_bytes)
    decrypted_by_pub_key = private_cipher_rsa.decrypt(encrypted_by_pub_key)
    assert decrypted_by_pub_key == raw_text_bytes

    # RSA encryption and decryption by private key
    encrypted_by_private_key = private_cipher_rsa.encrypt(message=raw_text_bytes)
    decrypted_by_private_key = private_cipher_rsa.decrypt(encrypted_by_private_key)
    assert decrypted_by_private_key == raw_text_bytes


def test_rsa_key_provider_deletes_private_key_and_cache(monkeypatch: pytest.MonkeyPatch) -> None:
    storage_deletes: list[str] = []
    cache_deletes: list[str | bytes] = []
    monkeypatch.setattr(rsa.storage, "delete", storage_deletes.append)
    monkeypatch.setattr(rsa.redis_client, "delete", lambda key: cache_deletes.append(key))

    provider = RSAKeyProvider()
    provider.delete_key_pair("workspace")
    provider.delete_key_pair("workspace")

    assert storage_deletes == ["privkeys/workspace/private.pem", "privkeys/workspace/private.pem"]
    assert len(cache_deletes) == 2
    assert cache_deletes[0] == cache_deletes[1]
    assert str(cache_deletes[0]).startswith("tenant_privkey:")
