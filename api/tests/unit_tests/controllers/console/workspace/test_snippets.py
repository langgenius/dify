from types import SimpleNamespace
from unittest.mock import Mock

from controllers.console.workspace import snippets as snippets_module


def _unwrap(func):
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


def test_create_snippet_rejects_forbidden_nodes(app, monkeypatch):
    user = SimpleNamespace(id="account-1")
    create_snippet = Mock()
    monkeypatch.setattr(snippets_module, "current_account_with_tenant", lambda: (user, "tenant-1"))
    monkeypatch.setattr(snippets_module.SnippetService, "create_snippet", create_snippet)

    api = snippets_module.CustomizedSnippetsApi()
    handler = _unwrap(api.post)

    with app.test_request_context(
        "/workspaces/current/customized-snippets",
        method="POST",
        json={
            "name": "snippet with invalid node",
            "type": "node",
            "graph": {
                "nodes": [
                    {"id": "knowledge-1", "data": {"type": "knowledge-retrieval"}},
                ],
                "edges": [],
            },
        },
    ):
        response, status_code = handler(api)

    assert status_code == 400
    assert "knowledge-retrieval" in response["message"]
    create_snippet.assert_not_called()
