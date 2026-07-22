from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import pytest

from services.knowledge_fs import data_facade as data_facade_module
from services.knowledge_fs.capability_broker import KnowledgeFSIssuedProductCapability
from services.knowledge_fs.data_facade import KnowledgeFSDataFacade
from services.knowledge_fs.product_dto import (
    KnowledgeFSDocumentCreatePayload,
    KnowledgeFSDocumentDeletePayload,
    KnowledgeFSProfileModelSelection,
    KnowledgeFSQueryCreatePayload,
    KnowledgeFSResearchTaskCreatePayload,
    KnowledgeFSSettingsPayload,
    KnowledgeFSSourceCreatePayload,
    KnowledgeFSSourceUpdatePayload,
    KnowledgeFSSpaceUpdatePayload,
)
from services.knowledge_fs.product_remote import (
    KnowledgeFSOperationUnavailableError,
    KnowledgeFSProductRequestRejectedError,
    KnowledgeFSRemoteBinaryRequest,
    KnowledgeFSRemoteJSONRequest,
)


class NoopCharge:
    def commit(self) -> None:
        return

    def refund(self) -> None:
        return


class NoopAdmission:
    def reserve(self, **kwargs: object) -> NoopCharge:
        _ = kwargs
        return NoopCharge()


class RecordingCharge:
    def __init__(self) -> None:
        self.commits = 0
        self.refunds = 0

    def commit(self) -> None:
        self.commits += 1

    def refund(self) -> None:
        self.refunds += 1


class RecordingAdmission:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []
        self.charges: list[RecordingCharge] = []

    def reserve(self, **kwargs: object) -> RecordingCharge:
        self.calls.append(kwargs)
        charge = RecordingCharge()
        self.charges.append(charge)
        return charge


class FailingBroker:
    def __init__(self) -> None:
        self.calls = 0

    def issue_interactive(self, **kwargs):
        _ = kwargs
        self.calls += 1
        raise AssertionError("manifest gaps must fail before capability issuance")


class FailingRemote:
    def __init__(self) -> None:
        self.calls = 0

    def batch_space_summaries(self, **kwargs):
        _ = kwargs
        self.calls += 1
        raise AssertionError("not used")

    def execute_json(self, request: KnowledgeFSRemoteJSONRequest):
        _ = request
        self.calls += 1
        raise AssertionError("manifest gaps must fail before external I/O")

    def execute_binary(self, request: KnowledgeFSRemoteBinaryRequest):
        _ = request
        self.calls += 1
        raise AssertionError("must not perform binary I/O")


class RecordingBroker:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    def issue_interactive(self, **kwargs) -> KnowledgeFSIssuedProductCapability:
        self.calls.append(kwargs)
        operation_id = kwargs["operation_id"]
        return KnowledgeFSIssuedProductCapability(
            token="capability-token",
            expires_at=datetime(2030, 1, 1, tzinfo=UTC),
            operation_id=operation_id,
            knowledge_space_id="space-1",
            knowledge_space_revision=9,
            trace_id="trace-1",
        )


