from __future__ import annotations

import base64
import json
from datetime import UTC, datetime
from typing import override

import pytest
from pydantic import JsonValue, ValidationError
from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.app_invoke_entities import DifyRunContext, InvokeFrom, UserFrom
from enums import DeploymentEdition
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
from services.knowledge_fs import app_execution_capability
from services.knowledge_fs.app_admission_service import (
    KnowledgeFSAppAdmissionError,
    KnowledgeFSAppAdmissionService,
    KnowledgeFSAppPrincipalProfile,
)
from services.knowledge_fs.app_execution_capability import (
    KnowledgeFSAppExecutionCapabilityService,
    KnowledgeResourceRef,
)
from services.knowledge_fs.capability_broker import KnowledgeFSIssuedProductCapability
from services.knowledge_fs.product_dto import (
    KnowledgeFSResearchTaskCreatePayload,
    KnowledgeFSRetrievalTestPayload,
    KnowledgeFSWorkflowFailedRetrievalCapturePayload,
)
from services.knowledge_fs.product_remote import (
    KNOWLEDGE_FS_QUERY_IMAGE_GRANTS_HEADER,
    KnowledgeFSOperationUnavailableError,
    KnowledgeFSRemoteJSONRequest,
    UnavailableKnowledgeFSProductRemote,
)
from tests.helpers.unit.config_override import apply_config_overrides


class _KnowledgeFsAppExecutionBroker:
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


class _KnowledgeFsAppExecutionRemote(UnavailableKnowledgeFSProductRemote):
    def __init__(self) -> None:
        self.calls: list[KnowledgeFSRemoteJSONRequest] = []

    @override
    def execute_json(self, request: KnowledgeFSRemoteJSONRequest) -> dict[str, JsonValue]:
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


class TestKnowledgeFsAppExecutionCases:
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

    @staticmethod
    @pytest.fixture(autouse=True)
    def _enable_knowledge_fs(monkeypatch: pytest.MonkeyPatch) -> None:
        apply_config_overrides(monkeypatch, DEPLOYMENT_EDITION=DeploymentEdition.CLOUD, KNOWLEDGE_FS_ENABLED=True)

    @staticmethod
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
        broker = _KnowledgeFsAppExecutionBroker()
        remote = _KnowledgeFsAppExecutionRemote()
        service = KnowledgeFSAppExecutionCapabilityService(  # type: ignore[arg-type]
            admission=KnowledgeFSAppAdmissionService(
                sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False)
            ),
            broker=broker,
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

    @staticmethod
    @pytest.mark.parametrize(
        "caller_kind",
        [KnowledgeFSAppSpaceJoinType.AGENT, KnowledgeFSAppSpaceJoinType.WORKFLOW],
    )
    def test_execution_issues_capability_then_performs_bounded_remote_io(
        sqlite_session: Session,
        caller_kind: KnowledgeFSAppSpaceJoinType,
    ) -> None:
        space = _seed(sqlite_session, caller_kind=caller_kind)
        broker = _KnowledgeFsAppExecutionBroker()
        remote = _KnowledgeFsAppExecutionRemote()
        service = KnowledgeFSAppExecutionCapabilityService(  # type: ignore[arg-type]
            admission=KnowledgeFSAppAdmissionService(
                sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False)
            ),
            broker=broker,
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


class Admission:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []
        self.profile = KnowledgeFSAppPrincipalProfile(
            tenant_id="tenant-1",
            control_space_id="control-1",
            app_id="app-1",
            join_id="join-1",
            caller_kind=KnowledgeFSAppSpaceJoinType.WORKFLOW,
            action="read",
            knowledge_space_id="space-1",
            knowledge_space_revision=2,
            membership_epoch=1,
            space_acl_epoch=1,
            external_access_epoch=1,
            content_policy_revision=1,
        )

    def admit(self, **kwargs: object) -> KnowledgeFSAppPrincipalProfile:
        self.calls.append(kwargs)
        return self.profile


class _KnowledgeFsAppExecutionCapabilityBroker:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    def issue_app(self, **kwargs: object) -> KnowledgeFSIssuedProductCapability:
        self.calls.append(kwargs)
        return KnowledgeFSIssuedProductCapability(
            token="token",
            expires_at=datetime(2030, 1, 1, tzinfo=UTC),
            operation_id=str(kwargs["operation_id"]),
            knowledge_space_id="space-1",
            knowledge_space_revision=2,
            trace_id="trace-1",
        )


