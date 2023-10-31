from core.extension.extensible import ExtensionModule
from core.moderation.base import Moderation
from extensions.ext_code_based_extension import code_based_extension


class ModerationFactory:
    @staticmethod
    def get(name: str) -> type[Moderation]:
        return code_based_extension.extension_class(ExtensionModule.MODERATION, name)
