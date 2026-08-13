from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import pytest

from services.knowledge_fs import data_facade as data_facade_module
from services.knowledge_fs.capability_broker import KnowledgeFSIssuedProductCapability
from services.knowledge_fs.data_facade import KnowledgeFSDataFacade
from services.knowledge_fs.product_dto import (
    KnowledgeFSAdmittedQueryRequest,
    KnowledgeFSCatQuery,
    KnowledgeFSDiffQuery,
    KnowledgeFSDocumentDeletePayload,
    KnowledgeFSFindQuery,
    KnowledgeFSGoldenQuestionBulkImportPayload,
    KnowledgeFSGoldenQuestionBulkImportRowPayload,
    KnowledgeFSGoldenQuestionEvidenceMatchPayload,
    KnowledgeFSGoldenQuestionPayload,
    KnowledgeFSGrepQuery,
    KnowledgeFSListQuery,
    KnowledgeFSLogicalDocumentDeletePayload,
    KnowledgeFSMetadataFieldCreatePayload,
    KnowledgeFSMetadataFieldUpdatePayload,
    KnowledgeFSProductRerankProfile,
    KnowledgeFSProductRetrievalProfile,
    KnowledgeFSProductScoreThreshold,
    KnowledgeFSProfileModelSelection,
    KnowledgeFSQueryCreatePayload,
    KnowledgeFSResearchTaskCreatePayload,
    KnowledgeFSSettingsPayload,
    KnowledgeFSSourceCreatePayload,
    KnowledgeFSSourceUpdatePayload,
    KnowledgeFSSpaceUpdatePayload,
    KnowledgeFSStatQuery,
    KnowledgeFSTreeQuery,
    KnowledgeFSUploadPartPresignPayload,
    KnowledgeFSUploadSessionAbortPayload,
    KnowledgeFSUploadSessionCompletePayload,
    KnowledgeFSUploadSessionCreatePayload,
    KnowledgeFSUploadSessionPartPayload,
)
from services.knowledge_fs.product_remote import (
    KnowledgeFSOperationUnavailableError,
    KnowledgeFSProductRemoteError,
    KnowledgeFSProductRequestRejectedError,
    KnowledgeFSRemoteBinaryRequest,
    KnowledgeFSRemoteJSONRequest,
    KnowledgeFSRemoteMultipartFile,
    KnowledgeFSRemoteMultipartRequest,
    KnowledgeFSRemoteSSERequest,
    KnowledgeFSRemoteSSEResponse,
)


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

    def execute_multipart(self, request: KnowledgeFSRemoteMultipartRequest):
        _ = request
        self.calls += 1
        raise AssertionError("must not perform multipart I/O")

    def execute_sse(self, request: KnowledgeFSRemoteSSERequest):
        _ = request
        self.calls += 1
        raise AssertionError("must not perform SSE I/O")


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
        self.multipart_requests: list[KnowledgeFSRemoteMultipartRequest] = []
        self.sse_requests: list[KnowledgeFSRemoteSSERequest] = []

    def batch_space_summaries(self, **kwargs):
        _ = kwargs
        return {}

    def execute_json(self, request: KnowledgeFSRemoteJSONRequest):
        self.requests.append(request)
        if request.operation_id in {"listKnowledgeFs", "findKnowledgeFs"}:
            return {"items": [], "path": "/knowledge", "truncated": False}
        if request.operation_id == "treeKnowledgeFs":
            return {
                "path": "/knowledge",
                "root": {
                    "kind": "directory",
                    "metadata": {},
                    "name": "knowledge",
                    "path": "/knowledge",
                },
                "truncated": False,
            }
        if request.operation_id == "grepKnowledgeFs":
            return {"matches": [], "path": "/knowledge", "truncated": False}
        if request.operation_id == "diffKnowledgeFs":
            return {
                "mode": "line",
                "newPath": "/knowledge/new.md",
                "oldPath": "/knowledge/old.md",
                "operations": [],
                "stats": {"delete": 0, "equal": 0, "insert": 0},
            }
        if request.operation_id == "catKnowledgeFs":
            return {
                "contentType": "text/markdown",
                "path": "/knowledge/readme.md",
                "text": "hello",
                "truncated": False,
            }
        if request.operation_id == "statKnowledgeFs":
            return {
                "metadata": {},
                "path": "/knowledge/readme.md",
                "resourceType": "document",
                "targetId": "document-1",
            }
        if request.operation_id in {"getSettings", "updateSettings"}:
            return {
                "activeProfileAvailable": False,
                "activeProfileRevisions": {},
                "capabilities": {
                    "deep": False,
                    "index": False,
                    "ingest": True,
                    "query": False,
                    "research": False,
                    "sourceSync": True,
                },
                "configurationState": "pending-validation",
                "embedding": {
                    "model": "embed-v1",
                    "pluginId": "plugin-1",
                    "provider": "provider-1",
                },
                "retrieval": None,
                "issues": [{"code": "missing", "field": "reasoning", "retryable": False}],
                "revision": 2,
            }
        if request.operation_id == "listMetadataFields":
            return {
                "items": [
                    {
                        "count": 2,
                        "createdAt": "2030-01-01T00:00:00Z",
                        "id": "field-1",
                        "name": "category",
                        "rowVersion": 3,
                        "type": "string",
                        "updatedAt": "2030-01-01T00:00:00Z",
                    }
                ],
                "nextCursor": None,
            }
        if request.operation_id in {
            "createMetadataField",
            "updateMetadataField",
        }:
            return {
                "count": 2,
                "createdAt": "2030-01-01T00:00:00Z",
                "id": "field-1",
                "name": "category",
                "rowVersion": 3,
                "type": "string",
                "updatedAt": "2030-01-01T00:00:00Z",
            }
        if request.operation_id == "deleteMetadataField":
            return {"deleted": True}
        if request.operation_id == "listSources":
            return {
                "items": [
                    {
                        "syncWorkflow": {
                            "canceledAt": None,
                            "checkpoint": "provider-read",
                            "completedAt": None,
                            "createdAt": "2030-01-01T00:00:00Z",
                            "cursor": None,
                            "executionAttempts": 1,
                            "id": "workflow-1",
                            "knowledgeSpaceId": "space-1",
                            "kind": "sync",
                            "lastErrorCode": None,
                            "maxExecutionAttempts": 3,
                            "progressCompleted": 2,
                            "progressFailed": 0,
                            "progressSkipped": 0,
                            "progressTotal": 5,
                            "sourceId": "source-1",
                            "state": "syncing",
                            "updatedAt": "2030-01-01T00:01:00Z",
                        },
                        "connectionId": None,
                        "createdAt": "2030-01-01T00:00:00Z",
                        "id": "source-1",
                        "knowledgeSpaceId": "space-1",
                        "lastSyncedAt": "2030-01-01T01:00:00Z",
                        "metadata": {},
                        "name": "Docs",
                        "permissionScope": [],
                        "status": "active",
                        "syncPolicy": {
                            "createdAt": "2030-01-01T00:00:00Z",
                            "enabled": True,
                            "expectedSourceVersion": 1,
                            "id": "policy-1",
                            "knowledgeSpaceId": "space-1",
                            "mode": "provider",
                            "revision": 1,
                            "sourceId": "source-1",
                            "updatedAt": "2030-01-01T00:00:00Z",
                        },
                        "type": "web",
                        "updatedAt": "2030-01-01T00:00:00Z",
                        "uri": "https://example.test/docs",
                        "version": 1,
                    }
                ],
                "nextCursor": None,
            }
        if request.operation_id in {"listResearchTasks", "listTraces"}:
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
        if request.operation_id in {"deleteDocument", "deleteLogicalDocument", "deleteSource"}:
            return {
                "job": {
                    "checkpoint": "requested",
                    "createdAt": "2030-01-01T00:00:00Z",
                    "id": "00000000-0000-4000-8000-000000000001",
                    "knowledgeSpaceId": "space-1",
                    "runState": "queued",
                    "targetId": "00000000-0000-4000-8000-000000000002",
                    "targetType": (
                        "document"
                        if request.operation_id == "deleteDocument"
                        else "logical_document"
                        if request.operation_id == "deleteLogicalDocument"
                        else "source"
                    ),
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
        if request.operation_id == "createUploadSession":
            return {
                "session": {
                    "expectedSizeBytes": 12,
                    "expiresAt": 2_060_000,
                    "id": "session-1",
                    "mode": "multipart",
                    "multipartPartCount": 1,
                    "multipartPartSizeBytes": 12,
                    "status": "ready",
                },
                "upload": None,
            }
        if request.operation_id == "presignUploadSessionPart":
            return {
                "expiresAt": 2_030_000,
                "headers": {"x-amz-checksum-sha256": "part-checksum"},
                "method": "PUT",
                "url": "https://storage.example/upload-part",
            }
        if request.operation_id in {"completeUploadSession", "abortUploadSession"}:
            return {
                "session": {
                    "expectedSizeBytes": 12,
                    "expiresAt": 2_060_000,
                    "id": "session-1",
                    "mode": "multipart",
                    "status": "completed" if request.operation_id == "completeUploadSession" else "aborted",
                }
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

    def execute_multipart(self, request: KnowledgeFSRemoteMultipartRequest):
        self.multipart_requests.append(request)
        return {
            "asset": {
                "createdAt": "2030-01-01T00:00:00Z",
                "filename": request.file.filename,
                "id": "asset-1",
                "knowledgeSpaceId": "space-1",
                "metadata": {},
                "mimeType": request.file.content_type,
                "objectKey": "documents/asset-1/upload.md",
                "parserStatus": "pending",
                "sha256": "sha256",
                "sizeBytes": len(request.file.body),
                "sourceId": None,
                "updatedAt": None,
                "version": 1,
            },
            "assetStatusUrl": "/knowledge-spaces/space-1/documents/asset-1",
            "compilationJob": {"id": "job-1", "stage": "queued"},
            "documentRevision": 1,
            "logicalDocument": {"id": "document-1", "revision": 1},
            "logicalDocumentId": "document-1",
            "statusUrl": "/knowledge-spaces/space-1/logical-documents/document-1/tasks/job-1",
        }

    def execute_sse(self, request: KnowledgeFSRemoteSSERequest):
        self.sse_requests.append(request)
        return KnowledgeFSRemoteSSEResponse(
            status_code=200,
            headers=(("content-type", "text/event-stream"),),
            chunks=iter((b"data: ok\n\n",)),
            close=lambda: None,
        )


class ActiveSettingsRemote(RecordingRemote):
    def __init__(
        self,
        *,
        active_profile_available: bool | None = None,
        configuration_state: str = "active",
        rerank_enabled: bool = True,
    ) -> None:
        super().__init__()
        self.active_profile_available = (
            configuration_state == "active" if active_profile_available is None else active_profile_available
        )
        self.configuration_state = configuration_state
        self.rerank_enabled = rerank_enabled

    def execute_json(self, request: KnowledgeFSRemoteJSONRequest):
        self.requests.append(request)
        if request.operation_id == "getSettings":
            return {
                "activeProfileAvailable": self.active_profile_available,
                "activeProfileRevisions": ({"embedding": 3, "retrieval": 4} if self.active_profile_available else {}),
                "capabilities": {
                    "deep": self.active_profile_available,
                    "index": self.active_profile_available,
                    "ingest": self.active_profile_available or self.configuration_state == "pending-validation",
                    "query": self.active_profile_available,
                    "research": self.active_profile_available,
                    "sourceSync": self.active_profile_available or self.configuration_state == "pending-validation",
                },
                "configurationState": self.configuration_state,
                "embedding": {
                    "model": "embed-v1",
                    "pluginId": "plugin-1",
                    "provider": "provider-1",
                    **({"revision": 3} if self.configuration_state == "active" else {}),
                },
                "retrieval": {
                    "defaultMode": "fast",
                    "reasoningModel": {
                        "model": "reason-v1",
                        "pluginId": "plugin-1",
                        "provider": "provider-1",
                    },
                    "rerank": {
                        "enabled": self.rerank_enabled,
                        "model": (
                            {
                                "model": "rerank-v1",
                                "pluginId": "plugin-1",
                                "provider": "provider-1",
                            }
                            if self.rerank_enabled
                            else None
                        ),
                    },
                    **({"revision": 4} if self.configuration_state == "active" else {}),
                    "scoreThreshold": {
                        "enabled": False,
                        "stage": "rerank" if self.rerank_enabled else "mode-final",
                        "value": 0.5,
                    },
                    "topK": 3,
                },
                "issues": [],
                "revision": 9,
            }
        if request.operation_id in {"updateEmbeddingProfile", "updateRetrievalProfile"}:
            return {
                "changedKind": "embedding" if request.operation_id == "updateEmbeddingProfile" else "retrieval",
                "checkpoint": "queued",
                "createdAt": "2026-07-28T00:00:00Z",
                "id": "migration-1",
                "knowledgeSpaceId": "space-1",
                "rebuildScope": "full-vector-space",
                "runState": "queued",
                "updatedAt": "2026-07-28T00:00:00Z",
            }
        if request.operation_id == "getProfileMigration":
            return {
                "changedKind": "embedding",
                "checkpoint": "activated",
                "completedAt": "2026-07-28T00:01:00Z",
                "createdAt": "2026-07-28T00:00:00Z",
                "id": "migration-1",
                "knowledgeSpaceId": "space-1",
                "rebuildScope": "full-vector-space",
                "runState": "succeeded",
                "updatedAt": "2026-07-28T00:01:00Z",
            }
        return super().execute_json(request)


def test_knowledge_fs_commands_use_independent_manifest_operations_and_query_contracts() -> None:
    remote = RecordingRemote()
    broker = RecordingBroker()
    facade = KnowledgeFSDataFacade(broker=broker, remote=remote)  # type: ignore[arg-type]
    common = {
        "tenant_id": "tenant-1",
        "account_id": "account-1",
        "control_space_id": "control-1",
    }

    facade.list_knowledge_fs(
        **common,
        query=KnowledgeFSListQuery(
            path="/knowledge",
            limit=25,
            cursor="cursor-1",
            consistency_class="path-consistent",
        ),
    )
    facade.tree_knowledge_fs(
        **common,
        query=KnowledgeFSTreeQuery(path="/knowledge", limit=20, depth=3),
    )
    facade.grep_knowledge_fs(
        **common,
        query=KnowledgeFSGrepQuery(path="/knowledge", query="TODO", limit=10, timeout_ms=500),
    )
    facade.find_knowledge_fs(
        **common,
        query=KnowledgeFSFindQuery(
            path="/knowledge",
            limit=15,
            name_contains="readme",
            resource_type="document",
        ),
    )
    facade.diff_knowledge_fs(
        **common,
        query=KnowledgeFSDiffQuery(
            old_path="/knowledge/old.md",
            new_path="/knowledge/new.md",
            mode="line",
            semantic=True,
        ),
    )
    cat = facade.cat_knowledge_fs(
        **common,
        query=KnowledgeFSCatQuery(path="/knowledge/readme.md"),
    )
    facade.stat_knowledge_fs(
        **common,
        query=KnowledgeFSStatQuery(path="/knowledge/readme.md"),
    )

    assert [call["operation_id"] for call in broker.calls] == [
        "listKnowledgeFs",
        "treeKnowledgeFs",
        "grepKnowledgeFs",
        "findKnowledgeFs",
        "diffKnowledgeFs",
        "catKnowledgeFs",
        "statKnowledgeFs",
    ]
    assert [request.operation_id for request in remote.requests] == [
        "listKnowledgeFs",
        "treeKnowledgeFs",
        "grepKnowledgeFs",
        "findKnowledgeFs",
        "diffKnowledgeFs",
        "catKnowledgeFs",
        "statKnowledgeFs",
    ]
    assert remote.requests[0].query == (
        ("path", "/knowledge"),
        ("limit", "25"),
        ("cursor", "cursor-1"),
        ("consistencyClass", "path-consistent"),
    )
    assert ("q", "TODO") in remote.requests[2].query
    assert ("nameContains", "readme") in remote.requests[3].query
    assert ("semantic", "true") in remote.requests[4].query
    assert all(request.method == "GET" and request.payload is None for request in remote.requests)
    assert cat.text == "hello"


def test_facade_propagates_remote_io_failure() -> None:
    facade = KnowledgeFSDataFacade(  # type: ignore[arg-type]
        broker=RecordingBroker(),
        remote=RecordingRemote(),
    )

    result = facade.get_settings(
        tenant_id="tenant-1",
        account_id="account-1",
        control_space_id="control-1",
    )

    assert result.revision == 2

    failing = KnowledgeFSDataFacade(  # type: ignore[arg-type]
        broker=RecordingBroker(),
        remote=FailingRemote(),
    )
    with pytest.raises(AssertionError, match="manifest gaps"):
        failing.get_settings(
            tenant_id="tenant-1",
            account_id="account-1",
            control_space_id="control-1",
        )


def test_document_upload_authorizes_before_read_and_binds_bounded_multipart_request() -> None:
    remote = RecordingRemote()
    broker = RecordingBroker()
    facade = KnowledgeFSDataFacade(broker=broker, remote=remote)  # type: ignore[arg-type]
    observed: list[str] = []

    def read_upload(max_bytes: int) -> KnowledgeFSRemoteMultipartFile:
        observed.append(f"read:{max_bytes}")
        assert broker.calls
        return KnowledgeFSRemoteMultipartFile(
            filename="upload.md",
            content_type="text/markdown",
            body=b"# Upload",
        )

    result = facade.create_document(
        tenant_id="tenant-1",
        account_id="account-1",
        control_space_id="control-1",
        body_reader=read_upload,
    )

    assert result.logical_document_id == "document-1"
    assert observed == ["read:15728640"]
    assert broker.calls == [
        {
            "tenant_id": "tenant-1",
            "account_id": "account-1",
            "control_space_id": "control-1",
            "operation_id": "createDocument",
        }
    ]
    assert remote.multipart_requests == [
        KnowledgeFSRemoteMultipartRequest(
            operation_id="createDocument",
            method="POST",
            path="/knowledge-spaces/space-1/documents",
            namespace_id="tenant-1",
            knowledge_space_id="space-1",
            capability_token="capability-token",
            trace_id="trace-1",
            file=KnowledgeFSRemoteMultipartFile(
                filename="upload.md",
                content_type="text/markdown",
                body=b"# Upload",
            ),
        )
    ]


def test_legacy_buffered_query_fails_before_capability_or_remote_io() -> None:
    broker = FailingBroker()
    remote = FailingRemote()
    facade = KnowledgeFSDataFacade(broker=broker, remote=remote)  # type: ignore[arg-type]

    with pytest.raises(KnowledgeFSOperationUnavailableError, match="queries/admission"):
        facade.create_query(
            tenant_id="tenant-1",
            account_id="account-1",
            control_space_id="control-1",
            payload=KnowledgeFSQueryCreatePayload(query="ignored"),
        )

    assert broker.calls == 0
    assert remote.calls == 0


def test_query_and_research_streams_use_the_internal_sse_transport() -> None:
    remote = RecordingRemote()
    facade = KnowledgeFSDataFacade(broker=RecordingBroker(), remote=remote)  # type: ignore[arg-type]

    query_response = facade.stream_query(
        capability_token="query-capability",
        trace_id="trace-1",
        payload=KnowledgeFSAdmittedQueryRequest(
            knowledgeSpaceId="space-1",
            query="What changed?",
            mode="fast",
        ),
    )
    research_response = facade.stream_research_task(
        capability_token="research-capability",
        trace_id="trace-2",
        task_id="task-1",
        knowledge_space_id="space-1",
        cursor="cursor-1",
        limit=25,
    )

    assert query_response.status_code == 200
    assert research_response.status_code == 200
    assert remote.sse_requests == [
        KnowledgeFSRemoteSSERequest(
            operation_id="createQuery",
            method="POST",
            path="/queries",
            capability_token="query-capability",
            trace_id="trace-1",
            payload={
                "activeDocumentIds": [],
                "activeEntityIds": [],
                "knowledgeSpaceId": "space-1",
                "mode": "fast",
                "query": "What changed?",
            },
        ),
        KnowledgeFSRemoteSSERequest(
            operation_id="streamResearchTask",
            method="GET",
            path="/research-tasks/task-1/events",
            capability_token="research-capability",
            trace_id="trace-2",
            payload=None,
            query=(
                ("knowledgeSpaceId", "space-1"),
                ("limit", "25"),
                ("cursor", "cursor-1"),
            ),
        ),
    ]


def test_upload_session_control_plane_uses_only_json_bff_calls_bound_to_the_space() -> None:
    remote = RecordingRemote()
    broker = RecordingBroker()
    facade = KnowledgeFSDataFacade(broker=broker, remote=remote)  # type: ignore[arg-type]

    created = facade.create_upload_session(
        tenant_id="tenant-1",
        account_id="account-1",
        control_space_id="control-1",
        payload=KnowledgeFSUploadSessionCreatePayload(
            checksum_sha256_base64="whole-checksum",
            content_type="application/pdf",
            expected_size_bytes=12,
            file_name="guide.pdf",
        ),
        idempotency_key="upload-session-1",
    )
    presigned = facade.presign_upload_session_part(
        tenant_id="tenant-1",
        account_id="account-1",
        control_space_id="control-1",
        upload_session_id="session-1",
        part_number=1,
        payload=KnowledgeFSUploadPartPresignPayload(
            checksum_sha256_base64="part-checksum",
            content_length=12,
        ),
    )
    completed = facade.complete_upload_session(
        tenant_id="tenant-1",
        account_id="account-1",
        control_space_id="control-1",
        upload_session_id="session-1",
        payload=KnowledgeFSUploadSessionCompletePayload(
            parts=[
                KnowledgeFSUploadSessionPartPayload(
                    checksum_sha256_base64="part-checksum",
                    etag="etag-1",
                    part_number=1,
                )
            ]
        ),
    )
    aborted = facade.abort_upload_session(
        tenant_id="tenant-1",
        account_id="account-1",
        control_space_id="control-1",
        upload_session_id="session-1",
        payload=KnowledgeFSUploadSessionAbortPayload(),
    )

    assert created.session.status == "ready"
    assert presigned.url == "https://storage.example/upload-part"
    assert completed.session.status == "completed"
    assert aborted.session.status == "aborted"
    assert [call["operation_id"] for call in broker.calls] == [
        "createUploadSession",
        "presignUploadSessionPart",
        "completeUploadSession",
        "abortUploadSession",
    ]
    assert remote.requests == [
        KnowledgeFSRemoteJSONRequest(
            operation_id="createUploadSession",
            method="POST",
            path="/knowledge-spaces/space-1/upload-sessions",
            namespace_id="tenant-1",
            knowledge_space_id="space-1",
            capability_token="capability-token",
            trace_id="trace-1",
            payload={
                "checksumSha256Base64": "whole-checksum",
                "contentType": "application/pdf",
                "expectedSizeBytes": 12,
                "fileName": "guide.pdf",
                "idempotencyKey": "upload-session-1",
            },
        ),
        KnowledgeFSRemoteJSONRequest(
            operation_id="presignUploadSessionPart",
            method="POST",
            path="/upload-sessions/session-1/parts/1/presign",
            namespace_id="tenant-1",
            knowledge_space_id="space-1",
            capability_token="capability-token",
            trace_id="trace-1",
            payload={
                "checksumSha256Base64": "part-checksum",
                "contentLength": 12,
                "knowledgeSpaceId": "space-1",
            },
        ),
        KnowledgeFSRemoteJSONRequest(
            operation_id="completeUploadSession",
            method="POST",
            path="/upload-sessions/session-1/complete",
            namespace_id="tenant-1",
            knowledge_space_id="space-1",
            capability_token="capability-token",
            trace_id="trace-1",
            payload={
                "parts": [
                    {
                        "checksumSha256Base64": "part-checksum",
                        "etag": "etag-1",
                        "partNumber": 1,
                    }
                ],
                "knowledgeSpaceId": "space-1",
            },
        ),
        KnowledgeFSRemoteJSONRequest(
            operation_id="abortUploadSession",
            method="POST",
            path="/upload-sessions/session-1/abort",
            namespace_id="tenant-1",
            knowledge_space_id="space-1",
            capability_token="capability-token",
            trace_id="trace-1",
            payload={"knowledgeSpaceId": "space-1"},
        ),
    ]


def test_small_file_fallback_authorizes_before_read_and_binds_narrow_binary_request() -> None:
    remote = RecordingRemote()
    broker = RecordingBroker()
    facade = KnowledgeFSDataFacade(broker=broker, remote=remote)  # type: ignore[arg-type]
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
        broker=DenyingBroker(),
        remote=denied_remote,
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
        broker=RecordingBroker(),
        remote=remote,
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
    facade = KnowledgeFSDataFacade(broker=broker, remote=remote)  # type: ignore[arg-type]

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
        payload=KnowledgeFSSpaceUpdatePayload(name="Renamed", icon="grinning"),
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
        "iconRef": "grinning",
        "name": "Renamed",
    }
    assert {call["control_space_id"] for call in broker.calls} == {"control-1"}


def test_basic_product_facade_resolves_control_space_then_uses_exact_kfs_routes() -> None:
    remote = RecordingRemote()
    broker = RecordingBroker()
    facade = KnowledgeFSDataFacade(broker=broker, remote=remote)  # type: ignore[arg-type]

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
        limit=25,
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
    assert updated.settings.embedding is not None
    assert updated.settings.embedding.plugin_id == "plugin-1"
    assert len(sources.data) == 1
    assert sources.data[0].sync_workflow is not None
    assert sources.data[0].sync_workflow.id == "workflow-1"
    assert sources.data[0].sync_workflow.state == "syncing"
    assert sources.data[0].last_synced_at == datetime(2030, 1, 1, 1, tzinfo=UTC)
    assert sources.data[0].sync_policy is not None
    assert sources.data[0].sync_policy.mode == "provider"
    assert source.knowledge_space_id == "space-1"
    assert tasks.data == []
    assert traces.data == []
    assert [request.operation_id for request in remote.requests] == [
        "getSettings",
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
        "/knowledge-spaces/space-1/product-settings",
        "/knowledge-spaces/space-1/sources",
        "/knowledge-spaces/space-1/sources",
        "/knowledge-spaces/space-1/research-tasks",
        "/knowledge-spaces/space-1/quality/traces",
    ]
    assert remote.requests[2].payload == {
        "embedding": {"model": "embed-v1", "pluginId": "plugin-1", "provider": "provider-1"},
        "expectedRevision": 1,
    }
    assert remote.requests[3].query == (("cursor", "source-cursor"), ("limit", "25"))
    assert remote.requests[4].payload == {
        "metadata": {"team": "search"},
        "name": "Docs",
        "permissionScope": [],
        "type": "web",
        "uri": "https://example.test/docs",
    }
    assert remote.requests[5].query == (("cursor", "task-cursor"),)
    assert remote.requests[6].query == (("cursor", "trace-cursor"),)
    assert {call["control_space_id"] for call in broker.calls} == {"control-1"}


def test_metadata_field_facade_uses_catalog_routes_and_row_version_cas() -> None:
    remote = RecordingRemote()
    broker = RecordingBroker()
    facade = KnowledgeFSDataFacade(broker=broker, remote=remote)  # type: ignore[arg-type]

    listed = facade.list_metadata_fields(
        tenant_id="tenant-1",
        account_id="account-1",
        control_space_id="control-1",
        cursor="field-cursor",
        limit=25,
    )
    facade.create_metadata_field(
        tenant_id="tenant-1",
        account_id="account-1",
        control_space_id="control-1",
        payload=KnowledgeFSMetadataFieldCreatePayload(name="category", type="string"),
    )
    facade.update_metadata_field(
        tenant_id="tenant-1",
        account_id="account-1",
        control_space_id="control-1",
        field_id="field-1",
        payload=KnowledgeFSMetadataFieldUpdatePayload(expected_row_version=3, name="topic"),
    )
    deleted = facade.delete_metadata_field(
        tenant_id="tenant-1",
        account_id="account-1",
        control_space_id="control-1",
        field_id="field-1",
        expected_row_version=4,
    )

    assert listed.data[0].name == "category"
    assert deleted.deleted is True
    assert [request.operation_id for request in remote.requests] == [
        "listMetadataFields",
        "createMetadataField",
        "updateMetadataField",
        "deleteMetadataField",
    ]
    assert [request.path for request in remote.requests] == [
        "/knowledge-spaces/space-1/metadata-fields",
        "/knowledge-spaces/space-1/metadata-fields",
        "/knowledge-spaces/space-1/metadata-fields/field-1",
        "/knowledge-spaces/space-1/metadata-fields/field-1",
    ]
    assert remote.requests[0].query == (("cursor", "field-cursor"), ("limit", "25"))
    assert remote.requests[1].payload == {"name": "category", "type": "string"}
    assert remote.requests[2].payload == {"expectedRowVersion": 3, "name": "topic"}
    assert remote.requests[3].query == (("expectedRowVersion", "4"),)
    assert {call["control_space_id"] for call in broker.calls} == {"control-1"}


def test_active_settings_use_durable_profile_migration_routes() -> None:
    embedding_remote = ActiveSettingsRemote()
    embedding_facade = KnowledgeFSDataFacade(
        broker=RecordingBroker(),
        remote=embedding_remote,
    )  # type: ignore[arg-type]

    embedding_result = embedding_facade.update_settings(
        tenant_id="tenant-1",
        account_id="account-1",
        control_space_id="control-1",
        payload=KnowledgeFSSettingsPayload(
            embedding=KnowledgeFSProfileModelSelection(
                model="embed-v2",
                plugin_id="plugin-2",
                provider="provider-2",
            ),
            expected_revision=9,
        ),
    )

    assert embedding_result.settings.configuration_state == "active"
    assert embedding_result.migration is not None
    assert embedding_result.migration.run_state == "queued"
    assert [request.operation_id for request in embedding_remote.requests] == [
        "getSettings",
        "updateEmbeddingProfile",
    ]
    assert embedding_remote.requests[1].path == "/knowledge-spaces/space-1/embedding-profile"
    assert embedding_remote.requests[1].payload == {
        "model": "embed-v2",
        "pluginId": "plugin-2",
        "provider": "provider-2",
    }

    retrieval_remote = ActiveSettingsRemote()
    retrieval_facade = KnowledgeFSDataFacade(
        broker=RecordingBroker(),
        remote=retrieval_remote,
    )  # type: ignore[arg-type]
    retrieval_profile = KnowledgeFSProductRetrievalProfile(
        default_mode="research",
        reasoning_model=KnowledgeFSProfileModelSelection(
            model="reason-v2",
            plugin_id="plugin-2",
            provider="provider-2",
        ),
        rerank=KnowledgeFSProductRerankProfile(
            enabled=True,
            model=KnowledgeFSProfileModelSelection(
                model="rerank-v2",
                plugin_id="plugin-2",
                provider="provider-2",
            ),
        ),
        score_threshold=KnowledgeFSProductScoreThreshold(
            enabled=True,
            stage="mode-final",
            value=0.6,
        ),
        top_k=6,
    )

    retrieval_facade.update_settings(
        tenant_id="tenant-1",
        account_id="account-1",
        control_space_id="control-1",
        payload=KnowledgeFSSettingsPayload(
            expected_revision=9,
            retrieval=retrieval_profile,
        ),
    )

    assert [request.operation_id for request in retrieval_remote.requests] == [
        "getSettings",
        "updateRetrievalProfile",
    ]
    assert retrieval_remote.requests[1].path == "/knowledge-spaces/space-1/retrieval-profile"
    assert retrieval_remote.requests[1].payload == {
        "expectedRevision": 4,
        "profile": {
            "defaultMode": "research",
            "reasoningModel": {
                "model": "reason-v2",
                "pluginId": "plugin-2",
                "provider": "provider-2",
            },
            "rerank": {
                "enabled": True,
                "model": {
                    "model": "rerank-v2",
                    "pluginId": "plugin-2",
                    "provider": "provider-2",
                },
            },
            "scoreThreshold": {
                "enabled": True,
                "stage": "mode-final",
                "value": 0.6,
            },
            "topK": 6,
        },
    }


def test_setup_required_legacy_settings_with_revisions_use_the_migration_route() -> None:
    remote = ActiveSettingsRemote(
        active_profile_available=True,
        configuration_state="setup-required",
        rerank_enabled=False,
    )
    facade = KnowledgeFSDataFacade(
        broker=RecordingBroker(),
        remote=remote,
    )  # type: ignore[arg-type]

    result = facade.update_settings(
        tenant_id="tenant-1",
        account_id="account-1",
        control_space_id="control-1",
        payload=KnowledgeFSSettingsPayload(
            expected_revision=9,
            retrieval=KnowledgeFSProductRetrievalProfile(
                default_mode="fast",
                reasoning_model=KnowledgeFSProfileModelSelection(
                    model="reason-v1",
                    plugin_id="plugin-1",
                    provider="provider-1",
                ),
                rerank=KnowledgeFSProductRerankProfile(
                    enabled=True,
                    model=KnowledgeFSProfileModelSelection(
                        model="rerank-v1",
                        plugin_id="plugin-1",
                        provider="provider-1",
                    ),
                ),
                score_threshold=KnowledgeFSProductScoreThreshold(
                    enabled=False,
                    stage="rerank",
                    value=0.5,
                ),
                top_k=3,
            ),
        ),
    )

    assert result.settings.configuration_state == "setup-required"
    assert result.migration is not None
    assert [request.operation_id for request in remote.requests] == [
        "getSettings",
        "updateRetrievalProfile",
    ]


def test_failed_candidate_with_active_profiles_uses_the_migration_route() -> None:
    remote = ActiveSettingsRemote(
        active_profile_available=True,
        configuration_state="validation-failed",
    )
    facade = KnowledgeFSDataFacade(
        broker=RecordingBroker(),
        remote=remote,
    )  # type: ignore[arg-type]

    result = facade.update_settings(
        tenant_id="tenant-1",
        account_id="account-1",
        control_space_id="control-1",
        payload=KnowledgeFSSettingsPayload(
            embedding=KnowledgeFSProfileModelSelection(
                model="embed-v2",
                plugin_id="plugin-2",
                provider="provider-2",
            ),
            expected_revision=9,
        ),
    )

    assert result.settings.active_profile_available is True
    assert result.settings.embedding is not None
    assert result.settings.embedding.revision is None
    assert result.migration is not None
    assert [request.operation_id for request in remote.requests] == [
        "getSettings",
        "updateEmbeddingProfile",
    ]


def test_get_profile_migration_uses_the_durable_migration_route() -> None:
    remote = ActiveSettingsRemote()
    facade = KnowledgeFSDataFacade(
        broker=RecordingBroker(),
        remote=remote,
    )  # type: ignore[arg-type]

    result = facade.get_profile_migration(
        tenant_id="tenant-1",
        account_id="account-1",
        control_space_id="control-1",
        migration_id="migration-1",
    )

    assert result.run_state == "succeeded"
    assert remote.requests[0].path == ("/knowledge-spaces/space-1/profile-migrations/migration-1")


def test_active_settings_reject_concurrent_profile_migrations() -> None:
    remote = ActiveSettingsRemote()
    facade = KnowledgeFSDataFacade(
        broker=RecordingBroker(),
        remote=remote,
    )  # type: ignore[arg-type]

    with pytest.raises(KnowledgeFSProductRequestRejectedError) as error:
        facade.update_settings(
            tenant_id="tenant-1",
            account_id="account-1",
            control_space_id="control-1",
            payload=KnowledgeFSSettingsPayload(
                embedding=KnowledgeFSProfileModelSelection(
                    model="embed-v2",
                    plugin_id="plugin-2",
                    provider="provider-2",
                ),
                expected_revision=9,
                retrieval=KnowledgeFSProductRetrievalProfile(
                    default_mode="fast",
                    reasoning_model=KnowledgeFSProfileModelSelection(
                        model="reason-v2",
                        plugin_id="plugin-2",
                        provider="provider-2",
                    ),
                    rerank=KnowledgeFSProductRerankProfile(
                        enabled=True,
                        model=KnowledgeFSProfileModelSelection(
                            model="rerank-v2",
                            plugin_id="plugin-2",
                            provider="provider-2",
                        ),
                    ),
                    score_threshold=KnowledgeFSProductScoreThreshold(
                        enabled=False,
                        stage="rerank",
                        value=0.5,
                    ),
                    top_k=3,
                ),
            ),
        )

    assert error.value.status_code == 422
    assert [request.operation_id for request in remote.requests] == ["getSettings"]


def test_golden_question_facade_binds_direct_evidence_metadata() -> None:
    facade = KnowledgeFSDataFacade(broker=MagicMock(), remote=MagicMock())
    raw = {
        "createdAt": "2026-08-02T12:00:00Z",
        "expectedEvidenceIds": ["node-1"],
        "id": "golden-1",
        "metadata": {
            "annotation": "Reviewer note",
            "evidenceText": "Refunds are available for 30 days.",
            "matchPolicy": "all",
        },
        "question": "How long is the refund window?",
        "tags": ["billing"],
        "updatedAt": "2026-08-02T12:00:00Z",
    }
    interactive = MagicMock(return_value=raw)

    with patch.object(facade, "_interactive", interactive):
        result = facade.create_golden_question(
            tenant_id="tenant-1",
            account_id="account-1",
            control_space_id="control-1",
            payload=KnowledgeFSGoldenQuestionPayload(
                annotation=" Reviewer note ",
                evidence_text=" Refunds are available for 30 days. ",
                expected_evidence_ids=[" node-1 ", "node-1"],
                question=" How long is the refund window? ",
                tags=[" billing ", "billing"],
            ),
        )

    assert result.status == "active"
    assert result.expected_evidence_ids == ["node-1"]
    delegated = interactive.call_args.kwargs
    assert delegated["operation_id"] == "createGoldenQuestion"
    assert delegated["payload"].model_dump(mode="json", by_alias=True) == {
        "expectedEvidenceIds": ["node-1"],
        "metadata": {
            "annotation": "Reviewer note",
            "evidenceText": "Refunds are available for 30 days.",
            "matchPolicy": "all",
        },
        "question": "How long is the refund window?",
        "tags": ["billing"],
    }


def test_golden_question_update_preserves_evidence_when_new_fields_are_omitted() -> None:
    facade = KnowledgeFSDataFacade(broker=MagicMock(), remote=MagicMock())
    interactive_child = MagicMock(
        return_value={
            "createdAt": "2026-08-02T12:00:00Z",
            "expectedEvidenceIds": ["node-1"],
            "id": "golden-1",
            "metadata": {
                "annotation": "Updated note",
                "evidenceText": "Existing evidence",
                "lifecycleStatus": "active",
                "matchPolicy": "any",
            },
            "question": "Updated question?",
            "tags": [],
            "updatedAt": "2026-08-02T12:01:00Z",
        }
    )

    with patch.object(facade, "_interactive_child", interactive_child):
        result = facade.update_golden_question(
            tenant_id="tenant-1",
            account_id="account-1",
            control_space_id="control-1",
            question_id="golden-1",
            payload=KnowledgeFSGoldenQuestionPayload(
                annotation="Updated note",
                question="Updated question?",
            ),
        )

    assert result.expected_evidence_ids == ["node-1"]
    assert result.match_policy == "any"
    remote_payload = interactive_child.call_args.kwargs["payload"]
    assert remote_payload.model_dump(mode="json", by_alias=True, exclude_none=True) == {
        "metadata": {"annotation": "Updated note"},
        "question": "Updated question?",
        "tags": [],
    }


def test_golden_question_facade_matches_evidence_and_forwards_csv_as_one_batch() -> None:
    facade = KnowledgeFSDataFacade(broker=MagicMock(), remote=MagicMock())
    interactive = MagicMock(
        side_effect=[
            {
                "items": [
                    {
                        "candidates": [
                            {
                                "documentAssetId": "document-1",
                                "nodeId": "node-1",
                                "projectionId": "projection-1",
                                "score": 0.91,
                                "sectionPath": ["Refunds"],
                                "text": "Refunds are available for 30 days.",
                            }
                        ],
                        "evidenceText": "Refund policy",
                        "matched": True,
                    }
                ]
            },
            {
                "activeCount": 1,
                "draftCount": 0,
                "items": [
                    {
                        "expectedEvidenceId": "node-1",
                        "questionId": "golden-1",
                        "rowIndex": 0,
                        "similarity": 0.91,
                        "status": "active",
                    }
                ],
            },
        ]
    )

    with patch.object(facade, "_interactive", interactive):
        match = facade.match_golden_question_evidence(
            tenant_id="tenant-1",
            account_id="account-1",
            control_space_id="control-1",
            payload=KnowledgeFSGoldenQuestionEvidenceMatchPayload(evidence=" Refund policy "),
        )
        imported = facade.bulk_import_golden_questions(
            tenant_id="tenant-1",
            account_id="account-1",
            control_space_id="control-1",
            payload=KnowledgeFSGoldenQuestionBulkImportPayload(
                rows=[
                    KnowledgeFSGoldenQuestionBulkImportRowPayload(
                        evidence=" Refunds are available for 30 days. ",
                        question=" How long is the refund window? ",
                        tags=[" billing ", "billing"],
                    )
                ]
            ),
        )

    assert match.matched is True
    assert match.candidates[0].node_id == "node-1"
    assert imported.active_count == 1
    assert imported.items[0].question_id == "golden-1"
    assert [call.kwargs["operation_id"] for call in interactive.call_args_list] == [
        "matchGoldenQuestionEvidence",
        "bulkImportGoldenQuestions",
    ]
    assert interactive.call_args_list[0].kwargs["payload"].model_dump(mode="json", by_alias=True) == {
        "evidenceTexts": ["Refund policy"],
        "minimumSimilarity": 0.7,
        "topK": 5,
    }
    assert interactive.call_args_list[1].kwargs["payload"].model_dump(mode="json", by_alias=True) == {
        "matchPolicy": "all",
        "minimumSimilarity": 0.7,
        "rows": [
            {
                "evidence": "Refunds are available for 30 days.",
                "metadata": {
                    "evidenceText": "Refunds are available for 30 days.",
                    "importSource": "csv",
                },
                "question": "How long is the refund window?",
                "tags": ["billing"],
            }
        ],
    }


@pytest.mark.parametrize(
    "remote_response",
    [None, True, 1, 1.5, [], "invalid", {}, {"items": []}, {"items": [None]}],
)
def test_golden_question_evidence_match_rejects_malformed_remote_response(remote_response: object) -> None:
    facade = KnowledgeFSDataFacade(broker=MagicMock(), remote=MagicMock())

    with (
        patch.object(facade, "_interactive", return_value=remote_response),
        pytest.raises(KnowledgeFSProductRemoteError, match="invalid evidence match response"),
    ):
        facade.match_golden_question_evidence(
            tenant_id="tenant-1",
            account_id="account-1",
            control_space_id="control-1",
            payload=KnowledgeFSGoldenQuestionEvidenceMatchPayload(evidence="Refund policy"),
        )


def test_settings_dto_rejects_fast_threshold_without_rerank() -> None:
    with pytest.raises(ValueError, match="requires rerank"):
        KnowledgeFSProductRetrievalProfile(
            default_mode="fast",
            reasoning_model=KnowledgeFSProfileModelSelection(
                model="reason-v1",
                plugin_id="plugin-1",
                provider="provider-1",
            ),
            rerank=KnowledgeFSProductRerankProfile(enabled=False),
            score_threshold=KnowledgeFSProductScoreThreshold(
                enabled=True,
                stage="mode-final",
                value=0.5,
            ),
            top_k=3,
        )


def test_advanced_facade_binds_child_resources_parent_space_and_idempotency() -> None:
    remote = RecordingRemote()
    broker = RecordingBroker()
    facade = KnowledgeFSDataFacade(broker=broker, remote=remote)  # type: ignore[arg-type]

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


def test_logical_document_delete_preserves_initial_row_version() -> None:
    remote = RecordingRemote()
    facade = KnowledgeFSDataFacade(broker=RecordingBroker(), remote=remote)  # type: ignore[arg-type]

    deletion = facade.delete_logical_document(
        tenant_id="tenant-1",
        account_id="account-1",
        control_space_id="control-1",
        document_id="document-1",
        payload=KnowledgeFSLogicalDocumentDeletePayload(expected_revision=0),
        idempotency_key="delete-logical-once",
    )

    request = remote.requests[-1]
    assert deletion.job.target_type == "logical_document"
    assert request.operation_id == "deleteLogicalDocument"
    assert request.path == "/knowledge-spaces/space-1/logical-documents/document-1"
    assert request.payload == {"expectedRevision": 0}
    assert request.headers == (("Idempotency-Key", "delete-logical-once"),)


@pytest.mark.parametrize(
    ("method_name", "response_name", "operation_id", "specific_kwargs", "child_resource_id"),
    [
        ("get_overview_stats", "KnowledgeFSOverviewBaseStatsResponse", "getOverviewStats", {}, None),
        (
            "get_overview_query_outcomes",
            "KnowledgeFSOverviewQueryOutcomesResponse",
            "getOverviewQueryOutcomes",
            {"window": "7d"},
            None,
        ),
        ("get_overview_inventory", "KnowledgeFSOverviewInventoryResponse", "getOverviewInventory", {}, None),
        (
            "list_overview_attention",
            "KnowledgeFSOverviewAttentionListResponse",
            "listOverviewAttention",
            {"include_dismissed": False, "limit": 20},
            None,
        ),
        (
            "list_overview_activity",
            "KnowledgeFSOverviewActivityListResponse",
            "listOverviewActivity",
            {
                "action": None,
                "actor_id": None,
                "actor_type": None,
                "cursor": "cursor-1",
                "from_at": "2026-07-01T00:00:00Z",
                "limit": 20,
                "resource_type": None,
                "result": None,
                "to_at": None,
            },
            None,
        ),
        ("get_overview_health", "KnowledgeFSOverviewHealthResponse", "getOverviewHealth", {}, None),
        ("list_documents", "KnowledgeFSDocumentListResponse", "listDocuments", {"cursor": "cursor-1"}, None),
        (
            "list_logical_documents",
            "KnowledgeFSLogicalDocumentListResponse",
            "listLogicalDocuments",
            {"cursor": "cursor-1"},
            None,
        ),
        (
            "get_logical_document",
            "KnowledgeFSLogicalDocumentResponse",
            "getLogicalDocument",
            {"document_id": "document-1"},
            "document-1",
        ),
        (
            "delete_logical_document",
            "KnowledgeFSDurableDeletionAcceptedResponse",
            "deleteLogicalDocument",
            {
                "document_id": "document-1",
                "payload": MagicMock(),
                "idempotency_key": "delete-logical-document-once",
            },
            "document-1",
        ),
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
        (
            "list_background_tasks",
            "KnowledgeFSBackgroundTaskListResponse",
            "listBackgroundTasks",
            {"cursor": "cursor-1", "limit": 25},
            None,
        ),
        (
            "list_golden_questions",
            "KnowledgeFSGoldenQuestionListResponse",
            "listGoldenQuestions",
            {"cursor": "cursor-1", "limit": 25},
            None,
        ),
        (
            "list_bad_cases",
            "KnowledgeFSBadCaseListResponse",
            "listQualityBadCases",
            {"cursor": "cursor-1", "limit": 25},
            None,
        ),
        (
            "get_bad_case",
            "KnowledgeFSBadCaseResponse",
            "getQualityBadCase",
            {"bad_case_id": "bad-case-1"},
            "bad-case-1",
        ),
        (
            "create_quality_replay",
            "KnowledgeFSQualityReplayResponse",
            "createQualityReplay",
            {"payload": MagicMock(), "idempotency_key": "quality-replay-once"},
            None,
        ),
        (
            "cancel_background_task",
            "KnowledgeFSBackgroundTaskResponse",
            "cancelBackgroundTask",
            {"task_kind": "source", "task_id": "task-1"},
            "task-1",
        ),
        (
            "retry_background_task",
            "KnowledgeFSBackgroundTaskResponse",
            "retryBackgroundTask",
            {"task_kind": "document_bulk", "task_id": "task-1"},
            "task-1",
        ),
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
            "sync_source",
            "KnowledgeFSSourceWorkflowResponse",
            "syncSource",
            {"source_id": "source-1", "idempotency_key": "sync-source-once"},
            "source-1",
        ),
        (
            "list_source_providers",
            "KnowledgeFSSourceProviderListResponse",
            "listSourceProviders",
            {},
            None,
        ),
        (
            "create_source_connection",
            "KnowledgeFSSourceConnectionResponse",
            "createSourceConnection",
            {"payload": MagicMock()},
            None,
        ),
        (
            "list_source_connections",
            "KnowledgeFSSourceConnectionListResponse",
            "listSourceConnections",
            {"cursor": "cursor-1", "limit": 25},
            None,
        ),
        (
            "refresh_source_connection",
            "KnowledgeFSSourceConnectionResponse",
            "refreshSourceConnection",
            {"connection_id": "connection-1", "payload": MagicMock()},
            None,
        ),
        (
            "preview_source_crawl",
            "KnowledgeFSSourceWorkflowResponse",
            "previewSourceCrawl",
            {"source_id": "source-1", "idempotency_key": "preview-source-once"},
            "source-1",
        ),
        (
            "import_source_workflow",
            "KnowledgeFSSourceWorkflowResponse",
            "importSourceWorkflow",
            {
                "source_id": "source-1",
                "payload": MagicMock(),
                "idempotency_key": "import-source-once",
            },
            "source-1",
        ),
        (
            "get_source_sync_policy",
            "KnowledgeFSSourceSyncPolicyResponse",
            "getSourceSyncPolicy",
            {"source_id": "source-1"},
            "source-1",
        ),
        (
            "update_source_sync_policy",
            "KnowledgeFSSourceSyncPolicyResponse",
            "updateSourceSyncPolicy",
            {"source_id": "source-1", "payload": MagicMock()},
            "source-1",
        ),
        (
            "get_source_workflow",
            "KnowledgeFSSourceWorkflowResponse",
            "getSourceWorkflow",
            {"run_id": "run-1"},
            "run-1",
        ),
        (
            "cancel_source_workflow",
            "KnowledgeFSSourceWorkflowResponse",
            "cancelSourceWorkflow",
            {"run_id": "run-1", "payload": MagicMock()},
            "run-1",
        ),
        (
            "retry_source_workflow",
            "KnowledgeFSSourceWorkflowResponse",
            "retrySourceWorkflow",
            {"run_id": "run-1"},
            "run-1",
        ),
        (
            "list_crawl_preview_pages",
            "KnowledgeFSCrawlPreviewPageListResponse",
            "listCrawlPreviewPages",
            {"run_id": "run-1", "cursor": "cursor-1", "limit": 25},
            "run-1",
        ),
        (
            "select_crawl_preview_pages",
            "KnowledgeFSSourceWorkflowResponse",
            "selectCrawlPreviewPages",
            {"run_id": "run-1", "payload": MagicMock(), "idempotency_key": "selection-once"},
            "run-1",
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
    facade = KnowledgeFSDataFacade(broker=MagicMock(), remote=MagicMock())
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
    if operation_id == "listBackgroundTasks":
        assert delegated.call_args.kwargs["query"] == (("limit", "25"), ("cursor", "cursor-1"))
    if operation_id in {"listGoldenQuestions", "listQualityBadCases"}:
        assert delegated.call_args.kwargs["query"] == (("limit", "25"), ("cursor", "cursor-1"))
    if operation_id == "createQualityReplay":
        assert delegated.call_args.kwargs["headers"] == (("Idempotency-Key", "quality-replay-once"),)
    if operation_id == "getOverviewQueryOutcomes":
        assert delegated.call_args.kwargs["query"] == (("window", "7d"),)
    if operation_id == "cancelBackgroundTask":
        assert delegated.call_args.kwargs["path_parameters"] == (
            ("taskKind", "source"),
            ("taskId", "task-1"),
        )
    if operation_id == "retryBackgroundTask":
        assert delegated.call_args.kwargs["path_parameters"] == (
            ("taskKind", "document_bulk"),
            ("taskId", "task-1"),
        )
    if operation_id == "importSourceWorkflow":
        assert delegated.call_args.kwargs["path_parameters"] == (("sourceId", "source-1"),)
        assert delegated.call_args.kwargs["headers"] == (("Idempotency-Key", "import-source-once"),)