class _KnowledgeFsAppExecutionCapabilityRemote(UnavailableKnowledgeFSProductRemote):
    def __init__(self) -> None:
        self.calls: list[KnowledgeFSRemoteJSONRequest] = []

    @override
    def execute_json(self, request: KnowledgeFSRemoteJSONRequest) -> dict[str, JsonValue]:
        self.calls.append(request)
        if request.operation_id == "captureAgentKnowledgeInvestigation":
            return {"investigationId": "investigation-1", "failedQueries": []}
        if request.operation_id == "captureWorkflowFailedRetrieval":
            return {
                "failedQueryId": "019fac9f-bfb0-75ee-9af5-252ebafbac1c",
                "verdict": "retrieval-miss",
                "badCaseId": "019fac9f-bfb0-75ee-9af5-252ebafbac1d",
            }
        if request.operation_id == "listMetadataFields":
            return {
                "items": [
                    {
                        "count": 3,
                        "createdAt": "2026-01-01T00:00:00Z",
                        "id": "field-1",
                        "name": "department",
                        "rowVersion": 1,
                        "type": "string",
                        "updatedAt": "2026-01-01T00:00:00Z",
                    }
                ],
                "nextCursor": "cursor-2",
            }
        if request.operation_id == "retrieveEvidence":
            return {
                "items": [
                    {
                        "citation": {
                            "artifactHash": "a" * 64,
                            "documentAssetId": "document-1",
                            "documentVersion": 1,
                            "sectionPath": ["Camera"],
                        },
                        "nodeId": "node-1",
                        "projectionIds": ["projection-1"],
                        "score": 0.8,
                        "sources": ["dense"],
                        "text": "Camera evidence",
                    }
                ],
                "metrics": {"denseCandidates": 1, "totalMs": 10},
                "mode": "fast",
                "traceId": "trace-1",
            }
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


class FailingRemote(_KnowledgeFsAppExecutionCapabilityRemote):
    @override
    def execute_json(self, request: KnowledgeFSRemoteJSONRequest) -> dict[str, JsonValue]:
        self.calls.append(request)
        raise RuntimeError("remote failed")


