import base64

from extensions.ext_database import db
from libs import rsa
from models.account import Tenant


def obfuscated_token(token: str):
    return token[:6] + '*' * (len(token) - 8) + token[-2:]


def encrypt_token(tenant_id: str, token: str):
    tenant = db.session.query(Tenant).filter(Tenant.id == tenant_id).first()
    encrypted_token = rsa.encrypt(token, tenant.encrypt_public_key)
    return base64.b64encode(encrypted_token).decode()


def decrypt_token(tenant_id: str, token: str):
    return rsa.decrypt(base64.b64decode(token), tenant_id)


def batch_decrypt_token(tenant_id: str, tokens: list[str]):
    rsa_key, cipher_rsa = rsa.get_decrypt_decoding(tenant_id)

    return [rsa.decrypt_token_with_decoding(base64.b64decode(token), rsa_key, cipher_rsa) for token in tokens]


def get_decrypt_decoding(tenant_id: str):
    return rsa.get_decrypt_decoding(tenant_id)


def decrypt_token_with_decoding(token: str, rsa_key, cipher_rsa):
    return rsa.decrypt_token_with_decoding(base64.b64decode(token), rsa_key, cipher_rsa)
