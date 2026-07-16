from __future__ import annotations

import gzip
import json
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from threading import Barrier, Lock
from uuid import uuid4

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from clients.knowledge_fs import (
    KnowledgeFSHTTPError,
    KnowledgeFSValidationError,
    OpenAPIKnowledgeFSClient,
)
from clients.knowledge_fs.credentials import (
    BearerCredential,
    KnowledgeFSScope,
    RS256KnowledgeFSCredentialProvider,
)

_DEFAULT_RESPONSE_LIMIT_BYTES = 1024 * 1024


class _ChunkedResponseStream(httpx.SyncByteStream):
    chunks: tuple[bytes, ...]

    def __init__(self, *chunks: bytes) -> None:
        self.chunks = chunks

    def __iter__(self) -> Iterator[bytes]:
        return iter(self.chunks)


class _StaticCredentialProvider:
    def issue(
        self,
        *,
        tenant_id: str,
        subject_id: str,
        scope: KnowledgeFSScope,
    ) -> BearerCredential:
        return BearerCredential(token="dev-token", expires_at=datetime.max.replace(tzinfo=UTC))


def _client(http_client: httpx.Client) -> OpenAPIKnowledgeFSClient:
    return OpenAPIKnowledgeFSClient(
        http_client=http_client,
        credential_provider=_StaticCredentialProvider(),
    )


def _space_payload(*, tenant_id: str = "dify-tenant") -> dict[str, str | int]:
    return {
        "id": "space-1",
        "tenantId": tenant_id,
        "name": "Product docs",
        "revision": 1,
        "slug": "product-docs",
        "description": "New RAG knowledge base",
        "createdAt": "2026-07-15T08:00:00Z",
        "updatedAt": "2026-07-15T08:00:00Z",
    }


def _creation_payload(*, tenant_id: str = "dify-tenant") -> dict[str, str | int]:
    return {**_space_payload(tenant_id=tenant_id), "configurationStatus": "pending-validation"}


def test_list_knowledge_spaces_uses_generated_operation_and_per_request_credential() -> None:
    captured_request: httpx.Request | None = None

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal captured_request
        captured_request = request
        return httpx.Response(200, json={"items": [_space_payload()], "nextCursor": "product-docs"})

    transport = httpx.MockTransport(handler)
    with httpx.Client(
        base_url="http://knowledge-fs.test",
        transport=transport,
    ) as http_client:
        client = _client(http_client)
        result = client.list_knowledge_spaces(
            limit=20,
            cursor="previous-space",
            tenant_id="dify-tenant",
            user_id="dify-user",
        )

    assert captured_request is not None
    assert captured_request.url.path == "/knowledge-spaces"
    assert dict(captured_request.url.params) == {"limit": "20", "cursor": "previous-space"}
    assert captured_request.headers["Authorization"] == "Bearer dev-token"
    assert "X-Dify-Tenant-ID" not in captured_request.headers
    assert "X-Dify-User-ID" not in captured_request.headers
    assert result.items[0].name == "Product docs"
    assert result.next_cursor == "product-docs"
    assert "Authorization" not in http_client.headers


def test_list_knowledge_spaces_rejects_items_from_another_tenant() -> None:
    transport = httpx.MockTransport(lambda _request: httpx.Response(200, json={"items": [_space_payload()]}))

    with httpx.Client(base_url="http://knowledge-fs.test", transport=transport) as http_client:
        client = _client(http_client)
        with pytest.raises(KnowledgeFSValidationError, match="response validation failed") as exc_info:
            client.list_knowledge_spaces(
                limit=20,
                cursor=None,
                tenant_id="another-tenant",
                user_id="dify-user",
            )

    assert exc_info.value.detail == "KnowledgeSpace.tenantId does not match the requested tenant"