class TestKnowledgeFsAppExecutionCapabilityCases:
    @staticmethod
    @pytest.fixture(autouse=True)
    def _enable_knowledge_fs(monkeypatch: pytest.MonkeyPatch) -> None:
        apply_config_overrides(monkeypatch, DEPLOYMENT_EDITION=DeploymentEdition.CLOUD, KNOWLEDGE_FS_ENABLED=True)

    @staticmethod
    def test_app_execution_capability_always_admits_binding_before_broker_issuance() -> None:
        admission = Admission()
        broker = _KnowledgeFsAppExecutionCapabilityBroker()
        service = KnowledgeFSAppExecutionCapabilityService(  # type: ignore[arg-type]
            admission=admission,
            broker=broker,
            remote=_KnowledgeFsAppExecutionCapabilityRemote(),
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

    @staticmethod
    def test_disabled_feature_blocks_app_issuance_and_investigation_capture_before_io(
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        admission = Admission()
        broker = _KnowledgeFsAppExecutionCapabilityBroker()
        remote = _KnowledgeFsAppExecutionCapabilityRemote()
        service = KnowledgeFSAppExecutionCapabilityService(  # type: ignore[arg-type]
            admission=admission,
            broker=broker,
            remote=remote,
        )
        previously_issued = KnowledgeFSIssuedProductCapability(
            token="token",
            expires_at=datetime(2030, 1, 1, tzinfo=UTC),
            operation_id="captureAgentKnowledgeInvestigation",
            knowledge_space_id="space-1",
            knowledge_space_revision=2,
            trace_id="trace-1",
        )
        apply_config_overrides(monkeypatch, KNOWLEDGE_FS_ENABLED=False)

        with pytest.raises(KnowledgeFSOperationUnavailableError, match="disabled"):
            service.issue(
                tenant_id="tenant-1",
                app_id="app-1",
                control_space_id="control-1",
                caller_kind=KnowledgeFSAppSpaceJoinType.AGENT,
                operation_id="retrieveEvidence",
            )
        with pytest.raises(KnowledgeFSOperationUnavailableError, match="disabled"):
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
        with pytest.raises(KnowledgeFSOperationUnavailableError, match="disabled"):
            service.run_retrieval(
                run_context=DifyRunContext(
                    tenant_id="tenant-1",
                    app_id="app-1",
                    user_id="user-1",
                    user_from=UserFrom.END_USER,
                    invoke_from=InvokeFrom.WEB_APP,
                ),
                caller_kind=KnowledgeFSAppSpaceJoinType.WORKFLOW,
                resource=KnowledgeResourceRef(kind="knowledge_fs", control_space_id="control-1"),
                payload=KnowledgeFSRetrievalTestPayload.model_validate(
                    {
                        "includeText": True,
                        "mode": "fast",
                        "query": "camera",
                        "queryId": "10000000-0000-4000-8000-000000000010",
                    }
                ),
            )
        with pytest.raises(KnowledgeFSOperationUnavailableError, match="disabled"):
            service.capture_agent_investigation(issued=previously_issued, tenant_id="tenant-1", payload={})

        assert admission.calls == []
        assert broker.calls == []
        assert remote.calls == []

    @staticmethod
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

    @staticmethod
    def test_create_research_task_fails_closed_when_product_operation_is_unavailable(
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        admission = Admission()
        broker = _KnowledgeFsAppExecutionCapabilityBroker()
        remote = _KnowledgeFsAppExecutionCapabilityRemote()
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

    @staticmethod
    def test_create_research_task_uses_only_dify_run_context_identity_then_calls_kfs() -> None:
        admission = Admission()
        broker = _KnowledgeFsAppExecutionCapabilityBroker()
        remote = _KnowledgeFsAppExecutionCapabilityRemote()
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

    @staticmethod
    def test_create_research_task_propagates_remote_io_failure() -> None:
        service = KnowledgeFSAppExecutionCapabilityService(  # type: ignore[arg-type]
            admission=Admission(),
            broker=_KnowledgeFsAppExecutionCapabilityBroker(),
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

    @staticmethod
    def test_run_retrieval_issues_read_capability_and_calls_bounded_product_operation() -> None:
        admission = Admission()
        broker = _KnowledgeFsAppExecutionCapabilityBroker()
        remote = _KnowledgeFsAppExecutionCapabilityRemote()
        service = KnowledgeFSAppExecutionCapabilityService(  # type: ignore[arg-type]
            admission=admission,
            broker=broker,
            remote=remote,
        )
        run_context = DifyRunContext(
            tenant_id="tenant-1",
            app_id="app-1",
            user_id="user-1",
            user_from=UserFrom.ACCOUNT,
            invoke_from=InvokeFrom.DEBUGGER,
            trace_session_id="trace-from-workflow",
        )

        result = service.run_retrieval(
            run_context=run_context,
            caller_kind=KnowledgeFSAppSpaceJoinType.WORKFLOW,
            resource=KnowledgeResourceRef(kind="knowledge_fs", control_space_id="control-1"),
            payload=KnowledgeFSRetrievalTestPayload.model_validate(
                {
                    "includeText": True,
                    "mode": "fast",
                    "query": "camera",
                    "queryId": "10000000-0000-4000-8000-000000000010",
                    "queryImages": [
                        {
                            "accessGrant": "short-lived-grant",
                            "uploadFileId": "00000000-0000-4000-8000-000000000001",
                        }
                    ],
                }
            ),
        )

        assert result.items[0].text == "Camera evidence"
        assert admission.calls[0]["operation_id"] == "retrieveEvidence"
        assert broker.calls[0]["operation_id"] == "retrieveEvidence"
        assert len(remote.calls) == 1
        request = remote.calls[0]
        assert request.payload == {
            "includeText": True,
            "mode": "fast",
            "query": "camera",
            "queryId": "10000000-0000-4000-8000-000000000010",
            "queryImages": [{"uploadFileId": "00000000-0000-4000-8000-000000000001"}],
        }
        assert len(request.headers) == 1
        assert request.headers[0][0] == KNOWLEDGE_FS_QUERY_IMAGE_GRANTS_HEADER
        encoded_grants = request.headers[0][1]
        padded_grants = encoded_grants + "=" * (-len(encoded_grants) % 4)
        assert json.loads(base64.urlsafe_b64decode(padded_grants)) == {
            "g": ["short-lived-grant"],
            "v": 1,
        }

    @staticmethod
    def test_list_metadata_fields_issues_workflow_capability_and_calls_catalog_operation() -> None:
        admission = Admission()
        broker = _KnowledgeFsAppExecutionCapabilityBroker()
        remote = _KnowledgeFsAppExecutionCapabilityRemote()
        service = KnowledgeFSAppExecutionCapabilityService(  # type: ignore[arg-type]
            admission=admission,
            broker=broker,
            remote=remote,
        )
        run_context = DifyRunContext(
            tenant_id="tenant-1",
            app_id="app-1",
            user_id="user-1",
            user_from=UserFrom.ACCOUNT,
            invoke_from=InvokeFrom.DEBUGGER,
            trace_session_id="trace-from-workflow",
        )

        first_page = service.list_metadata_fields(
            run_context=run_context,
            caller_kind=KnowledgeFSAppSpaceJoinType.WORKFLOW,
            resource=KnowledgeResourceRef(kind="knowledge_fs", control_space_id="control-1"),
        )
        second_page = service.list_metadata_fields(
            run_context=run_context,
            caller_kind=KnowledgeFSAppSpaceJoinType.WORKFLOW,
            resource=KnowledgeResourceRef(kind="knowledge_fs", control_space_id="control-1"),
            cursor=first_page.next_cursor,
            limit=50,
        )

        assert [item.name for item in first_page.data] == ["department"]
        assert first_page.data[0].type == "string"
        assert first_page.next_cursor == "cursor-2"
        assert second_page.next_cursor == "cursor-2"
        assert [call["operation_id"] for call in admission.calls] == ["listMetadataFields", "listMetadataFields"]
        assert [call["caller_kind"] for call in admission.calls] == [
            KnowledgeFSAppSpaceJoinType.WORKFLOW,
            KnowledgeFSAppSpaceJoinType.WORKFLOW,
        ]
        assert [call["operation_id"] for call in broker.calls] == ["listMetadataFields", "listMetadataFields"]
        assert len(remote.calls) == 2
        first_request, second_request = remote.calls
        assert first_request.operation_id == "listMetadataFields"
        assert first_request.method == "GET"
        assert first_request.path == "/knowledge-spaces/space-1/metadata-fields"
        assert first_request.namespace_id == "tenant-1"
        assert first_request.knowledge_space_id == "space-1"
        assert first_request.capability_token == "token"
        assert first_request.payload is None
        assert first_request.query == (("limit", "100"),)
        assert second_request.query == (("cursor", "cursor-2"), ("limit", "50"))

    @staticmethod
    def test_list_metadata_fields_fails_closed_when_product_operation_is_unavailable(
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        admission = Admission()
        broker = _KnowledgeFsAppExecutionCapabilityBroker()
        remote = _KnowledgeFsAppExecutionCapabilityRemote()
        service = KnowledgeFSAppExecutionCapabilityService(  # type: ignore[arg-type]
            admission=admission,
            broker=broker,
            remote=remote,
        )
        monkeypatch.setattr(app_execution_capability, "is_product_operation_ready", lambda _operation_id: False)

        with pytest.raises(KnowledgeFSOperationUnavailableError):
            service.list_metadata_fields(
                run_context=DifyRunContext(
                    tenant_id="tenant-1",
                    app_id="app-1",
                    user_id="user-1",
                    user_from=UserFrom.ACCOUNT,
                    invoke_from=InvokeFrom.DEBUGGER,
                ),
                caller_kind=KnowledgeFSAppSpaceJoinType.WORKFLOW,
                resource=KnowledgeResourceRef(kind="knowledge_fs", control_space_id="control-1"),
            )

        assert admission.calls == []
        assert broker.calls == []
        assert remote.calls == []

    @staticmethod
    def test_capture_workflow_failed_retrieval_uses_fresh_transport_trace_and_business_event_id() -> None:
        admission = Admission()
        broker = _KnowledgeFsAppExecutionCapabilityBroker()
        remote = _KnowledgeFsAppExecutionCapabilityRemote()
        service = KnowledgeFSAppExecutionCapabilityService(  # type: ignore[arg-type]
            admission=admission,
            broker=broker,
            remote=remote,
        )

        result = service.capture_workflow_failed_retrieval(
            tenant_id="tenant-1",
            app_id="app-1",
            resource=KnowledgeResourceRef(kind="knowledge_fs", control_space_id="control-1"),
            payload=KnowledgeFSWorkflowFailedRetrievalCapturePayload(
                event_id="019fac9f-bfb0-75ee-9af5-252ebafbac1e",
                query="  missing answer  ",
                mode="fast",
                retrieval_trace_id=" trace-retrieval-1 ",
            ),
        )

        assert str(result.failed_query_id) == "019fac9f-bfb0-75ee-9af5-252ebafbac1c"
        assert result.verdict == "retrieval-miss"
        assert str(result.bad_case_id) == "019fac9f-bfb0-75ee-9af5-252ebafbac1d"
        assert admission.calls == [
            {
                "tenant_id": "tenant-1",
                "app_id": "app-1",
                "control_space_id": "control-1",
                "caller_kind": KnowledgeFSAppSpaceJoinType.WORKFLOW,
                "operation_id": "captureWorkflowFailedRetrieval",
            }
        ]
        assert broker.calls == [
            {
                "profile": admission.profile,
                "operation_id": "captureWorkflowFailedRetrieval",
                "resource_id": None,
                "trace_id": None,
            }
        ]
        assert remote.calls == [
            KnowledgeFSRemoteJSONRequest(
                operation_id="captureWorkflowFailedRetrieval",
                method="POST",
                path="/knowledge-spaces/space-1/failed-queries/workflow-retrieval-misses",
                namespace_id="tenant-1",
                knowledge_space_id="space-1",
                capability_token="token",
                trace_id="trace-1",
                payload={
                    "eventId": "019fac9f-bfb0-75ee-9af5-252ebafbac1e",
                    "query": "missing answer",
                    "mode": "fast",
                    "retrievalTraceId": "trace-retrieval-1",
                },
            )
        ]

    @staticmethod
    def test_agent_investigation_uses_authorized_space_and_preserves_report_identity() -> None:
        broker = _KnowledgeFsAppExecutionCapabilityBroker()
        remote = _KnowledgeFsAppExecutionCapabilityRemote()
        service = KnowledgeFSAppExecutionCapabilityService(admission=Admission(), broker=broker, remote=remote)
        issued = broker.issue_app(operation_id="captureAgentKnowledgeInvestigation")
        payload: dict[str, JsonValue] = {"investigationId": "investigation-1", "query": "refund", "attempts": []}

        result = service.capture_agent_investigation(issued=issued, tenant_id="tenant-1", payload=payload)

        assert result == {"investigationId": "investigation-1", "failedQueries": []}
        assert remote.calls == [
            KnowledgeFSRemoteJSONRequest(
                operation_id="captureAgentKnowledgeInvestigation",
                method="POST",
                path="/knowledge-spaces/space-1/agent-investigations",
                namespace_id="tenant-1",
                knowledge_space_id="space-1",
                capability_token="token",
                trace_id="trace-1",
                payload=payload,
            )
        ]

    @staticmethod
    @pytest.mark.parametrize("unavailable", ["wrong-capability", "unready-operation", "missing-path"])
    def test_agent_investigation_refuses_unavailable_or_wrong_capability_before_io(
        monkeypatch: pytest.MonkeyPatch, unavailable: str
    ) -> None:
        broker = _KnowledgeFsAppExecutionCapabilityBroker()
        remote = _KnowledgeFsAppExecutionCapabilityRemote()
        service = KnowledgeFSAppExecutionCapabilityService(admission=Admission(), broker=broker, remote=remote)
        issued = broker.issue_app(operation_id="captureAgentKnowledgeInvestigation")
        if unavailable == "wrong-capability":
            issued = issued._replace(operation_id="retrieveEvidence")
        elif unavailable == "unready-operation":
            monkeypatch.setattr(app_execution_capability, "is_product_operation_ready", lambda _operation_id: False)
        else:
            operation_id = "captureAgentKnowledgeInvestigation"
            operations = dict(app_execution_capability.KNOWLEDGE_FS_PRODUCT_OPERATIONS)
            operations[operation_id] = operations[operation_id]._replace(kfs_path=None)
            monkeypatch.setattr(app_execution_capability, "KNOWLEDGE_FS_PRODUCT_OPERATIONS", operations)
            monkeypatch.setattr(app_execution_capability, "is_product_operation_ready", lambda _operation_id: True)

        with pytest.raises(KnowledgeFSOperationUnavailableError):
            service.capture_agent_investigation(issued=issued, tenant_id="tenant-1", payload={})

        assert remote.calls == []
