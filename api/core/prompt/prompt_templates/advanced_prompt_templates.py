CONTEXT = "Use the following context as your learned knowledge, inside <context></context> XML tags.\n\n<context>\n{{#context#}}\n</context>\n\nWhen answer to user:\n- If you don't know, just say that you don't know.\n- If you don't know when you are not sure, ask for clarification.\nAvoid mentioning that you obtained the information from the context.\nAnd answer according to the language of the user's question.\n"  # noqa: E501

CHAT_APP_COMPLETION_PROMPT_CONFIG = {
    "completion_prompt_config": {
        "prompt": {
            "text": "{{#pre_prompt#}}\nHere are the chat histories between human and assistant, inside <histories></histories> XML tags.\n\n<histories>\n{{#histories#}}\n</histories>\n\n\nHuman: {{#query#}}\n\nAssistant: "  # noqa: E501
        },
        "conversation_histories_role": {"user_prefix": "Human", "assistant_prefix": "Assistant"},
    },
    "stop": ["Human:"],
}

CHAT_APP_CHAT_PROMPT_CONFIG = {"chat_prompt_config": {"prompt": [{"role": "system", "text": "{{#pre_prompt#}}"}]}}

COMPLETION_APP_CHAT_PROMPT_CONFIG = {"chat_prompt_config": {"prompt": [{"role": "user", "text": "{{#pre_prompt#}}"}]}}

COMPLETION_APP_COMPLETION_PROMPT_CONFIG = {
    "completion_prompt_config": {"prompt": {"text": "{{#pre_prompt#}}"}},
    "stop": ["Human:"],
}
