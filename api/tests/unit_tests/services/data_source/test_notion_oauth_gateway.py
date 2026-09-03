import json
from dataclasses import dataclass
from typing import Never, cast

import httpx
import pytest

from core.helper.ssrf_proxy import SSRFProxy
from core.tools.errors import ToolSSRFError
from services.data_source.notion_oauth_gateway import NotionDataSourceGateway
from services.data_source.oauth_service import DataSourceOAuthError


@dataclass(frozen=True)
class RejectingSSRFClient:
    error: Exception

    def post(self, *_args: object, **_kwargs: object) -> Never:
        raise self.error


def _gateway(handler: httpx.MockTransport) -> tuple[NotionDataSourceGateway, httpx.Client]:
    client = httpx.Client(transport=handler)
    return (
        NotionDataSourceGateway(
            client_id="client-id",
            client_secret="client-secret",
            redirect_uri="https://api.example/oauth/data-source/callback/notion",
            http_client=client,
        ),
        client,
    )


def test_get_authorization_url_encodes_configured_values() -> None:
    gateway, client = _gateway(httpx.MockTransport(lambda _request: httpx.Response(500)))
    try:
        result = gateway.get_authorization_url()
    finally:
        client.close()

    assert result == (
        "https://api.notion.com/v1/oauth/authorize?client_id=client-id&response_type=code&"
        "redirect_uri=https%3A%2F%2Fapi.example%2Foauth%2Fdata-source%2Fcallback%2Fnotion&owner=user"
    )


def test_authorize_exchanges_code_and_builds_source_info_without_persistence() -> None:
    search_types: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/oauth/token":
            assert request.headers["authorization"].startswith("Basic ")
            return httpx.Response(
                200,
                json={
                    "access_token": "notion-token",
                    "workspace_name": "Notion Workspace",
                    "workspace_icon": "https://example/icon.png",
                    "workspace_id": "notion-workspace",
                },
            )
        if request.url.path == "/v1/search":
            payload = json.loads(request.content)
            search_types.append(payload["filter"]["value"])
            return httpx.Response(200, json={"results": [], "has_more": False})
        raise AssertionError(f"Unexpected Notion request: {request.url}")

    gateway, client = _gateway(httpx.MockTransport(handler))
    try:
        authorization = gateway.authorize("authorization-code")
    finally:
        client.close()

    assert authorization.access_token == "notion-token"
    assert authorization.source_info == {
        "workspace_name": "Notion Workspace",
        "workspace_icon": "https://example/icon.png",
        "workspace_id": "notion-workspace",
        "pages": [],
        "total": 0,
    }
    assert search_types == ["page", "database"]


@pytest.mark.parametrize("token_payload", [{}, {"access_token": ""}, {"access_token": 42}])
def test_authorize_rejects_missing_or_invalid_access_token(token_payload: dict[str, object]) -> None:
    gateway, client = _gateway(httpx.MockTransport(lambda _request: httpx.Response(200, json=token_payload)))
    try:
        with pytest.raises(DataSourceOAuthError, match="did not include an access token"):
            gateway.authorize("authorization-code")
    finally:
        client.close()


def test_authorize_internal_reads_workspace_name_and_builds_source_info() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/users/me":
            assert request.headers["authorization"] == "Bearer notion-token"
            return httpx.Response(
                200,
                json={"object": "user", "type": "bot", "bot": {"workspace_name": "Internal Workspace"}},
            )
        if request.url.path == "/v1/search":
            return httpx.Response(200, json={"results": [], "has_more": False})
        raise AssertionError(f"Unexpected Notion request: {request.url}")

    gateway, client = _gateway(httpx.MockTransport(handler))
    try:
        authorization = gateway.authorize_internal("notion-token", "notion-workspace")
    finally:
        client.close()

    assert authorization.access_token == "notion-token"
    assert authorization.source_info == {
        "workspace_name": "Internal Workspace",
        "workspace_icon": None,
        "workspace_id": "notion-workspace",
        "pages": [],
        "total": 0,
    }