class RecordingRemote:
    def __init__(self) -> None:
        self.requests: list[KnowledgeFSRemoteJSONRequest] = []
        self.binary_requests: list[KnowledgeFSRemoteBinaryRequest] = []

    def batch_space_summaries(self, **kwargs):
        _ = kwargs
        return {}

    def execute_json(self, request: KnowledgeFSRemoteJSONRequest):
        self.requests.append(request)
        if request.operation_id in {"getSettings", "updateSettings"}:
            return {
                "configurationState": "pending-validation",
                "embedding": {
                    "model": "embed-v1",
                    "pluginId": "plugin-1",
                    "provider": "provider-1",
                },
                "retrieval": None,
                "revision": 2,
            }
        if request.operation_id in {"listSources", "listResearchTasks", "listTraces"}:
            return {"items": [], "nextCursor": None}
        if request.operation_id == "createSource":
            return {
                "connectionId": None,
                "createdAt": "2030-01-01T00:00:00Z",
                "id": "source-1",
                "knowledgeSpaceId": "space-1",
                "metadata": {"team": "search"},
                "name": "Docs",
                "permissionScope": [],
                "status": "active",
                "type": "web",
                "updatedAt": "2030-01-01T00:00:00Z",
                "uri": "https://example.test/docs",
                "version": 1,
            }
        if request.operation_id in {"getSource", "updateSource"}:
            return {
                "connectionId": None,
                "createdAt": "2030-01-01T00:00:00Z",
                "id": "source-1",
                "knowledgeSpaceId": "space-1",
                "metadata": {},
                "name": "Docs",
                "permissionScope": [],
                "status": "active",
                "type": "web",
                "updatedAt": "2030-01-01T00:00:00Z",
                "uri": "https://example.test/docs",
                "version": 2,
            }
        if request.operation_id == "testSource":
            return {"valid": True}
        if request.operation_id == "getCompilationJob":
            return {
                "createdAt": 1.0,
                "documentAssetId": "document-1",
                "id": "job-1",
                "knowledgeSpaceId": "space-1",
                "stage": "queued",
                "tenantId": "tenant-1",
                "updatedAt": 1.0,
                "version": 1,
            }
        if request.operation_id == "getTrace":
            return {
                "createdAt": "2030-01-01T00:00:00Z",
                "id": "trace-1",
                "knowledgeSpaceId": "space-1",
                "mode": "fast",
                "query": "What changed?",
                "steps": [],
            }
        if request.operation_id == "listTraceEvidence":
            return {"items": [], "path": "/queries/trace-1/evidence", "truncated": False}
        if request.operation_id in {"deleteDocument", "deleteSource"}:
            return {
                "job": {
                    "checkpoint": "requested",
                    "createdAt": "2030-01-01T00:00:00Z",
                    "id": "00000000-0000-4000-8000-000000000001",
                    "knowledgeSpaceId": "space-1",
                    "runState": "queued",
                    "targetId": "00000000-0000-4000-8000-000000000002",
                    "targetType": "document" if request.operation_id == "deleteDocument" else "source",
                    "updatedAt": "2030-01-01T00:00:00Z",
                },
                "statusUrl": "/deletion-jobs/job-1",
            }
        if request.operation_id == "createResearchTask":
            return {
                "id": "research-1",
                "knowledgeSpaceId": "space-1",
                "query": "What changed?",
                "stage": "queued",
                "mode": "research",
                "topK": 5,
                "metadata": {},
                "cost": {"entries": [], "totalUsd": 0},
                "createdAt": 1.0,
                "updatedAt": 1.0,
            }
        return {"id": "space-1"}

    def execute_binary(self, request: KnowledgeFSRemoteBinaryRequest):
        self.binary_requests.append(request)
        return {
            "session": {
                "compilationJobId": "compilation-1",
                "completedAt": 2_000_000,
                "documentAssetId": "asset-1",
                "expectedSizeBytes": len(request.body),
                "expiresAt": 2_060_000,
                "id": "session-1",
                "mode": "small_fallback",
                "status": "completed",
            }
        }


def test_facade_reserves_before_capability_and_commits_or_refunds_after_remote_io() -> None:
    admission = RecordingAdmission()
    facade = KnowledgeFSDataFacade(  # type: ignore[arg-type]
        admission=admission,
        broker=RecordingBroker(),
        remote=RecordingRemote(),
    )

    result = facade.get_settings(
        tenant_id="tenant-1",
        account_id="account-1",
        control_space_id="control-1",
    )

    assert result.revision == 2
    assert admission.calls == [{"tenant_id": "tenant-1", "operation_id": "getSettings"}]
    assert (admission.charges[0].commits, admission.charges[0].refunds) == (1, 0)

    failing_admission = RecordingAdmission()
    failing = KnowledgeFSDataFacade(  # type: ignore[arg-type]
        admission=failing_admission,
        broker=RecordingBroker(),
        remote=FailingRemote(),
    )
    with pytest.raises(AssertionError, match="manifest gaps"):
        failing.get_settings(
            tenant_id="tenant-1",
            account_id="account-1",
            control_space_id="control-1",
        )
    assert (failing_admission.charges[0].commits, failing_admission.charges[0].refunds) == (0, 1)