def test_concurrent_tenants_receive_request_scoped_jwts_without_cross_tenant_leakage() -> None:
    now = datetime(2026, 7, 15, 10, 30, tzinfo=UTC)
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    provider = RS256KnowledgeFSCredentialProvider(
        private_key=private_key,
        key_id="2026-07-k1",
        issuer="https://dify.test/internal",
        audience="knowledge-fs",
        ttl_seconds=60,
        now=lambda: now,
        jti_factory=lambda: str(uuid4()),
    )
    requests_ready = Barrier(2)
    captured_claims: dict[str, dict[str, object]] = {}
    captured_claims_lock = Lock()

    def handler(request: httpx.Request) -> httpx.Response:
        requests_ready.wait(timeout=5)
        authorization = request.headers["Authorization"]
        assert authorization.startswith("Bearer ")
        claims = jwt.decode(
            authorization.removeprefix("Bearer "),
            private_key.public_key(),
            algorithms=["RS256"],
            audience="knowledge-fs",
            issuer="https://dify.test/internal",
            options={"verify_exp": False, "verify_iat": False, "verify_nbf": False},
        )
        with captured_claims_lock:
            captured_claims[request.method] = claims

        tenant_id = claims["tenant_id"]
        assert isinstance(tenant_id, str)
        payload = _space_payload(tenant_id=tenant_id)
        if request.method == "GET":
            return httpx.Response(200, json={"items": [payload]})
        return httpx.Response(201, json={**payload, "configurationStatus": "pending-validation"})

    transport = httpx.MockTransport(handler)
    with httpx.Client(base_url="http://knowledge-fs.test", transport=transport) as http_client:
        client = OpenAPIKnowledgeFSClient(http_client=http_client, credential_provider=provider)
        assert "Authorization" not in http_client.headers

        with ThreadPoolExecutor(max_workers=2) as executor:
            list_future = executor.submit(
                client.list_knowledge_spaces,
                limit=20,
                cursor=None,
                tenant_id="tenant-a",
                user_id="user-a",
            )
            create_future = executor.submit(
                client.create_knowledge_space,
                idempotency_key="create-product-docs",
                name="Product docs",
                description=None,
                tenant_id="tenant-b",
                user_id="user-b",
            )
            listed = list_future.result(timeout=10)
            created = create_future.result(timeout=10)

        assert "Authorization" not in http_client.headers

    assert listed.items[0].tenant_id == "tenant-a"
    assert created.tenant_id == "tenant-b"
    assert captured_claims["GET"]["tenant_id"] == "tenant-a"
    assert captured_claims["GET"]["sub"] == "user-a"
    assert captured_claims["GET"]["scope"] == "knowledge-spaces:read"
    assert captured_claims["POST"]["tenant_id"] == "tenant-b"
    assert captured_claims["POST"]["sub"] == "user-b"
    assert captured_claims["POST"]["scope"] == "knowledge-spaces:write"


def test_create_knowledge_space_uses_kfs_wire_shape() -> None:
    captured_body: dict[str, str] | None = None

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal captured_body
        captured_body = json.loads(request.content)
        return httpx.Response(201, json=_creation_payload())

    transport = httpx.MockTransport(handler)
    with httpx.Client(
        base_url="http://knowledge-fs.test",
        headers={"Authorization": "Bearer dev-token"},
        transport=transport,
    ) as http_client:
        client = _client(http_client)
        result = client.create_knowledge_space(
            idempotency_key="create-product-docs",
            name="Product docs",
            description="New RAG knowledge base",
            tenant_id="dify-tenant",
            user_id="dify-user",
        )

    assert captured_body == {
        "idempotencyKey": "create-product-docs",
        "name": "Product docs",
        "description": "New RAG knowledge base",
    }
    assert result.id == "space-1"


def test_create_knowledge_space_rejects_response_from_another_tenant() -> None:
    transport = httpx.MockTransport(
        lambda _request: httpx.Response(201, json=_creation_payload(tenant_id="another-tenant"))
    )

    with httpx.Client(base_url="http://knowledge-fs.test", transport=transport) as http_client:
        client = _client(http_client)
        with pytest.raises(KnowledgeFSValidationError, match="response validation failed") as exc_info:
            client.create_knowledge_space(
                idempotency_key="create-product-docs",
                name="Product docs",
                description=None,
                tenant_id="dify-tenant",
                user_id="dify-user",
            )

    assert exc_info.value.detail == "KnowledgeSpace.tenantId does not match the requested tenant"


def test_create_knowledge_space_rejects_invalid_revision() -> None:
    transport = httpx.MockTransport(lambda _request: httpx.Response(201, json={**_creation_payload(), "revision": "1"}))

    with httpx.Client(base_url="http://knowledge-fs.test", transport=transport) as http_client:
        client = _client(http_client)
        with pytest.raises(KnowledgeFSValidationError, match="response validation failed") as exc_info:
            client.create_knowledge_space(
                idempotency_key="create-product-docs",
                name="Product docs",
                description=None,
                tenant_id="dify-tenant",
                user_id="dify-user",
            )

    assert exc_info.value.detail == "KnowledgeSpace.revision must be a positive integer"


def test_client_preserves_http_status_and_safe_error_detail() -> None:
    transport = httpx.MockTransport(lambda _request: httpx.Response(409, json={"error": "Tenant slug conflict"}))

    with httpx.Client(
        base_url="http://knowledge-fs.test",
        headers={"Authorization": "Bearer dev-token"},
        transport=transport,
    ) as http_client:
        client = _client(http_client)
        with pytest.raises(KnowledgeFSHTTPError) as exc_info:
            client.create_knowledge_space(
                idempotency_key="create-product-docs",
                name="Product docs",
                description=None,
                tenant_id="dify-tenant",
                user_id="dify-user",
            )

    assert exc_info.value.status_code == 409
    assert exc_info.value.detail == "Tenant slug conflict"


def test_client_ignores_non_string_error_detail_without_raising_type_error() -> None:
    transport = httpx.MockTransport(lambda _request: httpx.Response(409, json={"error": 123}))

    with httpx.Client(base_url="http://knowledge-fs.test", transport=transport) as http_client:
        client = _client(http_client)
        with pytest.raises(KnowledgeFSHTTPError) as exc_info:
            client.create_knowledge_space(
                idempotency_key="create-product-docs",
                name="Product docs",
                description=None,
                tenant_id="dify-tenant",
                user_id="dify-user",
            )

    assert exc_info.value.status_code == 409
    assert exc_info.value.detail is None