@pytest.mark.parametrize(
    ("operation", "expected_message"),
    [
        ("authorize", "Notion OAuth response was invalid"),
        ("authorize_internal", "Notion integration response was invalid"),
        ("refresh", "Notion integration response was invalid"),
    ],
)
def test_public_operations_translate_malformed_page_payload(
    operation: str,
    expected_message: str,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/oauth/token":
            return httpx.Response(200, json={"access_token": "notion-token"})
        if request.url.path == "/v1/users/me":
            return httpx.Response(200, json={"object": "user", "type": "bot", "bot": {}})
        if request.url.path == "/v1/search":
            payload = json.loads(request.content)
            results = [{}] if payload["filter"]["value"] == "page" else []
            return httpx.Response(200, json={"results": results, "has_more": False})
        raise AssertionError(f"Unexpected Notion request: {request.url}")

    gateway, client = _gateway(httpx.MockTransport(handler))

    def invoke() -> None:
        if operation == "authorize":
            gateway.authorize("authorization-code")
        elif operation == "authorize_internal":
            gateway.authorize_internal("notion-token", "notion-workspace")
        else:
            gateway.refresh("notion-token", {})

    try:
        with pytest.raises(DataSourceOAuthError, match=expected_message):
            invoke()
    finally:
        client.close()


def test_authorized_pages_map_pagination_icons_and_parent_chains() -> None:
    page_requests: list[dict[str, object]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/search":
            payload = json.loads(request.content)
            object_type = payload["filter"]["value"]
            if object_type == "page":
                page_requests.append(payload)
                if "start_cursor" not in payload:
                    return httpx.Response(
                        200,
                        json={
                            "results": [
                                {
                                    "id": "page-1",
                                    "properties": {"Name": {"title": [{"plain_text": "First page"}]}},
                                    "icon": {"type": "external", "external": {"url": "/page-icon"}},
                                    "parent": {"type": "block_id", "block_id": "child-block"},
                                }
                            ],
                            "has_more": True,
                            "next_cursor": "next-page",
                        },
                    )
                return httpx.Response(
                    200,
                    json={
                        "results": [
                            {
                                "id": "page-2",
                                "properties": {},
                                "icon": {"type": "emoji", "emoji": "📄"},
                                "parent": {"type": "workspace", "workspace": True},
                            }
                        ],
                        "has_more": False,
                    },
                )
            return httpx.Response(
                200,
                json={
                    "results": [
                        {
                            "id": "database-1",
                            "title": [{"plain_text": "Database"}],
                            "icon": {"type": "emoji", "emoji": "🗃️"},
                            "parent": {"type": "page_id", "page_id": "page-1"},
                        },
                        {
                            "id": "database-2",
                            "title": [],
                            "icon": None,
                            "parent": {"type": "workspace", "workspace": True},
                        },
                    ],
                    "has_more": False,
                },
            )
        if request.url.path == "/v1/blocks/child-block":
            return httpx.Response(200, json={"parent": {"type": "block_id", "block_id": "root-block"}})
        if request.url.path == "/v1/blocks/root-block":
            return httpx.Response(200, json={"parent": {"type": "page_id", "page_id": "parent-page"}})
        raise AssertionError(f"Unexpected Notion request: {request.url}")

    gateway, client = _gateway(httpx.MockTransport(handler))
    try:
        pages = gateway.get_authorized_pages("notion-token")
    finally:
        client.close()

    assert pages == [
        {
            "page_id": "page-1",
            "page_name": "First page",
            "page_icon": {"type": "url", "url": "https://www.notion.so/page-icon"},
            "parent_id": "parent-page",
            "type": "page",
        },
        {
            "page_id": "page-2",
            "page_name": "Untitled",
            "page_icon": {"type": "emoji", "emoji": "📄"},
            "parent_id": "root",
            "type": "page",
        },
        {
            "page_id": "database-1",
            "page_name": "Database",
            "page_icon": {"type": "emoji", "emoji": "🗃️"},
            "parent_id": "page-1",
            "type": "database",
        },
        {
            "page_id": "database-2",
            "page_name": "Untitled",
            "page_icon": None,
            "parent_id": "root",
            "type": "database",
        },
    ]
    assert page_requests == [
        {"filter": {"value": "page", "property": "object"}},
        {"filter": {"value": "page", "property": "object"}, "start_cursor": "next-page"},
    ]


def test_refresh_preserves_workspace_metadata() -> None:
    gateway, client = _gateway(
        httpx.MockTransport(
            lambda request: (
                httpx.Response(200, json={"results": [], "has_more": False})
                if request.url.path == "/v1/search"
                else httpx.Response(404)
            )
        )
    )
    try:
        source_info = gateway.refresh(
            "notion-token",
            {
                "workspace_name": "Workspace",
                "workspace_icon": None,
                "workspace_id": "notion-workspace",
                "pages": [
                    {
                        "page_id": "old",
                        "page_name": "Old page",
                        "page_icon": None,
                        "parent_id": "root",
                        "type": "page",
                    }
                ],
                "total": 1,
            },
        )
    finally:
        client.close()

    assert source_info == {
        "workspace_name": "Workspace",
        "workspace_icon": None,
        "workspace_id": "notion-workspace",
        "pages": [],
        "total": 0,
    }


def test_search_rejects_missing_cursor_when_more_results_are_declared() -> None:
    requests = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal requests
        requests += 1
        return httpx.Response(200, json={"results": [], "has_more": True, "next_cursor": None})

    gateway, client = _gateway(httpx.MockTransport(handler))
    try:
        with pytest.raises(DataSourceOAuthError, match="valid next_cursor"):
            gateway.notion_page_search("notion-token")
    finally:
        client.close()

    assert requests == 1


def test_search_rejects_non_list_results() -> None:
    gateway, client = _gateway(
        httpx.MockTransport(lambda _request: httpx.Response(200, json={"results": {}, "has_more": False}))
    )
    try:
        with pytest.raises(DataSourceOAuthError, match="search response was invalid"):
            gateway.notion_page_search("notion-token")
    finally:
        client.close()


@pytest.mark.parametrize(
    ("payload", "expected_message"),
    [
        ({"parent": []}, "block response was invalid"),
        ({"parent": {"type": "page_id"}}, "block parent was invalid"),
        ({"parent": {"type": "page_id", "page_id": 42}}, "parent identifier was invalid"),
    ],
)
def test_block_parent_rejects_invalid_provider_payload(
    payload: dict[str, object],
    expected_message: str,
) -> None:
    gateway, client = _gateway(httpx.MockTransport(lambda _request: httpx.Response(200, json=payload)))
    try:
        with pytest.raises(DataSourceOAuthError, match=expected_message):
            gateway.notion_block_parent_page_id("notion-token", "block-1")
    finally:
        client.close()


def test_provider_http_failure_is_translated_to_application_boundary_error() -> None:
    gateway, client = _gateway(httpx.MockTransport(lambda _request: httpx.Response(503, text="unavailable")))
    try:
        with pytest.raises(DataSourceOAuthError, match="unsuccessful response"):
            gateway.authorize("authorization-code")
    finally:
        client.close()


def test_provider_non_object_json_is_rejected() -> None:
    gateway, client = _gateway(httpx.MockTransport(lambda _request: httpx.Response(200, json=[])))
    try:
        with pytest.raises(DataSourceOAuthError, match="response was invalid"):
            gateway.authorize("authorization-code")
    finally:
        client.close()


def test_provider_get_failure_is_translated_to_application_boundary_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("offline", request=request)

    gateway, client = _gateway(httpx.MockTransport(handler))
    try:
        with pytest.raises(DataSourceOAuthError, match="Notion request failed"):
            gateway.authorize_internal("notion-token", "notion-workspace")
    finally:
        client.close()


def test_ssrf_rejection_is_translated_to_application_boundary_error() -> None:
    client = RejectingSSRFClient(ToolSSRFError("blocked"))
    gateway = NotionDataSourceGateway(
        client_id="client-id",
        client_secret="client-secret",
        redirect_uri="https://api.example/oauth/data-source/callback/notion",
        http_client=cast(SSRFProxy, client),
    )

    with pytest.raises(DataSourceOAuthError, match="Notion request failed"):
        gateway.authorize("authorization-code")
