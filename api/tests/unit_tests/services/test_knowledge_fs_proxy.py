from __future__ import annotations

from unittest.mock import MagicMock

import httpx
import jwt
import pytest
from pydantic import SecretStr

from core.helper import ssrf_proxy
from core.rbac import RBACPermission
from core.tools.errors import ToolSSRFError
from services.knowledge_fs_operations import (
    KNOWLEDGE_FS_CONSOLE_OPERATIONS,
    KnowledgeFSMethod,
    KnowledgeFSOperation,
)
from services.knowledge_fs_proxy import (
    KnowledgeFSAccessDeniedError,
    KnowledgeFSAuthorization,
    KnowledgeFSConfigurationError,
    KnowledgeFSRouteNotAllowedError,
    KnowledgeFSTimeoutError,
    KnowledgeFSTransportError,
    authorize_knowledge_fs_request,
    get_knowledge_fs_operation,
    proxy_authorized_knowledge_fs_request,
    proxy_knowledge_fs_request,
)
from services.knowledge_fs_proxy import (
    _forward_knowledge_fs_request as forward_knowledge_fs_request,
)

_JWT_SECRET = "production-secret-with-at-least-32-bytes"

_HAPPY_PATH_OPERATION_IDS = (
    "listKnowledgeSpaces",
    "createKnowledgeSpace",
    "getKnowledgeSpacesById",
    "getKnowledgeSpacesByIdAccessPolicy",
    "patchKnowledgeSpacesByIdAccessPolicy",
    "getSourceProviders",
    "getKnowledgeSpacesByIdSourceConnections",
    "postKnowledgeSpacesByIdSourceConnections",
    "postKnowledgeSpacesByIdSourceConnectionsByConnectionIdRefresh",
    "getKnowledgeSpacesByIdSources",
    "postKnowledgeSpacesByIdSources",
    "postKnowledgeSpacesByIdSourcesBySourceIdCrawlPreview",
    "getKnowledgeSpacesByIdSourceWorkflowsByRunId",
    "getKnowledgeSpacesByIdSourceWorkflowsByRunIdPages",
    "postKnowledgeSpacesByIdSourceWorkflowsByRunIdCancel",
    "postKnowledgeSpacesByIdSourceWorkflowsByRunIdRetry",
    "postKnowledgeSpacesByIdSourceWorkflowsByRunIdSelection",
    "getKnowledgeSpacesByIdSourcesBySourceIdSyncPolicy",
    "putKnowledgeSpacesByIdSourcesBySourceIdSyncPolicy",
    "getKnowledgeSpacesByIdLogicalDocuments",
    "getKnowledgeSpacesByIdLogicalDocumentsByDocumentId",
    "getKnowledgeSpacesByIdDocumentsByDocumentIdRevisions",
    "getKnowledgeSpacesByIdDocumentsByDocumentIdRevisionsByRevisionChunks",
    "getKnowledgeSpacesByIdProcessingTasks",
    "getKnowledgeSpacesByIdDocumentsByDocumentIdProcessingTasksByTaskIdEvents",
    "deleteKnowledgeSpacesByIdDocumentsByDocumentIdProcessingTasksByTaskId",
    "postKnowledgeSpacesByIdDocumentsByDocumentIdProcessingTasksByTaskIdRetry",
)

