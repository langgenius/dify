# -*- coding:utf-8 -*-
import hashlib

from Crypto.Cipher import PKCS1_OAEP
from Crypto.PublicKey import RSA

from extensions.ext_redis import redis_client
from extensions.ext_storage import storage


# TODO: PKCS1_OAEP is no longer recommended for new systems and protocols. It is recommended to migrate to PKCS1_PSS.


def generate_key_pair(tenant_id):
    private_key = RSA.generate(2048)
    public_key = private_key.publickey()

    pem_private = private_key.export_key()
    pem_public = public_key.export_key()

    filepath = "privkeys/{tenant_id}".format(tenant_id=tenant_id) + "/private.pem"

    storage.save(filepath, pem_private)

    return pem_public.decode()


def encrypt(text, public_key):
    if isinstance(public_key, str):
        public_key = public_key.encode()

    rsa_key = RSA.import_key(public_key)
    cipher = PKCS1_OAEP.new(rsa_key)
    encrypted_text = cipher.encrypt(text.encode())
    return encrypted_text


def decrypt(encrypted_text, tenant_id):
    filepath = "privkeys/{tenant_id}".format(tenant_id=tenant_id) + "/private.pem"

    cache_key = 'tenant_privkey:{hash}'.format(hash=hashlib.sha3_256(filepath.encode()).hexdigest())
    private_key = redis_client.get(cache_key)
    if not private_key:
        try:
            private_key = storage.load(filepath)
        except FileNotFoundError:
            raise PrivkeyNotFoundError("Private key not found, tenant_id: {tenant_id}".format(tenant_id=tenant_id))

        redis_client.setex(cache_key, 120, private_key)

    rsa_key = RSA.import_key(private_key)
    cipher = PKCS1_OAEP.new(rsa_key)
    decrypted_text = cipher.decrypt(encrypted_text)
    return decrypted_text.decode()


class PrivkeyNotFoundError(Exception):
    pass
