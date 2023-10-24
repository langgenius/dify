from core.helper.extensible import Extensible

class ExtensionService:
    
    @classmethod
    def get_code_based_extensions(cls, module: str) -> list[dict]:
        return Extensible.get_extensions().get(module, [])