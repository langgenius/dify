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

    rsa_key = RSA.import_key(private_key)
    cipher_rsa = gmpy2_pkcs10aep_cipher.new(rsa_key)

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
