import json

from models.model import AppMode,ResourceType
from models.dataset import Dataset
from models.model import App

default_app_detail = {
    AppMode.CHAT: {
        "icon_type":"emoji",
        "icon":"🤖",
        "icon_background":"#FFEAD5",
    }
}

default_dataset_model = {
        AppMode.CHAT: {
        "name": "123",
        "description": None,
        "provider": "vendor",
        "permission": "only_me",
        "data_source_type": None,
        "indexing_technique": None,
        "app_count": 0,
        "document_count": 0,
        "word_count": 0,
        "created_by": "",
        "created_at": 0,
        "updated_by": "",
        "updated_at": 0,
        "embedding_model": None,
        "embedding_model_provider": None,
        "embedding_available": None,
        "retrieval_model_dict": {
            "search_method": "semantic_search",
            "reranking_enable": False,
            "reranking_mode": None,
            "reranking_model": {
                "reranking_provider_name": "",
                "reranking_model_name": ""
            },
            "weights": None,
            "top_k": 2,
            "score_threshold_enabled": False,
            "score_threshold": None
        },
        "tags": []
    }
}

default_resource_type = {
    ResourceType.APP:App,
    ResourceType.DATASET:Dataset
}

default_app_templates = {
    # workflow default mode
    AppMode.WORKFLOW: {
        "app": {
            "mode": AppMode.WORKFLOW.value,
            "enable_site": True,
            "enable_api": True,
        }
    },
    # completion default mode
    AppMode.COMPLETION: {
        "app": {
            "mode": AppMode.COMPLETION.value,
            "enable_site": True,
            "enable_api": True,
        },
        "model_config": {
            "model": {
                "provider": "openai",
                "name": "gpt-4o",
                "mode": "chat",
                "completion_params": {},
            },
            "user_input_form": json.dumps(
                [
                    {
                        "paragraph": {
                            "label": "Query",
                            "variable": "query",
                            "required": True,
                            "default": "",
                        },
                    },
                ]
            ),
            "pre_prompt": "{{query}}",
        },
    },
    # chat default mode
    AppMode.CHAT: {
        "app": {
            "mode": AppMode.CHAT.value,
            "enable_site": True,
            "enable_api": True,
        },
        "opening_statement":"",
        "language":"",
        "model_config": {
            "model": {
                "provider": "openai",
                "name": "gpt-4o",
                "mode": "chat",
                "completion_params": {},
            },
        },
        "pre_prompt": "",
        "chat_prompt_config": {
        },
        "completion_prompt_config": {
        },
        "user_input_form": [
        ],
        "dataset_query_variable": "",
        "opening_statement": "",
        "suggested_questions": [
        ],
        "more_like_this": {
            "enabled": False
        },
        "suggested_questions_after_answer": {
            "enabled": False
        },
        "speech_to_text": {
            "enabled": False
        },
        "text_to_speech": {
            "enabled": False,
            "voice": "",
            "language": ""
        },
        "retriever_resource": {
            "enabled": False
        },
        "sensitive_word_avoidance": {
            "enabled": False,
            "type": "",
            "configs": [
            ]
        },
        "agent_mode": {
            "enabled": False,
            "max_iteration": 5,
            "strategy": "function_call",
            "tools": [
            ]
        },
        "dataset_configs": {
                "top_k": 4,
                "reranking_mode": "weighted_score",
                "weights": {
                    "vector_setting": {
                        "vector_weight": 1,
                        "embedding_provider_name": "volcengine_maas",
                        "embedding_model_name": "doubao-embedding"
                    },
                    "keyword_setting": {
                        "keyword_weight": 0
                    }
                },
                "reranking_enable": False,
                "retrieval_model": "multiple",
                "datasets": {
                    "datasets": [
                        {
                            "dataset": {
                                "enabled": True,
                                "id": ""
                            }
                        }
                    ]
                }
            },
        "file_upload": {
            "image": {
                "enabled": False,
                "number_limits": 3,
                "detail": "high",
                "transfer_methods": [
                    "remote_url",
                    "local_file"
                ]
            }
        }
    },
    # advanced-chat default mode
    AppMode.ADVANCED_CHAT: {
        "app": {
            "mode": AppMode.ADVANCED_CHAT.value,
            "enable_site": True,
            "enable_api": True,
        },
    },
    # agent-chat default mode
    AppMode.AGENT_CHAT: {
        "app": {
            "mode": AppMode.AGENT_CHAT.value,
            "enable_site": True,
            "enable_api": True,
        },
        "model_config": {
            "model": {
                "provider": "openai",
                "name": "gpt-4o",
                "mode": "chat",
                "completion_params": {},
            },
        },
    },
}

default_app_model_config = {
    "pre_prompt": "",
    "prompt_type": "simple",
    "chat_prompt_config": {

    },
    "completion_prompt_config": {

    },
    "user_input_form": [

    ],
    "dataset_query_variable": "",
    "opening_statement": "",
    "suggested_questions": [

    ],
    "more_like_this": {
        "enabled": False
    },
    "suggested_questions_after_answer": {
        "enabled": False
    },
    "speech_to_text": {
        "enabled": False
    },
    "text_to_speech": {
        "enabled": False,
        "voice": "",
        "language": ""
    },
    "retriever_resource": {
        "enabled": False
    },
    "sensitive_word_avoidance": {
        "enabled": False,
        "type": "",
        "configs": [

        ]
    },
    "agent_mode": {
        "enabled": False,
        "max_iteration": 5,
        "strategy": "function_call",
        "tools": [

        ]
    },
    "dataset_configs": {
        "top_k": 4,
        "reranking_mode": "weighted_score",
        "weights": {
            "vector_setting": {
                "vector_weight": 1,
                "embedding_provider_name": "volcengine_maas",
                "embedding_model_name": "doubao-embedding"
            },
            "keyword_setting": {
                "keyword_weight": 0
            }
        },
        "reranking_enable": False,
        "retrieval_model": "multiple",
        "datasets": {
            "datasets": [
                # {
                #     "dataset": {
                #         "enabled": False,
                #         "id": "3b0ae236-7c7b-4187-8c96-d4930c90c62e"
                #     }
                # }
            ]
        }
    },
    "file_upload": {
        "image": {
            "enabled": False,
            "number_limits": 3,
            "detail": "high",
            "transfer_methods": [
                "remote_url",
                "local_file"
            ]
        }
    }
}
