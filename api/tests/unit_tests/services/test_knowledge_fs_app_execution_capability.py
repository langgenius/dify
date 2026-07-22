from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any

import pytest
from pydantic import ValidationError

from core.app.entities.app_invoke_entities import DifyRunContext, InvokeFrom, UserFrom
from models.knowledge_fs import KnowledgeFSAppSpaceJoinType
from services.knowledge_fs.app_execution_capability import (
    KnowledgeFSAppExecutionCapabilityService,
    KnowledgeResourceRef,
)
from services.knowledge_fs.capability_broker import KnowledgeFSIssuedProductCapability
from services.knowledge_fs.product_dto import KnowledgeFSResearchTaskCreatePayload
from services.knowledge_fs.product_remote import KnowledgeFSRemoteJSONRequest


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

    def execute_json(self, request: KnowledgeFSRemoteJSONRequest) -> dict[str, Any]:
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


class Charge:
    def __init__(self) -> None:
        self.committed = False
        self.refunded = False

    def commit(self) -> None:
        self.committed = True

    def refund(self) -> None:
        self.refunded = True


class OperationAdmission:
    def __init__(self) -> None:
        self.calls: list[dict[str, str]] = []
        self.charge = Charge()

    def reserve(self, *, tenant_id: str, operation_id: str) -> Charge:
        self.calls.append({"tenant_id": tenant_id, "operation_id": operation_id})
        return self.charge


class FailingRemote(Remote):
    def execute_json(self, request: KnowledgeFSRemoteJSONRequest) -> dict[str, Any]:
        self.calls.append(request)
        raise RuntimeError("remote failed")


class RejectingOperationAdmission(OperationAdmission):
    def reserve(self, *, tenant_id: str, operation_id: str) -> Charge:
        self.calls.append({"tenant_id": tenant_id, "operation_id": operation_id})
        raise RuntimeError("operation rejected")


def test_app_execution_capability_always_admits_binding_before_broker_issuance() -> None:
    admission = Admission()
    broker = Broker()
    service = KnowledgeFSAppExecutionCapabilityService(  # type: ignore[arg-type]
        admission=admission,
        broker=broker,
        operation_admission=OperationAdmission(),
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


def test_create_research_task_uses_only_dify_run_context_identity_then_calls_kfs() -> None:
    admission = Admission()
    broker = Broker()
    remote = Remote()
    operation_admission = OperationAdmission()
    service = KnowledgeFSAppExecutionCapabilityService(  # type: ignore[arg-type]
        admission=admission,
        broker=broker,
        operation_admission=operation_admission,
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
    assert operation_admission.calls == [
        {
            "tenant_id": "tenant-from-run-context",
            "operation_id": "createResearchTask",
        }
    ]
    assert operation_admission.charge.committed is True
    assert operation_admission.charge.refunded is False


def test_create_research_task_refunds_operation_charge_when_remote_io_fails() -> None:
    operation_admission = OperationAdmission()
    service = KnowledgeFSAppExecutionCapabilityService(  # type: ignore[arg-type]
        admission=Admission(),
        broker=Broker(),
        operation_admission=operation_admission,
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

    assert operation_admission.charge.committed is False
    assert operation_admission.charge.refunded is True


def test_operation_admission_rejection_prevents_app_capability_and_remote_io() -> None:
    admission = Admission()
    broker = Broker()
    remote = Remote()
    operation_admission = RejectingOperationAdmission()
    service = KnowledgeFSAppExecutionCapabilityService(  # type: ignore[arg-type]
        admission=admission,
        broker=broker,
        operation_admission=operation_admission,
        remote=remote,
    )

    with pytest.raises(RuntimeError, match="operation rejected"):
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
