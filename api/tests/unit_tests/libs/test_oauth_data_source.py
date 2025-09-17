from urllib.parse import parse_qs, urlparse

import pytest

from libs import oauth_data_source


class _DummyResponse:
    def __init__(self, payload: dict, status_code: int = 200):
        self._payload = payload
        self.status_code = status_code

    def json(self) -> dict:
        return self._payload


def test_notion_oauth_authorization_url_contains_expected_params():
    notion_oauth = oauth_data_source.NotionOAuth("cid", "secret", "https://callback")

    url = notion_oauth.get_authorization_url()

    parsed = urlparse(url)
    assert parsed.scheme == "https"
    assert parsed.netloc == "api.notion.com"
    assert parsed.path == "/v1/oauth/authorize"

    params = parse_qs(parsed.query)
    assert params == {
        "client_id": ["cid"],
        "response_type": ["code"],
        "redirect_uri": ["https://callback"],
        "owner": ["user"],
    }


def test_notion_oauth_get_access_token_raises_when_missing_token(monkeypatch):
    notion_oauth = oauth_data_source.NotionOAuth("cid", "secret", "https://callback")

    def fake_post(*_, **__):
        return _DummyResponse({"error": "invalid_grant"})

    monkeypatch.setattr(oauth_data_source.requests, "post", fake_post)

    with pytest.raises(ValueError, match="Error in Notion OAuth: {'error': 'invalid_grant'}"):
        notion_oauth.get_access_token("code")


def test_get_authorized_pages_builds_page_and_database_payload(monkeypatch):
    notion_oauth = oauth_data_source.NotionOAuth("cid", "secret", "https://callback")

    page_results = [
        {
            "id": "page-1",
            "properties": {"Title": {"title": [{"plain_text": "First"}]}},
            "icon": {"type": "file", "file": {"url": "/icon.png"}},
            "parent": {"type": "block_id", "block_id": "block-1"},
        },
        {
            "id": "page-2",
            "properties": {},
            "icon": None,
            "parent": {"type": "workspace"},
        },
        {
            "id": "page-3",
            "properties": {"Name": {"title": [{"plain_text": "Third"}]}},
            "icon": {"type": "emoji", "emoji": "✨"},
            "parent": {"type": "page_id", "page_id": "parent-3"},
        },
    ]

    database_results = [
        {
            "id": "db-1",
            "title": [{"plain_text": "Database"}],
            "icon": {"type": "external", "external": {"url": "http://db/icon.png"}},
            "parent": {"type": "block_id", "block_id": "db-block"},
        },
        {
            "id": "db-2",
            "title": [],
            "icon": None,
            "parent": {"type": "workspace"},
        },
    ]

    def fake_page_search(self, access_token):
        assert access_token == "token"
        return page_results

    def fake_database_search(self, access_token):
        assert access_token == "token"
        return database_results

    def fake_block_parent(self, access_token, block_id):
        assert access_token == "token"
        mapping = {"block-1": "parent-block", "db-block": "db-parent"}
        return mapping[block_id]

    monkeypatch.setattr(oauth_data_source.NotionOAuth, "notion_page_search", fake_page_search)
    monkeypatch.setattr(oauth_data_source.NotionOAuth, "notion_database_search", fake_database_search)
    monkeypatch.setattr(oauth_data_source.NotionOAuth, "notion_block_parent_page_id", fake_block_parent)

    pages = notion_oauth.get_authorized_pages("token")

    assert pages == [
        {
            "page_id": "page-1",
            "page_name": "First",
            "page_icon": {"type": "url", "url": "https://www.notion.so/icon.png"},
            "parent_id": "parent-block",
            "type": "page",
        },
        {
            "page_id": "page-2",
            "page_name": "Untitled",
            "page_icon": None,
            "parent_id": "root",
            "type": "page",
        },
        {
            "page_id": "page-3",
            "page_name": "Third",
            "page_icon": {"type": "emoji", "emoji": "✨"},
            "parent_id": "parent-3",
            "type": "page",
        },
        {
            "page_id": "db-1",
            "page_name": "Database",
            "page_icon": {"type": "url", "url": "http://db/icon.png"},
            "parent_id": "db-parent",
            "type": "database",
        },
        {
            "page_id": "db-2",
            "page_name": "Untitled",
            "page_icon": None,
            "parent_id": "root",
            "type": "database",
        },
    ]


