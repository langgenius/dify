from __future__ import annotations

import httpx
import pytest

from core.helper import ssrf_proxy
from services.knowledge_fs import product_remote_http
from services.knowledge_fs.product_remote import (
    KnowledgeFSOperationUnavailableError,
    KnowledgeFSProductRemoteError,
    KnowledgeFSProductRequestRejectedError,
    KnowledgeFSRemoteBinaryRequest,
    KnowledgeFSRemoteJSONRequest,
)
from services.knowledge_fs.product_remote_http import HTTPKnowledgeFSProductRemoteClient


def test_remote_client_builds_capability_only_headers(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}
    response = httpx.Response(
        200,
        json={"data": [], "next_cursor": None},
        headers={"Content-Type": "application/json"},
    )

    def fake_make_request(**kwargs):
        captured.update(kwargs)
        return response

    monkeypatch.setattr(ssrf_proxy, "make_request", fake_make_request)
    monkeypatch.setattr(ssrf_proxy, "buffer_response", lambda response, **_: response)
    client = HTTPKnowledgeFSProductRemoteClient(base_url="https://knowledge-fs.test", timeout_seconds=3)

    result = client.execute_json(
        KnowledgeFSRemoteJSONRequest(
            operation_id="listDocuments",
            method="GET",
            path="/knowledge-spaces/space-1/documents",
            namespace_id="tenant-1",
            knowledge_space_id="space-1",
            capability_token="capability-token",
            trace_id="trace-1",
            payload=None,
        )
    )

    assert result == {"data": [], "next_cursor": None}
    headers = captured["headers"]
    assert isinstance(headers, dict)
    assert headers["Authorization"] == "Bearer capability-token"
    assert headers["X-Trace-Id"] == "trace-1"
    assert not any(name.lower() == "cookie" for name in headers)
    assert captured["follow_redirects"] is False


