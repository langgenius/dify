# default block config
default_block_configs = [
    {
        "type": "llm",
        "config": {
            "prompt_templates": {
                "chat_model": {
                    "prompts": [
                        {
                            "role": "system",
                            "text": "You are a helpful AI assistant."
                        }
                    ]
                },
                "completion_model": {
                    "conversation_histories_role": {
                        "user_prefix": "Human",
                        "assistant_prefix": "Assistant"
                    },
                    "prompt": {
                        "text": "Here is the chat histories between human and assistant, inside "
                                "<histories></histories> XML tags.\n\n<histories>\n{{"
                                "#histories#}}\n</histories>\n\n\nHuman: {{#query#}}\n\nAssistant:"
                    },
                    "stop": ["Human:"]
                }
            }
        }
    },
    {
        "type": "code",
        "config": {
            "variables": [
                {
                    "variable": "arg1",
                    "value_selector": []
                },
                {
                    "variable": "arg2",
                    "value_selector": []
                }
            ],
            "code_language": "python3",
            "code": "def main(\n    arg1: int,\n    arg2: int,\n) -> int:\n    return {\n        \"result\": arg1 "
                    "+ arg2\n    }",
            "outputs": [
                {
                    "variable": "result",
                    "variable_type": "number"
                }
            ]
        }
    },
    {
        "type": "template-transform",
        "config": {
            "variables": [
                {
                    "variable": "arg1",
                    "value_selector": []
                }
            ],
            "template": "{{ arg1 }}"
        }
    },
    {
        "type": "question-classifier",
        "config": {
            "instructions": ""  # TODO
        }
    }
]
