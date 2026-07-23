"""Product-facing KnowledgeFS operation and authorization declarations.

This registry is Dify's explicit Console surface. Transport concerns live in
knowledge_fs_proxy so contract review does not require reading proxy mechanics.
"""

from __future__ import annotations

from typing import Final, Literal, NamedTuple

from core.rbac import RBACPermission

type KnowledgeFSMethod = Literal["DELETE", "GET", "PATCH", "POST", "PUT"]
type KnowledgeFSResponseKind = Literal["binary", "buffered", "stream"]
type KnowledgeFSRequiredScope = Literal["knowledge-spaces:read", "knowledge-spaces:write"]
type KnowledgeFSLegacyRole = Literal["reader", "dataset_editor", "admin"]
type KnowledgeFSErrorStatusMap = tuple[tuple[int, int], ...]


class KnowledgeFSOperation(NamedTuple):
    operation_id: str
    method: KnowledgeFSMethod
    path: str
    response_kind: KnowledgeFSResponseKind
    required_scope: KnowledgeFSRequiredScope
    rbac_permission: RBACPermission
    legacy_role: KnowledgeFSLegacyRole
    max_response_bytes: int
    request_headers: tuple[str, ...]
    response_headers: tuple[str, ...]
    response_media_types: tuple[str, ...]
    error_status_map: KnowledgeFSErrorStatusMap


def _console_operation(
    operation_id: str,
    method: KnowledgeFSMethod,
    path: str,
    *,
    rbac_permission: RBACPermission,
    legacy_role: KnowledgeFSLegacyRole,
    max_response_bytes: int = 1_048_576,
    request_headers: tuple[str, ...] = ("x-trace-id",),
    response_kind: KnowledgeFSResponseKind = "buffered",
    response_media_types: tuple[str, ...] = ("application/json",),
    error_status_map: KnowledgeFSErrorStatusMap = ((401, 502), (403, 403)),
) -> KnowledgeFSOperation:
    """Declare one contract-pinned operation with an explicit Dify authorization policy."""
    is_read = method == "GET"
    return KnowledgeFSOperation(
        operation_id=operation_id,
        method=method,
        path=path,
        response_kind=response_kind,
        required_scope="knowledge-spaces:read" if is_read else "knowledge-spaces:write",
        rbac_permission=rbac_permission,
        legacy_role=legacy_role,
        max_response_bytes=max_response_bytes,
        request_headers=request_headers,
        response_headers=("x-trace-id",),
        response_media_types=response_media_types,
        error_status_map=error_status_map,
    )


def _dataset_read_operation(operation_id: str, path: str) -> KnowledgeFSOperation:
    """Declare a dataset-readable buffered JSON operation."""
    return _console_operation(
        operation_id,
        "GET",
        path,
        rbac_permission=RBACPermission.DATASET_READONLY,
        legacy_role="reader",
    )


def _dataset_edit_operation(
    operation_id: str,
    method: KnowledgeFSMethod,
    path: str,
    *,
    request_headers: tuple[str, ...] = ("x-trace-id",),
) -> KnowledgeFSOperation:
    """Declare a dataset-editable buffered JSON operation."""
    return _console_operation(
        operation_id,
        method,
        path,
        rbac_permission=RBACPermission.DATASET_EDIT,
        legacy_role="dataset_editor",
        request_headers=request_headers,
    )


def _external_source_operation(
    operation_id: str,
    method: KnowledgeFSMethod,
    path: str,
    *,
    request_headers: tuple[str, ...] = ("x-trace-id",),
) -> KnowledgeFSOperation:
    """Declare a source-connection operation restricted to dataset editors."""
    return _console_operation(
        operation_id,
        method,
        path,
        rbac_permission=RBACPermission.DATASET_EXTERNAL_CONNECT,
        legacy_role="dataset_editor",
        request_headers=request_headers,
    )


