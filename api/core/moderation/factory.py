from typing import Optional

from core.extension.extensible import ExtensionModule
from extensions.ext_code_based_extension import code_based_extension


class ModerationFactory:

    def __init__(self, name: str, tenant_id: str, config: dict) -> None:
        extension_class = code_based_extension.extension_class(ExtensionModule.MODERATION, name)
        self.__extension_instance = extension_class(tenant_id, config)

    @classmethod
    def validate_config(cls, name: str, tenant_id: str, config: dict) -> None:
        """
        Validate the incoming form config data.

        :param name: the name of extension
        :param tenant_id: the id of workspace
        :param config: the form config data
        :return:
        """
        extension_class = code_based_extension.extension_class(ExtensionModule.MODERATION, name)
        extension_class.validate_config(tenant_id, config)

    def moderation_for_inputs(self, inputs: dict, query: Optional[str] = None):
        return self.__extension_instance.moderation_for_inputs(inputs, query)

    def moderation_for_outputs(self, text: str):
        return self.__extension_instance.moderation_for_outputs(text)