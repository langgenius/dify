import json
from unittest.mock import MagicMock

import httpx
import pytest

from core.helper.ssrf_proxy import SSRFProxy
from core.tools.errors import ToolSSRFError
from services.data_source_oauth_service import DataSourceOAuthError
from services.notion_data_source_gateway import NotionDataSourceGateway


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


def test_provider_http_failure_is_translated_to_application_boundary_error() -> None:
    gateway, client = _gateway(httpx.MockTransport(lambda _request: httpx.Response(503, text="unavailable")))
    try:
        with pytest.raises(DataSourceOAuthError, match="unsuccessful response"):
            gateway.authorize("authorization-code")
    finally:
        client.close()


def test_ssrf_rejection_is_translated_to_application_boundary_error() -> None:
    client = MagicMock(spec=SSRFProxy)
    client.post.side_effect = ToolSSRFError("blocked")
    gateway = NotionDataSourceGateway(
        client_id="client-id",
        client_secret="client-secret",
        redirect_uri="https://api.example/oauth/data-source/callback/notion",
        http_client=client,
    )

    with pytest.raises(DataSourceOAuthError, match="Notion request failed"):
        gateway.authorize("authorization-code")
