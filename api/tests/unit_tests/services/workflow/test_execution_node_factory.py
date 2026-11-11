from graphon.enums import BuiltinNodeTypes
from graphon.runtime import RuntimeState, VariablePool
from services.human_input_v2.composition import WorkflowHumanInputRuntime
from services.workflow.execution.adapters.node_factory import DifyNodeFactory
from services.workflow.execution.ports import WorkflowRuntime
from tests.workflow_test_utils import build_test_graph_init_params


def test_factory_constructs_adapter_knowledge_retrieval_node(workflow_runtime: WorkflowRuntime) -> None:
    factory = DifyNodeFactory(
        init_params=build_test_graph_init_params(),
        runtime_state=RuntimeState(workflow_id="workflow", variable_pool=VariablePool(), start_at=0),
        workflow_runtime=workflow_runtime,
    )

    node = factory.create_node(
        {
            "id": "knowledge-node",
            "data": {
                "type": BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL,
                "title": "Knowledge Retrieval",
                "version": "1",
                "dataset_ids": [],
                "retrieval_mode": "multiple",
                "multiple_retrieval_config": {
                    "top_k": 4,
                    "reranking_enable": False,
                },
            },
        }
    )

    from services.workflow.execution.adapters.knowledge_retrieval import KnowledgeRetrievalNode

    assert isinstance(node, KnowledgeRetrievalNode)
    assert node.id == "knowledge-node"


def test_factory_constructs_human_input_v2_with_application_runtime(workflow_runtime: WorkflowRuntime) -> None:
    factory = DifyNodeFactory(
        init_params=build_test_graph_init_params(),
        runtime_state=RuntimeState(workflow_id="workflow", variable_pool=VariablePool(), start_at=0),
        workflow_runtime=workflow_runtime,
    )

    node = factory.create_node(
        {
            "id": "human-input-node",
            "data": {
                "type": BuiltinNodeTypes.HUMAN_INPUT,
                "title": "Approval",
                "version": "2",
                "recipients_spec": [],
                "message_template": {"subject": "Approval requested", "body": "[Request URL]"},
                "debug_mode": {"enabled": False, "channels": []},
                "form_content": "Review the request",
                "user_actions": [],
            },
        }
    )

    from core.workflow.nodes.human_input_v2.node import HumanInputNode

    assert isinstance(node, HumanInputNode)
    assert isinstance(node._human_input_runtime, WorkflowHumanInputRuntime)
