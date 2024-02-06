import json

model_templates = {
    # completion default mode
    'completion_default': {
        'app': {
            'mode': 'completion',
            'enable_site': True,
            'enable_api': True,
            'is_demo': False,
            'api_rpm': 0,
            'api_rph': 0,
            'status': 'normal'
        },
        'model_config': {
            'provider': 'openai',
            'model_id': 'gpt-3.5-turbo-instruct',
            'configs': {
                'prompt_template': '',
                'prompt_variables': [],
                'completion_params': {
                    'max_token': 512,
                    'temperature': 1,
                    'top_p': 1,
                    'presence_penalty': 0,
                    'frequency_penalty': 0,
                }
            },
            'model': json.dumps({
                "provider": "openai",
                "name": "gpt-3.5-turbo-instruct",
                "mode": "completion",
                "completion_params": {
                    "max_tokens": 512,
                    "temperature": 1,
                    "top_p": 1,
                    "presence_penalty": 0,
                    "frequency_penalty": 0
                }
            }),
            'user_input_form': json.dumps([
                {
                    "paragraph": {
                        "label": "Query",
                        "variable": "query",
                        "required": True,
                        "default": ""
                    }
                }
            ]),
            'pre_prompt': '{{query}}'
        }
    },

    # chat default mode
    'chat_default': {
        'app': {
            'mode': 'chat',
            'enable_site': True,
            'enable_api': True,
            'is_demo': False,
            'api_rpm': 0,
            'api_rph': 0,
            'status': 'normal'
        },
        'model_config': {
            'provider': 'openai',
            'model_id': 'gpt-3.5-turbo',
            'configs': {
                'prompt_template': '',
                'prompt_variables': [],
                'completion_params': {
                    'max_token': 512,
                    'temperature': 1,
                    'top_p': 1,
                    'presence_penalty': 0,
                    'frequency_penalty': 0,
                }
            },
            'model': json.dumps({
                "provider": "openai",
                "name": "gpt-3.5-turbo",
                "mode": "chat",
                "completion_params": {
                    "max_tokens": 512,
                    "temperature": 1,
                    "top_p": 1,
                    "presence_penalty": 0,
                    "frequency_penalty": 0
                }
            })
        }
    },
}


