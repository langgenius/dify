from datetime import UTC, datetime
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import ANY, Mock

import pytest
from flask import Flask
from werkzeug.exceptions import NotFound

from controllers.console.workspace import snippets as snippets_module
from models.account import Account, TenantAccountRole
from services.snippet_dsl_service import ImportStatus, SnippetImportInfo


@pytest.fixture(autouse=True)
def _patch_snippet_service_factory(monkeypatch):
    def factory():
        return snippets_module.SnippetService.__new__(snippets_module.SnippetService)

    monkeypatch.setattr(snippets_module, "_snippet_service", factory)


class _SessionContext:
    def __init__(self, engine, *args, **kwargs):
        self.engine = engine
        self.session = kwargs.pop("session", None)

    def __enter__(self):
        return self.session

    def __exit__(self, exc_type, exc, tb):
        return False


def _account(account_id: str = "account-1") -> Account:
    account = Account(name="Test User", email=f"{account_id}@example.com")
    account.id = account_id
    account.role = TenantAccountRole.EDITOR
    return account


def _snippet(**overrides) -> SimpleNamespace:
    data = {
        "id": "snippet-1",
        "tenant_id": "tenant-1",
        "name": "Snippet",
        "description": "Description",
        "type": snippets_module.SnippetType.NODE,
        "version": 1,
        "use_count": 0,
        "is_published": False,
        "icon_info": None,
        "graph_dict": {},
        "input_fields_list": [],
        "tags": [],
        "created_by": None,
        "author_name": None,
        "created_by_account": None,
        "created_at": datetime.fromtimestamp(1_704_067_200, UTC),
        "updated_by": None,
        "updated_by_account": None,
        "updated_at": datetime.fromtimestamp(1_704_153_600, UTC),
    }
    data.update(overrides)
    return SimpleNamespace(**data)


def test_snippet_list_item_response_rejects_missing_timestamps():
    snippet = _snippet(created_at=None)

    with pytest.raises(ValueError, match="timestamp is required"):
        snippets_module.SnippetListItemResponse.model_validate(snippet)


def test_snippet_response_rejects_missing_timestamps():
    snippet = _snippet(updated_at=None)

    with pytest.raises(ValueError, match="timestamp is required"):
        snippets_module.SnippetResponse.model_validate(snippet)


def test_normalize_snippet_list_query_args_sorts_indexed_values():
    query_args = snippets_module.MultiDict(
        [
            ("tag_ids[1]", "tag-b"),
            ("tag_ids[0]", "tag-a"),
            ("creator_ids[1]", "account-b"),
            ("creator_ids[0]", "account-a"),
            ("keyword", "search"),
        ]
    )

    assert snippets_module._normalize_snippet_list_query_args(query_args) == {
        "tag_ids": ["tag-a", "tag-b"],
        "creators": ["account-a", "account-b"],
        "keyword": "search",
    }


def test_list_snippets_returns_pagination(app: Flask, monkeypatch: pytest.MonkeyPatch):
    snippets = [_snippet()]
    tag_id = "11111111-1111-1111-1111-111111111111"
    get_snippets = Mock(return_value=(snippets, 1, False))
    monkeypatch.setattr(snippets_module.SnippetService, "get_snippets", get_snippets)

    api = snippets_module.CustomizedSnippetsApi()
    handler = unwrap(api.get)

    with app.test_request_context(
        f"/workspaces/current/customized-snippets?page=2&limit=10&tag_ids[0]={tag_id}&creator_ids[0]=account-2"
    ):
        response, status_code = handler(api, "tenant-1")

    assert status_code == 200
    assert response == {
        "data": [
            {
                "id": "snippet-1",
                "name": "Snippet",
                "description": "Description",
                "type": snippets_module.SnippetType.NODE.value,
                "version": 1,
                "use_count": 0,
                "is_published": False,
                "icon_info": None,
                "tags": [],
                "created_by": None,
                "author_name": None,
                "created_at": 1_704_067_200,
                "updated_by": None,
                "updated_at": 1_704_153_600,
            }
        ],
        "page": 2,
        "limit": 10,
        "total": 1,
        "has_more": False,
    }
    get_snippets.assert_called_once_with(
        tenant_id="tenant-1",
        session=ANY,
        page=2,
        limit=10,
        keyword=None,
        is_published=None,
        creators=["account-2"],
        tag_ids=[tag_id],
    )


