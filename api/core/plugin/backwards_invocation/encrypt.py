from core.plugin.entities.request import RequestInvokeEncrypt
from core.tools.utils.configuration import ProviderConfigEncrypter
from models.account import Tenant


class PluginEncrypter:
    @classmethod
    def invoke_encrypt(cls, tenant: Tenant, payload: RequestInvokeEncrypt) -> dict:
        encrypter = ProviderConfigEncrypter(
            tenant_id=tenant.id,
            config=payload.config,
            provider_type=payload.namespace,
            provider_identity=payload.identity,
        )

        if payload.opt == "encrypt":
            return {
                "data": encrypter.encrypt(payload.data),
            }
        elif payload.opt == "decrypt":
            return {
                "data": encrypter.decrypt(payload.data),
            }
        elif payload.opt == "clear":
            encrypter.delete_tool_credentials_cache()
            return {
                "data": {},
            }
        else:
            raise ValueError(f"Invalid opt: {payload.opt}")
