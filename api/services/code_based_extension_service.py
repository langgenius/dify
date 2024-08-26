from extensions.ext_code_based_extension import code_based_extension


class CodeBasedExtensionService:
    @staticmethod
    def get_code_based_extension(module: str) -> list[dict]:
        module_extensions = code_based_extension.module_extensions(module)
        return [
            {
                "name": module_extension.name,
                "label": module_extension.label,
                "form_schema": module_extension.form_schema,
            }
            for module_extension in module_extensions
            if not module_extension.builtin
        ]
