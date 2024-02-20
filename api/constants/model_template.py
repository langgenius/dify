import json

model_templates = {
    # workflow default mode
    'workflow_default': {
        'app': {
            'mode': 'workflow',
            'enable_site': True,
            'enable_api': True,
            'is_demo': False,
            'api_rpm': 0,
            'api_rph': 0,
            'status': 'normal'
        },
        'model_config': {
            'provider': '',
            'model_id': '',
            'configs': {}
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
            'model_id': 'gpt-4',
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
                "name": "gpt-4",
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

    # agent default mode
    'agent_default': {
        'app': {
            'mode': 'agent',
            'enable_site': True,
            'enable_api': True,
            'is_demo': False,
            'api_rpm': 0,
            'api_rph': 0,
            'status': 'normal'
        },
        'model_config': {
            'provider': 'openai',
            'model_id': 'gpt-4',
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
                "name": "gpt-4",
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