KNOWLEDGE_FS_CONSOLE_OPERATIONS: Final[tuple[KnowledgeFSOperation, ...]] = (
    _console_operation(
        operation_id="listKnowledgeSpaces",
        method="GET",
        path="knowledge-spaces",
        rbac_permission=RBACPermission.DATASET_READONLY,
        legacy_role="reader",
    ),
    _console_operation(
        operation_id="createKnowledgeSpace",
        method="POST",
        path="knowledge-spaces",
        rbac_permission=RBACPermission.DATASET_CREATE_AND_MANAGEMENT,
        legacy_role="dataset_editor",
    ),
    _console_operation(
        operation_id="getKnowledgeSpacesById",
        method="GET",
        path="knowledge-spaces/{id}",
        rbac_permission=RBACPermission.DATASET_READONLY,
        legacy_role="reader",
    ),
    _dataset_edit_operation("patchKnowledgeSpacesById", "PATCH", "knowledge-spaces/{id}"),
    _dataset_edit_operation(
        "deleteKnowledgeSpacesById",
        "DELETE",
        "knowledge-spaces/{id}",
        request_headers=("idempotency-key", "x-trace-id"),
    ),
    _dataset_read_operation("getKnowledgeSpacesByIdStats", "knowledge-spaces/{id}/stats"),
    _console_operation(
        operation_id="getKnowledgeSpacesByIdAccessPolicy",
        method="GET",
        path="knowledge-spaces/{id}/access-policy",
        rbac_permission=RBACPermission.DATASET_READONLY,
        legacy_role="reader",
    ),
    _console_operation(
        operation_id="patchKnowledgeSpacesByIdAccessPolicy",
        method="PATCH",
        path="knowledge-spaces/{id}/access-policy",
        rbac_permission=RBACPermission.DATASET_ACCESS_CONFIG,
        legacy_role="admin",
    ),
    _console_operation(
        operation_id="getSourceProviders",
        method="GET",
        path="source-providers",
        rbac_permission=RBACPermission.DATASET_EXTERNAL_CONNECT,
        legacy_role="dataset_editor",
    ),
    _console_operation(
        operation_id="getKnowledgeSpacesByIdSourceConnections",
        method="GET",
        path="knowledge-spaces/{id}/source-connections",
        rbac_permission=RBACPermission.DATASET_EXTERNAL_CONNECT,
        legacy_role="dataset_editor",
    ),
    _console_operation(
        operation_id="postKnowledgeSpacesByIdSourceConnections",
        method="POST",
        path="knowledge-spaces/{id}/source-connections",
        rbac_permission=RBACPermission.DATASET_EXTERNAL_CONNECT,
        legacy_role="dataset_editor",
    ),
    _external_source_operation(
        "postKnowledgeSpacesByIdSourceConnectionsOauth",
        "POST",
        "knowledge-spaces/{id}/source-connections/oauth",
    ),
    _external_source_operation("postSourceOauthCallback", "POST", "source-oauth/callback"),
    _external_source_operation(
        "getKnowledgeSpacesByIdSourceConnectionsByConnectionId",
        "GET",
        "knowledge-spaces/{id}/source-connections/{connectionId}",
    ),
    _external_source_operation(
        "deleteKnowledgeSpacesByIdSourceConnectionsByConnectionId",
        "DELETE",
        "knowledge-spaces/{id}/source-connections/{connectionId}",
    ),
    _console_operation(
        operation_id="postKnowledgeSpacesByIdSourceConnectionsByConnectionIdRefresh",
        method="POST",
        path="knowledge-spaces/{id}/source-connections/{connectionId}/refresh",
        rbac_permission=RBACPermission.DATASET_EXTERNAL_CONNECT,
        legacy_role="dataset_editor",
    ),
    _console_operation(
        operation_id="getKnowledgeSpacesByIdSources",
        method="GET",
        path="knowledge-spaces/{id}/sources",
        rbac_permission=RBACPermission.DATASET_READONLY,
        legacy_role="reader",
    ),
    _console_operation(
        operation_id="postKnowledgeSpacesByIdSources",
        method="POST",
        path="knowledge-spaces/{id}/sources",
        rbac_permission=RBACPermission.DATASET_EXTERNAL_CONNECT,
        legacy_role="dataset_editor",
    ),
    _external_source_operation(
        "getKnowledgeSpacesByIdSourcesBySourceId",
        "GET",
        "knowledge-spaces/{id}/sources/{sourceId}",
    ),
    _external_source_operation(
        "patchKnowledgeSpacesByIdSourcesBySourceId",
        "PATCH",
        "knowledge-spaces/{id}/sources/{sourceId}",
    ),
    _external_source_operation(
        "deleteKnowledgeSpacesByIdSourcesBySourceId",
        "DELETE",
        "knowledge-spaces/{id}/sources/{sourceId}",
        request_headers=("idempotency-key", "x-trace-id"),
    ),
    _external_source_operation(
        "putKnowledgeSpacesByIdSourcesBySourceIdCredentials",
        "PUT",
        "knowledge-spaces/{id}/sources/{sourceId}/credentials",
    ),
    _external_source_operation(
        "deleteKnowledgeSpacesByIdSourcesBySourceIdCredentials",
        "DELETE",
        "knowledge-spaces/{id}/sources/{sourceId}/credentials",
    ),
    _external_source_operation(
        "postKnowledgeSpacesByIdSourcesBySourceIdSync",
        "POST",
        "knowledge-spaces/{id}/sources/{sourceId}/sync",
        request_headers=("idempotency-key", "x-trace-id"),
    ),
    _console_operation(
        operation_id="postKnowledgeSpacesByIdSourcesBySourceIdCrawlPreview",
        method="POST",
        path="knowledge-spaces/{id}/sources/{sourceId}/crawl-preview",
        rbac_permission=RBACPermission.DATASET_EXTERNAL_CONNECT,
        legacy_role="dataset_editor",
        request_headers=("idempotency-key", "x-trace-id"),
    ),
    _external_source_operation(
        "postKnowledgeSpacesByIdSourcesBySourceIdWorkflowImports",
        "POST",
        "knowledge-spaces/{id}/sources/{sourceId}/workflow-imports",
        request_headers=("idempotency-key", "x-trace-id"),
    ),
    _external_source_operation(
        "getKnowledgeSpacesByIdSourcesBySourceIdPages",
        "GET",
        "knowledge-spaces/{id}/sources/{sourceId}/pages",
    ),
    _external_source_operation(
        "getKnowledgeSpacesByIdSourcesBySourceIdFiles",
        "GET",
        "knowledge-spaces/{id}/sources/{sourceId}/files",
    ),
    _external_source_operation(
        "postKnowledgeSpacesByIdSourcesBySourceIdCrawl",
        "POST",
        "knowledge-spaces/{id}/sources/{sourceId}/crawl",
    ),
    _external_source_operation(
        "postKnowledgeSpacesByIdSourcesBySourceIdImport",
        "POST",
        "knowledge-spaces/{id}/sources/{sourceId}/import",
    ),
    _external_source_operation(
        "postKnowledgeSpacesByIdSourcesBySourceIdTest",
        "POST",
        "knowledge-spaces/{id}/sources/{sourceId}/test",
    ),
    _external_source_operation(
        "postKnowledgeSpacesByIdSourcesBySourceIdImportFiles",
        "POST",
        "knowledge-spaces/{id}/sources/{sourceId}/import-files",
    ),
    _external_source_operation(
        "postKnowledgeSpacesByIdSourcesBulk",
        "POST",
        "knowledge-spaces/{id}/sources/bulk",
        request_headers=("idempotency-key", "x-trace-id"),
    ),
    _external_source_operation(
        "getKnowledgeSpacesByIdSourceWorkflows",
        "GET",
        "knowledge-spaces/{id}/source-workflows",
    ),
    _console_operation(
        operation_id="getKnowledgeSpacesByIdSourceWorkflowsByRunId",
        method="GET",
        path="knowledge-spaces/{id}/source-workflows/{runId}",
        rbac_permission=RBACPermission.DATASET_EXTERNAL_CONNECT,
        legacy_role="dataset_editor",
    ),
    _external_source_operation(
        "getKnowledgeSpacesByIdSourceWorkflowsByRunIdBulkItems",
        "GET",
        "knowledge-spaces/{id}/source-workflows/{runId}/bulk-items",
    ),
    _console_operation(
        operation_id="getKnowledgeSpacesByIdSourceWorkflowsByRunIdPages",
        method="GET",
        path="knowledge-spaces/{id}/source-workflows/{runId}/pages",
        rbac_permission=RBACPermission.DATASET_EXTERNAL_CONNECT,
        legacy_role="dataset_editor",
    ),
    _console_operation(
        operation_id="postKnowledgeSpacesByIdSourceWorkflowsByRunIdCancel",
        method="POST",
        path="knowledge-spaces/{id}/source-workflows/{runId}/cancel",
        rbac_permission=RBACPermission.DATASET_EXTERNAL_CONNECT,
        legacy_role="dataset_editor",
    ),
    _console_operation(
        operation_id="postKnowledgeSpacesByIdSourceWorkflowsByRunIdRetry",
        method="POST",
        path="knowledge-spaces/{id}/source-workflows/{runId}/retry",
        rbac_permission=RBACPermission.DATASET_EXTERNAL_CONNECT,
        legacy_role="dataset_editor",
    ),
    _console_operation(
        operation_id="postKnowledgeSpacesByIdSourceWorkflowsByRunIdSelection",
        method="POST",
        path="knowledge-spaces/{id}/source-workflows/{runId}/selection",
        rbac_permission=RBACPermission.DATASET_EXTERNAL_CONNECT,
        legacy_role="dataset_editor",
        request_headers=("idempotency-key", "x-trace-id"),
    ),
    _console_operation(
        operation_id="getKnowledgeSpacesByIdSourcesBySourceIdSyncPolicy",
        method="GET",
        path="knowledge-spaces/{id}/sources/{sourceId}/sync-policy",
        rbac_permission=RBACPermission.DATASET_READONLY,
        legacy_role="reader",
    ),
    _console_operation(
        operation_id="putKnowledgeSpacesByIdSourcesBySourceIdSyncPolicy",
        method="PUT",
        path="knowledge-spaces/{id}/sources/{sourceId}/sync-policy",
        rbac_permission=RBACPermission.DATASET_EDIT,
        legacy_role="dataset_editor",
    ),
    _dataset_read_operation("getKnowledgeSpacesByIdDocuments", "knowledge-spaces/{id}/documents"),
    _dataset_edit_operation("postKnowledgeSpacesByIdDocuments", "POST", "knowledge-spaces/{id}/documents"),
    _dataset_edit_operation(
        "deleteKnowledgeSpacesByIdDocumentsBulk",
        "DELETE",
        "knowledge-spaces/{id}/documents/bulk",
        request_headers=("idempotency-key", "x-trace-id"),
    ),
    _dataset_edit_operation(
        "postKnowledgeSpacesByIdDocumentsBulk",
        "POST",
        "knowledge-spaces/{id}/documents/bulk",
    ),
    _dataset_edit_operation(
        "postKnowledgeSpacesByIdDocumentsBulkReindex",
        "POST",
        "knowledge-spaces/{id}/documents/bulk/reindex",
    ),
    _dataset_read_operation(
        "getKnowledgeSpacesByIdDocumentsByDocumentId",
        "knowledge-spaces/{id}/documents/{documentId}",
    ),
    _dataset_edit_operation(
        "deleteKnowledgeSpacesByIdDocumentsByDocumentId",
        "DELETE",
        "knowledge-spaces/{id}/documents/{documentId}",
        request_headers=("idempotency-key", "x-trace-id"),
    ),
    _console_operation(
        operation_id="getKnowledgeSpacesByIdLogicalDocuments",
        method="GET",
        path="knowledge-spaces/{id}/logical-documents",
        rbac_permission=RBACPermission.DATASET_READONLY,
        legacy_role="reader",
    ),
    _dataset_edit_operation(
        "deleteKnowledgeSpacesByIdLogicalDocumentsByDocumentId",
        "DELETE",
        "knowledge-spaces/{id}/logical-documents/{documentId}",
        request_headers=("idempotency-key", "x-trace-id"),
    ),
    _dataset_read_operation(
        "getKnowledgeSpacesByIdDocumentsByDocumentIdOutline",
        "knowledge-spaces/{id}/documents/{documentId}/outline",
    ),
    _console_operation(
        operation_id="getKnowledgeSpacesByIdLogicalDocumentsByDocumentId",
        method="GET",
        path="knowledge-spaces/{id}/logical-documents/{documentId}",
        rbac_permission=RBACPermission.DATASET_READONLY,
        legacy_role="reader",
    ),
    _console_operation(
        operation_id="getKnowledgeSpacesByIdDocumentsByDocumentIdRevisions",
        method="GET",
        path="knowledge-spaces/{id}/documents/{documentId}/revisions",
        rbac_permission=RBACPermission.DATASET_READONLY,
        legacy_role="reader",
    ),
    _dataset_edit_operation(
        "postKnowledgeSpacesByIdDocumentsByDocumentIdRevisionsByRevisionRollback",
        "POST",
        "knowledge-spaces/{id}/documents/{documentId}/revisions/{revision}/rollback",
    ),
    _dataset_edit_operation(
        "patchKnowledgeSpacesByIdDocumentsByDocumentIdMetadata",
        "PATCH",
        "knowledge-spaces/{id}/documents/{documentId}/metadata",
    ),
    _console_operation(
        operation_id="getKnowledgeSpacesByIdDocumentsByDocumentIdRevisionsByRevisionChunks",
        method="GET",
        path="knowledge-spaces/{id}/documents/{documentId}/revisions/{revision}/chunks",
        rbac_permission=RBACPermission.DATASET_READONLY,
        legacy_role="reader",
    ),
    _dataset_read_operation(
        "getKnowledgeSpacesByIdDocumentsByDocumentIdRevisionsByRevisionChunksByChunkId",
        "knowledge-spaces/{id}/documents/{documentId}/revisions/{revision}/chunks/{chunkId}",
    ),
    _dataset_edit_operation(
        "postKnowledgeSpacesByIdDocumentsByDocumentIdRevisionsByRevisionChunksByChunkIdState",
        "POST",
        "knowledge-spaces/{id}/documents/{documentId}/revisions/{revision}/chunks/{chunkId}/state",
    ),
    _console_operation(
        operation_id="getKnowledgeSpacesByIdProcessingTasks",
        method="GET",
        path="knowledge-spaces/{id}/processing-tasks",
        rbac_permission=RBACPermission.DATASET_READONLY,
        legacy_role="reader",
    ),
    _dataset_read_operation(
        "getKnowledgeSpacesByIdDocumentsByDocumentIdProcessingTasks",
        "knowledge-spaces/{id}/documents/{documentId}/processing-tasks",
    ),
    _dataset_read_operation(
        "getKnowledgeSpacesByIdDocumentsByDocumentIdProcessingTasksByTaskId",
        "knowledge-spaces/{id}/documents/{documentId}/processing-tasks/{taskId}",
    ),
    _console_operation(
        operation_id="getKnowledgeSpacesByIdDocumentsByDocumentIdProcessingTasksByTaskIdEvents",
        method="GET",
        path="knowledge-spaces/{id}/documents/{documentId}/processing-tasks/{taskId}/events",
        rbac_permission=RBACPermission.DATASET_READONLY,
        legacy_role="reader",
        max_response_bytes=67_108_864,
        request_headers=("last-event-id", "x-trace-id"),
        response_kind="stream",
        response_media_types=("text/event-stream",),
    ),
    _console_operation(
        operation_id="deleteKnowledgeSpacesByIdDocumentsByDocumentIdProcessingTasksByTaskId",
        method="DELETE",
        path="knowledge-spaces/{id}/documents/{documentId}/processing-tasks/{taskId}",
        rbac_permission=RBACPermission.DATASET_EDIT,
        legacy_role="dataset_editor",
    ),
    _console_operation(
        operation_id="postKnowledgeSpacesByIdDocumentsByDocumentIdProcessingTasksByTaskIdRetry",
        method="POST",
        path="knowledge-spaces/{id}/documents/{documentId}/processing-tasks/{taskId}/retry",
        rbac_permission=RBACPermission.DATASET_EDIT,
        legacy_role="dataset_editor",
    ),
    _dataset_read_operation(
        "getKnowledgeSpacesByIdDocumentsByDocumentIdSettings",
        "knowledge-spaces/{id}/documents/{documentId}/settings",
    ),
    _dataset_edit_operation(
        "putKnowledgeSpacesByIdDocumentsByDocumentIdSettings",
        "PUT",
        "knowledge-spaces/{id}/documents/{documentId}/settings",
    ),
    _dataset_read_operation("getJobsById", "jobs/{id}"),
    _dataset_edit_operation("deleteJobsById", "DELETE", "jobs/{id}"),
    _dataset_edit_operation("postJobsByIdRetry", "POST", "jobs/{id}/retry"),
    _dataset_read_operation("getDeletionJobsByJobId", "deletion-jobs/{jobId}"),
    _dataset_edit_operation(
        "postDeletionJobsByJobIdRetry",
        "POST",
        "deletion-jobs/{jobId}/retry",
        request_headers=("idempotency-key", "x-trace-id"),
    ),
    _dataset_read_operation("getBulkJobsById", "bulk-jobs/{id}"),
)