_REQUIRED_EXPANDED_HAPPY_PATH_OPERATION_IDS = {
    "patchKnowledgeSpacesById",
    "deleteKnowledgeSpacesById",
    "getKnowledgeSpacesByIdStats",
    "postKnowledgeSpacesByIdSourceConnectionsOauth",
    "postSourceOauthCallback",
    "getKnowledgeSpacesByIdSourceConnectionsByConnectionId",
    "deleteKnowledgeSpacesByIdSourceConnectionsByConnectionId",
    "getKnowledgeSpacesByIdSourcesBySourceId",
    "patchKnowledgeSpacesByIdSourcesBySourceId",
    "deleteKnowledgeSpacesByIdSourcesBySourceId",
    "putKnowledgeSpacesByIdSourcesBySourceIdCredentials",
    "deleteKnowledgeSpacesByIdSourcesBySourceIdCredentials",
    "postKnowledgeSpacesByIdSourcesBySourceIdSync",
    "postKnowledgeSpacesByIdSourcesBySourceIdWorkflowImports",
    "getKnowledgeSpacesByIdSourcesBySourceIdPages",
    "getKnowledgeSpacesByIdSourcesBySourceIdFiles",
    "postKnowledgeSpacesByIdSourcesBySourceIdCrawl",
    "postKnowledgeSpacesByIdSourcesBySourceIdImport",
    "postKnowledgeSpacesByIdSourcesBySourceIdTest",
    "postKnowledgeSpacesByIdSourcesBySourceIdImportFiles",
    "postKnowledgeSpacesByIdSourcesBulk",
    "getKnowledgeSpacesByIdSourceWorkflows",
    "getKnowledgeSpacesByIdSourceWorkflowsByRunIdBulkItems",
    "getKnowledgeSpacesByIdDocuments",
    "postKnowledgeSpacesByIdDocuments",
    "deleteKnowledgeSpacesByIdDocumentsBulk",
    "postKnowledgeSpacesByIdDocumentsBulk",
    "postKnowledgeSpacesByIdDocumentsBulkReindex",
    "getKnowledgeSpacesByIdDocumentsByDocumentId",
    "deleteKnowledgeSpacesByIdDocumentsByDocumentId",
    "deleteKnowledgeSpacesByIdLogicalDocumentsByDocumentId",
    "getKnowledgeSpacesByIdDocumentsByDocumentIdOutline",
    "postKnowledgeSpacesByIdDocumentsByDocumentIdRevisionsByRevisionRollback",
    "patchKnowledgeSpacesByIdDocumentsByDocumentIdMetadata",
    "getKnowledgeSpacesByIdDocumentsByDocumentIdRevisionsByRevisionChunksByChunkId",
    "postKnowledgeSpacesByIdDocumentsByDocumentIdRevisionsByRevisionChunksByChunkIdState",
    "getKnowledgeSpacesByIdDocumentsByDocumentIdProcessingTasks",
    "getKnowledgeSpacesByIdDocumentsByDocumentIdProcessingTasksByTaskId",
    "getKnowledgeSpacesByIdDocumentsByDocumentIdSettings",
    "putKnowledgeSpacesByIdDocumentsByDocumentIdSettings",
    "getJobsById",
    "deleteJobsById",
    "postJobsByIdRetry",
    "getDeletionJobsByJobId",
    "postDeletionJobsByJobIdRetry",
    "getBulkJobsById",
}

_EXPANDED_EXTERNAL_SOURCE_OPERATION_IDS = {
    operation_id
    for operation_id in _REQUIRED_EXPANDED_HAPPY_PATH_OPERATION_IDS
    if "Source" in operation_id or operation_id == "postSourceOauthCallback"
}

