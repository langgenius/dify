CONTEXT = "Use the following context as your learned knowledge, inside <context></context> XML tags.\n\n<context>\n{{#context#}}\n</context>\n\nWhen answer to user:\n- If you don't know, just say that you don't know.\n- If you don't know when you are not sure, ask for clarification.\nAvoid mentioning that you obtained the information from the context.\nAnd answer according to the language of the user's question.\n"  # noqa: E501

BAICHUAN_CONTEXT = "用户在与一个客观的助手对话。助手会尊重找到的材料，给出全面专业的解释，但不会过度演绎。同时回答中不会暴露引用的材料：\n\n```\n{{#context#}}\n```\n\n"  # noqa: E501

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

BAICHUAN_CHAT_APP_COMPLETION_PROMPT_CONFIG = {
    "completion_prompt_config": {
        "prompt": {
            "text": "{{#pre_prompt#}}\n\n用户和助手的历史对话内容如下：\n```\n{{#histories#}}\n```\n\n\n\n用户：{{#query#}}"  # noqa: E501
        },
        "conversation_histories_role": {"user_prefix": "用户", "assistant_prefix": "助手"},
    },
    "stop": ["用户:"],
}

BAICHUAN_CHAT_APP_CHAT_PROMPT_CONFIG = {
    "chat_prompt_config": {"prompt": [{"role": "system", "text": "{{#pre_prompt#}}"}]}
}

BAICHUAN_COMPLETION_APP_CHAT_PROMPT_CONFIG = {
    "chat_prompt_config": {"prompt": [{"role": "user", "text": "{{#pre_prompt#}}"}]}
}

BAICHUAN_COMPLETION_APP_COMPLETION_PROMPT_CONFIG = {
    "completion_prompt_config": {"prompt": {"text": "{{#pre_prompt#}}"}},
    "stop": ["用户:"],
}
