from core.extension.extensible import ExtensionModule
from extensions.ext_code_based_extension import code_based_extension


class ModerationFactory:

    def __init__(self, name: str):
        self.__moderation_class = code_based_extension.extension_class(ExtensionModule.MODERATION, name)

    def validate_config(self, config: dict) -> None:
        self.__moderation_class.validate_config(config)
