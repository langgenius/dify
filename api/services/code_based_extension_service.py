from pydantic import BaseModel

from extensions.ext_code_based_extension import code_based_extension


class Extension(BaseModel):
    name: str
    label: dict | None
    form_schema: list | None


class CodeBasedExtensionService:
    @staticmethod
    def get_code_based_extension(module: str):
        module_extensions = code_based_extension.module_extensions(module)
        return [
            Extension(
                name=module_extension.name,
                label=module_extension.label,
                form_schema=module_extension.form_schema,
            )
            for module_extension in module_extensions
            if not module_extension.builtin
        ]
