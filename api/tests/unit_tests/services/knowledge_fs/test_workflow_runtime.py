"""Workflow nodes receive the application's authoritative KnowledgeFS runtime ports."""

import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import cast

import pytest
from flask import Flask
from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.app_invoke_entities import DifyRunContext
from core.workflow.node_factory import DifyNodeFactory
from core.workflow.node_runtime import build_knowledge_fs_node_dependencies
from extensions import ext_application_services
from graphon.enums import WorkflowNodeExecutionStatus
from graphon.runtime import RuntimeState, VariablePool
from graphon.variables import StringSegment
from models.knowledge_fs import KnowledgeFSAppSpaceJoinType
from services.knowledge_fs import runtime as runtime_module
from services.knowledge_fs import workflow_runtime
from services.knowledge_fs.knowledge_retrieval_v2.knowledge_retrieval_v2_node import KnowledgeRetrievalV2Node
from services.knowledge_fs.resource import KnowledgeResourceRef
from services.knowledge_fs.retrieval_contracts import KnowledgeFSAppBindingPayload, KnowledgeFSRetrievalTestPayload
from tests.workflow_test_utils import build_test_graph_init_params


@dataclass
class _RecordingPort:
    """Records keyword calls per method and returns one stable result object per method."""

    calls: dict[str, list[dict[str, object]]] = field(default_factory=dict)
    results: dict[str, object] = field(default_factory=dict)

    def _record(self, method: str, **kwargs: object) -> object:
        self.calls.setdefault(method, []).append(kwargs)
        return self.results.setdefault(method, object())

    def run_retrieval(self, **kwargs: object) -> object:
        return self._record("run_retrieval", **kwargs)

    def list_metadata_fields(self, **kwargs: object) -> object:
        return self._record("list_metadata_fields", **kwargs)

    def upsert(self, **kwargs: object) -> object:
        return self._record("upsert", **kwargs)


@dataclass
class _FakeRuntime:
    app_capabilities: _RecordingPort = field(default_factory=_RecordingPort)
    app_bindings: _RecordingPort = field(default_factory=_RecordingPort)


@dataclass
class _RuntimeResolver:
    """Stands in for get_knowledge_fs_runtime and records every session maker it receives."""

    resolve: Callable[[sessionmaker[Session]], object]
    calls: list[sessionmaker[Session]] = field(default_factory=list)

    def __call__(self, session_maker: sessionmaker[Session]) -> object:
        self.calls.append(session_maker)
        return self.resolve(session_maker)


class _FakeIdentity:
    def load_user(self, account_id: str) -> None:
        raise AssertionError(f"workflow runtime registration must not load account {account_id}")


@dataclass
class _FakeAccounts:
    identity: _FakeIdentity = field(default_factory=_FakeIdentity)


@dataclass
class _FakeApplicationServices:
    accounts: _FakeAccounts = field(default_factory=_FakeAccounts)


def test_application_registers_lazy_workflow_runtime_dependencies(monkeypatch: pytest.MonkeyPatch) -> None:
    app = Flask(__name__)
    session_maker = sessionmaker[Session]()
    runtime = _FakeRuntime()
    resolve_runtime = _RuntimeResolver(resolve=lambda _session_maker: runtime)
    monkeypatch.setattr(workflow_runtime, "get_knowledge_fs_runtime", resolve_runtime)
    monkeypatch.setattr(workflow_runtime.session_factory, "get_session_maker", lambda: session_maker)
    monkeypatch.setattr(ext_application_services, "get_session_maker", lambda: session_maker)
    monkeypatch.setattr(
        ext_application_services, "build_application_services", lambda **_kwargs: _FakeApplicationServices()
    )

    ext_application_services.init_app(app)
    assert resolve_runtime.calls == []

    with app.app_context():
        ports = build_knowledge_fs_node_dependencies()

    assert resolve_runtime.calls == []
    capabilities = ports["capability_service"]
    assert isinstance(capabilities, workflow_runtime._LazyWorkflowCapabilities)
    assert ports["binding_service"] is capabilities
    run_context = cast(DifyRunContext, object())
    caller_kind = cast(KnowledgeFSAppSpaceJoinType, object())
    resource = cast(KnowledgeResourceRef, object())
    payload = cast(KnowledgeFSRetrievalTestPayload, object())
    binding_payload = cast(KnowledgeFSAppBindingPayload, object())
    assert (
        capabilities.run_retrieval(run_context=run_context, caller_kind=caller_kind, resource=resource, payload=payload)
        is runtime.app_capabilities.results["run_retrieval"]
    )
    assert runtime.app_capabilities.calls["run_retrieval"] == [
        {"run_context": run_context, "caller_kind": caller_kind, "resource": resource, "payload": payload}
    ]
    assert (
        capabilities.list_metadata_fields(
            run_context=run_context, caller_kind=caller_kind, resource=resource, cursor="next", limit=7
        )
        is runtime.app_capabilities.results["list_metadata_fields"]
    )
    assert runtime.app_capabilities.calls["list_metadata_fields"] == [
        {"run_context": run_context, "caller_kind": caller_kind, "resource": resource, "cursor": "next", "limit": 7}
    ]
    assert (
        capabilities.upsert(
            tenant_id="tenant", actor_account_id="actor", control_space_id="space", payload=binding_payload
        )
        is runtime.app_bindings.results["upsert"]
    )
    assert runtime.app_bindings.calls["upsert"] == [
        {"tenant_id": "tenant", "actor_account_id": "actor", "control_space_id": "space", "payload": binding_payload}
    ]
    assert len(resolve_runtime.calls) == 3
    assert resolve_runtime.calls[-1] is session_maker
    assert ports["query_image_issuer"] is workflow_runtime.issue_workflow_query_image_reference
    assert ports["failed_retrieval_dispatcher"] is workflow_runtime.enqueue_workflow_failed_retrieval_capture


def test_graph_can_create_unused_retrieval_node_without_knowledge_fs_config(
    monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
) -> None:
    config_overrides(KNOWLEDGE_FS_BASE_URL=None)
    monkeypatch.setattr(runtime_module, "_runtime_cache", None)
    resolve_runtime = _RuntimeResolver(resolve=runtime_module.get_knowledge_fs_runtime)
    monkeypatch.setattr(workflow_runtime, "get_knowledge_fs_runtime", resolve_runtime)
    session_maker = sessionmaker[Session]()
    monkeypatch.setattr(workflow_runtime.session_factory, "get_session_maker", lambda: session_maker)
    app = Flask(__name__)
    app.extensions["knowledge_fs_node_dependencies"] = workflow_runtime.build_knowledge_fs_node_dependencies
    pool = VariablePool()
    pool.add(["start", "query"], StringSegment(value="test query"))
    factory = DifyNodeFactory(
        init_params=build_test_graph_init_params(),
        runtime_state=RuntimeState(workflow_id="workflow", variable_pool=pool, start_at=time.perf_counter()),
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
        assert resolve_runtime.calls == []
        # A skipped branch never initializes KnowledgeFS. Executing it still reports
        # the real configuration error rather than silently disabling retrieval.
        result = node._run()
        assert result.status == WorkflowNodeExecutionStatus.FAILED
        assert result.error == "Agent Knowledge Base draft binding could not be enabled for this workflow"
        assert len(resolve_runtime.calls) == 1
