from core.extension.extensible import ExtensionModule, ModuleExtension
from core.external_data_tool.base import ExternalDataTool
from core.moderation.base import Moderation


class Extension:
    __module_extensions: dict[str, dict[str, ModuleExtension]] = {}

    module_classes = {ExtensionModule.MODERATION: Moderation, ExtensionModule.EXTERNAL_DATA_TOOL: ExternalDataTool}

    def init(self):
        for module, module_class in self.module_classes.items():
            self.__module_extensions[module.value] = module_class.scan_extensions()

    def module_extensions(self, module: str) -> list[ModuleExtension]:
        module_extensions = self.__module_extensions.get(module)

        if not module_extensions:
            raise ValueError(f"Extension Module {module} not found")

        return list(module_extensions.values())

    def module_extension(self, module: ExtensionModule, extension_name: str) -> ModuleExtension:
        module_extensions = self.__module_extensions.get(module.value)

        if not module_extensions:
            raise ValueError(f"Extension Module {module} not found")

        module_extension = module_extensions.get(extension_name)

        if not module_extension:
            raise ValueError(f"Extension {extension_name} not found")

        return module_extension

    def extension_class(self, module: ExtensionModule, extension_name: str) -> type:
        module_extension = self.module_extension(module, extension_name)
        return module_extension.extension_class

    def validate_form_schema(self, module: ExtensionModule, extension_name: str, config: dict) -> None:
        module_extension = self.module_extension(module, extension_name)
        form_schema = module_extension.form_schema

        # TODO validate form_schema