def test_legacy_buffered_document_and_query_fail_before_capability_or_remote_io() -> None:
    broker = FailingBroker()
    remote = FailingRemote()
    facade = KnowledgeFSDataFacade(admission=NoopAdmission(), broker=broker, remote=remote)  # type: ignore[arg-type]

    with pytest.raises(KnowledgeFSOperationUnavailableError, match="direct-upload"):
        facade.create_document(
            tenant_id="tenant-1",
            account_id="account-1",
            control_space_id="control-1",
            payload=KnowledgeFSDocumentCreatePayload(name="ignored", text="ignored", idempotency_key="once"),
        )
    with pytest.raises(KnowledgeFSOperationUnavailableError, match="queries/admission"):
        facade.create_query(
            tenant_id="tenant-1",
            account_id="account-1",
            control_space_id="control-1",
            payload=KnowledgeFSQueryCreatePayload(query="ignored"),
        )

    assert broker.calls == 0
    assert remote.calls == 0


def test_small_file_fallback_authorizes_before_read_and_binds_narrow_binary_request() -> None:
    remote = RecordingRemote()
    broker = RecordingBroker()
    facade = KnowledgeFSDataFacade(admission=NoopAdmission(), broker=broker, remote=remote)  # type: ignore[arg-type]
    observed: list[str] = []

    def read_body(max_bytes: int) -> bytes:
        assert broker.calls
        assert broker.calls[0]["operation_id"] == "uploadSmallFile"
        assert max_bytes == 8 * 1024 * 1024
        observed.append("read")
        return b"tiny"

    result = facade.upload_small_file(
        tenant_id="tenant-1",
        account_id="account-1",
        control_space_id="control-1",
        upload_session_id="session-1",
        body_reader=read_body,
    )

    assert result.session.status == "completed"
    assert observed == ["read"]
    assert broker.calls == [
        {
            "tenant_id": "tenant-1",
            "account_id": "account-1",
            "control_space_id": "control-1",
            "operation_id": "uploadSmallFile",
            "resource_id": "session-1",
        }
    ]
    assert remote.binary_requests == [
        KnowledgeFSRemoteBinaryRequest(
            operation_id="uploadSmallFile",
            method="POST",
            path="/upload-sessions/session-1/small-file",
            namespace_id="tenant-1",
            knowledge_space_id="space-1",
            capability_token="capability-token",
            trace_id="trace-1",
            body=b"tiny",
            query=(("knowledgeSpaceId", "space-1"),),
        )
    ]


def test_small_file_fallback_denial_and_size_limit_stop_before_bytes_or_remote_io() -> None:
    class DenyingBroker:
        def issue_interactive(self, **kwargs):
            _ = kwargs
            raise PermissionError("document write denied")

    denied_remote = FailingRemote()
    denied_facade = KnowledgeFSDataFacade(  # type: ignore[arg-type]
        admission=NoopAdmission(), broker=DenyingBroker(), remote=denied_remote
    )
    reads = 0

    def forbidden_read(_: int) -> bytes:
        nonlocal reads
        reads += 1
        return b"must-not-read"

    with pytest.raises(PermissionError, match="document write denied"):
        denied_facade.upload_small_file(
            tenant_id="tenant-1",
            account_id="account-1",
            control_space_id="control-1",
            upload_session_id="session-1",
            body_reader=forbidden_read,
        )
    assert reads == 0
    assert denied_remote.calls == 0

    remote = RecordingRemote()
    facade = KnowledgeFSDataFacade(  # type: ignore[arg-type]
        admission=NoopAdmission(), broker=RecordingBroker(), remote=remote
    )
    with pytest.raises(KnowledgeFSProductRequestRejectedError) as oversized:
        facade.upload_small_file(
            tenant_id="tenant-1",
            account_id="account-1",
            control_space_id="control-1",
            upload_session_id="session-1",
            body_reader=lambda maximum: b"x" * (maximum + 1),
        )
    assert oversized.value.status_code == 413
    assert remote.binary_requests == []


