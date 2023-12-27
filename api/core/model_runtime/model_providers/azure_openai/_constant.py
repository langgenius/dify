from core.model_runtime.entities.llm_entities import LLMMode
from core.model_runtime.entities.model_entities import ModelFeature

AZURE_OPENAI_API_VERSION = '2023-12-01-preview'

LLM_BASE_MODELS = [
    {
        'model': 'gpt-3.5-turbo',
        'base_model_name': 'gpt-35-turbo',
        'features': [
            ModelFeature.AGENT_THOUGHT,
            ModelFeature.MULTI_TOOL_CALL,
        ],
        'model_properties': {
            'mode': LLMMode.CHAT,
            'context_size': 4096
        }
    },
    {
        'model': 'gpt-3.5-turbo-16k',
        'base_model_name': 'gpt-35-turbo-16k',
        'features': [
            ModelFeature.AGENT_THOUGHT,
            ModelFeature.MULTI_TOOL_CALL,
        ],
        'model_properties': {
            'mode': LLMMode.CHAT,
            'context_size': 16385
        }
    },
    {
        'model': 'gpt-4',
        'base_model_name': 'gpt-4',
        'features': [
            ModelFeature.AGENT_THOUGHT,
            ModelFeature.MULTI_TOOL_CALL,
        ],
        'model_properties': {
            'mode': LLMMode.CHAT,
            'context_size': 8192
        }
    },
    {
        'model': 'gpt-4-32k',
        'base_model_name': 'gpt-4-32k',
        'features': [
            ModelFeature.AGENT_THOUGHT,
            ModelFeature.MULTI_TOOL_CALL,
        ],
        'model_properties': {
            'mode': LLMMode.CHAT,
            'context_size': 32768
        }
    },
    {
        'model': 'gpt-4-1106-preview',
        'base_model_name': 'gpt-4-1106-preview',
        'features': [
            ModelFeature.AGENT_THOUGHT,
            ModelFeature.MULTI_TOOL_CALL,
        ],
        'model_properties': {
            'mode': LLMMode.CHAT,
            'context_size': 128000
        }
    },
    {
        'model': 'gpt-4-vision-preview',
        'base_model_name': 'gpt-4-vision-preview',
        'features': [
            ModelFeature.VISION
        ],
        'model_properties': {
            'mode': LLMMode.CHAT,
            'context_size': 128000
        }
    },
    {
        'model': 'gpt-3.5-turbo-instruct',
        'base_model_name': 'gpt-35-turbo-instruct',
        'features': [],
        'model_properties': {
            'mode': LLMMode.COMPLETION,
            'context_size': 4097
        }
    }
]

EMBEDDING_BASE_MODELS = [
    {
        'model': 'text-embedding-ada-002',
        'base_model_name': 'text-embedding-ada-002',
        'model_properties': {
            'context_size': 8097,
            'max_chunks': 32,
        }
    }
]
