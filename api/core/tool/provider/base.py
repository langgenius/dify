import base64
from abc import ABC, abstractmethod
from typing import Optional

from extensions.ext_database import db
from libs import rsa
from models.account import Tenant
from models.tool import ToolProvider, ToolProviderName


class BaseToolProvider(ABC):
    def __init__(self, tenant_id: str):
        self.tenant_id = tenant_id

    @abstractmethod
    def get_provider_name(self) -> ToolProviderName:
        raise NotImplementedError

    @abstractmethod
    def get_credentials(self, obfuscated: bool = False) -> Optional[dict]:
        raise NotImplementedError

    @abstractmethod
    def credentials_to_func_kwargs(self) -> Optional[dict]:
        raise NotImplementedError

    @abstractmethod
    def credentials_validate(self, credentials: dict):
        raise NotImplementedError

    def get_provider(self, must_enabled: bool = False) -> Optional[ToolProvider]:
        """
        Returns the Provider instance for the given tenant_id and provider_name.
        """
        query = db.session.query(ToolProvider).filter(
            ToolProvider.tenant_id == self.tenant_id,
            ToolProvider.provider_name == self.get_provider_name()
        )

        if must_enabled:
            query = query.filter(ToolProvider.is_enabled == True)

        return query.first()

    def encrypt_token(self, token) -> str:
        tenant = db.session.query(Tenant).filter(Tenant.id == self.tenant_id).first()
        encrypted_token = rsa.encrypt(token, tenant.encrypt_public_key)
        return base64.b64encode(encrypted_token).decode()

    def decrypt_token(self, token: str, obfuscated: bool = False) -> str:
        token = rsa.decrypt(base64.b64decode(token), self.tenant_id)

        if obfuscated:
            return self._obfuscated_token(token)

        return token

    def _obfuscated_token(self, token: str) -> str:
        return token[:6] + '*' * (len(token) - 8) + token[-2:]
