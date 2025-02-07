from typing import Any

from pydantic import BaseModel

from core.model_runtime.entities.llm_entities import LLMMode
from core.model_runtime.entities.model_entities import ModelFeature


class ModelProperties(BaseModel):
    context_size: int
    max_tokens: int
    mode: LLMMode


class ModelConfig(BaseModel):
    properties: ModelProperties
    features: list[ModelFeature]


configs: dict[str, ModelConfig] = {
    "DeepSeek-R1-Distill-Qwen-32B": ModelConfig(
        properties=ModelProperties(context_size=64000, max_tokens=8192, mode=LLMMode.CHAT),
        features=[ModelFeature.AGENT_THOUGHT],
    ),
    "DeepSeek-R1-Distill-Qwen-7B": ModelConfig(
        properties=ModelProperties(context_size=64000, max_tokens=8192, mode=LLMMode.CHAT),
        features=[ModelFeature.AGENT_THOUGHT],
    ),
    "DeepSeek-R1": ModelConfig(
        properties=ModelProperties(context_size=64000, max_tokens=8192, mode=LLMMode.CHAT),
        features=[ModelFeature.AGENT_THOUGHT],
    ),
    "DeepSeek-V3": ModelConfig(
        properties=ModelProperties(context_size=64000, max_tokens=8192, mode=LLMMode.CHAT),
        features=[ModelFeature.AGENT_THOUGHT, ModelFeature.TOOL_CALL, ModelFeature.STREAM_TOOL_CALL],
    ),
    "Doubao-1.5-vision-pro-32k": ModelConfig(
        properties=ModelProperties(context_size=32768, max_tokens=12288, mode=LLMMode.CHAT),
        features=[ModelFeature.AGENT_THOUGHT, ModelFeature.VISION],
    ),
    "Doubao-1.5-pro-32k": ModelConfig(
        properties=ModelProperties(context_size=32768, max_tokens=12288, mode=LLMMode.CHAT),
        features=[ModelFeature.AGENT_THOUGHT],
    ),
    "Doubao-1.5-lite-32k": ModelConfig(
        properties=ModelProperties(context_size=32768, max_tokens=12288, mode=LLMMode.CHAT),
        features=[ModelFeature.AGENT_THOUGHT],
    ),
    "Doubao-1.5-pro-256k": ModelConfig(
        properties=ModelProperties(context_size=262144, max_tokens=12288, mode=LLMMode.CHAT),
        features=[ModelFeature.AGENT_THOUGHT],
    ),
    "Doubao-vision-pro-32k": ModelConfig(
        properties=ModelProperties(context_size=32768, max_tokens=4096, mode=LLMMode.CHAT),
        features=[ModelFeature.AGENT_THOUGHT, ModelFeature.VISION],
    ),
    "Doubao-vision-lite-32k": ModelConfig(
        properties=ModelProperties(context_size=32768, max_tokens=4096, mode=LLMMode.CHAT),
        features=[ModelFeature.AGENT_THOUGHT, ModelFeature.VISION],
    ),
    "Doubao-pro-4k": ModelConfig(
        properties=ModelProperties(context_size=4096, max_tokens=4096, mode=LLMMode.CHAT),
        features=[ModelFeature.AGENT_THOUGHT, ModelFeature.TOOL_CALL],
    ),
    "Doubao-lite-4k": ModelConfig(
        properties=ModelProperties(context_size=4096, max_tokens=4096, mode=LLMMode.CHAT),
        features=[ModelFeature.AGENT_THOUGHT, ModelFeature.TOOL_CALL],
    ),
    "Doubao-pro-32k": ModelConfig(
        properties=ModelProperties(context_size=32768, max_tokens=4096, mode=LLMMode.CHAT),
        features=[ModelFeature.AGENT_THOUGHT, ModelFeature.TOOL_CALL],
    ),
    "Doubao-lite-32k": ModelConfig(
        properties=ModelProperties(context_size=32768, max_tokens=4096, mode=LLMMode.CHAT),
        features=[ModelFeature.AGENT_THOUGHT, ModelFeature.TOOL_CALL],
    ),
    "Doubao-pro-256k": ModelConfig(
        properties=ModelProperties(context_size=262144, max_tokens=4096, mode=LLMMode.CHAT),
        features=[ModelFeature.AGENT_THOUGHT],
    ),
    "Doubao-pro-128k": ModelConfig(
        properties=ModelProperties(context_size=131072, max_tokens=4096, mode=LLMMode.CHAT),
        features=[ModelFeature.AGENT_THOUGHT, ModelFeature.TOOL_CALL],
    ),
    "Doubao-lite-128k": ModelConfig(
        properties=ModelProperties(context_size=131072, max_tokens=4096, mode=LLMMode.CHAT),
        features=[ModelFeature.AGENT_THOUGHT],
    ),
    "Skylark2-pro-4k": ModelConfig(
        properties=ModelProperties(context_size=4096, max_tokens=4096, mode=LLMMode.CHAT),
        features=[ModelFeature.AGENT_THOUGHT],
    ),
    "Llama3-8B": ModelConfig(
        properties=ModelProperties(context_size=8192, max_tokens=8192, mode=LLMMode.CHAT),
        features=[ModelFeature.AGENT_THOUGHT],
    ),
    "Llama3-70B": ModelConfig(
        properties=ModelProperties(context_size=8192, max_tokens=8192, mode=LLMMode.CHAT),
        features=[ModelFeature.AGENT_THOUGHT],
    ),
    "Moonshot-v1-8k": ModelConfig(
        properties=ModelProperties(context_size=8192, max_tokens=4096, mode=LLMMode.CHAT),
        features=[ModelFeature.AGENT_THOUGHT, ModelFeature.TOOL_CALL],
    ),
    "Moonshot-v1-32k": ModelConfig(
        properties=ModelProperties(context_size=32768, max_tokens=16384, mode=LLMMode.CHAT),
        features=[ModelFeature.AGENT_THOUGHT, ModelFeature.TOOL_CALL],
    ),
    "Moonshot-v1-128k": ModelConfig(
        properties=ModelProperties(context_size=131072, max_tokens=65536, mode=LLMMode.CHAT),
        features=[ModelFeature.AGENT_THOUGHT, ModelFeature.TOOL_CALL],
    ),
    "GLM3-130B": ModelConfig(
        properties=ModelProperties(context_size=8192, max_tokens=4096, mode=LLMMode.CHAT),
        features=[ModelFeature.AGENT_THOUGHT, ModelFeature.TOOL_CALL],
    ),
    "GLM3-130B-Fin": ModelConfig(
        properties=ModelProperties(context_size=8192, max_tokens=4096, mode=LLMMode.CHAT),
        features=[ModelFeature.AGENT_THOUGHT, ModelFeature.TOOL_CALL],
    ),
    "Mistral-7B": ModelConfig(
        properties=ModelProperties(context_size=8192, max_tokens=2048, mode=LLMMode.CHAT),
        features=[ModelFeature.AGENT_THOUGHT],
    ),
}


