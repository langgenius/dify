from pydantic import BaseModel


class ModelProperties(BaseModel):
    context_size: int
    max_chunks: int


class ModelConfig(BaseModel):
    properties: ModelProperties


ModelConfigs = {
    'Doubao-embedding': ModelConfig(
        properties=ModelProperties(context_size=4096, max_chunks=32)
    ),
}


def get_model_config(credentials: dict) -> ModelConfig:
    base_model = credentials.get('base_model_name', '')
    model_configs = ModelConfigs.get(base_model)
    if not model_configs:
        return ModelConfig(
            properties=ModelProperties(
                context_size=int(credentials.get('context_size', 0)),
                max_chunks=int(credentials.get('max_chunks', 0)),
            )
        )
    return model_configs
