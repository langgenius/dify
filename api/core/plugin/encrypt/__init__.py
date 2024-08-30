from collections.abc import Mapping
from typing import Any

from core.plugin.entities.request import RequestInvokeEncrypt
from core.tools.utils.configuration import ProviderConfigEncrypter
from models.account import Tenant


class PluginEncrypter:
    @classmethod
    def invoke_encrypt(cls, tenant: Tenant, payload: RequestInvokeEncrypt) -> Mapping[str, Any]:
        encrypter = ProviderConfigEncrypter(
            tenant_id=tenant.id,
            config=payload.data,
            provider_type=payload.namespace,
            provider_identity=payload.identity,
        )

        if payload.opt == "encrypt":
            return encrypter.encrypt(payload.data)
        else:
            return encrypter.decrypt(payload.data)