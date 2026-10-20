import os
import subprocess
import sys
import textwrap
from pathlib import Path


def test_adapter_mapping_overrides_moved_nodes_without_mutating_shared_registry() -> None:
    from core.trigger.constants import TRIGGER_WEBHOOK_NODE_TYPE
    from graphon.enums import BuiltinNodeTypes
    from graphon.nodes.base.node import Node
    from services.workflow.execution.adapters import node_factory

    node_factory.register_nodes()
    shared_mapping_before = {
        node_type: dict(version_mapping) for node_type, version_mapping in Node.get_node_type_classes_mapping().items()
    }
    registry_version_before = Node.get_registry_version()

    adapter_mapping = node_factory.get_node_type_classes_mapping()

    shared_mapping_after = Node.get_node_type_classes_mapping()
    assert Node.get_registry_version() == registry_version_before
    assert shared_mapping_after.keys() == shared_mapping_before.keys()
    for node_type, version_mapping in shared_mapping_before.items():
        assert shared_mapping_after[node_type].keys() == version_mapping.keys()
        for version, node_class in version_mapping.items():
            assert shared_mapping_after[node_type][version] is node_class

    from services.workflow.execution.adapters.agent_node import AgentNode
    from services.workflow.execution.adapters.agent_v2.agent_node import DifyAgentNode
    from services.workflow.execution.adapters.knowledge_retrieval import KnowledgeRetrievalNode
    from services.workflow.execution.adapters.trigger_webhook import TriggerWebhookNode

    assert adapter_mapping[BuiltinNodeTypes.AGENT]["1"] is AgentNode
    assert adapter_mapping[BuiltinNodeTypes.AGENT]["2"] is DifyAgentNode
    assert adapter_mapping[BuiltinNodeTypes.AGENT][node_factory.LATEST_VERSION] is DifyAgentNode
    assert adapter_mapping[BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL]["1"] is KnowledgeRetrievalNode
    assert adapter_mapping[BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL][node_factory.LATEST_VERSION] is KnowledgeRetrievalNode
    assert adapter_mapping[TRIGGER_WEBHOOK_NODE_TYPE]["1"] is TriggerWebhookNode
    assert adapter_mapping[TRIGGER_WEBHOOK_NODE_TYPE][node_factory.LATEST_VERSION] is TriggerWebhookNode

    assert (
        node_factory.DifyNodeFactory._resolve_node_class(
            node_type=BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL,
            node_version="1",
        )
        is KnowledgeRetrievalNode
    )
    assert (
        node_factory.DifyNodeFactory._resolve_node_class(
            node_type=BuiltinNodeTypes.AGENT,
            node_version="1",
        )
        is AgentNode
    )
    assert (
        node_factory.DifyNodeFactory._resolve_node_class(
            node_type=BuiltinNodeTypes.AGENT,
            node_version="2",
        )
        is DifyAgentNode
    )
    assert (
        node_factory.DifyNodeFactory._resolve_node_class(
            node_type=TRIGGER_WEBHOOK_NODE_TYPE,
            node_version="1",
        )
        is TriggerWebhookNode
    )
    assert (
        node_factory.resolve_workflow_node_class(
            node_type=BuiltinNodeTypes.AGENT,
            node_version="2",
            node_data={"type": "agent", "version": "2"},
        )
        is AgentNode
    )
    assert (
        node_factory.resolve_workflow_node_class(
            node_type=BuiltinNodeTypes.AGENT,
            node_version="2",
            node_data={"type": "agent", "version": "2", "agent_node_kind": "dify_agent"},
        )
        is DifyAgentNode
    )


def test_moved_core_nodes_resolve_after_importing_production_entrypoints() -> None:
    api_root = Path(__file__).resolve().parents[4]

    # `PYTHONSAFEPATH=1` enables Python's safe-path mode, which suppresses the
    # usual implicit insertion of the working directory into `sys.path`.
    # Set `PYTHONPATH` explicitly so this subprocess test stays deterministic in
    # both CI and local shells that may export `PYTHONSAFEPATH`.
    env = os.environ.copy()
    existing_pythonpath = env.get("PYTHONPATH")
    env["PYTHONPATH"] = (
        str(api_root) if not existing_pythonpath else os.pathsep.join([str(api_root), existing_pythonpath])
    )
    env["PYTHONSAFEPATH"] = "1"
    script = textwrap.dedent(
        """
        from services.workflow.execution.adapters import graph as workflow_app_runner
        from services.workflow.execution.adapters import workflow_entry
        from core.workflow.nodes.knowledge_index import KNOWLEDGE_INDEX_NODE_TYPE
        from services.workflow.execution.adapters.node_factory import (
            DifyNodeFactory,
            NODE_TYPE_CLASSES_MAPPING,
            resolve_workflow_node_class,
        )
        from core.trigger.constants import TRIGGER_WEBHOOK_NODE_TYPE
        from graphon.enums import BuiltinNodeTypes
        from services import workflow_service
        from services.rag_pipeline import rag_pipeline

        _ = workflow_entry, workflow_app_runner, workflow_service, rag_pipeline

        expected = (
            KNOWLEDGE_INDEX_NODE_TYPE,
            BuiltinNodeTypes.DATASOURCE,
        )

        for node_type in expected:
            assert node_type in NODE_TYPE_CLASSES_MAPPING, node_type
            resolved = DifyNodeFactory._resolve_node_class(node_type=node_type, node_version="1")
            assert resolved.__module__.startswith("core.workflow.nodes."), resolved.__module__

        # Resolve through the production bootstrap before importing the moved
        # classes; preloading them here would hide missing registration.
        agent = DifyNodeFactory._resolve_node_class(node_type=BuiltinNodeTypes.AGENT, node_version="1")
        webhook = DifyNodeFactory._resolve_node_class(node_type=TRIGGER_WEBHOOK_NODE_TYPE, node_version="1")
        from services.workflow.execution.adapters.agent_node import AgentNode
        from services.workflow.execution.adapters.agent_v2.agent_node import DifyAgentNode
        from services.workflow.execution.adapters.trigger_webhook import TriggerWebhookNode

        from services.workflow.execution.adapters.knowledge_retrieval import KnowledgeRetrievalNode
        assert DifyNodeFactory._resolve_node_class(
            node_type=BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL, node_version="1"
        ) is KnowledgeRetrievalNode
        assert agent is AgentNode
        assert webhook is TriggerWebhookNode
        assert DifyNodeFactory._resolve_node_class(
            node_type=BuiltinNodeTypes.AGENT,
            node_version="2",
        ) is DifyAgentNode
        assert resolve_workflow_node_class(
            node_type=BuiltinNodeTypes.AGENT,
            node_version="2",
            node_data={"type": "agent", "version": "2"},
        ) is AgentNode
        assert resolve_workflow_node_class(
            node_type=BuiltinNodeTypes.AGENT,
            node_version="2",
            node_data={"type": "agent", "version": "2", "agent_node_kind": "dify_agent"},
        ) is DifyAgentNode
        """
    )
    completed = subprocess.run(
        [sys.executable, "-c", script],
        cwd=api_root,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )

    assert completed.returncode == 0, completed.stderr or completed.stdout
