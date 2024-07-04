from typing import Optional

from core.workflow.graph_engine.entities.graph import Graph
from core.workflow.workflow_entry import WorkflowEntry


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

    workflow_entry = WorkflowEntry()
    graph = workflow_entry._init_graph(
        graph_config=graph_config
    )

    assert graph.root_node.id == "1717222650545"
    assert graph.root_node.source_edge_config is None
    assert graph.root_node.descendant_node_ids == ["1719481290322"]

    assert graph.graph_nodes.get("1719481290322") is not None
    assert len(graph.graph_nodes.get("1719481290322").descendant_node_ids) == 2

    assert graph.graph_nodes.get("llm").run_condition is not None
    assert graph.graph_nodes.get("1719481315734").run_condition is not None


def test__init_graph_with_iteration():
    graph_config = {
        "edges": [
            {
                "data": {
                    "sourceType": "llm",
                    "targetType": "answer"
                },
                "id": "llm-answer",
                "source": "llm",
                "sourceHandle": "source",
                "target": "answer",
                "targetHandle": "target",
                "type": "custom"
            },
            {
                "data": {
                    "isInIteration": False,
                    "sourceType": "iteration",
                    "targetType": "llm"
                },
                "id": "1720001776597-source-llm-target",
                "selected": False,
                "source": "1720001776597",
                "sourceHandle": "source",
                "target": "llm",
                "targetHandle": "target",
                "type": "custom",
                "zIndex": 0
            },
            {
                "data": {
                    "isInIteration": True,
                    "iteration_id": "1720001776597",
                    "sourceType": "template-transform",
                    "targetType": "llm"
                },
                "id": "1720001783092-source-1720001859851-target",
                "source": "1720001783092",
                "sourceHandle": "source",
                "target": "1720001859851",
                "targetHandle": "target",
                "type": "custom",
                "zIndex": 1002
            },
            {
                "data": {
                    "isInIteration": True,
                    "iteration_id": "1720001776597",
                    "sourceType": "llm",
                    "targetType": "answer"
                },
                "id": "1720001859851-source-1720001879621-target",
                "source": "1720001859851",
                "sourceHandle": "source",
                "target": "1720001879621",
                "targetHandle": "target",
                "type": "custom",
                "zIndex": 1002
            },
            {
                "data": {
                    "isInIteration": False,
                    "sourceType": "start",
                    "targetType": "code"
                },
                "id": "1720001771022-source-1720001956578-target",
                "source": "1720001771022",
                "sourceHandle": "source",
                "target": "1720001956578",
                "targetHandle": "target",
                "type": "custom",
                "zIndex": 0
            },
            {
                "data": {
                    "isInIteration": False,
                    "sourceType": "code",
                    "targetType": "iteration"
                },
                "id": "1720001956578-source-1720001776597-target",
                "source": "1720001956578",
                "sourceHandle": "source",
                "target": "1720001776597",
                "targetHandle": "target",
                "type": "custom",
                "zIndex": 0
            }
        ],
        "nodes": [
            {
                "data": {
                    "desc": "",
                    "selected": False,
                    "title": "Start",
                    "type": "start",
                    "variables": []
                },
                "height": 53,
                "id": "1720001771022",
                "position": {
                    "x": 80,
                    "y": 282
                },
                "positionAbsolute": {
                    "x": 80,
                    "y": 282
                },
                "selected": False,
                "sourcePosition": "right",
                "targetPosition": "left",
                "type": "custom",
                "width": 244
            },
            {
                "data": {
                    "context": {
                        "enabled": False,
                        "variable_selector": []
                    },
                    "desc": "",
                    "memory": {
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
                            "temperature": 0.7
                        },
                        "mode": "chat",
                        "name": "gpt-3.5-turbo",
                        "provider": "openai"
                    },
                    "prompt_template": [
                        {
                            "id": "b7d1350e-cf0d-4ff3-8ad0-52b6f1218781",
                            "role": "system",
                            "text": ""
                        }
                    ],
                    "selected": False,
                    "title": "LLM",
                    "type": "llm",
                    "variables": [],
                    "vision": {
                        "enabled": False
                    }
                },
                "height": 97,
                "id": "llm",
                "position": {
                    "x": 1730.595805935594,
                    "y": 282
                },
                "positionAbsolute": {
                    "x": 1730.595805935594,
                    "y": 282
                },
                "selected": True,
                "sourcePosition": "right",
                "targetPosition": "left",
                "type": "custom",
                "width": 244
            },
            {
                "data": {
                    "answer": "{{#llm.text#}}",
                    "desc": "",
                    "selected": False,
                    "title": "Answer",
                    "type": "answer",
                    "variables": []
                },
                "height": 105,
                "id": "answer",
                "position": {
                    "x": 2042.803154918583,
                    "y": 282
                },
                "positionAbsolute": {
                    "x": 2042.803154918583,
                    "y": 282
                },
                "selected": False,
                "sourcePosition": "right",
                "targetPosition": "left",
                "type": "custom",
                "width": 244
            },
            {
                "data": {
                    "desc": "",
                    "height": 202,
                    "iterator_selector": [
                        "1720001956578",
                        "result"
                    ],
                    "output_selector": [
                        "1720001859851",
                        "text"
                    ],
                    "output_type": "array[string]",
                    "selected": False,
                    "startNodeType": "template-transform",
                    "start_node_id": "1720001783092",
                    "title": "Iteration",
                    "type": "iteration",
                    "width": 985
                },
                "height": 202,
                "id": "1720001776597",
                "position": {
                    "x": 678.6748900850307,
                    "y": 282
                },
                "positionAbsolute": {
                    "x": 678.6748900850307,
                    "y": 282
                },
                "selected": False,
                "sourcePosition": "right",
                "targetPosition": "left",
                "type": "custom",
                "width": 985,
                "zIndex": 1
            },
            {
                "data": {
                    "desc": "",
                    "isInIteration": True,
                    "isIterationStart": True,
                    "iteration_id": "1720001776597",
                    "selected": False,
                    "template": "{{ arg1 }}",
                    "title": "Template",
                    "type": "template-transform",
                    "variables": [
                        {
                            "value_selector": [
                                "1720001776597",
                                "item"
                            ],
                            "variable": "arg1"
                        }
                    ]
                },
                "extent": "parent",
                "height": 53,
                "id": "1720001783092",
                "parentId": "1720001776597",
                "position": {
                    "x": 117,
                    "y": 85
                },
                "positionAbsolute": {
                    "x": 795.6748900850307,
                    "y": 367
                },
                "selected": False,
                "sourcePosition": "right",
                "targetPosition": "left",
                "type": "custom",
                "width": 244,
                "zIndex": 1001
            },
            {
                "data": {
                    "context": {
                        "enabled": False,
                        "variable_selector": []
                    },
                    "desc": "",
                    "isInIteration": True,
                    "iteration_id": "1720001776597",
                    "model": {
                        "completion_params": {
                            "temperature": 0.7
                        },
                        "mode": "chat",
                        "name": "gpt-3.5-turbo",
                        "provider": "openai"
                    },
                    "prompt_template": [
                        {
                            "id": "9575b8f2-33c4-4611-b6d0-17d8d436a250",
                            "role": "system",
                            "text": "{{#1720001783092.output#}}"
                        }
                    ],
                    "selected": False,
                    "title": "LLM 2",
                    "type": "llm",
                    "variables": [],
                    "vision": {
                        "enabled": False
                    }
                },
                "extent": "parent",
                "height": 97,
                "id": "1720001859851",
                "parentId": "1720001776597",
                "position": {
                    "x": 421,
                    "y": 85
                },
                "positionAbsolute": {
                    "x": 1099.6748900850307,
                    "y": 367
                },
                "selected": False,
                "sourcePosition": "right",
                "targetPosition": "left",
                "type": "custom",
                "width": 244,
                "zIndex": 1002
            },
            {
                "data": {
                    "answer": "{{#1720001859851.text#}}",
                    "desc": "",
                    "isInIteration": True,
                    "iteration_id": "1720001776597",
                    "selected": False,
                    "title": "Answer 2",
                    "type": "answer",
                    "variables": []
                },
                "extent": "parent",
                "height": 105,
                "id": "1720001879621",
                "parentId": "1720001776597",
                "position": {
                    "x": 725,
                    "y": 85
                },
                "positionAbsolute": {
                    "x": 1403.6748900850307,
                    "y": 367
                },
                "selected": False,
                "sourcePosition": "right",
                "targetPosition": "left",
                "type": "custom",
                "width": 244,
                "zIndex": 1002
            },
            {
                "data": {
                    "code": "\ndef main() -> dict:\n    return {\n        \"result\": [\n            \"a\",\n            \"b\"\n        ]\n    }\n",
                    "code_language": "python3",
                    "desc": "",
                    "outputs": {
                        "result": {
                            "children": None,
                            "type": "array[string]"
                        }
                    },
                    "selected": False,
                    "title": "Code",
                    "type": "code",
                    "variables": []
                },
                "height": 53,
                "id": "1720001956578",
                "position": {
                    "x": 380,
                    "y": 282
                },
                "positionAbsolute": {
                    "x": 380,
                    "y": 282
                },
                "sourcePosition": "right",
                "targetPosition": "left",
                "type": "custom",
                "width": 244
            }
        ]
    }

    workflow_entry = WorkflowEntry()
    graph = workflow_entry._init_graph(
        graph_config=graph_config
    )

    # start 1720001771022 -> code 1720001956578 -> iteration 1720001776597 -> llm llm -> answer answer
    # iteration 1720001776597:
    #   [template 1720001783092 -> llm 1720001859851 -> answer 1720001879621]

    main_graph_orders = [
        "1720001771022",
        "1720001956578",
        "1720001776597",
        "llm",
        "answer"
    ]

    iteration_sub_graph_orders = [
        "1720001783092",
        "1720001859851",
        "1720001879621"
    ]

    assert graph.root_node.id == "1720001771022"

    print("")

    current_graph = graph
    for i, node_id in enumerate(main_graph_orders):
        current_root_node = current_graph.root_node
        assert current_root_node is not None
        assert current_root_node.id == node_id

        if current_root_node.node_config.get("data", {}).get("type") == "iteration":
            assert current_root_node.sub_graph is not None

            sub_graph = current_root_node.sub_graph
            assert sub_graph.root_node.id == "1720001783092"

            current_sub_graph = sub_graph
            for j, sub_node_id in enumerate(iteration_sub_graph_orders):
                sub_descendant_graphs = current_sub_graph.get_descendant_graphs(node_id=current_sub_graph.root_node.id)
                print(f"Iteration [{current_sub_graph.root_node.id}] -> {len(sub_descendant_graphs)}"
                      f" {[sub_descendant_graph.root_node.id for sub_descendant_graph in sub_descendant_graphs]}")

                if j == len(iteration_sub_graph_orders) - 1:
                    break

                assert len(sub_descendant_graphs) == 1

                first_sub_descendant_graph = sub_descendant_graphs[0]
                assert first_sub_descendant_graph.root_node.id == iteration_sub_graph_orders[j + 1]
                assert first_sub_descendant_graph.root_node.predecessor_node_id == sub_node_id

                current_sub_graph = first_sub_descendant_graph

        descendant_graphs = current_graph.get_descendant_graphs(node_id=current_graph.root_node.id)
        print(f"[{current_graph.root_node.id}] -> {len(descendant_graphs)}"
              f" {[descendant_graph.root_node.id for descendant_graph in descendant_graphs]}")
        if i == len(main_graph_orders) - 1:
            assert len(descendant_graphs) == 0
            break

        assert len(descendant_graphs) == 1

        first_descendant_graph = descendant_graphs[0]
        assert first_descendant_graph.root_node.id == main_graph_orders[i + 1]
        assert first_descendant_graph.root_node.predecessor_node_id == node_id

        current_graph = first_descendant_graph
