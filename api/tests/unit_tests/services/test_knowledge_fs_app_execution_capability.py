from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from core.app.entities.app_invoke_entities import DifyRunContext, InvokeFrom, UserFrom
from models.knowledge_fs import KnowledgeFSAppSpaceJoinType
from services.knowledge_fs import app_execution_capability
from services.knowledge_fs.app_execution_capability import (
    KnowledgeFSAppExecutionCapabilityService,
    KnowledgeResourceRef,
)
from services.knowledge_fs.capability_broker import KnowledgeFSIssuedProductCapability
from services.knowledge_fs.product_dto import KnowledgeFSResearchTaskCreatePayload
from services.knowledge_fs.product_remote import KnowledgeFSOperationUnavailableError, KnowledgeFSRemoteJSONRequest


class Admission:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []
        self.profile = SimpleNamespace(app_id="app-1")

    def admit(self, **kwargs: object) -> object:
        self.calls.append(kwargs)
        return self.profile


class Broker:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    def issue_app(self, **kwargs: object) -> KnowledgeFSIssuedProductCapability:
        self.calls.append(kwargs)
        return KnowledgeFSIssuedProductCapability(
            token="token",
            expires_at=datetime(2030, 1, 1, tzinfo=UTC),
            operation_id="createResearchTask",
            knowledge_space_id="space-1",
            knowledge_space_revision=2,
            trace_id="trace-1",
        )


class Remote:
    def __init__(self) -> None:
        self.calls: list[KnowledgeFSRemoteJSONRequest] = []

    def execute_json(self, request: KnowledgeFSRemoteJSONRequest) -> dict[str, object]:
        self.calls.append(request)
        return {
            "id": "research-1",
            "knowledgeSpaceId": "space-1",
            "query": "Compare the evidence",
            "cost": {},
            "stage": "queued",
            "metadata": {},
            "createdAt": 1.0,
            "updatedAt": 1.0,
        }


class FailingRemote(Remote):
    def execute_json(self, request: KnowledgeFSRemoteJSONRequest) -> dict[str, object]:
        self.calls.append(request)
        raise RuntimeError("remote failed")


def test_app_execution_capability_always_admits_binding_before_broker_issuance() -> None:
    admission = Admission()
    broker = Broker()
    service = KnowledgeFSAppExecutionCapabilityService(  # type: ignore[arg-type]
        admission=admission,
        broker=broker,
        remote=Remote(),
    )

    issued = service.issue(
        tenant_id="tenant-1",
        app_id="app-1",
        control_space_id="control-1",
        caller_kind=KnowledgeFSAppSpaceJoinType.WORKFLOW,
        operation_id="createResearchTask",
        resource_id="research-1",
        trace_id="trace-1",
    )

    assert issued.token == "token"
    assert admission.calls == [
        {
            "tenant_id": "tenant-1",
            "app_id": "app-1",
            "control_space_id": "control-1",
            "caller_kind": KnowledgeFSAppSpaceJoinType.WORKFLOW,
            "operation_id": "createResearchTask",
        }
    ]
    assert broker.calls == [
        {
            "profile": admission.profile,
            "operation_id": "createResearchTask",
            "resource_id": "research-1",
            "trace_id": "trace-1",
        }
    ]


def test_typed_knowledge_resource_ref_rejects_dataset_and_extra_authority_fields() -> None:
    with pytest.raises(ValidationError):
        KnowledgeResourceRef.model_validate(
            {
                "kind": "dataset",
                "control_space_id": "control-1",
            }
        )

    with pytest.raises(ValidationError):
        KnowledgeResourceRef.model_validate(
            {
                "kind": "knowledge_fs",
                "control_space_id": "control-1",
                "dataset_ids": ["control-1"],
            }
        )

    with pytest.raises(ValidationError):
        KnowledgeResourceRef.model_validate(
            {
                "kind": "knowledge_fs",
                "control_space_id": "   ",
            }
        )


