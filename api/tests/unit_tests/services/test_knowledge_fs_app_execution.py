from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pytest
from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.app_invoke_entities import DifyRunContext, InvokeFrom, UserFrom
from models.knowledge_fs import (
    AppKnowledgeFSSpaceJoin,
    KnowledgeFSAppSpaceJoinStatus,
    KnowledgeFSAppSpaceJoinType,
    KnowledgeFSAuthorizationRevision,
    KnowledgeFSCapabilityIssuanceAudit,
    KnowledgeFSCapabilityIssuanceReservation,
    KnowledgeFSControlSpace,
    KnowledgeFSControlSpaceState,
    KnowledgeFSExternalAccessPolicy,
    KnowledgeFSLifecycleOutbox,
)
from services.knowledge_fs.app_admission_service import KnowledgeFSAppAdmissionError, KnowledgeFSAppAdmissionService
from services.knowledge_fs.app_execution_capability import (
    KnowledgeFSAppExecutionCapabilityService,
    KnowledgeResourceRef,
)
from services.knowledge_fs.capability_broker import KnowledgeFSIssuedProductCapability
from services.knowledge_fs.product_dto import KnowledgeFSResearchTaskCreatePayload
from services.knowledge_fs.product_remote import KnowledgeFSRemoteJSONRequest

pytestmark = pytest.mark.parametrize(
    "sqlite_session",
    [
        (
            KnowledgeFSControlSpace,
            KnowledgeFSExternalAccessPolicy,
            KnowledgeFSAuthorizationRevision,
            KnowledgeFSCapabilityIssuanceAudit,
            KnowledgeFSCapabilityIssuanceReservation,
            KnowledgeFSLifecycleOutbox,
            AppKnowledgeFSSpaceJoin,
        )
    ],
    indirect=True,
)


class Broker:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    def issue_app(self, **kwargs: object) -> KnowledgeFSIssuedProductCapability:
        self.calls.append(kwargs)
        return KnowledgeFSIssuedProductCapability(
            token="capability",
            expires_at=datetime(2030, 1, 1, tzinfo=UTC),
            operation_id="createResearchTask",
            knowledge_space_id="space-1",
            knowledge_space_revision=3,
            trace_id="trace-issued",
        )


