"""Workflow nodes receive the application's authoritative KnowledgeFS runtime ports."""

import time
from collections.abc import Callable
from unittest.mock import MagicMock

import pytest
from flask import Flask

from core.workflow.node_factory import DifyNodeFactory
from core.workflow.node_runtime import build_knowledge_fs_node_dependencies
from core.workflow.nodes.knowledge_retrieval_v2.knowledge_retrieval_v2_node import KnowledgeRetrievalV2Node
from extensions import ext_application_services
from graphon.enums import WorkflowNodeExecutionStatus
from graphon.runtime import GraphRuntimeState, VariablePool
from graphon.variables import StringSegment
from services.knowledge_fs import runtime as runtime_module
from services.knowledge_fs import workflow_runtime
from services.knowledge_fs.runtime import KnowledgeFSRuntime
from tests.workflow_test_utils import build_test_graph_init_params


def test_application_registers_lazy_workflow_runtime_dependencies(monkeypatch: pytest.MonkeyPatch) -> None:
    app = Flask(__name__)
    session_maker = MagicMock()
    runtime = MagicMock(spec=KnowledgeFSRuntime)
    resolve_runtime = MagicMock(return_value=runtime)
    monkeypatch.setattr(workflow_runtime, "get_knowledge_fs_runtime", resolve_runtime)
    monkeypatch.setattr(workflow_runtime.session_factory, "get_session_maker", lambda: session_maker)
    monkeypatch.setattr(ext_application_services, "get_session_maker", lambda: session_maker)
    monkeypatch.setattr(ext_application_services, "build_application_services", MagicMock())

    ext_application_services.init_app(app)
    resolve_runtime.assert_not_called()

    with app.app_context():
        ports = build_knowledge_fs_node_dependencies()

    resolve_runtime.assert_not_called()
    capabilities = ports["capability_service"]
    assert isinstance(capabilities, workflow_runtime._LazyWorkflowCapabilities)
    assert ports["binding_service"] is capabilities
    run_context = MagicMock()
    caller_kind = MagicMock()
    resource = MagicMock()
    payload = MagicMock()
    assert (
        capabilities.run_retrieval(run_context=run_context, caller_kind=caller_kind, resource=resource, payload=payload)
        is runtime.app_capabilities.run_retrieval.return_value
    )
    runtime.app_capabilities.run_retrieval.assert_called_once_with(
        run_context=run_context, caller_kind=caller_kind, resource=resource, payload=payload
    )
    assert (
        capabilities.list_metadata_fields(
            run_context=run_context, caller_kind=caller_kind, resource=resource, cursor="next", limit=7
        )
        is runtime.app_capabilities.list_metadata_fields.return_value
    )
    runtime.app_capabilities.list_metadata_fields.assert_called_once_with(
        run_context=run_context, caller_kind=caller_kind, resource=resource, cursor="next", limit=7
    )
    assert (
        capabilities.upsert(tenant_id="tenant", actor_account_id="actor", control_space_id="space", payload=payload)
        is runtime.app_bindings.upsert.return_value
    )
    runtime.app_bindings.upsert.assert_called_once_with(
        tenant_id="tenant", actor_account_id="actor", control_space_id="space", payload=payload
    )
    assert resolve_runtime.call_count == 3
    resolve_runtime.assert_called_with(session_maker)
    assert ports["query_image_issuer"] is workflow_runtime.issue_workflow_query_image_reference
    assert ports["failed_retrieval_dispatcher"] is workflow_runtime.enqueue_workflow_failed_retrieval_capture


def test_graph_can_create_unused_retrieval_node_without_knowledge_fs_config(
    monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
) -> None:
    config_overrides(KNOWLEDGE_FS_BASE_URL=None)
    monkeypatch.setattr(runtime_module, "_runtime_cache", None)
    resolve_runtime = MagicMock(wraps=runtime_module.get_knowledge_fs_runtime)
    monkeypatch.setattr(workflow_runtime, "get_knowledge_fs_runtime", resolve_runtime)
    monkeypatch.setattr(workflow_runtime.session_factory, "get_session_maker", MagicMock())
    app = Flask(__name__)
    app.extensions["knowledge_fs_node_dependencies"] = workflow_runtime.build_knowledge_fs_node_dependencies
    pool = VariablePool()
    pool.add(["start", "query"], StringSegment(value="test query"))
    factory = DifyNodeFactory(
        graph_init_params=build_test_graph_init_params(),
        graph_runtime_state=GraphRuntimeState(variable_pool=pool, start_at=time.perf_counter()),
    )

    with app.app_context():
        node = factory.create_node(
            {
                "id": "retrieval",
                "data": {
                    "type": "knowledge-retrieval-v2",
                    "title": "Retrieval",
                    "control_space_ids": ["space"],
                    "query_variable_selector": ["start", "query"],
                },
            }
        )
        assert isinstance(node, KnowledgeRetrievalV2Node)
        resolve_runtime.assert_not_called()
        # A skipped branch never initializes KnowledgeFS. Executing it still reports
        # the real configuration error rather than silently disabling retrieval.
        result = node._run()
        assert result.status == WorkflowNodeExecutionStatus.FAILED
        assert result.error == "KnowledgeFS draft binding could not be enabled for this workflow"
        resolve_runtime.assert_called_once()
