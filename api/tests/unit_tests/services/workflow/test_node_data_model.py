import json

from core.workflow.node_factory import node_data_model, resolve_workflow_node_class
from core.workflow.nodes.human_input.entities import HumanInputNodeDataFull
from graphon.enums import BuiltinNodeTypes
from models.workflow import Workflow, WorkflowType
from services.workflow.graph_diff import draft_token

_HUMAN_INPUT_V1 = {
    "id": "ask",
    "data": {
        "type": "human-input",
        "title": "Ask",
        "form_content": "{{#$output.reason#}}",
        "inputs": [
            {
                "type": "paragraph",
                "output_variable_name": "reason",
                "default": {"type": "constant", "value": "none"},
            }
        ],
        "user_actions": [{"id": "approve", "title": "Approve", "button_style": "primary"}],
        "delivery_methods": [
            {"id": "6f1f3a52-2a3c-4d6e-9d5b-0f4a3b1c7e11", "type": "webapp", "enabled": True, "config": {}}
        ],
    },
}
_GRAPH = {
    "nodes": [
        {"id": "start", "data": {"type": "start", "title": "Start", "variables": []}},
        _HUMAN_INPUT_V1,
        {"id": "end", "data": {"type": "end", "title": "End", "outputs": []}},
    ],
    "edges": [
        {"id": "e1", "source": "start", "target": "ask", "sourceHandle": "source"},
        {"id": "e2", "source": "ask", "target": "end", "sourceHandle": "approve"},
    ],
}
# Computed on 020e027cd7, before node_data_model replaced node_data_type.
_V1_GRAPH_TOKEN = "78c3f5863c200b68a4b3ca7e9441129e022c30ae60149d9604971d39e18cc993"


def test_human_input_v2_uses_its_own_model() -> None:
    cls = resolve_workflow_node_class(node_type=BuiltinNodeTypes.HUMAN_INPUT, node_version="2")

    assert node_data_model(cls) is cls._get_node_data_type()
    assert node_data_model(cls) is not HumanInputNodeDataFull


def test_human_input_v1_keeps_the_full_v1_model() -> None:
    cls = resolve_workflow_node_class(node_type=BuiltinNodeTypes.HUMAN_INPUT, node_version="1")

    assert node_data_model(cls) is HumanInputNodeDataFull


def test_other_nodes_use_their_declared_model() -> None:
    cls = resolve_workflow_node_class(node_type=BuiltinNodeTypes.CODE, node_version="1")

    assert node_data_model(cls) is cls._get_node_data_type()


def test_draft_token_unchanged_for_v1_human_input_and_a_plain_graph() -> None:
    draft = Workflow.new(
        tenant_id="workspace-1",
        app_id="app-1",
        type=WorkflowType.WORKFLOW,
        version=Workflow.VERSION_DRAFT,
        graph=json.dumps(_GRAPH),
        features="{}",
        created_by="account-1",
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )

    assert draft_token(draft) == _V1_GRAPH_TOKEN
