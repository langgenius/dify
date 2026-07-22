"""Transport-only forwarding for the explicitly enabled KnowledgeFS Console operations.

KnowledgeFS owns the request and response contract. This module binds short-lived
account and workspace identities, enforces Dify's coarse workspace policy, and
normalizes transport failures. Dify deliberately maintains a small product-facing
operation registry instead of exposing the full upstream OpenAPI surface. The
dedicated request path uses Dify's shared SSRF policy, never follows redirects,
bounds buffered responses, and rejects compressed responses.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from datetime import UTC, datetime, timedelta
from http import HTTPStatus
from typing import Final, Literal, NamedTuple, Protocol

import httpx
import jwt

from configs import dify_config
from core.helper import ssrf_proxy
from core.rbac import RBACPermission, RBACResourceScope
from core.tools.errors import ToolSSRFError
from models import Account
from services.enterprise.rbac_service import RBACService

type KnowledgeFSMethod = Literal["DELETE", "GET", "PATCH", "POST", "PUT"]
type KnowledgeFSResponseKind = Literal["binary", "buffered", "stream"]
type KnowledgeFSRequiredScope = Literal["knowledge-spaces:read", "knowledge-spaces:write"]
type KnowledgeFSLegacyRole = Literal["reader", "dataset_editor", "admin"]
type KnowledgeFSErrorStatusMap = tuple[tuple[int, int], ...]

_JWT_AUDIENCE = "knowledge-fs"
_JWT_ISSUER = "dify"
_JWT_TTL_SECONDS = 60
_MAX_BUFFERED_RESPONSE_BYTES = 1024 * 1024


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


class KnowledgeFSUpstreamResponse(NamedTuple):
    response: httpx.Response
    response_kind: KnowledgeFSResponseKind
    operation: KnowledgeFSOperation


class _RequestHeaders(Protocol):
    def items(self) -> Iterable[tuple[str, str]]: ...


class KnowledgeFSConfigurationError(RuntimeError):
    """KnowledgeFS is incompletely configured or blocked by outbound policy."""


class KnowledgeFSTimeoutError(RuntimeError):
    """KnowledgeFS exceeded the configured request timeout."""


class KnowledgeFSTransportError(RuntimeError):
    """KnowledgeFS could not be reached or returned a response outside safety bounds."""


class KnowledgeFSRouteNotAllowedError(RuntimeError):
    """The requested path is outside the Console-visible KnowledgeFS surface."""


class KnowledgeFSAccessDeniedError(RuntimeError):
    """The Dify account lacks the workspace permission required by the operation."""


def authorize_knowledge_fs_request(
    *,
    account: Account,
    tenant_id: str,
    operation: KnowledgeFSOperation,
) -> None:
    """Enforce Dify's workspace policy before KFS performs resource authorization.

    Args:
        account: Authenticated Dify account with its current workspace role.
        tenant_id: Current Dify workspace identifier.
        operation: Dify-maintained KnowledgeFS operation and policy metadata.

    Raises:
        KnowledgeFSAccessDeniedError: The account lacks a required legacy or enterprise permission.
    """
    if operation.legacy_role == "dataset_editor" and not account.is_dataset_editor:
        raise KnowledgeFSAccessDeniedError("KnowledgeFS operation requires dataset edit access")
    if operation.legacy_role == "admin" and not account.is_admin_or_owner:
        raise KnowledgeFSAccessDeniedError("KnowledgeFS operation requires workspace administration access")
    if not RBACService.CheckAccess.check(
        tenant_id,
        account.id,
        scene=operation.rbac_permission.value,
        resource_type=RBACResourceScope.DATASET.value,
    ):
        raise KnowledgeFSAccessDeniedError("KnowledgeFS operation is denied by workspace RBAC")


def proxy_knowledge_fs_request(
    *,
    account: Account,
    method: KnowledgeFSMethod,
    path: str,
    tenant_id: str,
    accept: str | None = None,
    content_type: str | None = None,
    query: bytes | None = None,
    body: bytes | None = None,
    request_headers: _RequestHeaders | None = None,
) -> KnowledgeFSUpstreamResponse:
    """Authorize and forward one allowlisted KnowledgeFS request as a single use case."""
    operation = get_knowledge_fs_operation(method, path)
    authorize_knowledge_fs_request(
        account=account,
        tenant_id=tenant_id,
        operation=operation,
    )
    incoming_request_headers = {name.lower(): value for name, value in (request_headers or {}).items()}
    contract_request_headers = {
        name: incoming_request_headers[name] for name in operation.request_headers if name in incoming_request_headers
    }
    return _forward_knowledge_fs_request(
        account_id=account.id,
        method=method,
        path=path,
        tenant_id=tenant_id,
        accept=accept,
        content_type=content_type,
        query=query,
        body=body,
        request_headers=contract_request_headers,
    )


def _forward_knowledge_fs_request(
    *,
    account_id: str,
    method: KnowledgeFSMethod,
    path: str,
    tenant_id: str,
    accept: str | None = None,
    content_type: str | None = None,
    query: bytes | None = None,
    body: bytes | None = None,
    request_headers: Mapping[str, str] | None = None,
) -> KnowledgeFSUpstreamResponse:
    """Forward one fixed-route request without parsing its KnowledgeFS payload.

    Args:
        account_id: Current Dify account used as the KFS member identity.
        method: Allowlisted upstream HTTP method.
        path: Relative KnowledgeFS path under an allowlisted product surface.
        tenant_id: Current Dify workspace used as the KFS tenant identity.
        accept: Original Accept header, when present.
        content_type: Original request Content-Type header, when present.
        query: Original encoded query string from the Console request.
        body: Original request body, when present.
        request_headers: Contract-declared request headers forwarded by the Console adapter.

    Returns:
        The KnowledgeFS response and its actual transport kind. Non-success responses are buffered.

    Raises:
        KnowledgeFSConfigurationError: The connection is incomplete or blocked by outbound policy.
        KnowledgeFSRouteNotAllowedError: The path is outside the allowlisted product surface.
        KnowledgeFSTimeoutError: KnowledgeFS exceeds the configured timeout.
        KnowledgeFSTransportError: The request fails or its response cannot be safely bounded.

    Each request is bound to stable Dify account and workspace principals with a short expiration.
    """
    operation = get_knowledge_fs_operation(method, path)
    base_url = dify_config.KNOWLEDGE_FS_BASE_URL
    jwt_secret = dify_config.KNOWLEDGE_FS_JWT_SECRET
    if base_url is None or jwt_secret is None:
        raise KnowledgeFSConfigurationError("KnowledgeFS connection configuration is incomplete")
    now = datetime.now(UTC)
    token = jwt.encode(
        {
            "aud": _JWT_AUDIENCE,
            "caller_kind": "interactive",
            "dify_account_id": f"dify-account:{account_id}",
            "exp": now + timedelta(seconds=_JWT_TTL_SECONDS),
            "iat": now,
            "iss": _JWT_ISSUER,
            "scopes": [operation.required_scope],
            "sub": f"dify-workspace:{tenant_id}",
            "tenant_id": tenant_id,
        },
        jwt_secret.get_secret_value(),
        algorithm="HS256",
    )
    headers = {
        "Accept": accept or "application/json",
        "Accept-Encoding": "identity",
        "Authorization": f"Bearer {token}",
    }
    if body is not None:
        headers["Content-Type"] = content_type or "application/json"
    allowed_request_headers = set(operation.request_headers)
    for name, value in (request_headers or {}).items():
        normalized_name = name.lower()
        if normalized_name not in allowed_request_headers:
            raise KnowledgeFSRouteNotAllowedError("KnowledgeFS request header is not allowed")
        headers[normalized_name] = value

    try:
        upstream_url = httpx.URL(f"{base_url}/").join(operation.path)
        response = ssrf_proxy.make_request(
            method=operation.method,
            url=str(upstream_url),
            params=query,
            content=body,
            headers=headers,
            timeout=dify_config.KNOWLEDGE_FS_TIMEOUT_SECONDS,
            follow_redirects=False,
            max_retries=0,
            stream_response=True,
        )
        response_kind = _classify_response(operation, response)
        if response_kind == "stream":
            content_encoding = response.headers.get("content-encoding", "identity").strip().lower()
            if content_encoding not in {"", "identity"}:
                response.close()
                raise KnowledgeFSTransportError("KnowledgeFS streaming response used an unsupported encoding")
            _set_response_read_timeout(response, dify_config.KNOWLEDGE_FS_SSE_READ_TIMEOUT_SECONDS)
            return KnowledgeFSUpstreamResponse(response, response_kind, operation)

        max_response_bytes = (
            operation.max_response_bytes
            if HTTPStatus.OK <= response.status_code < HTTPStatus.MULTIPLE_CHOICES
            else _MAX_BUFFERED_RESPONSE_BYTES
        )
        buffered_response = ssrf_proxy.buffer_response(response, max_response_bytes=max_response_bytes)
        if buffered_response.content and not buffered_response.headers.get("content-type", "").strip():
            buffered_response.close()
            raise KnowledgeFSTransportError("KnowledgeFS buffered response used an unsupported media type")
        return KnowledgeFSUpstreamResponse(buffered_response, response_kind, operation)
    except ssrf_proxy.ResponseLimitError as exc:
        raise KnowledgeFSTransportError("KnowledgeFS response violated the proxy limit") from exc
    except ToolSSRFError as exc:
        raise KnowledgeFSConfigurationError("KnowledgeFS origin was blocked by outbound policy") from exc
    except httpx.TimeoutException as exc:
        raise KnowledgeFSTimeoutError("KnowledgeFS request timed out") from exc
    except httpx.RequestError as exc:
        raise KnowledgeFSTransportError("KnowledgeFS transport request failed") from exc


def get_knowledge_fs_operation(method: KnowledgeFSMethod, path: str) -> KnowledgeFSOperation:
    """Resolve an exact operation and its transport/access contract metadata."""
    for operation in KNOWLEDGE_FS_CONSOLE_OPERATIONS:
        if method == operation.method and _matches_route_template(operation.path, path):
            return operation._replace(path=path)
    raise KnowledgeFSRouteNotAllowedError("KnowledgeFS route is not allowed")


def _classify_response(operation: KnowledgeFSOperation, response: httpx.Response) -> KnowledgeFSResponseKind:
    """Resolve the actual response kind from status and Content-Type before reading its body."""
    content_type = response.headers.get("content-type", "").partition(";")[0].strip().lower()
    is_success = HTTPStatus.OK <= response.status_code < HTTPStatus.MULTIPLE_CHOICES
    if not is_success:
        if content_type and not _is_json_content_type(content_type):
            response.close()
            raise KnowledgeFSTransportError("KnowledgeFS error response used an unsupported media type")
        return "buffered"

    if operation.response_kind == "stream":
        if content_type != "text/event-stream":
            response.close()
            raise KnowledgeFSTransportError("KnowledgeFS stream response used an unsupported media type")
        return "stream"
    if operation.response_kind == "binary":
        if content_type not in operation.response_media_types:
            response.close()
            raise KnowledgeFSTransportError("KnowledgeFS binary response used an unsupported media type")
        return "binary"
    if content_type and not _is_json_content_type(content_type):
        response.close()
        raise KnowledgeFSTransportError("KnowledgeFS buffered response used an unsupported media type")
    return "buffered"


def _is_json_content_type(content_type: str) -> bool:
    return content_type == "application/json" or content_type.endswith("+json")


def _set_response_read_timeout(response: httpx.Response, timeout_seconds: float | None) -> None:
    """Set the body-read timeout after headers identify a valid SSE response."""
    try:
        request = response.request
    except RuntimeError:
        return
    timeout = request.extensions.get("timeout")
    if isinstance(timeout, dict):
        timeout["read"] = timeout_seconds


def _matches_route_template(template: str, path: str) -> bool:
    """Match path parameters without permitting encoded or traversal-like segments."""
    template_segments = template.split("/")
    path_segments = path.split("/")
    if len(template_segments) != len(path_segments):
        return False

    for template_segment, path_segment in zip(template_segments, path_segments, strict=True):
        if template_segment.startswith("{") and template_segment.endswith("}"):
            if (
                not path_segment
                or path_segment in {".", ".."}
                or "\\" in path_segment
                or "%" in path_segment
                or "?" in path_segment
                or "#" in path_segment
            ):
                return False
            continue
        if template_segment != path_segment:
            return False
    return True