def test_remote_client_rejects_manifest_mismatch_before_io(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = 0

    def fail_make_request(**kwargs):
        nonlocal calls
        _ = kwargs
        calls += 1
        raise AssertionError("must not perform I/O")

    monkeypatch.setattr(ssrf_proxy, "make_request", fail_make_request)
    client = HTTPKnowledgeFSProductRemoteClient(base_url="https://knowledge-fs.test", timeout_seconds=3)

    with pytest.raises(KnowledgeFSOperationUnavailableError):
        client.execute_json(
            KnowledgeFSRemoteJSONRequest(
                operation_id="listDocuments",
                method="GET",
                path="/knowledge-spaces/space-other/sources",
                namespace_id="tenant-1",
                knowledge_space_id="space-1",
                capability_token="capability-token",
                trace_id="trace-1",
                payload=None,
            )
        )

    assert calls == 0

    with pytest.raises(KnowledgeFSProductRemoteError, match="binding"):
        client.execute_json(
            KnowledgeFSRemoteJSONRequest(
                operation_id="getSettings",
                method="GET",
                path="/knowledge-spaces/space-1/product-settings",
                namespace_id="tenant-1",
                knowledge_space_id="space-1",
                capability_token="capability-token",
                trace_id="",
                payload=None,
            )
        )

    assert calls == 0


def test_remote_client_allows_only_validated_idempotency_headers(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}
    response = httpx.Response(202, json={"status": "accepted"}, headers={"Content-Type": "application/json"})

    def fake_make_request(**kwargs):
        captured.update(kwargs)
        return response

    monkeypatch.setattr(ssrf_proxy, "make_request", fake_make_request)
    monkeypatch.setattr(ssrf_proxy, "buffer_response", lambda response, **_: response)
    client = HTTPKnowledgeFSProductRemoteClient(base_url="https://knowledge-fs.test", timeout_seconds=3)

    request = KnowledgeFSRemoteJSONRequest(
        operation_id="deleteDocument",
        method="DELETE",
        path="/knowledge-spaces/space-1/documents/document-1",
        namespace_id="tenant-1",
        knowledge_space_id="space-1",
        capability_token="capability-token",
        trace_id="trace-1",
        payload={"expectedRevision": 2},
        headers=(("Idempotency-Key", "delete-document-once"),),
    )
    assert client.execute_json(request) == {"status": "accepted"}
    headers = captured["headers"]
    assert isinstance(headers, dict)
    assert headers["Idempotency-Key"] == "delete-document-once"

    with pytest.raises(KnowledgeFSProductRemoteError, match="header binding"):
        client.execute_json(request._replace(headers=(("Cookie", "browser-cookie"),)))


def test_remote_client_rejects_operation_request_limit_before_io(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = 0

    def fail_make_request(**kwargs):
        nonlocal calls
        _ = kwargs
        calls += 1
        raise AssertionError("must not perform I/O")

    monkeypatch.setattr(ssrf_proxy, "make_request", fail_make_request)
    client = HTTPKnowledgeFSProductRemoteClient(base_url="https://knowledge-fs.test", timeout_seconds=3)

    with pytest.raises(KnowledgeFSProductRemoteError, match="operation byte limit"):
        client.execute_json(
            KnowledgeFSRemoteJSONRequest(
                operation_id="listDocuments",
                method="GET",
                path="/knowledge-spaces/space-1/documents",
                namespace_id="tenant-1",
                knowledge_space_id="space-1",
                capability_token="capability-token",
                trace_id="trace-1",
                payload=None,
                query=(("cursor", "x" * (17 * 1024)),),
            )
        )

    assert calls == 0


def test_remote_client_enforces_the_operation_response_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    captured_limit = 0
    response = httpx.Response(
        200,
        json={"configurationState": "setup-required", "embedding": None, "retrieval": None, "revision": 1},
        headers={"Content-Type": "application/json"},
    )

    monkeypatch.setattr(ssrf_proxy, "make_request", lambda **_: response)

    def fake_buffer_response(buffered: httpx.Response, *, max_response_bytes: int):
        nonlocal captured_limit
        captured_limit = max_response_bytes
        return buffered

    monkeypatch.setattr(ssrf_proxy, "buffer_response", fake_buffer_response)
    client = HTTPKnowledgeFSProductRemoteClient(
        base_url="https://knowledge-fs.test",
        timeout_seconds=3,
        max_response_bytes=8 * 1024 * 1024,
    )

    result = client.execute_json(
        KnowledgeFSRemoteJSONRequest(
            operation_id="getSettings",
            method="GET",
            path="/knowledge-spaces/space-1/product-settings",
            namespace_id="tenant-1",
            knowledge_space_id="space-1",
            capability_token="capability-token",
            trace_id="trace-1",
            payload=None,
        )
    )

    assert result["revision"] == 1
    assert captured_limit == 256 * 1024


def test_binary_remote_binds_only_small_file_bytes_parent_space_and_capability(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, object] = {}
    response = httpx.Response(
        200,
        json={
            "session": {
                "expectedSizeBytes": 4,
                "expiresAt": 2_000_000,
                "id": "session-1",
                "mode": "small_fallback",
                "status": "completed",
            }
        },
        headers={"Content-Type": "application/json"},
    )

    def fake_make_request(**kwargs):
        captured.update(kwargs)
        return response

    monkeypatch.setattr(ssrf_proxy, "make_request", fake_make_request)
    monkeypatch.setattr(ssrf_proxy, "buffer_response", lambda response, **_: response)
    client = HTTPKnowledgeFSProductRemoteClient(base_url="https://knowledge-fs.test", timeout_seconds=3)
    request = KnowledgeFSRemoteBinaryRequest(
        operation_id="uploadSmallFile",
        method="POST",
        path="/upload-sessions/session-1/small-file",
        namespace_id="tenant-1",
        knowledge_space_id="space-1",
        capability_token="small-file-capability",
        trace_id="trace-1",
        body=b"tiny",
        query=(("knowledgeSpaceId", "space-1"),),
    )

    assert client.execute_binary(request)["session"]["status"] == "completed"  # type: ignore[index]
    assert captured["content"] == b"tiny"
    assert captured["params"] == (("knowledgeSpaceId", "space-1"),)
    headers = captured["headers"]
    assert isinstance(headers, dict)
    assert headers == {
        "Accept": "application/json",
        "Accept-Encoding": "identity",
        "Authorization": "Bearer small-file-capability",
        "Content-Type": "application/octet-stream",
        "X-Trace-Id": "trace-1",
    }
    assert "small-file-capability" not in str(captured["url"])


def test_binary_remote_rejects_oversize_and_preserves_kfs_validation_status(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = 0

    def fake_make_request(**kwargs):
        nonlocal calls
        _ = kwargs
        calls += 1
        return httpx.Response(422, json={"error": "checksum"}, headers={"Content-Type": "application/json"})

    monkeypatch.setattr(ssrf_proxy, "make_request", fake_make_request)
    monkeypatch.setattr(ssrf_proxy, "buffer_response", lambda response, **_: response)
    client = HTTPKnowledgeFSProductRemoteClient(base_url="https://knowledge-fs.test", timeout_seconds=3)
    request = KnowledgeFSRemoteBinaryRequest(
        operation_id="uploadSmallFile",
        method="POST",
        path="/upload-sessions/session-1/small-file",
        namespace_id="tenant-1",
        knowledge_space_id="space-1",
        capability_token="small-file-capability",
        trace_id="trace-1",
        body=b"tiny",
        query=(("knowledgeSpaceId", "space-1"),),
    )

    with pytest.raises(KnowledgeFSProductRequestRejectedError) as rejected:
        client.execute_binary(request)
    assert rejected.value.status_code == 422
    assert calls == 1

    with pytest.raises(KnowledgeFSProductRequestRejectedError) as oversized:
        client.execute_binary(request._replace(body=b"x" * (8 * 1024 * 1024 + 1)))
    assert oversized.value.status_code == 413
    assert calls == 1


def test_batch_summary_uses_exact_capability_route_and_parses_camel_case(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, object] = {}
    response = httpx.Response(
        200,
        json={
            "items": [
                {
                    "description": None,
                    "documentCount": 3,
                    "icon": "builtin:book",
                    "indexState": None,
                    "knowledgeSpaceId": "space-1",
                    "lastJobState": None,
                    "modelProfile": None,
                    "name": "Space",
                    "revision": 2,
                    "slug": "space",
                }
            ]
        },
        headers={"Content-Type": "application/json"},
    )

    def fake_make_request(**kwargs):
        captured.update(kwargs)
        return response

    monkeypatch.setattr(ssrf_proxy, "make_request", fake_make_request)
    monkeypatch.setattr(ssrf_proxy, "buffer_response", lambda response, **_: response)
    client = HTTPKnowledgeFSProductRemoteClient(base_url="https://knowledge-fs.test", timeout_seconds=3)

    summaries = client.batch_space_summaries(
        namespace_id="tenant-1",
        knowledge_space_ids=("space-1",),
        capability_token="batch-token",
        trace_id="trace-1",
    )

    assert summaries["space-1"].document_count == 3
    assert captured["method"] == "POST"
    assert captured["url"] == "https://knowledge-fs.test/internal/knowledge-spaces/product-summaries/batch"
    assert captured["json"] == {"knowledgeSpaceIds": ["space-1"]}
    headers = captured["headers"]
    assert isinstance(headers, dict)
    assert headers["Authorization"] == "Bearer batch-token"


def test_batch_summary_rejects_out_of_scope_response_and_invalid_input_before_io(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = 0

    def fake_make_request(**kwargs):
        nonlocal calls
        calls += 1
        return httpx.Response(
            200,
            json={
                "items": [
                    {
                        "description": None,
                        "documentCount": 0,
                        "icon": None,
                        "indexState": None,
                        "knowledgeSpaceId": "space-other",
                        "lastJobState": None,
                        "modelProfile": None,
                        "name": "Other",
                        "revision": 1,
                        "slug": "other",
                    }
                ]
            },
            headers={"Content-Type": "application/json"},
        )

    monkeypatch.setattr(ssrf_proxy, "make_request", fake_make_request)
    monkeypatch.setattr(ssrf_proxy, "buffer_response", lambda response, **_: response)
    client = HTTPKnowledgeFSProductRemoteClient(base_url="https://knowledge-fs.test", timeout_seconds=3)

    with pytest.raises(KnowledgeFSProductRemoteError, match="out-of-scope"):
        client.batch_space_summaries(
            namespace_id="tenant-1",
            knowledge_space_ids=("space-1",),
            capability_token="batch-token",
            trace_id="trace-1",
        )
    assert calls == 1

    with pytest.raises(KnowledgeFSProductRemoteError, match="binding"):
        client.batch_space_summaries(
            namespace_id="tenant-1",
            knowledge_space_ids=tuple(f"space-{index}" for index in range(101)),
            capability_token="batch-token",
            trace_id="trace-1",
        )
    assert calls == 1


def _json_request(**updates: object) -> KnowledgeFSRemoteJSONRequest:
    values: dict[str, object] = {
        "operation_id": "getSettings",
        "method": "GET",
        "path": "/knowledge-spaces/space-1/product-settings",
        "namespace_id": "tenant-1",
        "knowledge_space_id": "space-1",
        "capability_token": "capability-token",
        "trace_id": "trace-1",
        "payload": None,
    }
    values.update(updates)
    return KnowledgeFSRemoteJSONRequest(**values)  # type: ignore[arg-type]


def _binary_request(**updates: object) -> KnowledgeFSRemoteBinaryRequest:
    values: dict[str, object] = {
        "operation_id": "uploadSmallFile",
        "method": "POST",
        "path": "/upload-sessions/session-1/small-file",
        "namespace_id": "tenant-1",
        "knowledge_space_id": "space-1",
        "capability_token": "capability-token",
        "trace_id": "trace-1",
        "body": b"tiny",
        "query": (("knowledgeSpaceId", "space-1"),),
    }
    values.update(updates)
    return KnowledgeFSRemoteBinaryRequest(**values)  # type: ignore[arg-type]


@pytest.mark.parametrize(
    "remote_request",
    [
        _json_request(operation_id="missingOperation"),
        _json_request(operation_id="uploadSmallFile", method="POST", path="/upload-sessions/session-1/small-file"),
        _json_request(method="POST"),
    ],
)
def test_json_remote_rejects_unknown_transport_or_method_without_io(
    remote_request: KnowledgeFSRemoteJSONRequest,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request_io = pytest.fail
    monkeypatch.setattr(ssrf_proxy, "make_request", request_io)
    client = HTTPKnowledgeFSProductRemoteClient(base_url="https://knowledge-fs.test", timeout_seconds=3)

    with pytest.raises(KnowledgeFSOperationUnavailableError):
        client.execute_json(remote_request)


@pytest.mark.parametrize(
    ("updates", "error_type", "status_code"),
    [
        ({"operation_id": "getSettings"}, KnowledgeFSOperationUnavailableError, None),
        ({"method": "GET"}, KnowledgeFSOperationUnavailableError, None),
        ({"namespace_id": ""}, KnowledgeFSProductRemoteError, None),
        ({"query": ()}, KnowledgeFSProductRemoteError, None),
        ({"body": b""}, KnowledgeFSProductRequestRejectedError, 422),
    ],
)
def test_binary_remote_rejects_manifest_binding_and_empty_body_before_io(
    updates: dict[str, object],
    error_type: type[Exception],
    status_code: int | None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(ssrf_proxy, "make_request", pytest.fail)
    client = HTTPKnowledgeFSProductRemoteClient(base_url="https://knowledge-fs.test", timeout_seconds=3)

    with pytest.raises(error_type) as raised:
        client.execute_binary(_binary_request(**updates))

    if status_code is not None:
        assert isinstance(raised.value, KnowledgeFSProductRequestRejectedError)
        assert raised.value.status_code == status_code


@pytest.mark.parametrize("binary", [False, True])
def test_remote_maps_network_and_response_limit_failures_to_stable_error(
    binary: bool,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fail_request(**_: object) -> httpx.Response:
        raise httpx.ConnectError("offline")

    monkeypatch.setattr(ssrf_proxy, "make_request", fail_request)
    client = HTTPKnowledgeFSProductRemoteClient(base_url="https://knowledge-fs.test", timeout_seconds=3)

    def invoke() -> object:
        if binary:
            return client.execute_binary(_binary_request())
        return client.execute_json(_json_request())

    with pytest.raises(KnowledgeFSProductRemoteError, match="request failed"):
        invoke()


@pytest.mark.parametrize(
    ("status_code", "content_type", "body", "error_type", "expected_status"),
    [
        (409, "application/json", b"{}", KnowledgeFSProductRequestRejectedError, 409),
        (413, "application/json", b"{}", KnowledgeFSProductRequestRejectedError, 413),
        (500, "application/json", b"{}", KnowledgeFSProductRemoteError, None),
        (200, "text/plain", b"ok", KnowledgeFSProductRemoteError, None),
        (200, "application/json", b"{", KnowledgeFSProductRemoteError, None),
    ],
)
def test_binary_remote_closes_and_maps_all_upstream_response_failures(
    status_code: int,
    content_type: str,
    body: bytes,
    error_type: type[Exception],
    expected_status: int | None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    response = httpx.Response(status_code, content=body, headers={"Content-Type": content_type})
    monkeypatch.setattr(ssrf_proxy, "make_request", lambda **_: response)
    monkeypatch.setattr(ssrf_proxy, "buffer_response", lambda buffered, **_: buffered)
    client = HTTPKnowledgeFSProductRemoteClient(base_url="https://knowledge-fs.test", timeout_seconds=3)

    with pytest.raises(error_type) as raised:
        client.execute_binary(_binary_request())

    if expected_status is not None:
        assert isinstance(raised.value, KnowledgeFSProductRequestRejectedError)
        assert raised.value.status_code == expected_status
    assert response.is_closed


@pytest.mark.parametrize(
    ("status_code", "content_type", "body"),
    [
        (500, "application/json", b"{}"),
        (200, "text/plain", b"ok"),
        (200, "application/json", b"{"),
    ],
)
def test_json_remote_closes_and_maps_upstream_response_failures(
    status_code: int,
    content_type: str,
    body: bytes,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    response = httpx.Response(status_code, content=body, headers={"Content-Type": content_type})
    monkeypatch.setattr(ssrf_proxy, "make_request", lambda **_: response)
    monkeypatch.setattr(ssrf_proxy, "buffer_response", lambda buffered, **_: buffered)
    client = HTTPKnowledgeFSProductRemoteClient(base_url="https://knowledge-fs.test", timeout_seconds=3)

    with pytest.raises(KnowledgeFSProductRemoteError):
        client.execute_json(_json_request())

    assert response.is_closed


def test_remote_rejects_invalid_json_payload_header_and_nonpositive_response_limit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(ssrf_proxy, "make_request", pytest.fail)
    client = HTTPKnowledgeFSProductRemoteClient(base_url="https://knowledge-fs.test", timeout_seconds=3)

    with pytest.raises(KnowledgeFSProductRemoteError, match="payload is invalid"):
        client.execute_json(_json_request(payload={"score": float("nan")}))
    with pytest.raises(KnowledgeFSProductRemoteError, match="header binding"):
        client.execute_json(_json_request(headers=(("Idempotency-Key", "short"),)))

    zero_limit_client = HTTPKnowledgeFSProductRemoteClient(
        base_url="https://knowledge-fs.test",
        timeout_seconds=3,
        max_response_bytes=0,
    )
    with pytest.raises(KnowledgeFSOperationUnavailableError, match="response limit"):
        zero_limit_client.execute_json(_json_request())
    with pytest.raises(KnowledgeFSOperationUnavailableError, match="response limit"):
        zero_limit_client.execute_binary(_binary_request())


def test_batch_summary_rejects_unavailable_and_invalid_response_contracts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = HTTPKnowledgeFSProductRemoteClient(base_url="https://knowledge-fs.test", timeout_seconds=3)
    monkeypatch.setattr(product_remote_http, "is_product_operation_ready", lambda _operation_id: False)
    with pytest.raises(KnowledgeFSOperationUnavailableError, match="unavailable"):
        client.batch_space_summaries(
            namespace_id="tenant-1",
            knowledge_space_ids=("space-1",),
            capability_token="token",
            trace_id="trace-1",
        )

    monkeypatch.setattr(product_remote_http, "is_product_operation_ready", lambda _operation_id: True)
    monkeypatch.setattr(client, "_request_json", lambda **_: {"items": "not-a-list"})
    with pytest.raises(KnowledgeFSProductRemoteError, match="invalid batch summary"):
        client.batch_space_summaries(
            namespace_id="tenant-1",
            knowledge_space_ids=("space-1",),
            capability_token="token",
            trace_id="trace-1",
        )


@pytest.mark.parametrize(
    ("template", "path", "matches"),
    [
        ("/jobs/{id}", "/jobs/job-1", True),
        ("/jobs/{id}", "/jobs", False),
        ("/jobs/{id}", "/jobs/..", False),
        ("/jobs/{id}", "/jobs/job%2Fone", False),
        ("/jobs/static", "/jobs/other", False),
    ],
)
def test_remote_path_matcher_rejects_unbound_or_ambiguous_segments(template: str, path: str, matches: bool) -> None:
    assert product_remote_http._matches_path(template, path) is matches
