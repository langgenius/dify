from types import SimpleNamespace
from unittest.mock import Mock

from controllers.console.workspace import snippets as snippets_module
from services.snippet_dsl_service import ImportStatus, SnippetImportInfo


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


def test_import_snippet_returns_202_for_pending_confirmation(app, monkeypatch):
    user = SimpleNamespace(id="account-1")
    result = SnippetImportInfo(id="import-1", status=ImportStatus.PENDING, imported_dsl_version="999.0.0")
    import_snippet = Mock(return_value=result)
    session = SimpleNamespace(commit=Mock())

    class _SessionContext:
        def __init__(self, engine):
            self.engine = engine

        def __enter__(self):
            return session

        def __exit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr(snippets_module, "current_account_with_tenant", lambda: (user, "tenant-1"))
    monkeypatch.setattr(snippets_module, "Session", _SessionContext)
    monkeypatch.setattr(snippets_module, "db", SimpleNamespace(engine=object()))
    monkeypatch.setattr(
        snippets_module,
        "SnippetDslService",
        Mock(return_value=SimpleNamespace(import_snippet=import_snippet)),
    )

    api = snippets_module.CustomizedSnippetImportApi()
    handler = _unwrap(api.post)

    with app.test_request_context(
        "/workspaces/current/customized-snippets/imports",
        method="POST",
        json={"mode": "yaml-content", "yaml_content": "kind: snippet"},
    ):
        response, status_code = handler(api)

    assert status_code == 202
    assert response["status"] == ImportStatus.PENDING.value
    import_snippet.assert_called_once()
    session.commit.assert_called_once()


def test_increment_use_count_returns_refreshed_count(app, monkeypatch):
    snippet = SimpleNamespace(id="snippet-1", tenant_id="tenant-1", use_count=2)
    merged_snippet = SimpleNamespace(id="snippet-1", tenant_id="tenant-1", use_count=3)
    session = SimpleNamespace(merge=Mock(return_value=merged_snippet), commit=Mock(), refresh=Mock())

    class _SessionContext:
        def __init__(self, engine):
            self.engine = engine

        def __enter__(self):
            return session

        def __exit__(self, exc_type, exc, tb):
            return False

    increment_use_count = Mock()
    monkeypatch.setattr(snippets_module, "current_account_with_tenant", lambda: (SimpleNamespace(), "tenant-1"))
    monkeypatch.setattr(snippets_module.SnippetService, "get_snippet_by_id", Mock(return_value=snippet))
    monkeypatch.setattr(snippets_module.SnippetService, "increment_use_count", increment_use_count)
    monkeypatch.setattr(snippets_module, "Session", _SessionContext)
    monkeypatch.setattr(snippets_module, "db", SimpleNamespace(engine=object()))

    api = snippets_module.CustomizedSnippetUseCountIncrementApi()
    handler = _unwrap(api.post)

    with app.test_request_context(
        "/workspaces/current/customized-snippets/snippet-1/use-count/increment",
        method="POST",
    ):
        response, status_code = handler(api, snippet_id="snippet-1")

    assert status_code == 200
    assert response == {"result": "success", "use_count": 3}
    increment_use_count.assert_called_once_with(session=session, snippet=merged_snippet)
    session.commit.assert_called_once()
    session.refresh.assert_called_once_with(merged_snippet)
