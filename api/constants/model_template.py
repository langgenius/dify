from models.model import AppMode

default_app_templates = {
    # workflow default mode
    AppMode.WORKFLOW: {
        'app': {
            'mode': AppMode.WORKFLOW.value,
            'enable_site': True,
            'enable_api': True
        }
    },

    # chat default mode
    AppMode.CHAT: {
        'app': {
            'mode': AppMode.CHAT.value,
            'enable_site': True,
            'enable_api': True
        },
        'model_config': {
            'model': {
                "provider": "openai",
                "name": "gpt-4",
                "mode": "chat",
                "completion_params": {}
            }
        }
    },

    # advanced-chat default mode
    AppMode.ADVANCED_CHAT: {
        'app': {
            'mode': AppMode.ADVANCED_CHAT.value,
            'enable_site': True,
            'enable_api': True
        }
    },

    # agent-chat default mode
    AppMode.AGENT_CHAT: {
        'app': {
            'mode': AppMode.AGENT_CHAT.value,
            'enable_site': True,
            'enable_api': True
        },
        'model_config': {
            'model': {
                "provider": "openai",
                "name": "gpt-4",
                "mode": "chat",
                "completion_params": {}
            }
        }
    }
}