_OPERATION_AUTHORIZATION_POLICIES = {
    "listKnowledgeSpaces": (RBACPermission.DATASET_READONLY, "reader"),
    "createKnowledgeSpace": (RBACPermission.DATASET_CREATE_AND_MANAGEMENT, "dataset_editor"),
    "getKnowledgeSpacesById": (RBACPermission.DATASET_READONLY, "reader"),
    "getKnowledgeSpacesByIdAccessPolicy": (RBACPermission.DATASET_READONLY, "reader"),
    "patchKnowledgeSpacesByIdAccessPolicy": (RBACPermission.DATASET_ACCESS_CONFIG, "admin"),
    "getSourceProviders": (RBACPermission.DATASET_EXTERNAL_CONNECT, "dataset_editor"),
    "getKnowledgeSpacesByIdSourceConnections": (RBACPermission.DATASET_EXTERNAL_CONNECT, "dataset_editor"),
    "postKnowledgeSpacesByIdSourceConnections": (RBACPermission.DATASET_EXTERNAL_CONNECT, "dataset_editor"),
    "postKnowledgeSpacesByIdSourceConnectionsByConnectionIdRefresh": (
        RBACPermission.DATASET_EXTERNAL_CONNECT,
        "dataset_editor",
    ),
    "getKnowledgeSpacesByIdSources": (RBACPermission.DATASET_READONLY, "reader"),
    "postKnowledgeSpacesByIdSources": (RBACPermission.DATASET_EXTERNAL_CONNECT, "dataset_editor"),
    "postKnowledgeSpacesByIdSourcesBySourceIdCrawlPreview": (
        RBACPermission.DATASET_EXTERNAL_CONNECT,
        "dataset_editor",
    ),
    "getKnowledgeSpacesByIdSourceWorkflowsByRunId": (
        RBACPermission.DATASET_EXTERNAL_CONNECT,
        "dataset_editor",
    ),
    "getKnowledgeSpacesByIdSourceWorkflowsByRunIdPages": (
        RBACPermission.DATASET_EXTERNAL_CONNECT,
        "dataset_editor",
    ),
    "postKnowledgeSpacesByIdSourceWorkflowsByRunIdCancel": (
        RBACPermission.DATASET_EXTERNAL_CONNECT,
        "dataset_editor",
    ),
    "postKnowledgeSpacesByIdSourceWorkflowsByRunIdRetry": (
        RBACPermission.DATASET_EXTERNAL_CONNECT,
        "dataset_editor",
    ),
    "postKnowledgeSpacesByIdSourceWorkflowsByRunIdSelection": (
        RBACPermission.DATASET_EXTERNAL_CONNECT,
        "dataset_editor",
    ),
    "getKnowledgeSpacesByIdSourcesBySourceIdSyncPolicy": (RBACPermission.DATASET_READONLY, "reader"),
    "putKnowledgeSpacesByIdSourcesBySourceIdSyncPolicy": (
        RBACPermission.DATASET_EXTERNAL_CONNECT,
        "dataset_editor",
    ),
    "getKnowledgeSpacesByIdLogicalDocuments": (RBACPermission.DATASET_READONLY, "reader"),
    "getKnowledgeSpacesByIdLogicalDocumentsByDocumentId": (RBACPermission.DATASET_READONLY, "reader"),
    "getKnowledgeSpacesByIdDocumentsByDocumentIdRevisions": (RBACPermission.DATASET_READONLY, "reader"),
    "getKnowledgeSpacesByIdDocumentsByDocumentIdRevisionsByRevisionChunks": (
        RBACPermission.DATASET_READONLY,
        "reader",
    ),
    "getKnowledgeSpacesByIdProcessingTasks": (RBACPermission.DATASET_READONLY, "reader"),
    "getKnowledgeSpacesByIdDocumentsByDocumentIdProcessingTasksByTaskIdEvents": (
        RBACPermission.DATASET_READONLY,
        "reader",
    ),
    "deleteKnowledgeSpacesByIdDocumentsByDocumentIdProcessingTasksByTaskId": (
        RBACPermission.DATASET_EDIT,
        "dataset_editor",
    ),
    "postKnowledgeSpacesByIdDocumentsByDocumentIdProcessingTasksByTaskIdRetry": (
        RBACPermission.DATASET_EDIT,
        "dataset_editor",
    ),
}


def _materialized_path(operation: KnowledgeFSOperation) -> str:
    segments = []
    for segment in operation.path.split("/"):
        if segment == "{revision}":
            segments.append("1")
        elif segment.startswith("{"):
            segments.append("00000000-0000-4000-8000-000000000001")
        else:
            segments.append(segment)
    return "/".join(segments)


