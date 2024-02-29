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
            'provider': '',
            'model_id': '',
            'configs': {},
            'model': json.dumps({
                "provider": "openai",
                "name": "gpt-3.5-turbo-instruct",
                "mode": "completion",
                "completion_params": {}
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
            'provider': '',
            'model_id': '',
            'configs': {},
            'model': json.dumps({
                "provider": "openai",
                "name": "gpt-3.5-turbo",
                "mode": "chat",
                "completion_params": {}
            })
        }
    },
}