def test_create_snippet_defaults_unknown_type_and_returns_created(app: Flask, monkeypatch: pytest.MonkeyPatch):
    user = _account("account-1")
    snippet = _snippet()
    create_snippet = Mock(return_value=snippet)
    monkeypatch.setattr(snippets_module.SnippetService, "create_snippet", create_snippet)
    monkeypatch.setattr(
        snippets_module.CreateSnippetPayload,
        "model_validate",
        Mock(
            return_value=SimpleNamespace(
                name="Snippet",
                type="unknown",
                description="Description",
                graph=None,
                icon_info=None,
                input_fields=[],
            )
        ),
    )

    api = snippets_module.CustomizedSnippetsApi()
    handler = unwrap(api.post)

    with app.test_request_context(
        "/workspaces/current/customized-snippets",
        method="POST",
        json={"name": "Snippet", "type": "node", "description": "Description"},
    ):
        response, status_code = handler(api, "tenant-1", user)

    assert status_code == 201
    assert response["id"] == "snippet-1"
    assert response["type"] == snippets_module.SnippetType.NODE.value
    assert create_snippet.call_args.kwargs["snippet_type"] == snippets_module.SnippetType.NODE


def test_create_snippet_rejects_forbidden_nodes(app: Flask, monkeypatch: pytest.MonkeyPatch):
    user = _account("account-1")
    create_snippet = Mock()
    monkeypatch.setattr(snippets_module.SnippetService, "create_snippet", create_snippet)

    api = snippets_module.CustomizedSnippetsApi()
    handler = unwrap(api.post)

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
        response, status_code = handler(api, "tenant-1", user)

    assert status_code == 400
    assert "knowledge-retrieval" in response["message"]
    create_snippet.assert_not_called()


