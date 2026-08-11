"""Legacy password implementation behind the account password port."""

import base64
import secrets
from typing import override

from libs.password import compare_password, hash_password, valid_password
from services.account_errors import InvalidAccountPasswordError
from services.account_ports import AccountPasswordHasher
from services.entities.account_entities import AccountPasswordDigest


class LegacyAccountPasswordHasher(AccountPasswordHasher):
    @override
    def verify(self, password: str, *, password_hash: str, password_salt: str) -> bool:
        return compare_password(password, password_hash, password_salt)

    @override
    def hash(self, password: str) -> AccountPasswordDigest:
        try:
            valid_password(password)
        except ValueError as error:
            raise InvalidAccountPasswordError(str(error)) from error
        salt = secrets.token_bytes(16)
        return AccountPasswordDigest(
            password_hash=base64.b64encode(hash_password(password, salt)).decode(),
            password_salt=base64.b64encode(salt).decode(),
        )