def get_model_config(credentials: dict) -> ModelConfig:
    base_model = credentials.get("base_model_name", "")
    model_configs = configs.get(base_model)
    if not model_configs:
        return ModelConfig(
            properties=ModelProperties(
                context_size=int(credentials.get("context_size", 0)),
                max_tokens=int(credentials.get("max_tokens", 0)),
                mode=LLMMode.value_of(credentials.get("mode", "chat")),
            ),
            features=[],
        )
    return model_configs


def get_v2_req_params(credentials: dict, model_parameters: dict, stop: list[str] | None = None):
    req_params: dict[str, Any] = {}
    # predefined properties
    model_configs = get_model_config(credentials)
    if model_configs:
        req_params["max_prompt_tokens"] = model_configs.properties.context_size
        req_params["max_new_tokens"] = model_configs.properties.max_tokens

    # model parameters
    if model_parameters.get("max_tokens"):
        req_params["max_new_tokens"] = model_parameters.get("max_tokens")
    if model_parameters.get("temperature"):
        req_params["temperature"] = model_parameters.get("temperature")
    if model_parameters.get("top_p"):
        req_params["top_p"] = model_parameters.get("top_p")
    if model_parameters.get("top_k"):
        req_params["top_k"] = model_parameters.get("top_k")
    if model_parameters.get("presence_penalty"):
        req_params["presence_penalty"] = model_parameters.get("presence_penalty")
    if model_parameters.get("frequency_penalty"):
        req_params["frequency_penalty"] = model_parameters.get("frequency_penalty")

    if stop:
        req_params["stop"] = stop

    return req_params


def get_v3_req_params(credentials: dict, model_parameters: dict, stop: list[str] | None = None):
    req_params: dict[str, Any] = {}
    # predefined properties
    model_configs = get_model_config(credentials)
    if model_configs:
        req_params["max_tokens"] = model_configs.properties.max_tokens

    # model parameters
    if model_parameters.get("max_tokens"):
        req_params["max_tokens"] = model_parameters.get("max_tokens")
    if model_parameters.get("temperature"):
        req_params["temperature"] = model_parameters.get("temperature")
    if model_parameters.get("top_p"):
        req_params["top_p"] = model_parameters.get("top_p")
    if model_parameters.get("presence_penalty"):
        req_params["presence_penalty"] = model_parameters.get("presence_penalty")
    if model_parameters.get("frequency_penalty"):
        req_params["frequency_penalty"] = model_parameters.get("frequency_penalty")

    if stop:
        req_params["stop"] = stop

    return req_params
