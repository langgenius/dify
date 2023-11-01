from core.extension.extensible import ExtensionModule
from extensions.ext_code_based_extension import code_based_extension


class ExternalDataToolFactory:

    def __init__(self, name: str, tenant_id: str, config: dict) -> None:
        self.__extension_class = code_based_extension.extension_class(ExtensionModule.EXTERNAL_DATA_TOOL, name)
        self.__extension_instance = self.__extension_class(tenant_id, config)

    def validate_config(self, config: dict) -> None:
        self.__extension_class.validate_config(config)