def test_create_research_task_fails_closed_when_product_operation_is_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    admission = Admission()
    broker = Broker()
    remote = Remote()
    service = KnowledgeFSAppExecutionCapabilityService(  # type: ignore[arg-type]
        admission=admission,
        broker=broker,
        remote=remote,
    )
    monkeypatch.setattr(app_execution_capability, "is_product_operation_ready", lambda _operation_id: False)

    with pytest.raises(KnowledgeFSOperationUnavailableError, match="creation is unavailable"):
        service.create_research_task(
            run_context=DifyRunContext(
                tenant_id="tenant-1",
                app_id="app-1",
                user_id="user-1",
                user_from=UserFrom.END_USER,
                invoke_from=InvokeFrom.WEB_APP,
            ),
            caller_kind=KnowledgeFSAppSpaceJoinType.AGENT,
            resource=KnowledgeResourceRef(kind="knowledge_fs", control_space_id="control-1"),
            payload=KnowledgeFSResearchTaskCreatePayload(query="Compare the evidence"),
        )

    assert admission.calls == []
    assert broker.calls == []
    assert remote.calls == []


def test_create_research_task_uses_only_dify_run_context_identity_then_calls_kfs() -> None:
    admission = Admission()
    broker = Broker()
    remote = Remote()
    service = KnowledgeFSAppExecutionCapabilityService(  # type: ignore[arg-type]
        admission=admission,
        broker=broker,
        remote=remote,
    )
    run_context = DifyRunContext(
        tenant_id="tenant-from-run-context",
        app_id="app-from-run-context",
        user_id="user-1",
        user_from=UserFrom.END_USER,
        invoke_from=InvokeFrom.WEB_APP,
        trace_session_id="trace-from-run-context",
    )

    result = service.create_research_task(
        run_context=run_context,
        caller_kind=KnowledgeFSAppSpaceJoinType.AGENT,
        resource=KnowledgeResourceRef(kind="knowledge_fs", control_space_id="control-1"),
        payload=KnowledgeFSResearchTaskCreatePayload(query="Compare the evidence"),
    )

    assert result.id == "research-1"
    assert admission.calls == [
        {
            "tenant_id": "tenant-from-run-context",
            "app_id": "app-from-run-context",
            "control_space_id": "control-1",
            "caller_kind": KnowledgeFSAppSpaceJoinType.AGENT,
            "operation_id": "createResearchTask",
        }
    ]
    assert broker.calls == [
        {
            "profile": admission.profile,
            "operation_id": "createResearchTask",
            "resource_id": None,
            "trace_id": "trace-from-run-context",
        }
    ]
    assert remote.calls == [
        KnowledgeFSRemoteJSONRequest(
            operation_id="createResearchTask",
            method="POST",
            path="/research-tasks",
            namespace_id="tenant-from-run-context",
            knowledge_space_id="space-1",
            capability_token="token",
            trace_id="trace-1",
            payload={
                "query": "Compare the evidence",
                "metadata": {},
                "knowledgeSpaceId": "space-1",
            },
        )
    ]


def test_create_research_task_propagates_remote_io_failure() -> None:
    service = KnowledgeFSAppExecutionCapabilityService(  # type: ignore[arg-type]
        admission=Admission(),
        broker=Broker(),
        remote=FailingRemote(),
    )

    with pytest.raises(RuntimeError, match="remote failed"):
        service.create_research_task(
            run_context=DifyRunContext(
                tenant_id="tenant-1",
                app_id="app-1",
                user_id="user-1",
                user_from=UserFrom.END_USER,
                invoke_from=InvokeFrom.WEB_APP,
            ),
            caller_kind=KnowledgeFSAppSpaceJoinType.AGENT,
            resource=KnowledgeResourceRef(kind="knowledge_fs", control_space_id="control-1"),
            payload=KnowledgeFSResearchTaskCreatePayload(query="Compare the evidence"),
        )
