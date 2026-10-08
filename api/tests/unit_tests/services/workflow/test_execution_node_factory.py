from graphon.enums import BuiltinNodeTypes
from graphon.runtime import GraphRuntimeState, VariablePool
from services.workflow.execution.adapters.node_factory import DifyNodeFactory
from services.workflow.execution.ports import WorkflowRuntime
from tests.workflow_test_utils import build_test_graph_init_params


def test_factory_constructs_adapter_knowledge_retrieval_node(workflow_runtime: WorkflowRuntime) -> None:
    factory = DifyNodeFactory(
        graph_init_params=build_test_graph_init_params(),
        graph_runtime_state=GraphRuntimeState(variable_pool=VariablePool(), start_at=0),
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