def test_json_facade_uses_kfs_camel_case_body_and_authoritative_revision() -> None:
    remote = RecordingRemote()
    broker = RecordingBroker()
    facade = KnowledgeFSDataFacade(admission=NoopAdmission(), broker=broker, remote=remote)  # type: ignore[arg-type]

    research = facade.create_research_task(
        tenant_id="tenant-1",
        account_id="account-1",
        control_space_id="control-1",
        payload=KnowledgeFSResearchTaskCreatePayload(
            query="What changed?",
            mode="research",
            top_k=5,
        ),
    )
    facade.update_space(
        tenant_id="tenant-1",
        account_id="account-1",
        control_space_id="control-1",
        payload=KnowledgeFSSpaceUpdatePayload(name="Renamed", icon="builtin:book"),
    )

    assert research.knowledge_space_id == "space-1"
    assert research.stage == "queued"
    assert remote.requests[0].payload == {
        "knowledgeSpaceId": "space-1",
        "metadata": {},
        "mode": "research",
        "query": "What changed?",
        "topK": 5,
    }
    assert remote.requests[1].payload == {
        "expectedRevision": 9,
        "iconRef": "builtin:book",
        "name": "Renamed",
    }
    assert {call["control_space_id"] for call in broker.calls} == {"control-1"}


def test_basic_product_facade_resolves_control_space_then_uses_exact_kfs_routes() -> None:
    remote = RecordingRemote()
    broker = RecordingBroker()
    facade = KnowledgeFSDataFacade(admission=NoopAdmission(), broker=broker, remote=remote)  # type: ignore[arg-type]

    settings = facade.get_settings(
        tenant_id="tenant-1",
        account_id="account-1",
        control_space_id="control-1",
    )
    updated = facade.update_settings(
        tenant_id="tenant-1",
        account_id="account-1",
        control_space_id="control-1",
        payload=KnowledgeFSSettingsPayload(
            embedding=KnowledgeFSProfileModelSelection(
                model="embed-v1",
                plugin_id="plugin-1",
                provider="provider-1",
            ),
            expected_revision=1,
        ),
    )
    sources = facade.list_sources(
        tenant_id="tenant-1",
        account_id="account-1",
        control_space_id="control-1",
        cursor="source-cursor",
    )
    source = facade.create_source(
        tenant_id="tenant-1",
        account_id="account-1",
        control_space_id="control-1",
        payload=KnowledgeFSSourceCreatePayload(
            metadata={"team": "search"},
            name="Docs",
            type="web",
            uri="https://example.test/docs",
        ),
    )
    tasks = facade.list_research_tasks(
        tenant_id="tenant-1",
        account_id="account-1",
        control_space_id="control-1",
        cursor="task-cursor",
    )
    traces = facade.list_traces(
        tenant_id="tenant-1",
        account_id="account-1",
        control_space_id="control-1",
        cursor="trace-cursor",
    )

    assert settings.revision == 2
    assert updated.embedding is not None
    assert updated.embedding.plugin_id == "plugin-1"
    assert sources.data == []
    assert source.knowledge_space_id == "space-1"
    assert tasks.data == []
    assert traces.data == []
    assert [request.operation_id for request in remote.requests] == [
        "getSettings",
        "updateSettings",
        "listSources",
        "createSource",
        "listResearchTasks",
        "listTraces",
    ]
    assert [request.path for request in remote.requests] == [
        "/knowledge-spaces/space-1/product-settings",
        "/knowledge-spaces/space-1/product-settings",
        "/knowledge-spaces/space-1/sources",
        "/knowledge-spaces/space-1/sources",
        "/knowledge-spaces/space-1/research-tasks",
        "/knowledge-spaces/space-1/quality/traces",
    ]
    assert remote.requests[1].payload == {
        "embedding": {"model": "embed-v1", "pluginId": "plugin-1", "provider": "provider-1"},
        "expectedRevision": 1,
    }
    assert remote.requests[2].query == (("cursor", "source-cursor"),)
    assert remote.requests[3].payload == {
        "metadata": {"team": "search"},
        "name": "Docs",
        "permissionScope": [],
        "type": "web",
        "uri": "https://example.test/docs",
    }
    assert remote.requests[4].query == (("cursor", "task-cursor"),)
    assert remote.requests[5].query == (("cursor", "trace-cursor"),)
    assert {call["control_space_id"] for call in broker.calls} == {"control-1"}


