import hashlib

from Crypto.Cipher import AES
from Crypto.PublicKey import RSA
from Crypto.Random import get_random_bytes

from extensions.ext_redis import redis_client
from extensions.ext_storage import storage
from libs import gmpy2_pkcs10aep_cipher


def generate_key_pair(tenant_id):
    private_key = RSA.generate(2048)
    public_key = private_key.publickey()

    pem_private = private_key.export_key()
    pem_public = public_key.export_key()

    filepath = "privkeys/{tenant_id}".format(tenant_id=tenant_id) + "/private.pem"

    storage.save(filepath, pem_private)

    return pem_public.decode()


prefix_hybrid = b"HYBRID:"


def encrypt(text, public_key):
    if isinstance(public_key, str):
        public_key = public_key.encode()

    aes_key = get_random_bytes(16)
    cipher_aes = AES.new(aes_key, AES.MODE_EAX)

    ciphertext, tag = cipher_aes.encrypt_and_digest(text.encode())

    rsa_key = RSA.import_key(public_key)
    cipher_rsa = gmpy2_pkcs10aep_cipher.new(rsa_key)

    enc_aes_key = cipher_rsa.encrypt(aes_key)

    encrypted_data = enc_aes_key + cipher_aes.nonce + tag + ciphertext

    return prefix_hybrid + encrypted_data


def get_decrypt_decoding(tenant_id):
    filepath = "privkeys/{tenant_id}".format(tenant_id=tenant_id) + "/private.pem"

    cache_key = "tenant_privkey:{hash}".format(hash=hashlib.sha3_256(filepath.encode()).hexdigest())
    private_key = redis_client.get(cache_key)
    if not private_key:
        try:
            private_key = storage.load(filepath)
        except FileNotFoundError:
            raise PrivkeyNotFoundError("Private key not found, tenant_id: {tenant_id}".format(tenant_id=tenant_id))

        redis_client.setex(cache_key, 120, private_key)

    try:
        # Ensure private_key is bytes
        if isinstance(private_key, str):
            private_key = private_key.encode("utf-8")

        # Clean up the key content - handle potential encoding/format issues
        key_content = private_key.decode("utf-8", errors="replace").strip()

        # Fix common format issues
        if not key_content.startswith("-----BEGIN"):
            # If key doesn't start with BEGIN, it might be corrupted
            raise ValueError("Private key doesn't start with proper PEM header")

        if not key_content.endswith("-----"):
            # If key doesn't end properly, it might be corrupted
            raise ValueError("Private key doesn't end with proper PEM footer")

        # Normalize line endings to Unix style
        key_content = key_content.replace("\r\n", "\n").replace("\r", "\n")

        # Re-encode to bytes
        normalized_key = key_content.encode("utf-8")

        # Debug: Log key format info
        print(f"DEBUG: Private key length: {len(normalized_key)} bytes")
        print(f"DEBUG: Private key starts with: {key_content[:50]}")
        print(f"DEBUG: Private key ends with: {key_content[-50:]}")

        rsa_key = RSA.import_key(normalized_key)
        cipher_rsa = gmpy2_pkcs10aep_cipher.new(rsa_key)
    except Exception as e:
        print(f"ERROR: Failed to import RSA key for tenant {tenant_id}: {e}")
        print(f"DEBUG: Original key type: {type(private_key)}")
        print(f"DEBUG: Original key length: {len(private_key)}")
        if isinstance(private_key, bytes):
            key_str = private_key.decode("utf-8", errors="replace")
            print(f"DEBUG: Key starts with: {key_str[:100]}")
            print(f"DEBUG: Key ends with: {key_str[-100:]}")
        raise

    return rsa_key, cipher_rsa


def decrypt_token_with_decoding(encrypted_text, rsa_key, cipher_rsa):
    if encrypted_text.startswith(prefix_hybrid):
        encrypted_text = encrypted_text[len(prefix_hybrid) :]

        enc_aes_key = encrypted_text[: rsa_key.size_in_bytes()]
        nonce = encrypted_text[rsa_key.size_in_bytes() : rsa_key.size_in_bytes() + 16]
        tag = encrypted_text[rsa_key.size_in_bytes() + 16 : rsa_key.size_in_bytes() + 32]
        ciphertext = encrypted_text[rsa_key.size_in_bytes() + 32 :]

        aes_key = cipher_rsa.decrypt(enc_aes_key)

        cipher_aes = AES.new(aes_key, AES.MODE_EAX, nonce=nonce)
        decrypted_text = cipher_aes.decrypt_and_verify(ciphertext, tag)
    else:
        decrypted_text = cipher_rsa.decrypt(encrypted_text)

    return decrypted_text.decode()


def decrypt(encrypted_text, tenant_id):
    rsa_key, cipher_rsa = get_decrypt_decoding(tenant_id)

    return decrypt_token_with_decoding(encrypted_text, rsa_key, cipher_rsa)


class PrivkeyNotFoundError(Exception):
    pass
