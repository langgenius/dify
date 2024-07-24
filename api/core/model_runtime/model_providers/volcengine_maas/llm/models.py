from core.model_runtime.entities.model_entities import ModelFeature

ModelConfigs = {
    'Doubao-pro-4k': {
        'req_params': {
            'max_prompt_tokens': 4096,
            'max_new_tokens': 4096,
        },
        'model_properties': {
            'context_size': 4096,
            'mode': 'chat',
        },
        'features': [
            ModelFeature.TOOL_CALL
        ],
    },
    'Doubao-lite-4k': {
        'req_params': {
            'max_prompt_tokens': 4096,
            'max_new_tokens': 4096,
        },
        'model_properties': {
            'context_size': 4096,
            'mode': 'chat',
        },
        'features': [
            ModelFeature.TOOL_CALL
        ],
    },
    'Doubao-pro-32k': {
        'req_params': {
            'max_prompt_tokens': 32768,
            'max_new_tokens': 32768,
        },
        'model_properties': {
            'context_size': 32768,
            'mode': 'chat',
        },
        'features': [
            ModelFeature.TOOL_CALL
        ],
    },
    'Doubao-lite-32k': {
        'req_params': {
            'max_prompt_tokens': 32768,
            'max_new_tokens': 32768,
        },
        'model_properties': {
            'context_size': 32768,
            'mode': 'chat',
        },
        'features': [
            ModelFeature.TOOL_CALL
        ],
    },
    'Doubao-pro-128k': {
        'req_params': {
            'max_prompt_tokens': 131072,
            'max_new_tokens': 131072,
        },
        'model_properties': {
            'context_size': 131072,
            'mode': 'chat',
        },
        'features': [
            ModelFeature.TOOL_CALL
        ],
    },
    'Doubao-lite-128k': {
        'req_params': {
            'max_prompt_tokens': 131072,
            'max_new_tokens': 131072,
        },
        'model_properties': {
            'context_size': 131072,
            'mode': 'chat',
        },
        'features': [
            ModelFeature.TOOL_CALL
        ],
    },
    'Skylark2-pro-4k': {
        'req_params': {
            'max_prompt_tokens': 4096,
            'max_new_tokens': 4000,
        },
        'model_properties': {
            'context_size': 4096,
            'mode': 'chat',
        },
        'features': [],
    },
    'Llama3-8B': {
        'req_params': {
            'max_prompt_tokens': 8192,
            'max_new_tokens': 8192,
        },
        'model_properties': {
            'context_size': 8192,
            'mode': 'chat',
        },
        'features': [],
    },
    'Llama3-70B': {
        'req_params': {
            'max_prompt_tokens': 8192,
            'max_new_tokens': 8192,
        },
        'model_properties': {
            'context_size': 8192,
            'mode': 'chat',
        },
        'features': [],
    },
    'Moonshot-v1-8k': {
        'req_params': {
            'max_prompt_tokens': 8192,
            'max_new_tokens': 4096,
        },
        'model_properties': {
            'context_size': 8192,
            'mode': 'chat',
        },
        'features': [],
    },
    'Moonshot-v1-32k': {
        'req_params': {
            'max_prompt_tokens': 32768,
            'max_new_tokens': 16384,
        },
        'model_properties': {
            'context_size': 32768,
            'mode': 'chat',
        },
        'features': [],
    },
    'Moonshot-v1-128k': {
        'req_params': {
            'max_prompt_tokens': 131072,
            'max_new_tokens': 65536,
        },
        'model_properties': {
            'context_size': 131072,
            'mode': 'chat',
        },
        'features': [],
    },
    'GLM3-130B': {
        'req_params': {
            'max_prompt_tokens': 8192,
            'max_new_tokens': 4096,
        },
        'model_properties': {
            'context_size': 8192,
            'mode': 'chat',
        },
        'features': [],
    },
    'GLM3-130B-Fin': {
        'req_params': {
            'max_prompt_tokens': 8192,
            'max_new_tokens': 4096,
        },
        'model_properties': {
            'context_size': 8192,
            'mode': 'chat',
        },
        'features': [],
    },
    'Mistral-7B': {
        'req_params': {
            'max_prompt_tokens': 8192,
            'max_new_tokens': 2048,
        },
        'model_properties': {
            'context_size': 8192,
            'mode': 'chat',
        },
        'features': [],
    }
}