def test_advanced_facade_binds_child_resources_parent_space_and_idempotency() -> None:
    remote = RecordingRemote()
    broker = RecordingBroker()
    facade = KnowledgeFSDataFacade(admission=NoopAdmission(), broker=broker, remote=remote)  # type: ignore[arg-type]

    source = facade.update_source(
        tenant_id="tenant-1",
        account_id="account-1",
        control_space_id="control-1",
        source_id="source-1",
        payload=KnowledgeFSSourceUpdatePayload(name="Docs"),
    )
    credential_test = facade.test_source(
        tenant_id="tenant-1",
        account_id="account-1",
        control_space_id="control-1",
        source_id="source-1",
    )
    job = facade.get_compilation_job(
        tenant_id="tenant-1",
        account_id="account-1",
        control_space_id="control-1",
        job_id="job-1",
    )
    trace = facade.get_trace(
        tenant_id="tenant-1",
        account_id="account-1",
        control_space_id="control-1",
        trace_id="trace-1",
    )
    evidence = facade.list_trace_entries(
        tenant_id="tenant-1",
        account_id="account-1",
        control_space_id="control-1",
        trace_id="trace-1",
        kind="evidence",
        limit=25,
    )
    deletion = facade.delete_document(
        tenant_id="tenant-1",
        account_id="account-1",
        control_space_id="control-1",
        document_id="document-1",
        payload=KnowledgeFSDocumentDeletePayload(expected_revision=2),
        idempotency_key="delete-document-once",
    )

    assert source.version == 2
    assert credential_test.valid is True
    assert job.id == "job-1"
    assert trace.id == "trace-1"
    assert evidence.data == []
    assert deletion.job.target_type == "document"
    assert [request.path for request in remote.requests[-6:]] == [
        "/knowledge-spaces/space-1/sources/source-1",
        "/knowledge-spaces/space-1/sources/source-1/test",
        "/jobs/job-1",
        "/queries/trace-1",
        "/queries/trace-1/evidence",
        "/knowledge-spaces/space-1/documents/document-1",
    ]
    assert remote.requests[-4].query == (("knowledgeSpaceId", "space-1"),)
    assert remote.requests[-3].query == (("knowledgeSpaceId", "space-1"),)
    assert remote.requests[-2].query == (("limit", "25"), ("knowledgeSpaceId", "space-1"))
    assert remote.requests[-1].headers == (("Idempotency-Key", "delete-document-once"),)
    assert [call["resource_id"] for call in broker.calls[-6:]] == [
        "source-1",
        "source-1",
        "job-1",
        "trace-1",
        "trace-1",
        "document-1",
    ]


