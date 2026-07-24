"""Typed Dify BFF manifest and explicit gaps against the Capability v2 registry.

An operation is executable only when ``capability_operation_id`` resolves to an
exact method/path/action/resource entry in the P2 registry. Declared operations
without an executable transport remain explicit gaps and fail before token
issuance or external I/O.
"""

from __future__ import annotations

from enum import StrEnum
from types import MappingProxyType
from typing import Final, Literal, NamedTuple

from services.knowledge_fs_capability import KNOWLEDGE_FS_CAPABILITY_OPERATIONS


class KnowledgeFSProductPermission(StrEnum):
    READ = "knowledge_space_read"
    CREATE = "knowledge_space_create"
    EDIT = "knowledge_space_edit"
    DELETE = "knowledge_space_delete"
    ACCESS_CONFIG = "knowledge_space_access_config"
    API_KEY_MANAGE = "knowledge_space_api_key_manage"
    DOCUMENT_WRITE = "knowledge_space_document_write"
    QUERY = "knowledge_space_query"


class KnowledgeFSProductOperation(NamedTuple):
    method: Literal["DELETE", "GET", "PATCH", "POST", "PUT"]
    capability_operation_id: str | None
    permission: KnowledgeFSProductPermission
    kfs_path: str | None
    transport: Literal["binary", "direct", "json", "multipart", "sse", "unavailable"]
    resource_resolver: Literal[
        "document", "job", "knowledge_space", "namespace", "query", "research_task", "source", "upload_session"
    ]
    rbac_permission: KnowledgeFSProductPermission
    billing_cost: int
    max_request_bytes: int
    max_response_bytes: int
    stream_kind: Literal["buffered-multipart", "direct-upload", "json", "sse"]
    rate_limit_bucket: Literal["direct", "import", "job", "query", "read", "write"]
    rate_limit_cost: int

    @property
    def action(self) -> str | None:
        if self.capability_operation_id is None:
            return None
        capability = KNOWLEDGE_FS_CAPABILITY_OPERATIONS.get(self.capability_operation_id)
        return capability.action if capability is not None else None


def _operation(
    method: Literal["DELETE", "GET", "PATCH", "POST", "PUT"],
    capability_operation_id: str | None,
    permission: KnowledgeFSProductPermission,
    kfs_path: str | None,
    transport: Literal["binary", "direct", "json", "multipart", "sse", "unavailable"],
    *,
    resource_resolver: Literal[
        "document", "job", "knowledge_space", "namespace", "query", "research_task", "source", "upload_session"
    ],
    billing_cost: int,
    max_request_bytes: int,
    max_response_bytes: int,
    stream_kind: Literal["buffered-multipart", "direct-upload", "json", "sse"],
    rate_limit_bucket: Literal["direct", "import", "job", "query", "read", "write"] | None = None,
    rate_limit_cost: int | None = None,
) -> KnowledgeFSProductOperation:
    resolved_rate_limit_bucket = rate_limit_bucket or _default_rate_limit_bucket(
        method=method,
        permission=permission,
        resource_resolver=resource_resolver,
        stream_kind=stream_kind,
    )
    return KnowledgeFSProductOperation(
        method=method,
        capability_operation_id=capability_operation_id,
        permission=permission,
        kfs_path=kfs_path,
        transport=transport,
        resource_resolver=resource_resolver,
        rbac_permission=permission,
        billing_cost=billing_cost,
        max_request_bytes=max_request_bytes,
        max_response_bytes=max_response_bytes,
        stream_kind=stream_kind,
        rate_limit_bucket=resolved_rate_limit_bucket,
        rate_limit_cost=rate_limit_cost if rate_limit_cost is not None else billing_cost,
    )


def _default_rate_limit_bucket(
    *,
    method: Literal["DELETE", "GET", "PATCH", "POST", "PUT"],
    permission: KnowledgeFSProductPermission,
    resource_resolver: Literal[
        "document", "job", "knowledge_space", "namespace", "query", "research_task", "source", "upload_session"
    ],
    stream_kind: Literal["buffered-multipart", "direct-upload", "json", "sse"],
) -> Literal["direct", "import", "job", "query", "read", "write"]:
    if stream_kind in {"direct-upload", "sse"}:
        return "direct"
    if permission == KnowledgeFSProductPermission.QUERY:
        return "query"
    if resource_resolver == "job":
        return "job"
    if method == "GET":
        return "read"
    return "write"