def _set_config(
    monkeypatch: pytest.MonkeyPatch,
    *,
    base_url: str | None = "http://knowledge-fs.test",
    sse_read_timeout_seconds: float = 90.0,
    timeout_seconds: float = 7.5,
    jwt_secret: str | None = _JWT_SECRET,
) -> None:
    values = {
        "KNOWLEDGE_FS_BASE_URL": base_url,
        "KNOWLEDGE_FS_SSE_READ_TIMEOUT_SECONDS": sse_read_timeout_seconds,
        "KNOWLEDGE_FS_TIMEOUT_SECONDS": timeout_seconds,
        "KNOWLEDGE_FS_JWT_SECRET": SecretStr(jwt_secret) if jwt_secret is not None else None,
    }
    for name, value in values.items():
        monkeypatch.setattr(f"services.knowledge_fs_proxy.dify_config.{name}", value, raising=False)


def _processing_task_events_path() -> str:
    operation = next(
        operation
        for operation in KNOWLEDGE_FS_CONSOLE_OPERATIONS
        if operation.operation_id == "getKnowledgeSpacesByIdDocumentsByDocumentIdProcessingTasksByTaskIdEvents"
    )
    return _materialized_path(operation)


def test_console_registry_exposes_only_the_new_rag_happy_path_operations() -> None:
    operation_ids = {operation.operation_id for operation in KNOWLEDGE_FS_CONSOLE_OPERATIONS}

    assert operation_ids == set(_HAPPY_PATH_OPERATION_IDS) | _REQUIRED_EXPANDED_HAPPY_PATH_OPERATION_IDS


def test_console_registry_exposes_existing_upstream_contracts_needed_by_all_happy_path_pages() -> None:
    operation_ids = {operation.operation_id for operation in KNOWLEDGE_FS_CONSOLE_OPERATIONS}

    assert operation_ids >= _REQUIRED_EXPANDED_HAPPY_PATH_OPERATION_IDS


def test_console_registry_preserves_explicit_scope_and_authorization_policies() -> None:
    for operation in KNOWLEDGE_FS_CONSOLE_OPERATIONS:
        is_read = operation.method == "GET"
        assert operation.required_scope == f"knowledge-spaces:{'read' if is_read else 'write'}"
        expected_policy = _OPERATION_AUTHORIZATION_POLICIES.get(operation.operation_id)
        if expected_policy is None and operation.operation_id in _EXPANDED_EXTERNAL_SOURCE_OPERATION_IDS:
            expected_policy = (RBACPermission.DATASET_EXTERNAL_CONNECT, "dataset_editor")
        if expected_policy is None:
            expected_policy = (
                (RBACPermission.DATASET_READONLY, "reader")
                if is_read
                else (RBACPermission.DATASET_EDIT, "dataset_editor")
            )
        assert (operation.rbac_permission, operation.legacy_role) == expected_policy
        assert operation.response_headers == ("x-trace-id",)


def test_console_registry_preserves_special_transport_contracts() -> None:
    crawl_preview = get_knowledge_fs_operation(
        "POST",
        "knowledge-spaces/00000000-0000-4000-8000-000000000001/sources/"
        "00000000-0000-4000-8000-000000000002/crawl-preview",
    )
    selection = get_knowledge_fs_operation(
        "POST",
        "knowledge-spaces/00000000-0000-4000-8000-000000000001/source-workflows/"
        "00000000-0000-4000-8000-000000000002/selection",
    )
    events = get_knowledge_fs_operation(
        "GET",
        "knowledge-spaces/00000000-0000-4000-8000-000000000001/documents/"
        "00000000-0000-4000-8000-000000000002/processing-tasks/"
        "00000000-0000-4000-8000-000000000003/events",
    )

    assert crawl_preview.request_headers == ("idempotency-key", "x-trace-id")
    assert selection.request_headers == ("idempotency-key", "x-trace-id")
    assert events.response_kind == "stream"
    assert events.max_response_bytes == 67_108_864
    assert events.request_headers == ("last-event-id", "x-trace-id")
    assert events.response_media_types == ("text/event-stream",)


