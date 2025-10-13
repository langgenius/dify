import base64
from collections.abc import Mapping
from typing import Any, overload

from libs import rsa


def obfuscated_token(token: str) -> str:
    if not token:
        return token
    if len(token) <= 8:
        return "*" * 20
    return token[:6] + "*" * 12 + token[-2:]


def full_mask_token(token_length=20):
    return "*" * token_length


def encrypt_token(tenant_id: str, token: str):
    from extensions.ext_database import db
    from models.account import Tenant

    if not (tenant := db.session.query(Tenant).where(Tenant.id == tenant_id).first()):
        raise ValueError(f"Tenant with id {tenant_id} not found")
    assert tenant.encrypt_public_key is not None
    encrypted_token = rsa.encrypt(token, tenant.encrypt_public_key)
    return base64.b64encode(encrypted_token).decode()


def decrypt_token(tenant_id: str, token: str) -> str:
    return rsa.decrypt(base64.b64decode(token), tenant_id)


def batch_decrypt_token(tenant_id: str, tokens: list[str]):
    rsa_key, cipher_rsa = rsa.get_decrypt_decoding(tenant_id)

    return [rsa.decrypt_token_with_decoding(base64.b64decode(token), rsa_key, cipher_rsa) for token in tokens]


def get_decrypt_decoding(tenant_id: str):
    return rsa.get_decrypt_decoding(tenant_id)


def decrypt_token_with_decoding(token: str, rsa_key, cipher_rsa):
    return rsa.decrypt_token_with_decoding(base64.b64decode(token), rsa_key, cipher_rsa)


# =========================
# encrypt_secret_keys
# =========================


# Overloads to preserve input type
@overload
def encrypt_secret_keys(
    obj: Mapping[str, Any],
    secret_variables: set[str] | None = None,
    parent_key: str | None = None,
) -> Mapping[str, Any]: ...


@overload
def encrypt_secret_keys(
    obj: list[Any],
    secret_variables: set[str] | None = None,
    parent_key: str | None = None,
) -> list[Any]: ...


@overload
def encrypt_secret_keys(
    obj: Any,
    secret_variables: set[str] | None = None,
    parent_key: str | None = None,
) -> Any: ...


def encrypt_secret_keys(
    obj: Any,
    secret_variables: set[str] | None = None,
    parent_key: str | None = None,
) -> Any:
    """
    Recursively obfuscate the value if it belongs to a Secret Variable.
    Preserves input type: dict -> dict, list -> list, scalar -> scalar.
    """
    if secret_variables is None:
        secret_variables = set()

    if isinstance(obj, Mapping):
        # recurse into dict
        return {key: encrypt_secret_keys(value, secret_variables, key) for key, value in obj.items()}

    elif isinstance(obj, list):
        # recurse into all list elements
        return [encrypt_secret_keys(value, secret_variables, None) for value in obj]

    else:
        # leaf node: obfuscate if parent_key is a secret variable
        if parent_key in secret_variables:
            return obfuscated_token(str(obj))
        return obj