KNOWLEDGE_FS_PRODUCT_OPERATIONS: Final[MappingProxyType[str, KnowledgeFSProductOperation]] = MappingProxyType(
    {
        "batchSpaceSummaries": _operation(
            "POST",
            "batchKnowledgeSpaceProductSummaries",
            KnowledgeFSProductPermission.READ,
            "/internal/knowledge-spaces/product-summaries/batch",
            "json",
            resource_resolver="namespace",
            billing_cost=2,
            max_request_bytes=64 * 1024,
            max_response_bytes=1024 * 1024,
            stream_kind="json",
        ),
        "getSpace": _operation(
            "GET",
            "getKnowledgeSpace",
            KnowledgeFSProductPermission.READ,
            "/knowledge-spaces/{id}",
            "json",
            resource_resolver="knowledge_space",
            billing_cost=1,
            max_request_bytes=0,
            max_response_bytes=256 * 1024,
            stream_kind="json",
        ),
        "updateSpace": _operation(
            "PATCH",
            "updateKnowledgeSpace",
            KnowledgeFSProductPermission.EDIT,
            "/knowledge-spaces/{id}",
            "json",
            resource_resolver="knowledge_space",
            billing_cost=3,
            max_request_bytes=32 * 1024,
            max_response_bytes=256 * 1024,
            stream_kind="json",
        ),
        "getSettings": _operation(
            "GET",
            "getKnowledgeSpaceProductSettings",
            KnowledgeFSProductPermission.READ,
            "/knowledge-spaces/{id}/product-settings",
            "json",
            resource_resolver="knowledge_space",
            billing_cost=1,
            max_request_bytes=0,
            max_response_bytes=256 * 1024,
            stream_kind="json",
        ),
        "getOverviewStats": _operation(
            "GET",
            "getKnowledgeSpaceOverviewStats",
            KnowledgeFSProductPermission.READ,
            "/knowledge-spaces/{id}/overview/stats",
            "json",
            resource_resolver="knowledge_space",
            billing_cost=2,
            max_request_bytes=16 * 1024,
            max_response_bytes=256 * 1024,
            stream_kind="json",
        ),
        "getOverviewQueryOutcomes": _operation(
            "GET",
            "getKnowledgeSpaceOverviewQueryOutcomes",
            KnowledgeFSProductPermission.READ,
            "/knowledge-spaces/{id}/overview/query-outcomes",
            "json",
            resource_resolver="knowledge_space",
            billing_cost=3,
            max_request_bytes=16 * 1024,
            max_response_bytes=512 * 1024,
            stream_kind="json",
        ),
        "getOverviewInventory": _operation(
            "GET",
            "getKnowledgeSpaceOverviewInventory",
            KnowledgeFSProductPermission.READ,
            "/knowledge-spaces/{id}/overview/inventory",
            "json",
            resource_resolver="knowledge_space",
            billing_cost=3,
            max_request_bytes=0,
            max_response_bytes=256 * 1024,
            stream_kind="json",
        ),
        "getOverviewHealth": _operation(
            "GET",
            "getKnowledgeSpaceProductHealth",
            KnowledgeFSProductPermission.READ,
            "/knowledge-spaces/{id}/overview/health",
            "json",
            resource_resolver="knowledge_space",
            billing_cost=2,
            max_request_bytes=0,
            max_response_bytes=256 * 1024,
            stream_kind="json",
        ),
        "updateSettings": _operation(
            "PATCH",
            "updateKnowledgeSpaceProductSettings",
            KnowledgeFSProductPermission.EDIT,
            "/knowledge-spaces/{id}/product-settings",
            "json",
            resource_resolver="knowledge_space",
            billing_cost=5,
            max_request_bytes=64 * 1024,
            max_response_bytes=256 * 1024,
            stream_kind="json",
        ),
        "listDocuments": _operation(
            "GET",
            "listDocuments",
            KnowledgeFSProductPermission.READ,
            "/knowledge-spaces/{id}/documents",
            "json",
            resource_resolver="knowledge_space",
            billing_cost=2,
            max_request_bytes=16 * 1024,
            max_response_bytes=2 * 1024 * 1024,
            stream_kind="json",
        ),
        "createDocument": _operation(
            "POST",
            "uploadDocument",
            KnowledgeFSProductPermission.DOCUMENT_WRITE,
            "/knowledge-spaces/{id}/documents",
            "multipart",
            resource_resolver="knowledge_space",
            billing_cost=10,
            max_request_bytes=0,
            max_response_bytes=0,
            stream_kind="buffered-multipart",
        ),
        "getDocument": _operation(
            "GET",
            "getDocument",
            KnowledgeFSProductPermission.READ,
            "/knowledge-spaces/{id}/documents/{documentId}",
            "json",
            resource_resolver="document",
            billing_cost=2,
            max_request_bytes=0,
            max_response_bytes=512 * 1024,
            stream_kind="json",
        ),
        "getDocumentOutline": _operation(
            "GET",
            "getDocumentOutline",
            KnowledgeFSProductPermission.READ,
            "/knowledge-spaces/{id}/documents/{documentId}/outline",
            "json",
            resource_resolver="document",
            billing_cost=3,
            max_request_bytes=0,
            max_response_bytes=4 * 1024 * 1024,
            stream_kind="json",
        ),
        "listDocumentRevisions": _operation(
            "GET",
            "listDocumentRevisions",
            KnowledgeFSProductPermission.READ,
            "/knowledge-spaces/{id}/documents/{documentId}/revisions",
            "json",
            resource_resolver="document",
            billing_cost=2,
            max_request_bytes=16 * 1024,
            max_response_bytes=2 * 1024 * 1024,
            stream_kind="json",
        ),
        "updateDocumentMetadata": _operation(
            "PATCH",
            "patchDocumentMetadata",
            KnowledgeFSProductPermission.DOCUMENT_WRITE,
            "/knowledge-spaces/{id}/documents/{documentId}/metadata",
            "json",
            resource_resolver="document",
            billing_cost=4,
            max_request_bytes=128 * 1024,
            max_response_bytes=512 * 1024,
            stream_kind="json",
        ),
        "listDocumentChunks": _operation(
            "GET",
            "listDocumentChunks",
            KnowledgeFSProductPermission.READ,
            "/knowledge-spaces/{id}/documents/{documentId}/revisions/{revision}/chunks",
            "json",
            resource_resolver="document",
            billing_cost=3,
            max_request_bytes=16 * 1024,
            max_response_bytes=4 * 1024 * 1024,
            stream_kind="json",
        ),
        "getDocumentChunk": _operation(
            "GET",
            "getDocumentChunk",
            KnowledgeFSProductPermission.READ,
            "/knowledge-spaces/{id}/documents/{documentId}/revisions/{revision}/chunks/{chunkId}",
            "json",
            resource_resolver="document",
            billing_cost=2,
            max_request_bytes=0,
            max_response_bytes=1024 * 1024,
            stream_kind="json",
        ),
        "deleteDocument": _operation(
            "DELETE",
            "requestDocumentDeletion",
            KnowledgeFSProductPermission.DOCUMENT_WRITE,
            "/knowledge-spaces/{id}/documents/{documentId}",
            "json",
            resource_resolver="document",
            billing_cost=8,
            max_request_bytes=32 * 1024,
            max_response_bytes=512 * 1024,
            stream_kind="json",
        ),
        "bulkDeleteDocuments": _operation(
            "DELETE",
            "requestBulkDocumentDeletion",
            KnowledgeFSProductPermission.DOCUMENT_WRITE,
            "/knowledge-spaces/{id}/documents/bulk",
            "json",
            resource_resolver="knowledge_space",
            billing_cost=20,
            max_request_bytes=1024 * 1024,
            max_response_bytes=4 * 1024 * 1024,
            stream_kind="json",
        ),
        "reindexDocuments": _operation(
            "POST",
            "bulkReindexDocuments",
            KnowledgeFSProductPermission.DOCUMENT_WRITE,
            "/knowledge-spaces/{id}/documents/bulk/reindex",
            "json",
            resource_resolver="knowledge_space",
            billing_cost=20,
            max_request_bytes=1024 * 1024,
            max_response_bytes=4 * 1024 * 1024,
            stream_kind="json",
            rate_limit_bucket="import",
        ),
        "getCompilationJob": _operation(
            "GET",
            "getDocumentCompilationJob",
            KnowledgeFSProductPermission.READ,
            "/jobs/{id}",
            "json",
            resource_resolver="job",
            billing_cost=1,
            max_request_bytes=16 * 1024,
            max_response_bytes=512 * 1024,
            stream_kind="json",
        ),
        "cancelCompilationJob": _operation(
            "DELETE",
            "cancelDocumentCompilationJob",
            KnowledgeFSProductPermission.DOCUMENT_WRITE,
            "/jobs/{id}",
            "json",
            resource_resolver="job",
            billing_cost=5,
            max_request_bytes=16 * 1024,
            max_response_bytes=512 * 1024,
            stream_kind="json",
        ),
        "retryCompilationJob": _operation(
            "POST",
            "retryDocumentCompilationJob",
            KnowledgeFSProductPermission.DOCUMENT_WRITE,
            "/jobs/{id}/retry",
            "json",
            resource_resolver="job",
            billing_cost=8,
            max_request_bytes=16 * 1024,
            max_response_bytes=512 * 1024,
            stream_kind="json",
        ),
        "getBulkJob": _operation(
            "GET",
            "getBulkOperation",
            KnowledgeFSProductPermission.READ,
            "/bulk-jobs/{id}",
            "json",
            resource_resolver="job",
            billing_cost=1,
            max_request_bytes=16 * 1024,
            max_response_bytes=2 * 1024 * 1024,
            stream_kind="json",
        ),
        "listBackgroundTasks": _operation(
            "GET",
            "listBackgroundTasks",
            KnowledgeFSProductPermission.READ,
            "/knowledge-spaces/{id}/background-tasks",
            "json",
            resource_resolver="knowledge_space",
            billing_cost=2,
            max_request_bytes=16 * 1024,
            max_response_bytes=4 * 1024 * 1024,
            stream_kind="json",
        ),
        "cancelBackgroundTask": _operation(
            "POST",
            "cancelBackgroundTask",
            KnowledgeFSProductPermission.DOCUMENT_WRITE,
            "/knowledge-spaces/{id}/background-tasks/{taskKind}/{taskId}/cancel",
            "json",
            resource_resolver="job",
            billing_cost=5,
            max_request_bytes=16 * 1024,
            max_response_bytes=512 * 1024,
            stream_kind="json",
        ),
        "retryBackgroundTask": _operation(
            "POST",
            "retryBackgroundTask",
            KnowledgeFSProductPermission.DOCUMENT_WRITE,
            "/knowledge-spaces/{id}/background-tasks/{taskKind}/{taskId}/retry",
            "json",
            resource_resolver="job",
            billing_cost=8,
            max_request_bytes=16 * 1024,
            max_response_bytes=512 * 1024,
            stream_kind="json",
        ),
        "listSources": _operation(
            "GET",
            "listKnowledgeSpaceSources",
            KnowledgeFSProductPermission.READ,
            "/knowledge-spaces/{id}/sources",
            "json",
            resource_resolver="knowledge_space",
            billing_cost=2,
            max_request_bytes=16 * 1024,
            max_response_bytes=2 * 1024 * 1024,
            stream_kind="json",
        ),
        "createSource": _operation(
            "POST",
            "createKnowledgeSpaceSource",
            KnowledgeFSProductPermission.DOCUMENT_WRITE,
            "/knowledge-spaces/{id}/sources",
            "json",
            resource_resolver="knowledge_space",
            billing_cost=8,
            max_request_bytes=256 * 1024,
            max_response_bytes=512 * 1024,
            stream_kind="json",
        ),
        "getSource": _operation(
            "GET",
            "getKnowledgeSpaceSource",
            KnowledgeFSProductPermission.READ,
            "/knowledge-spaces/{id}/sources/{sourceId}",
            "json",
            resource_resolver="source",
            billing_cost=1,
            max_request_bytes=0,
            max_response_bytes=512 * 1024,
            stream_kind="json",
        ),
        "updateSource": _operation(
            "PATCH",
            "updateKnowledgeSpaceSource",
            KnowledgeFSProductPermission.DOCUMENT_WRITE,
            "/knowledge-spaces/{id}/sources/{sourceId}",
            "json",
            resource_resolver="source",
            billing_cost=4,
            max_request_bytes=256 * 1024,
            max_response_bytes=512 * 1024,
            stream_kind="json",
        ),
        "deleteSource": _operation(
            "DELETE",
            "requestSourceDeletion",
            KnowledgeFSProductPermission.DOCUMENT_WRITE,
            "/knowledge-spaces/{id}/sources/{sourceId}",
            "json",
            resource_resolver="source",
            billing_cost=8,
            max_request_bytes=32 * 1024,
            max_response_bytes=512 * 1024,
            stream_kind="json",
        ),
        "testSource": _operation(
            "POST",
            "testKnowledgeSpaceSource",
            KnowledgeFSProductPermission.DOCUMENT_WRITE,
            "/knowledge-spaces/{id}/sources/{sourceId}/test",
            "json",
            resource_resolver="source",
            billing_cost=3,
            max_request_bytes=0,
            max_response_bytes=256 * 1024,
            stream_kind="json",
        ),
        "crawlSource": _operation(
            "POST",
            "crawlKnowledgeSpaceSource",
            KnowledgeFSProductPermission.DOCUMENT_WRITE,
            "/knowledge-spaces/{id}/sources/{sourceId}/crawl",
            "json",
            resource_resolver="source",
            billing_cost=20,
            max_request_bytes=0,
            max_response_bytes=8 * 1024 * 1024,
            stream_kind="json",
            rate_limit_bucket="import",
        ),
        "listSourcePages": _operation(
            "GET",
            "listKnowledgeSpaceSourcePages",
            KnowledgeFSProductPermission.READ,
            "/knowledge-spaces/{id}/sources/{sourceId}/pages",
            "json",
            resource_resolver="source",
            billing_cost=3,
            max_request_bytes=16 * 1024,
            max_response_bytes=4 * 1024 * 1024,
            stream_kind="json",
        ),
        "importSourcePages": _operation(
            "POST",
            "importKnowledgeSpaceSourcePages",
            KnowledgeFSProductPermission.DOCUMENT_WRITE,
            "/knowledge-spaces/{id}/sources/{sourceId}/import",
            "json",
            resource_resolver="source",
            billing_cost=25,
            max_request_bytes=1024 * 1024,
            max_response_bytes=4 * 1024 * 1024,
            stream_kind="json",
            rate_limit_bucket="import",
        ),
        "listSourceFiles": _operation(
            "GET",
            "listKnowledgeSpaceSourceFiles",
            KnowledgeFSProductPermission.READ,
            "/knowledge-spaces/{id}/sources/{sourceId}/files",
            "json",
            resource_resolver="source",
            billing_cost=3,
            max_request_bytes=32 * 1024,
            max_response_bytes=4 * 1024 * 1024,
            stream_kind="json",
        ),
        "importSourceFiles": _operation(
            "POST",
            "importKnowledgeSpaceSourceFiles",
            KnowledgeFSProductPermission.DOCUMENT_WRITE,
            "/knowledge-spaces/{id}/sources/{sourceId}/import-files",
            "json",
            resource_resolver="source",
            billing_cost=25,
            max_request_bytes=1024 * 1024,
            max_response_bytes=4 * 1024 * 1024,
            stream_kind="json",
            rate_limit_bucket="import",
        ),
        "createQuery": _operation(
            "POST",
            "createQuery",
            KnowledgeFSProductPermission.QUERY,
            "/queries",
            "direct",
            resource_resolver="knowledge_space",
            billing_cost=20,
            max_request_bytes=64 * 1024,
            max_response_bytes=0,
            stream_kind="sse",
        ),
        "listResearchTasks": _operation(
            "GET",
            "listKnowledgeSpaceResearchTasks",
            KnowledgeFSProductPermission.READ,
            "/knowledge-spaces/{id}/research-tasks",
            "json",
            resource_resolver="knowledge_space",
            billing_cost=2,
            max_request_bytes=16 * 1024,
            max_response_bytes=2 * 1024 * 1024,
            stream_kind="json",
        ),
        "createResearchTask": _operation(
            "POST",
            "createResearchTask",
            KnowledgeFSProductPermission.QUERY,
            "/research-tasks",
            "json",
            resource_resolver="knowledge_space",
            billing_cost=25,
            max_request_bytes=64 * 1024,
            max_response_bytes=512 * 1024,
            stream_kind="json",
        ),
        "planResearchTask": _operation(
            "POST",
            "planResearchTask",
            KnowledgeFSProductPermission.QUERY,
            "/research-tasks/plan",
            "json",
            resource_resolver="knowledge_space",
            billing_cost=8,
            max_request_bytes=64 * 1024,
            max_response_bytes=512 * 1024,
            stream_kind="json",
        ),
        "getResearchTask": _operation(
            "GET",
            "getResearchTask",
            KnowledgeFSProductPermission.QUERY,
            "/research-tasks/{id}",
            "json",
            resource_resolver="research_task",
            billing_cost=1,
            max_request_bytes=16 * 1024,
            max_response_bytes=512 * 1024,
            stream_kind="json",
        ),
        "listResearchTaskPartials": _operation(
            "GET",
            "listResearchTaskPartials",
            KnowledgeFSProductPermission.QUERY,
            "/research-tasks/{id}/partials",
            "json",
            resource_resolver="research_task",
            billing_cost=3,
            max_request_bytes=16 * 1024,
            max_response_bytes=8 * 1024 * 1024,
            stream_kind="json",
        ),
        "cancelResearchTask": _operation(
            "DELETE",
            "cancelResearchTask",
            KnowledgeFSProductPermission.QUERY,
            "/research-tasks/{id}",
            "json",
            resource_resolver="research_task",
            billing_cost=5,
            max_request_bytes=16 * 1024,
            max_response_bytes=512 * 1024,
            stream_kind="json",
        ),
        "listTraces": _operation(
            "GET",
            "listKnowledgeSpaceQualityTraces",
            KnowledgeFSProductPermission.READ,
            "/knowledge-spaces/{id}/quality/traces",
            "json",
            resource_resolver="knowledge_space",
            billing_cost=3,
            max_request_bytes=16 * 1024,
            max_response_bytes=4 * 1024 * 1024,
            stream_kind="json",
        ),
        "getTrace": _operation(
            "GET",
            "getAnswerTrace",
            KnowledgeFSProductPermission.QUERY,
            "/queries/{traceId}",
            "json",
            resource_resolver="query",
            billing_cost=2,
            max_request_bytes=16 * 1024,
            max_response_bytes=2 * 1024 * 1024,
            stream_kind="json",
        ),
        "listTraceEvidence": _operation(
            "GET",
            "listQueryEvidence",
            KnowledgeFSProductPermission.QUERY,
            "/queries/{traceId}/evidence",
            "json",
            resource_resolver="query",
            billing_cost=3,
            max_request_bytes=16 * 1024,
            max_response_bytes=4 * 1024 * 1024,
            stream_kind="json",
        ),
        "listTraceConflicts": _operation(
            "GET",
            "listQueryConflicts",
            KnowledgeFSProductPermission.QUERY,
            "/queries/{traceId}/conflicts",
            "json",
            resource_resolver="query",
            billing_cost=3,
            max_request_bytes=16 * 1024,
            max_response_bytes=4 * 1024 * 1024,
            stream_kind="json",
        ),
        "listTraceMissing": _operation(
            "GET",
            "listQueryMissing",
            KnowledgeFSProductPermission.QUERY,
            "/queries/{traceId}/missing",
            "json",
            resource_resolver="query",
            billing_cost=3,
            max_request_bytes=16 * 1024,
            max_response_bytes=4 * 1024 * 1024,
            stream_kind="json",
        ),
        "createUploadSession": _operation(
            "POST",
            "createUploadSession",
            KnowledgeFSProductPermission.DOCUMENT_WRITE,
            "/knowledge-spaces/{id}/upload-sessions",
            "direct",
            resource_resolver="knowledge_space",
            billing_cost=5,
            max_request_bytes=64 * 1024,
            max_response_bytes=64 * 1024,
            stream_kind="direct-upload",
        ),
        "presignUploadSessionPart": _operation(
            "POST",
            "presignUploadSessionPart",
            KnowledgeFSProductPermission.DOCUMENT_WRITE,
            "/upload-sessions/{id}/parts/{partNumber}/presign",
            "direct",
            resource_resolver="upload_session",
            billing_cost=1,
            max_request_bytes=32 * 1024,
            max_response_bytes=64 * 1024,
            stream_kind="direct-upload",
        ),
        "uploadSmallFile": _operation(
            "POST",
            "uploadSmallFile",
            KnowledgeFSProductPermission.DOCUMENT_WRITE,
            "/upload-sessions/{id}/small-file",
            "binary",
            resource_resolver="upload_session",
            billing_cost=8,
            max_request_bytes=8 * 1024 * 1024,
            max_response_bytes=128 * 1024,
            stream_kind="json",
        ),
        "completeUploadSession": _operation(
            "POST",
            "completeUploadSession",
            KnowledgeFSProductPermission.DOCUMENT_WRITE,
            "/upload-sessions/{id}/complete",
            "direct",
            resource_resolver="upload_session",
            billing_cost=8,
            max_request_bytes=128 * 1024,
            max_response_bytes=128 * 1024,
            stream_kind="direct-upload",
        ),
        "abortUploadSession": _operation(
            "POST",
            "abortUploadSession",
            KnowledgeFSProductPermission.DOCUMENT_WRITE,
            "/upload-sessions/{id}/abort",
            "direct",
            resource_resolver="upload_session",
            billing_cost=1,
            max_request_bytes=32 * 1024,
            max_response_bytes=64 * 1024,
            stream_kind="direct-upload",
        ),
        "streamResearchTask": _operation(
            "GET",
            "streamResearchTaskProgress",
            KnowledgeFSProductPermission.READ,
            "/research-tasks/{id}/events",
            "direct",
            resource_resolver="research_task",
            billing_cost=5,
            max_request_bytes=0,
            max_response_bytes=0,
            stream_kind="sse",
        ),
    }
)


