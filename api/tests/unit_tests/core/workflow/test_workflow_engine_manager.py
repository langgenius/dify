from core.workflow.graph import Graph
from core.workflow.workflow_engine_manager import WorkflowEngineManager


def test__init_graph():
    graph_config = {
        "edges": [
            {
                "id": "llm-source-answer-target",
                "source": "llm",
                "target": "answer",
            },
            {
                "id": "1717222650545-source-1719481290322-target",
                "source": "1717222650545",
                "target": "1719481290322",
            },
            {
                "id": "1719481290322-1-llm-target",
                "source": "1719481290322",
                "sourceHandle": "1",
                "target": "llm",
            },
            {
                "id": "1719481290322-2-1719481315734-target",
                "source": "1719481290322",
                "sourceHandle": "2",
                "target": "1719481315734",
            },
            {
                "id": "1719481315734-source-1719481326339-target",
                "source": "1719481315734",
                "target": "1719481326339",
            }
        ],
        "nodes": [
            {
                "data": {
                    "desc": "",
                    "title": "Start",
                    "type": "start",
                    "variables": [
                        {
                            "label": "name",
                            "max_length": 48,
                            "options": [],
                            "required": False,
                            "type": "text-input",
                            "variable": "name"
                        }
                    ]
                },
                "id": "1717222650545",
                "position": {
                    "x": -147.65487258270954,
                    "y": 263.5326708413438
                },
            },
            {
                "data": {
                    "context": {
                        "enabled": False,
                        "variable_selector": []
                    },
                    "desc": "",
                    "memory": {
                        "query_prompt_template": "{{#sys.query#}}",
                        "role_prefix": {
                            "assistant": "",
                            "user": ""
                        },
                        "window": {
                            "enabled": False,
                            "size": 10
                        }
                    },
                    "model": {
                        "completion_params": {
                            "temperature": 0
                        },
                        "mode": "chat",
                        "name": "anthropic.claude-3-sonnet-20240229-v1:0",
                        "provider": "bedrock"
                    },
                    "prompt_config": {
                        "jinja2_variables": [
                            {
                                "value_selector": [
                                    "sys",
                                    "query"
                                ],
                                "variable": "query"
                            }
                        ]
                    },
                    "prompt_template": [
                        {
                            "edition_type": "basic",
                            "id": "8b02d178-3aa0-4dbd-82bf-8b6a40658300",
                            "jinja2_text": "",
                            "role": "system",
                            "text": "yep"
                        }
                    ],
                    "title": "LLM",
                    "type": "llm",
                    "variables": [],
                    "vision": {
                        "configs": {
                            "detail": "low"
                        },
                        "enabled": True
                    }
                },
                "id": "llm",
                "position": {
                    "x": 654.0331237272932,
                    "y": 263.5326708413438
                },
            },
            {
                "data": {
                    "answer": "123{{#llm.text#}}",
                    "desc": "",
                    "title": "Answer",
                    "type": "answer",
                    "variables": []
                },
                "id": "answer",
                "position": {
                    "x": 958.1129142362784,
                    "y": 263.5326708413438
                },
            },
            {
                "data": {
                    "classes": [
                        {
                            "id": "1",
                            "name": "happy"
                        },
                        {
                            "id": "2",
                            "name": "sad"
                        }
                    ],
                    "desc": "",
                    "instructions": "",
                    "model": {
                        "completion_params": {
                            "temperature": 0.7
                        },
                        "mode": "chat",
                        "name": "gpt-4o",
                        "provider": "openai"
                    },
                    "query_variable_selector": [
                        "1717222650545",
                        "sys.query"
                    ],
                    "title": "Question Classifier",
                    "topics": [],
                    "type": "question-classifier"
                },
                "id": "1719481290322",
                "position": {
                    "x": 165.25154615277052,
                    "y": 263.5326708413438
                }
            },
            {
                "data": {
                    "authorization": {
                        "config": None,
                        "type": "no-auth"
                    },
                    "body": {
                        "data": "",
                        "type": "none"
                    },
                    "desc": "",
                    "headers": "",
                    "method": "get",
                    "params": "",
                    "timeout": {
                        "max_connect_timeout": 0,
                        "max_read_timeout": 0,
                        "max_write_timeout": 0
                    },
                    "title": "HTTP Request",
                    "type": "http-request",
                    "url": "https://baidu.com",
                    "variables": []
                },
                "height": 88,
                "id": "1719481315734",
                "position": {
                    "x": 654.0331237272932,
                    "y": 474.1180064703089
                }
            },
            {
                "data": {
                    "answer": "{{#1719481315734.status_code#}}",
                    "desc": "",
                    "title": "Answer 2",
                    "type": "answer",
                    "variables": []
                },
                "height": 105,
                "id": "1719481326339",
                "position": {
                    "x": 958.1129142362784,
                    "y": 474.1180064703089
                },
            }
        ],
    }

    workflow_engine_manager = WorkflowEngineManager()
    graph = workflow_engine_manager._init_graph(
        graph_config=graph_config
    )

    assert graph.root_node.id == "1717222650545"
    assert graph.root_node.source_edge_config is None
    assert graph.root_node.target_edge_config is not None
    assert graph.root_node.descendant_node_ids == ["1719481290322"]

    assert graph.graph_nodes.get("1719481290322") is not None
    assert len(graph.graph_nodes.get("1719481290322").descendant_node_ids) == 2

    assert graph.graph_nodes.get("llm").run_condition_callback is not None
    assert graph.graph_nodes.get("1719481315734").run_condition_callback is not None