class Remote:
    def __init__(self) -> None:
        self.calls: list[KnowledgeFSRemoteJSONRequest] = []

    def execute_json(self, request: KnowledgeFSRemoteJSONRequest) -> dict[str, Any]:
        self.calls.append(request)
        return {
            "id": "task-1",
            "knowledgeSpaceId": "space-1",
            "query": "question",
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
        self.charge = Charge()

    def reserve(self, *, tenant_id: str, operation_id: str) -> Charge:
        assert tenant_id == "tenant-1"
        assert operation_id == "createResearchTask"
        return self.charge


def _run_context(*, app_id: str) -> DifyRunContext:
    return DifyRunContext(
        tenant_id="tenant-1",
        app_id=app_id,
        user_id="user-1",
        user_from=UserFrom.END_USER,
        invoke_from=InvokeFrom.WEB_APP,
        trace_session_id="trace-run",
    )


def _seed(
    session: Session,
    *,
    join_status: KnowledgeFSAppSpaceJoinStatus = KnowledgeFSAppSpaceJoinStatus.ACTIVE,
    caller_kind: KnowledgeFSAppSpaceJoinType = KnowledgeFSAppSpaceJoinType.AGENT,
    channel_enabled: bool = True,
) -> KnowledgeFSControlSpace:
    space = KnowledgeFSControlSpace(
        tenant_id="tenant-1",
        owner_account_id="owner-1",
        provisioning_key="provision-1",
        knowledge_space_id="space-1",
        knowledge_space_revision=3,
        state=KnowledgeFSControlSpaceState.ACTIVE,
    )
    session.add_all(
        [
            space,
            KnowledgeFSExternalAccessPolicy(
                tenant_id="tenant-1",
                control_space_id=space.id,
                agent_enabled=channel_enabled if caller_kind is KnowledgeFSAppSpaceJoinType.AGENT else False,
                workflow_enabled=channel_enabled if caller_kind is KnowledgeFSAppSpaceJoinType.WORKFLOW else False,
            ),
            KnowledgeFSAuthorizationRevision(
                tenant_id="tenant-1",
                control_space_id=space.id,
            ),
            AppKnowledgeFSSpaceJoin(
                tenant_id="tenant-1",
                control_space_id=space.id,
                app_id="app-1",
                join_type=caller_kind,
                status=join_status,
            ),
        ]
    )
    session.commit()
    return space


@pytest.mark.parametrize(
    ("join_status", "caller_kind", "channel_enabled", "context_app_id"),
    [
        (
            KnowledgeFSAppSpaceJoinStatus.REVOKED,
            KnowledgeFSAppSpaceJoinType.AGENT,
            True,
            "app-1",
        ),
        (
            KnowledgeFSAppSpaceJoinStatus.ACTIVE,
            KnowledgeFSAppSpaceJoinType.AGENT,
            False,
            "app-1",
        ),
        (
            KnowledgeFSAppSpaceJoinStatus.ACTIVE,
            KnowledgeFSAppSpaceJoinType.WORKFLOW,
            False,
            "app-1",
        ),
        (
            KnowledgeFSAppSpaceJoinStatus.ACTIVE,
            KnowledgeFSAppSpaceJoinType.AGENT,
            True,
            "app-2",
        ),
    ],
    ids=("binding-disabled", "agent-channel-off", "workflow-channel-off", "cross-app-space"),
)
def test_execution_fails_closed_before_capability_or_remote_io(
    sqlite_session: Session,
    join_status: KnowledgeFSAppSpaceJoinStatus,
    caller_kind: KnowledgeFSAppSpaceJoinType,
    channel_enabled: bool,
    context_app_id: str,
) -> None:
    space = _seed(
        sqlite_session,
        join_status=join_status,
        caller_kind=caller_kind,
        channel_enabled=channel_enabled,
    )
    broker = Broker()
    remote = Remote()
    operation_admission = OperationAdmission()
    service = KnowledgeFSAppExecutionCapabilityService(  # type: ignore[arg-type]
        admission=KnowledgeFSAppAdmissionService(sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False)),
        broker=broker,
        operation_admission=operation_admission,
        remote=remote,
    )

    with pytest.raises(KnowledgeFSAppAdmissionError):
        service.create_research_task(
            run_context=_run_context(app_id=context_app_id),
            caller_kind=caller_kind,
            resource=KnowledgeResourceRef(kind="knowledge_fs", control_space_id=space.id),
            payload=KnowledgeFSResearchTaskCreatePayload(query="question"),
        )

    assert broker.calls == []
    assert remote.calls == []
    assert operation_admission.charge.committed is False
    assert operation_admission.charge.refunded is True


@pytest.mark.parametrize(
    "caller_kind",
    [KnowledgeFSAppSpaceJoinType.AGENT, KnowledgeFSAppSpaceJoinType.WORKFLOW],
)
def test_execution_issues_capability_then_performs_bounded_remote_io(
    sqlite_session: Session,
    caller_kind: KnowledgeFSAppSpaceJoinType,
) -> None:
    space = _seed(sqlite_session, caller_kind=caller_kind)
    broker = Broker()
    remote = Remote()
    operation_admission = OperationAdmission()
    service = KnowledgeFSAppExecutionCapabilityService(  # type: ignore[arg-type]
        admission=KnowledgeFSAppAdmissionService(sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False)),
        broker=broker,
        operation_admission=operation_admission,
        remote=remote,
    )

    response = service.create_research_task(
        run_context=_run_context(app_id="app-1"),
        caller_kind=caller_kind,
        resource=KnowledgeResourceRef(kind="knowledge_fs", control_space_id=space.id),
        payload=KnowledgeFSResearchTaskCreatePayload(query="question"),
    )

    assert response.id == "task-1"
    assert len(broker.calls) == 1
    assert operation_admission.charge.committed is True
    assert operation_admission.charge.refunded is False
    assert remote.calls == [
        KnowledgeFSRemoteJSONRequest(
            operation_id="createResearchTask",
            method="POST",
            path="/research-tasks",
            namespace_id="tenant-1",
            knowledge_space_id="space-1",
            capability_token="capability",
            trace_id="trace-issued",
            payload={
                "query": "question",
                "metadata": {},
                "knowledgeSpaceId": "space-1",
            },
        )
    ]
