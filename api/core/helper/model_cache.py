from typing import Optional

from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.model_providers.__base.ai_model import AIModel

model_cache: dict[str, AIModel] = {}


class ModelTypeInstanceCache:
    def __init__(self, model_type: ModelType | None = None, provider: str = ""):
        self.cache_key = f"model_type_instance:model_type:{model_type.value if model_type else ''}:provider:{provider}"

    def get(self):
        """get model_cache"""
        return model_cache.get(self.cache_key)

    def set(self, new_model: AIModel):
        """set model_cache"""
        model_cache[self.cache_key] = new_model

    def delete(self):
        """delete model_cache"""
        model_cache.pop(self.cache_key, None)

    def clear(self):
        """clear model_cache"""
        model_cache.clear()
