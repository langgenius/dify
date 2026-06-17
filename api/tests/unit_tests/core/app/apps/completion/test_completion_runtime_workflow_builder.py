import json
from types import SimpleNamespace
from unittest.mock import MagicMock

from core.app.apps.completion.runtime_workflow_builder import RuntimeCompletionWorkflowBuilder
from graphon.nodes import BuiltinNodeTypes
from models.model import AppMode


def test_builder_returns_runtime_graph_without_workflow_record() -> None:
    app_model = SimpleNamespace(mode=AppMode.COMPLETION)
    app_config = MagicMock()
    workflow_converter = MagicMock(
        build_graph_from_app_config=MagicMock(return_value=({"nodes": [{"id": "start"}], "edges": []}, {}))
    )

    result = RuntimeCompletionWorkflowBuilder(workflow_converter=workflow_converter).build(
        app_model=app_model,
        app_config=app_config,
    )

    assert result.workflow_id.startswith("completion-runtime-")
    assert result.root_node_id == "start"
    assert result.graph_dict == {"nodes": [{"id": "start"}], "edges": []}
    workflow_converter.build_graph_from_app_config.assert_called_once_with(
        app_model=app_model,
        app_config=app_config,
        target_app_mode=AppMode.WORKFLOW,
    )


def test_builder_routes_api_based_variable_query_to_runtime_sys_query() -> None:
    app_model = SimpleNamespace(mode=AppMode.COMPLETION)
    app_config = MagicMock()
    request_body = {"params": {"query": ""}}
    workflow_converter = MagicMock(
        build_graph_from_app_config=MagicMock(
            return_value=(
                {
                    "nodes": [
                        {
                            "id": "http_request_1",
                            "data": {
                                "type": BuiltinNodeTypes.HTTP_REQUEST,
                                "body": {"type": "json", "data": json.dumps(request_body)},
                            },
                        }
                    ],
                    "edges": [],
                },
                {},
            )
        )
    )

    result = RuntimeCompletionWorkflowBuilder(workflow_converter=workflow_converter).build(
        app_model=app_model,
        app_config=app_config,
    )

    http_node = result.graph_dict["nodes"][0]
    body = json.loads(http_node["data"]["body"]["data"])
    assert body["params"]["query"] == "{{#sys.query#}}"