@pytest.mark.parametrize(
    ("method_name", "response_name", "operation_id", "specific_kwargs", "child_resource_id"),
    [
        ("list_documents", "KnowledgeFSDocumentListResponse", "listDocuments", {"cursor": "cursor-1"}, None),
        ("get_document", "KnowledgeFSDocumentResponse", "getDocument", {"document_id": "document-1"}, "document-1"),
        (
            "get_document_outline",
            "KnowledgeFSDocumentOutlineResponse",
            "getDocumentOutline",
            {"document_id": "document-1"},
            "document-1",
        ),
        (
            "list_document_revisions",
            "KnowledgeFSDocumentRevisionListResponse",
            "listDocumentRevisions",
            {"document_id": "document-1", "cursor": "cursor-1"},
            "document-1",
        ),
        (
            "update_document_metadata",
            "KnowledgeFSLogicalDocumentResponse",
            "updateDocumentMetadata",
            {"document_id": "document-1", "payload": MagicMock()},
            "document-1",
        ),
        (
            "list_document_chunks",
            "KnowledgeFSDocumentChunkListResponse",
            "listDocumentChunks",
            {"document_id": "document-1", "revision": 2, "cursor": "cursor-1", "query_text": "risk"},
            "document-1",
        ),
        (
            "get_document_chunk",
            "KnowledgeFSDocumentChunkResponse",
            "getDocumentChunk",
            {"document_id": "document-1", "revision": 2, "chunk_id": "chunk-1"},
            "document-1",
        ),
        (
            "bulk_delete_documents",
            "KnowledgeFSBulkDeletionAcceptedResponse",
            "bulkDeleteDocuments",
            {"payload": MagicMock(), "idempotency_key": "bulk-delete-once"},
            None,
        ),
        (
            "reindex_documents",
            "KnowledgeFSDocumentReindexResponse",
            "reindexDocuments",
            {"payload": MagicMock()},
            None,
        ),
        (
            "cancel_compilation_job",
            "KnowledgeFSDocumentCompilationJobResponse",
            "cancelCompilationJob",
            {"job_id": "job-1"},
            "job-1",
        ),
        (
            "retry_compilation_job",
            "KnowledgeFSDocumentCompilationJobResponse",
            "retryCompilationJob",
            {"job_id": "job-1"},
            "job-1",
        ),
        ("get_bulk_job", "KnowledgeFSBulkJobResponse", "getBulkJob", {"job_id": "job-1"}, "job-1"),
        ("get_source", "KnowledgeFSSourceResponse", "getSource", {"source_id": "source-1"}, "source-1"),
        (
            "delete_source",
            "KnowledgeFSDurableDeletionAcceptedResponse",
            "deleteSource",
            {
                "source_id": "source-1",
                "payload": MagicMock(),
                "documents": "cascade",
                "idempotency_key": "delete-source-once",
            },
            "source-1",
        ),
        (
            "crawl_source",
            "KnowledgeFSSourceCrawlResponse",
            "crawlSource",
            {"source_id": "source-1"},
            "source-1",
        ),
        (
            "list_source_pages",
            "KnowledgeFSSourcePagesResponse",
            "listSourcePages",
            {"source_id": "source-1", "cursor": "cursor-1", "limit": 25},
            "source-1",
        ),
        (
            "import_source_pages",
            "KnowledgeFSSourceImportResponse",
            "importSourcePages",
            {"source_id": "source-1", "payload": MagicMock()},
            "source-1",
        ),
        (
            "list_source_files",
            "KnowledgeFSSourceFilesResponse",
            "listSourceFiles",
            {"source_id": "source-1", "query": (("cursor", "cursor-1"),)},
            "source-1",
        ),
        (
            "import_source_files",
            "KnowledgeFSSourceImportResponse",
            "importSourceFiles",
            {"source_id": "source-1", "payload": MagicMock()},
            "source-1",
        ),
        (
            "plan_research_task",
            "KnowledgeFSResearchTaskPlanResponse",
            "planResearchTask",
            {"payload": MagicMock()},
            None,
        ),
        (
            "get_research_task",
            "KnowledgeFSResearchTaskResponse",
            "getResearchTask",
            {"task_id": "task-1"},
            "task-1",
        ),
        (
            "list_research_task_partials",
            "KnowledgeFSResearchTaskPartialListResponse",
            "listResearchTaskPartials",
            {"task_id": "task-1", "cursor": "cursor-1", "limit": 10},
            "task-1",
        ),
        (
            "cancel_research_task",
            "KnowledgeFSResearchTaskResponse",
            "cancelResearchTask",
            {"task_id": "task-1"},
            "task-1",
        ),
    ],
)
def test_facade_public_methods_preserve_the_registered_operation_and_child_binding(
    method_name: str,
    response_name: str,
    operation_id: str,
    specific_kwargs: dict[str, object],
    child_resource_id: str | None,
) -> None:
    facade = KnowledgeFSDataFacade(admission=MagicMock(), broker=MagicMock(), remote=MagicMock())
    interactive = MagicMock(return_value={})
    interactive_child = MagicMock(return_value={})
    response_type = getattr(data_facade_module, response_name)
    expected_response = object()
    common_kwargs = {
        "tenant_id": "tenant-1",
        "account_id": "account-1",
        "control_space_id": "control-1",
    }

    with (
        patch.object(facade, "_interactive", interactive),
        patch.object(facade, "_interactive_child", interactive_child),
        patch.object(response_type, "model_validate", return_value=expected_response) as validate,
    ):
        result = getattr(facade, method_name)(**common_kwargs, **specific_kwargs)

    assert result is expected_response
    validate.assert_called_once_with({})
    delegated = interactive_child if child_resource_id is not None else interactive
    delegated.assert_called_once()
    assert delegated.call_args.kwargs["operation_id"] == operation_id
    if child_resource_id is not None:
        assert delegated.call_args.kwargs["resource_id"] == child_resource_id