def test_notion_block_parent_page_id_recurses_until_non_block(monkeypatch):
    notion_oauth = oauth_data_source.NotionOAuth("cid", "secret", "https://callback")

    def fake_get(url, **_):
        block_id = url.rsplit("/", 1)[1]
        payloads = {
            "block-1": {"parent": {"type": "block_id", "block_id": "block-2"}},
            "block-2": {"parent": {"type": "page_id", "page_id": "page-123"}},
        }
        return _DummyResponse(payloads[block_id])

    monkeypatch.setattr(oauth_data_source.requests, "get", fake_get)

    parent_id = notion_oauth.notion_block_parent_page_id("token", "block-1")

    assert parent_id == "page-123"


def test_notion_block_parent_page_id_raises_for_error(monkeypatch):
    notion_oauth = oauth_data_source.NotionOAuth("cid", "secret", "https://callback")

    def fake_get(*_, **__):
        return _DummyResponse({"message": "not found"}, status_code=404)

    monkeypatch.setattr(oauth_data_source.requests, "get", fake_get)

    with pytest.raises(ValueError, match="Error fetching block parent page ID: not found"):
        notion_oauth.notion_block_parent_page_id("token", "block")


def test_notion_workspace_name_returns_workspace(monkeypatch):
    notion_oauth = oauth_data_source.NotionOAuth("cid", "secret", "https://callback")

    def fake_get(*_, **__):
        return _DummyResponse({
            "object": "user",
            "type": "bot",
            "bot": {"workspace_name": "My Workspace"},
        })

    monkeypatch.setattr(oauth_data_source.requests, "get", fake_get)

    assert notion_oauth.notion_workspace_name("token") == "My Workspace"


def test_notion_workspace_name_defaults_when_missing(monkeypatch):
    notion_oauth = oauth_data_source.NotionOAuth("cid", "secret", "https://callback")

    def fake_get(*_, **__):
        return _DummyResponse({"object": "list"})

    monkeypatch.setattr(oauth_data_source.requests, "get", fake_get)

    assert notion_oauth.notion_workspace_name("token") == "workspace"


def test_notion_page_search_handles_pagination(monkeypatch):
    notion_oauth = oauth_data_source.NotionOAuth("cid", "secret", "https://callback")
    payloads = []

    responses = iter(
        [
            _DummyResponse({"results": [{"id": "p1"}], "has_more": True, "next_cursor": "cursor-1"}),
            _DummyResponse({"results": [{"id": "p2"}], "has_more": False, "next_cursor": None}),
        ]
    )

    def fake_post(url, json, **_):
        payloads.append(json)
        return next(responses)

    monkeypatch.setattr(oauth_data_source.requests, "post", fake_post)

    results = notion_oauth.notion_page_search("token")

    assert results == [{"id": "p1"}, {"id": "p2"}]
    assert payloads[0] == {"filter": {"value": "page", "property": "object"}}
    assert payloads[1]["start_cursor"] == "cursor-1"


def test_notion_database_search_handles_pagination(monkeypatch):
    notion_oauth = oauth_data_source.NotionOAuth("cid", "secret", "https://callback")
    payloads = []

    responses = iter(
        [
            _DummyResponse({"results": [{"id": "d1"}], "has_more": True, "next_cursor": "cursor-2"}),
            _DummyResponse({"results": [{"id": "d2"}], "has_more": False, "next_cursor": None}),
        ]
    )

    def fake_post(url, json, **_):
        payloads.append(json)
        return next(responses)

    monkeypatch.setattr(oauth_data_source.requests, "post", fake_post)

    results = notion_oauth.notion_database_search("token")

    assert results == [{"id": "d1"}, {"id": "d2"}]
    assert payloads[0] == {"filter": {"value": "database", "property": "object"}}
    assert payloads[1]["start_cursor"] == "cursor-2"
