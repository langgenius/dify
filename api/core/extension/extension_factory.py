from core.extension.extensible import ModuleExtension
from core.external_data_tool.base import ExternalDataTool
from core.moderation.base import Moderation


class ExtensionFactory:
    __module_extensions: dict[str, dict[str, ModuleExtension]] = {}

    module_classes = {
        'moderation': Moderation,
        'external_data_tool': ExternalDataTool
    }

    def init(self):
        for module, module_class in self.module_classes.items():
            self.__module_extensions[module] = module_class.scan_extensions()

    def module_extensions(self, module: str) -> list[ModuleExtension]:
        module_extensions = self.__module_extensions.get(module)

        if not module_extensions:
            raise ValueError(f"Extension Module {module} not found")

        return list(module_extensions.values())

    def module_extension(self, module: str, extension_name: str) -> ModuleExtension:
        module_extensions = self.__module_extensions.get(module)

        if not module_extensions:
            raise ValueError(f"Extension Module {module} not found")

        module_extension = module_extensions.get(extension_name)

        if not module_extension:
            raise ValueError(f"Extension {extension_name} not found")

        return module_extension
