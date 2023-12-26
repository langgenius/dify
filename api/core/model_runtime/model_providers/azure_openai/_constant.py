from core.model_runtime.entities.llm_entities import LLMMode
from core.model_runtime.entities.model_entities import ModelFeature

AZURE_OPENAI_API_VERSION = '2023-12-01-preview'

LLM_BASE_MODELS = [
    {
        'name': 'gpt-3.5-turbo',
        'base_model_name': 'gpt-35-turbo',
        'mode': LLMMode.CHAT,
        'features': [
            ModelFeature.AGENT_THOUGHT
        ]
    },
    {
        'name': 'gpt-3.5-turbo-16k',
        'base_model_name': 'gpt-35-turbo-16k',
        'mode': LLMMode.CHAT,
        'features': [
            ModelFeature.AGENT_THOUGHT
        ]
    },
    {
        'name': 'gpt-4',
        'base_model_name': 'gpt-4',
        'mode': LLMMode.CHAT,
        'features': [
            ModelFeature.AGENT_THOUGHT
        ]
    },
    {
        'name': 'gpt-4-32k',
        'base_model_name': 'gpt-4-32k',
        'mode': LLMMode.CHAT,
        'features': [
            ModelFeature.AGENT_THOUGHT
        ]
    },
    {
        'name': 'gpt-4-1106-preview',
        'base_model_name': 'gpt-4-1106-preview',
        'mode': LLMMode.CHAT,
        'features': [
            ModelFeature.AGENT_THOUGHT
        ]
    },
    {
        'name': 'gpt-4-vision-preview',
        'base_model_name': 'gpt-4-vision-preview',
        'mode': LLMMode.CHAT,
        'features': [
            ModelFeature.VISION
        ]
    },
    {
        'name': 'gpt-3.5-turbo-instruct',
        'base_model_name': 'gpt-35-turbo-instruct',
        'mode': LLMMode.COMPLETION,

        'features': []
    }
]

EMBEDDING_BASE_MODELS = [
    'text-embedding-ada-002',
]