def test_unconfigured_kfs_is_rejected_before_external_io(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_config(monkeypatch, base_url=None, jwt_secret=None)
    request = MagicMock()
    monkeypatch.setattr("services.knowledge_fs_proxy.ssrf_proxy.make_request", request)

    with pytest.raises(KnowledgeFSConfigurationError, match="incomplete"):
        forward_knowledge_fs_request(
            account_id="account-dev", method="GET", path="knowledge-spaces", tenant_id="tenant-dev"
        )

    request.assert_not_called()


@pytest.mark.parametrize("method", ["GET", "POST"])
def test_list_and_create_forward_raw_request(monkeypatch: pytest.MonkeyPatch, method: KnowledgeFSMethod) -> None:
    _set_config(monkeypatch, base_url="http://knowledge-fs.test/gateway")
    response = httpx.Response(201, content=b'{"id":"space-1"}', headers={"Content-Type": "application/json"})
    request = MagicMock(return_value=response)
    monkeypatch.setattr("services.knowledge_fs_proxy.ssrf_proxy.make_request", request)
    body = b'{"name":"Product docs"}' if method == "POST" else None
    query = b"limit=20&cursor=first" if method == "GET" else None

    result = forward_knowledge_fs_request(
        account_id="account-dev",
        method=method,
        path="knowledge-spaces",
        tenant_id="tenant-dev",
        query=query,
        body=body,
    )

    assert result.response.content == response.content
    assert result.response_kind == "buffered"
    assert request.call_args.kwargs["method"] == method
    assert request.call_args.kwargs["url"] == "http://knowledge-fs.test/gateway/knowledge-spaces"
    assert request.call_args.kwargs["params"] == query
    assert request.call_args.kwargs["content"] == body
    assert request.call_args.kwargs["follow_redirects"] is False
    assert request.call_args.kwargs["max_retries"] == 0
    assert request.call_args.kwargs["stream_response"] is True


def test_proxy_forwards_only_registry_declared_headers(monkeypatch: pytest.MonkeyPatch) -> None:
    account = MagicMock(id="account-1", is_dataset_editor=True)
    upstream = MagicMock()
    forward = MagicMock(return_value=upstream)
    monkeypatch.setattr(
        "services.knowledge_fs_proxy.RBACService.CheckAccess.check",
        MagicMock(return_value=True),
    )
    monkeypatch.setattr("services.knowledge_fs_proxy._forward_knowledge_fs_request", forward)

    result = proxy_knowledge_fs_request(
        account=account,
        method="POST",
        path="knowledge-spaces",
        tenant_id="tenant-1",
        request_headers={"Authorization": "browser-secret", "X-Trace-Id": "trace-1"},
    )

    assert result is upstream
    assert forward.call_args.kwargs["request_headers"] == {"x-trace-id": "trace-1"}


def test_authorized_proxy_does_not_repeat_workspace_rbac(monkeypatch: pytest.MonkeyPatch) -> None:
    account = MagicMock(id="account-1", is_dataset_editor=True)
    check_access = MagicMock(return_value=True)
    forward = MagicMock(return_value=MagicMock())
    monkeypatch.setattr("services.knowledge_fs_proxy.RBACService.CheckAccess.check", check_access)
    monkeypatch.setattr("services.knowledge_fs_proxy._forward_knowledge_fs_request", forward)
    operation = get_knowledge_fs_operation("POST", "knowledge-spaces")
    authorization = authorize_knowledge_fs_request(
        account=account,
        tenant_id="tenant-1",
        method=operation.method,
        path=_materialized_path(operation),
    )

    proxy_authorized_knowledge_fs_request(authorization=authorization)

    check_access.assert_called_once()
    assert forward.call_args.kwargs["account_id"] == "account-1"
    assert forward.call_args.kwargs["tenant_id"] == "tenant-1"
    assert forward.call_args.kwargs["method"] == "POST"
    assert forward.call_args.kwargs["path"] == "knowledge-spaces"


def test_authorization_capability_cannot_be_constructed_directly() -> None:
    operation = get_knowledge_fs_operation("POST", "knowledge-spaces")

    with pytest.raises(KnowledgeFSAccessDeniedError, match="must be created by workspace authorization"):
        KnowledgeFSAuthorization("account-1", "tenant-1", operation)


def test_authorization_resolves_the_canonical_operation_policy(monkeypatch: pytest.MonkeyPatch) -> None:
    account = MagicMock(id="account-1", is_dataset_editor=False, is_admin_or_owner=False)
    check_access = MagicMock(return_value=True)
    monkeypatch.setattr("services.knowledge_fs_proxy.RBACService.CheckAccess.check", check_access)

    with pytest.raises(KnowledgeFSAccessDeniedError, match="dataset edit access"):
        authorize_knowledge_fs_request(
            account=account,
            tenant_id="tenant-1",
            method="POST",
            path="knowledge-spaces",
        )

    check_access.assert_not_called()


@pytest.mark.parametrize(
    ("attribute", "value"),
    [
        ("account_id", "account-2"),
        ("tenant_id", "tenant-2"),
        ("operation", get_knowledge_fs_operation("GET", "knowledge-spaces")),
    ],
)
def test_authorization_capability_binding_cannot_be_mutated(
    monkeypatch: pytest.MonkeyPatch,
    attribute: str,
    value: object,
) -> None:
    account = MagicMock(id="account-1", is_dataset_editor=True)
    monkeypatch.setattr(
        "services.knowledge_fs_proxy.RBACService.CheckAccess.check",
        MagicMock(return_value=True),
    )
    authorization = authorize_knowledge_fs_request(
        account=account,
        tenant_id="tenant-1",
        method="POST",
        path="knowledge-spaces",
    )

    with pytest.raises(AttributeError):
        setattr(authorization, attribute, value)

    assert authorization.account_id == "account-1"
    assert authorization.tenant_id == "tenant-1"
    assert authorization.operation == get_knowledge_fs_operation("POST", "knowledge-spaces")


def test_authorization_capability_cannot_be_reused(monkeypatch: pytest.MonkeyPatch) -> None:
    account = MagicMock(id="account-1", is_dataset_editor=True)
    forward = MagicMock(return_value=MagicMock())
    monkeypatch.setattr(
        "services.knowledge_fs_proxy.RBACService.CheckAccess.check",
        MagicMock(return_value=True),
    )
    monkeypatch.setattr("services.knowledge_fs_proxy._forward_knowledge_fs_request", forward)
    authorization = authorize_knowledge_fs_request(
        account=account,
        tenant_id="tenant-1",
        method="POST",
        path="knowledge-spaces",
    )

    proxy_authorized_knowledge_fs_request(authorization=authorization)

    with pytest.raises(KnowledgeFSAccessDeniedError, match="already been used"):
        proxy_authorized_knowledge_fs_request(authorization=authorization)
    forward.assert_called_once()


@pytest.mark.parametrize("operation", KNOWLEDGE_FS_CONSOLE_OPERATIONS, ids=lambda operation: operation.operation_id)
def test_authorization_rejects_workspace_rbac_denial(
    monkeypatch: pytest.MonkeyPatch,
    operation: KnowledgeFSOperation,
) -> None:
    account = MagicMock(id="account-1", is_dataset_editor=True)
    check_access = MagicMock(return_value=False)
    monkeypatch.setattr("services.knowledge_fs_proxy.RBACService.CheckAccess.check", check_access)

    with pytest.raises(KnowledgeFSAccessDeniedError):
        authorize_knowledge_fs_request(
            account=account,
            tenant_id="tenant-1",
            method=operation.method,
            path=_materialized_path(operation),
        )

    check_access.assert_called_once_with(
        "tenant-1",
        "account-1",
        scene=operation.rbac_permission.value,
        resource_type="dataset",
    )


@pytest.mark.parametrize(
    "operation",
    tuple(operation for operation in KNOWLEDGE_FS_CONSOLE_OPERATIONS if operation.legacy_role == "dataset_editor"),
    ids=lambda operation: operation.operation_id,
)
def test_dataset_editor_operations_reject_legacy_viewers_before_rbac(
    monkeypatch: pytest.MonkeyPatch,
    operation: KnowledgeFSOperation,
) -> None:
    account = MagicMock(id="account-1", is_dataset_editor=False, is_admin_or_owner=False)
    check_access = MagicMock(return_value=True)
    monkeypatch.setattr("services.knowledge_fs_proxy.RBACService.CheckAccess.check", check_access)

    with pytest.raises(KnowledgeFSAccessDeniedError, match="dataset edit access"):
        authorize_knowledge_fs_request(
            account=account,
            tenant_id="tenant-1",
            method=operation.method,
            path=_materialized_path(operation),
        )

    check_access.assert_not_called()


def test_admin_operation_rejects_legacy_editors_before_rbac(monkeypatch: pytest.MonkeyPatch) -> None:
    account = MagicMock(id="account-1", is_dataset_editor=True, is_admin_or_owner=False)
    check_access = MagicMock(return_value=True)
    monkeypatch.setattr("services.knowledge_fs_proxy.RBACService.CheckAccess.check", check_access)
    operation = get_knowledge_fs_operation(
        "PATCH", "knowledge-spaces/00000000-0000-4000-8000-000000000001/access-policy"
    )

    with pytest.raises(KnowledgeFSAccessDeniedError, match="administration access"):
        authorize_knowledge_fs_request(
            account=account,
            tenant_id="tenant-1",
            method=operation.method,
            path=_materialized_path(operation),
        )

    check_access.assert_not_called()


def test_authorization_uses_the_declared_reader_policy(monkeypatch: pytest.MonkeyPatch) -> None:
    account = MagicMock(id="account-1", is_dataset_editor=False, is_admin_or_owner=False)
    check_access = MagicMock(return_value=True)
    monkeypatch.setattr("services.knowledge_fs_proxy.RBACService.CheckAccess.check", check_access)
    operation = get_knowledge_fs_operation("GET", "knowledge-spaces")

    authorize_knowledge_fs_request(
        account=account,
        tenant_id="tenant-1",
        method=operation.method,
        path=_materialized_path(operation),
    )

    check_access.assert_called_once()


@pytest.mark.parametrize("operation", KNOWLEDGE_FS_CONSOLE_OPERATIONS, ids=lambda operation: operation.operation_id)
def test_auth_signs_current_principals_and_declared_scope(
    monkeypatch: pytest.MonkeyPatch,
    operation: KnowledgeFSOperation,
) -> None:
    _set_config(monkeypatch)
    response = httpx.Response(
        200,
        content=b"data" if operation.response_kind == "stream" else b'{"items":[]}',
        headers={"Content-Type": operation.response_media_types[0]},
    )
    request = MagicMock(return_value=response)
    monkeypatch.setattr("services.knowledge_fs_proxy.ssrf_proxy.make_request", request)

    forward_knowledge_fs_request(
        account_id="account-1",
        method=operation.method,
        path=_materialized_path(operation),
        tenant_id="tenant-1",
    )

    authorization = request.call_args.kwargs["headers"]["Authorization"]
    claims = jwt.decode(
        authorization.removeprefix("Bearer "),
        _JWT_SECRET,
        algorithms=["HS256"],
        audience="knowledge-fs",
        issuer="dify",
    )
    assert claims["dify_account_id"] == "dify-account:account-1"
    assert claims["sub"] == "dify-workspace:tenant-1"
    assert claims["tenant_id"] == "tenant-1"
    assert claims["scopes"] == [operation.required_scope]
    assert claims["caller_kind"] == "interactive"
    assert claims["exp"] - claims["iat"] == 60


def test_buffered_response_rejects_non_empty_body_without_content_type(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_config(monkeypatch)
    response = httpx.Response(200, content=b"<html>unexpected</html>")
    monkeypatch.setattr("services.knowledge_fs_proxy.ssrf_proxy.make_request", MagicMock(return_value=response))

    with pytest.raises(KnowledgeFSTransportError, match="unsupported media type"):
        forward_knowledge_fs_request(
            account_id="account-dev", method="GET", path="knowledge-spaces", tenant_id="tenant-dev"
        )

    assert response.is_closed


def test_sse_response_remains_streaming_and_uses_the_dedicated_read_timeout(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _set_config(monkeypatch, sse_read_timeout_seconds=120.0)
    request = httpx.Request(
        "GET",
        "http://knowledge-fs.test/events",
        extensions={"timeout": {"connect": 7.5, "read": 7.5}},
    )
    response = httpx.Response(
        200,
        headers={"Content-Type": "text/event-stream"},
        request=request,
        stream=httpx.ByteStream(b"event: progress\n\n"),
    )
    monkeypatch.setattr("services.knowledge_fs_proxy.ssrf_proxy.make_request", MagicMock(return_value=response))
    buffer_response = MagicMock()
    monkeypatch.setattr("services.knowledge_fs_proxy.ssrf_proxy.buffer_response", buffer_response)

    result = forward_knowledge_fs_request(
        account_id="account-dev",
        method="GET",
        path=_processing_task_events_path(),
        tenant_id="tenant-dev",
    )

    assert result.response is response
    assert result.response_kind == "stream"
    assert request.extensions["timeout"]["read"] == 120.0
    assert not response.is_closed
    buffer_response.assert_not_called()


@pytest.mark.parametrize(
    ("headers", "message"),
    [
        ({"Content-Type": "application/json"}, "unsupported media type"),
        (
            {"Content-Type": "text/event-stream", "Content-Encoding": "gzip"},
            "unsupported encoding",
        ),
    ],
)
def test_sse_response_rejects_invalid_stream_headers_and_closes_upstream(
    monkeypatch: pytest.MonkeyPatch,
    headers: dict[str, str],
    message: str,
) -> None:
    _set_config(monkeypatch)
    response = httpx.Response(200, headers=headers, stream=httpx.ByteStream(b"data"))
    monkeypatch.setattr("services.knowledge_fs_proxy.ssrf_proxy.make_request", MagicMock(return_value=response))

    with pytest.raises(KnowledgeFSTransportError, match=message):
        forward_knowledge_fs_request(
            account_id="account-dev",
            method="GET",
            path=_processing_task_events_path(),
            tenant_id="tenant-dev",
        )

    assert response.is_closed


@pytest.mark.parametrize(
    ("error", "expected_exception"),
    [
        (
            httpx.ReadTimeout("timed out", request=httpx.Request("GET", "http://knowledge-fs.test")),
            KnowledgeFSTimeoutError,
        ),
        (
            httpx.ConnectError("unavailable", request=httpx.Request("GET", "http://knowledge-fs.test")),
            KnowledgeFSTransportError,
        ),
        (ssrf_proxy.ResponseTooLargeError("too large"), KnowledgeFSTransportError),
        (ToolSSRFError("blocked"), KnowledgeFSConfigurationError),
    ],
)
def test_transport_failures_are_normalized(
    monkeypatch: pytest.MonkeyPatch,
    error: Exception,
    expected_exception: type[Exception],
) -> None:
    _set_config(monkeypatch)
    monkeypatch.setattr("services.knowledge_fs_proxy.ssrf_proxy.make_request", MagicMock(side_effect=error))

    with pytest.raises(expected_exception):
        forward_knowledge_fs_request(
            account_id="account-dev", method="GET", path="knowledge-spaces", tenant_id="tenant-dev"
        )


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "openapi.json"),
        ("GET", "knowledge-spaces/space-1/manifest"),
        ("PATCH", "knowledge-spaces"),
        ("POST", "queries"),
        ("POST", "knowledge-spaces/space-1/uploads"),
    ],
)
def test_unregistered_route_is_rejected_before_external_io(
    monkeypatch: pytest.MonkeyPatch,
    method: KnowledgeFSMethod,
    path: str,
) -> None:
    _set_config(monkeypatch)
    request = MagicMock()
    monkeypatch.setattr("services.knowledge_fs_proxy.ssrf_proxy.make_request", request)

    with pytest.raises(KnowledgeFSRouteNotAllowedError):
        forward_knowledge_fs_request(account_id="account-dev", method=method, path=path, tenant_id="tenant-dev")

    request.assert_not_called()