def is_product_operation_registered(operation_id: str) -> bool:
    operation = KNOWLEDGE_FS_PRODUCT_OPERATIONS.get(operation_id)
    if operation is None or operation.capability_operation_id is None or operation.kfs_path is None:
        return False
    capability = KNOWLEDGE_FS_CAPABILITY_OPERATIONS.get(operation.capability_operation_id)
    return bool(
        capability
        and capability.method == operation.method
        and capability.path == operation.kfs_path
        and capability.action
        and capability.resource_type == operation.resource_resolver
        and operation.permission == operation.rbac_permission
    )


def is_product_operation_ready(operation_id: str) -> bool:
    operation = KNOWLEDGE_FS_PRODUCT_OPERATIONS.get(operation_id)
    return bool(
        operation
        and operation.transport in {"binary", "direct", "json"}
        and is_product_operation_registered(operation_id)
    )


def knowledge_fs_product_operation_gaps() -> tuple[str, ...]:
    return tuple(
        operation_id for operation_id in KNOWLEDGE_FS_PRODUCT_OPERATIONS if not is_product_operation_ready(operation_id)
    )


def product_operation_action(operation_id: str) -> str:
    if not is_product_operation_ready(operation_id):
        raise KeyError(operation_id)
    capability_operation_id = KNOWLEDGE_FS_PRODUCT_OPERATIONS[operation_id].capability_operation_id
    if capability_operation_id is None:
        raise KeyError(operation_id)
    return KNOWLEDGE_FS_CAPABILITY_OPERATIONS[capability_operation_id].action


__all__ = [
    "KNOWLEDGE_FS_PRODUCT_OPERATIONS",
    "KnowledgeFSProductOperation",
    "KnowledgeFSProductPermission",
    "is_product_operation_ready",
    "is_product_operation_registered",
    "knowledge_fs_product_operation_gaps",
    "product_operation_action",
]
