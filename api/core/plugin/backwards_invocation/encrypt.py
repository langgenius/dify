from core.plugin.entities.request import RequestInvokeEncrypt
from core.tools.utils.configuration import create_generic_encrypter
from models.account import Tenant


class PluginEncrypter:
    @classmethod
    def invoke_encrypt(cls, tenant: Tenant, payload: RequestInvokeEncrypt) -> dict:
        encrypter, cache = create_generic_encrypter(
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
            cache.delete()
            return {
                "data": {},
            }
        else:
            raise ValueError(f"Invalid opt: {payload.opt}")
