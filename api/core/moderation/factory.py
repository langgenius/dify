from core.extension.extensible import ExtensionModule
from extensions.ext_code_based_extension import code_based_extension


class ModerationFactory:

    def __init__(self, name: str, tenant_id: str, config: dict) -> None:
        self.__extension_class = code_based_extension.extension_class(ExtensionModule.MODERATION, name)
        self.__extension_instance = self.__extension_class(tenant_id, config)

    def validate_config(self, config: dict) -> None:
        self.__extension_class.validate_config(config)