def test_get_snippet_detail_raises_when_missing(app: Flask, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(snippets_module.SnippetService, "get_snippet_by_id", Mock(return_value=None))

    api = snippets_module.CustomizedSnippetDetailApi()
    handler = unwrap(api.get)

    with app.test_request_context("/workspaces/current/customized-snippets/snippet-1"):
        with pytest.raises(NotFound, match="Snippet not found"):
            handler(api, "tenant-1", snippet_id="snippet-1")


def test_get_snippet_detail_returns_snippet(app: Flask, monkeypatch: pytest.MonkeyPatch):
    snippet = _snippet()
    monkeypatch.setattr(snippets_module.SnippetService, "get_snippet_by_id", Mock(return_value=snippet))

    api = snippets_module.CustomizedSnippetDetailApi()
    handler = unwrap(api.get)

    with app.test_request_context("/workspaces/current/customized-snippets/snippet-1"):
        response, status_code = handler(api, "tenant-1", snippet_id="snippet-1")

    assert status_code == 200
    assert response["id"] == "snippet-1"
    assert response["name"] == "Snippet"


def test_patch_snippet_returns_400_for_empty_payload(app: Flask, monkeypatch: pytest.MonkeyPatch):
    snippet = _snippet()
    user = _account("user-1")
    monkeypatch.setattr(snippets_module.SnippetService, "get_snippet_by_id", Mock(return_value=snippet))

    api = snippets_module.CustomizedSnippetDetailApi()
    handler = unwrap(api.patch)

    with app.test_request_context(
        "/workspaces/current/customized-snippets/snippet-1",
        method="PATCH",
        json={},
    ):
        response, status_code = handler(api, "tenant-1", user, snippet_id="snippet-1")

    assert status_code == 400
    assert response == {"message": "No valid fields to update"}


def test_patch_snippet_updates_and_commits(app: Flask, monkeypatch: pytest.MonkeyPatch):
    user = _account("account-1")
    snippet = _snippet()
    updated_snippet = _snippet(name="New")
    session = SimpleNamespace(merge=Mock(return_value=snippet), commit=Mock())
    update_snippet = Mock(return_value=updated_snippet)

    class SessionContext(_SessionContext):
        def __init__(self, engine, *args, **kwargs):
            super().__init__(engine, *args, session=session, **kwargs)

    monkeypatch.setattr(snippets_module.SnippetService, "get_snippet_by_id", Mock(return_value=snippet))
    monkeypatch.setattr(snippets_module.SnippetService, "update_snippet", update_snippet)
    monkeypatch.setattr(snippets_module, "Session", SessionContext)
    monkeypatch.setattr(snippets_module, "db", SimpleNamespace(engine=object()))

    api = snippets_module.CustomizedSnippetDetailApi()
    handler = unwrap(api.patch)

    with app.test_request_context(
        "/workspaces/current/customized-snippets/snippet-1",
        method="PATCH",
        json={"name": "New", "icon_info": {"icon": "star"}},
    ):
        response, status_code = handler(api, "tenant-1", user, snippet_id="snippet-1")

    assert status_code == 200
    assert response["id"] == "snippet-1"
    assert response["name"] == "New"
    update_snippet.assert_called_once()
    assert update_snippet.call_args.kwargs["data"] == {
        "name": "New",
        "icon_info": {"icon": "star", "icon_background": None, "icon_type": None, "icon_url": None},
    }
    session.commit.assert_called_once()


def test_delete_snippet_deletes_and_commits(app: Flask, monkeypatch: pytest.MonkeyPatch):
    snippet = _snippet()
    session = SimpleNamespace(merge=Mock(return_value=snippet), commit=Mock())
    delete_snippet = Mock()

    class SessionContext(_SessionContext):
        def __init__(self, engine, *args, **kwargs):
            super().__init__(engine, *args, session=session, **kwargs)

    monkeypatch.setattr(snippets_module.SnippetService, "get_snippet_by_id", Mock(return_value=snippet))
    monkeypatch.setattr(snippets_module.SnippetService, "delete_snippet", delete_snippet)
    monkeypatch.setattr(snippets_module, "Session", SessionContext)
    monkeypatch.setattr(snippets_module, "db", SimpleNamespace(engine=object()))

    api = snippets_module.CustomizedSnippetDetailApi()
    handler = unwrap(api.delete)

    with app.test_request_context("/workspaces/current/customized-snippets/snippet-1", method="DELETE"):
        response, status_code = handler(api, "tenant-1", snippet_id="snippet-1")

    assert status_code == 204
    assert response == ""
    delete_snippet.assert_called_once_with(session=session, snippet=snippet)
    session.commit.assert_called_once()


def test_export_snippet_returns_yaml_attachment(app: Flask, monkeypatch: pytest.MonkeyPatch):
    snippet = _snippet(name="Snippet One")
    export_snippet_dsl = Mock(return_value="version: 0.1.0\nkind: snippet\n")
    session = SimpleNamespace()

    class SessionContext(_SessionContext):
        def __init__(self, engine, *args, **kwargs):
            super().__init__(engine, *args, session=session, **kwargs)

    monkeypatch.setattr(snippets_module.SnippetService, "get_snippet_by_id", Mock(return_value=snippet))
    monkeypatch.setattr(
        snippets_module,
        "SnippetDslService",
        Mock(return_value=SimpleNamespace(export_snippet_dsl=export_snippet_dsl)),
    )
    monkeypatch.setattr(snippets_module, "Session", SessionContext)
    monkeypatch.setattr(snippets_module, "db", SimpleNamespace(engine=object()))

    api = snippets_module.CustomizedSnippetExportApi()
    handler = unwrap(api.get)

    with app.test_request_context("/workspaces/current/customized-snippets/snippet-1/export?include_secret=true"):
        response = handler(api, "tenant-1", snippet_id="snippet-1")

    assert response.status_code == 200
    assert response.get_data(as_text=True) == "version: 0.1.0\nkind: snippet\n"
    assert response.headers["Content-Type"] == "application/x-yaml"
    assert "Snippet%20One.snippet" in response.headers["Content-Disposition"]
    export_snippet_dsl.assert_called_once_with(snippet=snippet, include_secret=True)


def test_import_snippet_returns_202_for_pending_confirmation(app: Flask, monkeypatch: pytest.MonkeyPatch):
    user = _account("account-1")
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

    monkeypatch.setattr(snippets_module, "Session", _SessionContext)
    monkeypatch.setattr(snippets_module, "db", SimpleNamespace(engine=object()))
    monkeypatch.setattr(
        snippets_module,
        "SnippetDslService",
        Mock(return_value=SimpleNamespace(import_snippet=import_snippet)),
    )

    api = snippets_module.CustomizedSnippetImportApi()
    handler = unwrap(api.post)

    with app.test_request_context(
        "/workspaces/current/customized-snippets/imports",
        method="POST",
        json={"mode": "yaml-content", "yaml_content": "kind: snippet"},
    ):
        response, status_code = handler(api, user)

    assert status_code == 202
    assert response["status"] == ImportStatus.PENDING.value
    import_snippet.assert_called_once()
    session.commit.assert_called_once()


def test_import_snippet_returns_400_for_failed_import(app: Flask, monkeypatch: pytest.MonkeyPatch):
    user = _account("account-1")
    result = SnippetImportInfo(id="import-1", status=ImportStatus.FAILED, error="Invalid DSL")
    import_snippet = Mock(return_value=result)
    session = SimpleNamespace(commit=Mock())

    class SessionContext(_SessionContext):
        def __init__(self, engine, *args, **kwargs):
            super().__init__(engine, *args, session=session, **kwargs)

    monkeypatch.setattr(snippets_module, "Session", SessionContext)
    monkeypatch.setattr(snippets_module, "db", SimpleNamespace(engine=object()))
    monkeypatch.setattr(
        snippets_module,
        "SnippetDslService",
        Mock(return_value=SimpleNamespace(import_snippet=import_snippet)),
    )

    api = snippets_module.CustomizedSnippetImportApi()
    handler = unwrap(api.post)

    with app.test_request_context(
        "/workspaces/current/customized-snippets/imports",
        method="POST",
        json={"mode": "yaml-content", "yaml_content": "kind: snippet"},
    ):
        response, status_code = handler(api, user)

    assert status_code == 400
    assert response["error"] == "Invalid DSL"
    session.commit.assert_called_once()


def test_import_snippet_returns_200_for_completed_import(app: Flask, monkeypatch: pytest.MonkeyPatch):
    user = _account("account-1")
    result = SnippetImportInfo(id="import-1", status=ImportStatus.COMPLETED, snippet_id="snippet-1")
    import_snippet = Mock(return_value=result)
    session = SimpleNamespace(commit=Mock())

    class SessionContext(_SessionContext):
        def __init__(self, engine, *args, **kwargs):
            super().__init__(engine, *args, session=session, **kwargs)

    monkeypatch.setattr(snippets_module, "Session", SessionContext)
    monkeypatch.setattr(snippets_module, "db", SimpleNamespace(engine=object()))
    monkeypatch.setattr(
        snippets_module,
        "SnippetDslService",
        Mock(return_value=SimpleNamespace(import_snippet=import_snippet)),
    )

    api = snippets_module.CustomizedSnippetImportApi()
    handler = unwrap(api.post)

    with app.test_request_context(
        "/workspaces/current/customized-snippets/imports",
        method="POST",
        json={"mode": "yaml-content", "yaml_content": "kind: snippet"},
    ):
        response, status_code = handler(api, user)

    assert status_code == 200
    assert response["snippet_id"] == "snippet-1"
    session.commit.assert_called_once()


def test_import_confirm_returns_200_for_completed_import(app: Flask, monkeypatch: pytest.MonkeyPatch):
    user = _account("account-1")
    result = SnippetImportInfo(id="import-1", status=ImportStatus.COMPLETED, snippet_id="snippet-1")
    confirm_import = Mock(return_value=result)
    session = SimpleNamespace(commit=Mock())

    class SessionContext(_SessionContext):
        def __init__(self, engine, *args, **kwargs):
            super().__init__(engine, *args, session=session, **kwargs)

    monkeypatch.setattr(snippets_module, "Session", SessionContext)
    monkeypatch.setattr(snippets_module, "db", SimpleNamespace(engine=object()))
    monkeypatch.setattr(
        snippets_module,
        "SnippetDslService",
        Mock(return_value=SimpleNamespace(confirm_import=confirm_import)),
    )

    api = snippets_module.CustomizedSnippetImportConfirmApi()
    handler = unwrap(api.post)

    with app.test_request_context(
        "/workspaces/current/customized-snippets/imports/import-1/confirm",
        method="POST",
    ):
        response, status_code = handler(api, user, import_id="import-1")

    assert status_code == 200
    assert response["snippet_id"] == "snippet-1"
    confirm_import.assert_called_once_with(import_id="import-1", account=user)
    session.commit.assert_called_once()


def test_import_confirm_returns_400_for_failed_import(app: Flask, monkeypatch: pytest.MonkeyPatch):
    user = _account("account-1")
    result = SnippetImportInfo(id="import-1", status=ImportStatus.FAILED, error="Invalid import")
    confirm_import = Mock(return_value=result)
    session = SimpleNamespace(commit=Mock())

    class SessionContext(_SessionContext):
        def __init__(self, engine, *args, **kwargs):
            super().__init__(engine, *args, session=session, **kwargs)

    monkeypatch.setattr(snippets_module, "Session", SessionContext)
    monkeypatch.setattr(snippets_module, "db", SimpleNamespace(engine=object()))
    monkeypatch.setattr(
        snippets_module,
        "SnippetDslService",
        Mock(return_value=SimpleNamespace(confirm_import=confirm_import)),
    )

    api = snippets_module.CustomizedSnippetImportConfirmApi()
    handler = unwrap(api.post)

    with app.test_request_context(
        "/workspaces/current/customized-snippets/imports/import-1/confirm",
        method="POST",
    ):
        response, status_code = handler(api, user, import_id="import-1")

    assert status_code == 400
    assert response["error"] == "Invalid import"
    confirm_import.assert_called_once_with(import_id="import-1", account=user)
    session.commit.assert_called_once()


def test_check_dependencies_raises_when_snippet_missing(app: Flask, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(snippets_module.SnippetService, "get_snippet_by_id", Mock(return_value=None))

    api = snippets_module.CustomizedSnippetCheckDependenciesApi()
    handler = unwrap(api.get)

    with app.test_request_context("/workspaces/current/customized-snippets/snippet-1/check-dependencies"):
        with pytest.raises(NotFound, match="Snippet not found"):
            handler(api, "tenant-1", snippet_id="snippet-1")


def test_check_dependencies_returns_dependency_result(app: Flask, monkeypatch: pytest.MonkeyPatch):
    snippet = _snippet()
    check_dependencies = Mock(return_value=SimpleNamespace(leaked_dependencies=[]))
    session = SimpleNamespace()

    class SessionContext(_SessionContext):
        def __init__(self, engine, *args, **kwargs):
            super().__init__(engine, *args, session=session, **kwargs)

    monkeypatch.setattr(snippets_module.SnippetService, "get_snippet_by_id", Mock(return_value=snippet))
    monkeypatch.setattr(snippets_module, "Session", SessionContext)
    monkeypatch.setattr(snippets_module, "db", SimpleNamespace(engine=object()))
    monkeypatch.setattr(
        snippets_module,
        "SnippetDslService",
        Mock(return_value=SimpleNamespace(check_dependencies=check_dependencies)),
    )

    api = snippets_module.CustomizedSnippetCheckDependenciesApi()
    handler = unwrap(api.get)

    with app.test_request_context("/workspaces/current/customized-snippets/snippet-1/check-dependencies"):
        response, status_code = handler(api, "tenant-1", snippet_id="snippet-1")

    assert status_code == 200
    assert response == {"leaked_dependencies": []}
    check_dependencies.assert_called_once_with(snippet=snippet)


def test_increment_use_count_raises_when_snippet_missing(app: Flask, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(snippets_module.SnippetService, "get_snippet_by_id", Mock(return_value=None))

    api = snippets_module.CustomizedSnippetUseCountIncrementApi()
    handler = unwrap(api.post)

    with app.test_request_context(
        "/workspaces/current/customized-snippets/snippet-1/use-count/increment",
        method="POST",
    ):
        with pytest.raises(NotFound, match="Snippet not found"):
            handler(api, "tenant-1", snippet_id="snippet-1")


def test_increment_use_count_returns_refreshed_count(app: Flask, monkeypatch: pytest.MonkeyPatch):
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
    monkeypatch.setattr(snippets_module.SnippetService, "get_snippet_by_id", Mock(return_value=snippet))
    monkeypatch.setattr(snippets_module.SnippetService, "increment_use_count", increment_use_count)
    monkeypatch.setattr(snippets_module, "Session", _SessionContext)
    monkeypatch.setattr(snippets_module, "db", SimpleNamespace(engine=object()))

    api = snippets_module.CustomizedSnippetUseCountIncrementApi()
    handler = unwrap(api.post)

    with app.test_request_context(
        "/workspaces/current/customized-snippets/snippet-1/use-count/increment",
        method="POST",
    ):
        response, status_code = handler(api, "tenant-1", snippet_id="snippet-1")

    assert status_code == 200
    assert response == {"result": "success", "use_count": 3}
    increment_use_count.assert_called_once_with(session=session, snippet=merged_snippet)
    session.commit.assert_called_once()
    session.refresh.assert_called_once_with(merged_snippet)