def test_client_rejects_malformed_success_response() -> None:
    transport = httpx.MockTransport(lambda _request: httpx.Response(200, json={"items": [{}]}))

    with httpx.Client(
        base_url="http://knowledge-fs.test",
        headers={"Authorization": "Bearer dev-token"},
        transport=transport,
    ) as http_client:
        client = _client(http_client)
        with pytest.raises(KnowledgeFSValidationError):
            client.list_knowledge_spaces(
                limit=20,
                cursor=None,
                tenant_id="dify-tenant",
                user_id="dify-user",
            )


def test_client_rejects_oversized_success_response_without_content_length() -> None:
    body = b'{"items":[],"padding":"' + (b"x" * _DEFAULT_RESPONSE_LIMIT_BYTES) + b'"}'
    transport = httpx.MockTransport(
        lambda _request: httpx.Response(
            200,
            stream=_ChunkedResponseStream(body[:37], body[37:]),
        )
    )

    with httpx.Client(base_url="http://knowledge-fs.test", transport=transport) as http_client:
        client = _client(http_client)
        with pytest.raises(KnowledgeFSValidationError, match="response validation failed") as exc_info:
            client.list_knowledge_spaces(
                limit=20,
                cursor=None,
                tenant_id="dify-tenant",
                user_id="dify-user",
            )

    assert exc_info.value.detail == "KnowledgeFS response exceeds 1048576 bytes"


def test_client_rejects_compressed_response_before_decoding() -> None:
    body = b'{"items":[],"padding":"' + (b"x" * _DEFAULT_RESPONSE_LIMIT_BYTES) + b'"}'
    compressed_body = gzip.compress(body)
    transport = httpx.MockTransport(
        lambda _request: httpx.Response(
            200,
            headers={"Content-Encoding": "gzip"},
            stream=_ChunkedResponseStream(compressed_body[:23], compressed_body[23:]),
        )
    )

    with httpx.Client(base_url="http://knowledge-fs.test", transport=transport) as http_client:
        client = _client(http_client)
        with pytest.raises(KnowledgeFSValidationError, match="response validation failed") as exc_info:
            client.list_knowledge_spaces(
                limit=20,
                cursor=None,
                tenant_id="dify-tenant",
                user_id="dify-user",
            )

    assert exc_info.value.detail == "KnowledgeFS response uses an unsupported content encoding"


def test_client_rejects_oversized_error_response_with_forged_content_length() -> None:
    body = b'{"error":"' + (b"x" * _DEFAULT_RESPONSE_LIMIT_BYTES) + b'"}'
    transport = httpx.MockTransport(
        lambda _request: httpx.Response(
            409,
            headers={"Content-Length": "1"},
            stream=_ChunkedResponseStream(body[:41], body[41:]),
        )
    )

    with httpx.Client(base_url="http://knowledge-fs.test", transport=transport) as http_client:
        client = _client(http_client)
        with pytest.raises(KnowledgeFSValidationError, match="response validation failed") as exc_info:
            client.create_knowledge_space(
                idempotency_key="create-product-docs",
                name="Product docs",
                description=None,
                tenant_id="dify-tenant",
                user_id="dify-user",
            )

    assert exc_info.value.detail == "KnowledgeFS response exceeds 1048576 bytes"


def test_client_preserves_existing_response_hooks() -> None:
    observed_statuses: list[int] = []

    def response_hook(response: httpx.Response) -> None:
        observed_statuses.append(response.status_code)
        assert response.json()["items"][0]["id"] == "space-1"

    transport = httpx.MockTransport(lambda _request: httpx.Response(200, json={"items": [_space_payload()]}))
    with httpx.Client(
        base_url="http://knowledge-fs.test",
        transport=transport,
        event_hooks={"response": [response_hook]},
    ) as http_client:
        client = _client(http_client)
        client.list_knowledge_spaces(
            limit=20,
            cursor=None,
            tenant_id="dify-tenant",
            user_id="dify-user",
        )

    assert observed_statuses == [200]


@pytest.mark.parametrize(
    "payload",
    [
        {"items": [], "nextCursor": 123},
        {"items": [{**_space_payload(), "id": 123}]},
        {"items": [{**_space_payload(), "revision": 0}]},
    ],
)
def test_client_rejects_success_fields_with_wrong_runtime_types(payload: object) -> None:
    transport = httpx.MockTransport(lambda _request: httpx.Response(200, json=payload))

    with httpx.Client(base_url="http://knowledge-fs.test", transport=transport) as http_client:
        client = _client(http_client)
        with pytest.raises(KnowledgeFSValidationError):
            client.list_knowledge_spaces(
                limit=20,
                cursor=None,
                tenant_id="dify-tenant",
                user_id="dify-user",
            )
