from core.extension.extensible import Extensible

class CodeBasedExtensionService:
    
    @staticmethod
    def get_code_based_extension(module: str) -> list[dict]:
        return Extensible.get_extensions().get(module, [])