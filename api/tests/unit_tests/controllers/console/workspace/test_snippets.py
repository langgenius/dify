from datetime import UTC, datetime
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from flask import Flask
from pydantic import ValidationError
from sqlalchemy.orm import Session
from werkzeug.exceptions import BadRequest, NotFound

from controllers.console.workspace import snippets as snippets_module
from models.account import Account, TenantAccountRole
from models.snippet import CustomizedSnippet
from services.snippet_dsl_service import ImportStatus, SnippetImportInfo


@pytest.fixture(autouse=True)
def _patch_snippet_service_factory(monkeypatch: pytest.MonkeyPatch):
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


def _snippet(**overrides) -> CustomizedSnippet:
    """Build a real ``CustomizedSnippet`` row so session-backed accessors run against the test schema.

    The SQLite fixtures in ``tests/unit_tests/conftest.py`` provide the full schema, so the
    ``get_*(session=...)`` accessors resolve through real queries instead of hand-written stubs.
    """
    snippet = CustomizedSnippet(
        tenant_id="tenant-1",
        name="Snippet",
        description="Description",
        type=snippets_module.SnippetType.NODE,
        version=1,
        use_count=0,
        is_published=False,
        icon_info=None,
        input_fields=None,
        created_by=None,
        created_at=datetime.fromtimestamp(1_704_067_200, UTC),
        updated_by=None,
        updated_at=datetime.fromtimestamp(1_704_153_600, UTC),
    )
    snippet.id = "snippet-1"
    for name, value in overrides.items():
        setattr(snippet, name, value)
    return snippet


def test_snippet_list_query_reads_repeated_values(app: Flask):
    tag_id = "11111111-1111-1111-1111-111111111111"
    other_tag_id = "22222222-2222-2222-2222-222222222222"

    with app.test_request_context(
        f"/workspaces/current/customized-snippets?tag_ids={tag_id}&tag_ids={other_tag_id}"
        "&creators=account-a&creators=account-b&keyword=search"
    ):
        query = snippets_module._snippet_list_query_from_request()

    assert query.tag_ids == [tag_id, other_tag_id]
    assert query.creators == ["account-a", "account-b"]
    assert query.keyword == "search"


def test_snippet_list_query_reads_creator_ids_alias(app: Flask):
    with app.test_request_context(
        "/workspaces/current/customized-snippets?creator_ids=account-a&creator_ids=account-b"
    ):
        query = snippets_module._snippet_list_query_from_request()

    assert query.creators == ["account-a", "account-b"]


def test_snippet_list_query_ignores_indexed_values(app: Flask):
    tag_id = "11111111-1111-1111-1111-111111111111"
    with app.test_request_context(f"/workspaces/current/customized-snippets?tag_ids[0]={tag_id}&creators[0]=account-a"):
        query = snippets_module._snippet_list_query_from_request()

    assert query.tag_ids is None
    assert query.creators is None


def test_list_snippets_returns_pagination(app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session):
    snippets = [_snippet()]
    tag_id = "11111111-1111-1111-1111-111111111111"
    get_snippets = Mock(return_value=(snippets, 1, False))
    monkeypatch.setattr(snippets_module.SnippetService, "get_snippets", get_snippets)

    api = snippets_module.CustomizedSnippetsApi()
    handler = unwrap(api.get)

    with app.test_request_context(
        f"/workspaces/current/customized-snippets?page=2&limit=10&tag_ids={tag_id}&creators=account-2"
    ):
        response, status_code = handler(api, sqlite_session, "tenant-1")

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
        session=sqlite_session,
        page=2,
        limit=10,
        keyword=None,
        is_published=None,
        creators=["account-2"],
        tag_ids=[tag_id],
    )


def test_create_snippet_defaults_unknown_type_and_returns_created(
    app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
):
    user = _account("account-1")
    snippet = _snippet()
    create_snippet = Mock(return_value=snippet)
    monkeypatch.setattr(snippets_module.SnippetService, "create_snippet", create_snippet)

    req_data = SimpleNamespace(
        name="Snippet",
        type="unknown",
        description="Description",
        graph=None,
        icon_info=None,
        input_fields=[],
    )

    api = snippets_module.CustomizedSnippetsApi()
    handler = unwrap(api.post)

    with app.test_request_context(
        "/workspaces/current/customized-snippets",
        method="POST",
        json={"name": "Snippet", "type": "node", "description": "Description"},
    ):
        response, status_code = handler(api, req_data, sqlite_session, "tenant-1", user)

    assert status_code == 201
    assert response["id"] == "snippet-1"
    assert response["type"] == snippets_module.SnippetType.NODE.value
    assert create_snippet.call_args.kwargs["snippet_type"] == snippets_module.SnippetType.NODE


def test_create_snippet_rejects_forbidden_nodes(app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session):
    user = _account("account-1")
    create_snippet = Mock()
    monkeypatch.setattr(snippets_module.SnippetService, "create_snippet", create_snippet)

    req_data = snippets_module.CreateSnippetPayload(
        name="snippet with invalid node",
        type="node",
        graph={
            "nodes": [
                {"id": "knowledge-1", "data": {"type": "knowledge-retrieval"}},
            ],
            "edges": [],
        },
    )

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
        response, status_code = handler(api, req_data, sqlite_session, "tenant-1", user)

    assert status_code == 400
    assert "knowledge-retrieval" in response["message"]
    create_snippet.assert_not_called()


def test_get_snippet_detail_raises_when_missing(app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session):
    monkeypatch.setattr(snippets_module.SnippetService, "get_snippet_by_id", Mock(return_value=None))

    api = snippets_module.CustomizedSnippetDetailApi()
    handler = unwrap(api.get)

    with app.test_request_context("/workspaces/current/customized-snippets/snippet-1"):
        with pytest.raises(NotFound, match="Snippet not found"):
            handler(api, sqlite_session, "tenant-1", snippet_id="snippet-1")


def test_get_snippet_detail_returns_snippet(app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session):
    snippet = _snippet()
    monkeypatch.setattr(snippets_module.SnippetService, "get_snippet_by_id", Mock(return_value=snippet))

    api = snippets_module.CustomizedSnippetDetailApi()
    handler = unwrap(api.get)

    with app.test_request_context("/workspaces/current/customized-snippets/snippet-1"):
        response, status_code = handler(api, sqlite_session, "tenant-1", snippet_id="snippet-1")

    assert status_code == 200
    assert response["id"] == "snippet-1"
    assert response["name"] == "Snippet"


def test_get_snippet_detail_resolves_creator_through_the_request_session(
    app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
):
    """The injected session is the one the accessors query, so a persisted creator resolves."""
    author = _account("11111111-1111-1111-1111-111111111111")
    sqlite_session.add(author)
    sqlite_session.commit()

    snippet = _snippet(created_by=author.id, updated_by=author.id)
    monkeypatch.setattr(snippets_module.SnippetService, "get_snippet_by_id", Mock(return_value=snippet))

    api = snippets_module.CustomizedSnippetDetailApi()
    handler = unwrap(api.get)

    with app.test_request_context("/workspaces/current/customized-snippets/snippet-1"):
        response, status_code = handler(api, sqlite_session, "tenant-1", snippet_id="snippet-1")

    assert status_code == 200
    assert response["created_by"] == {"id": author.id, "name": "Test User", "email": author.email}
    assert response["updated_by"] == {"id": author.id, "name": "Test User", "email": author.email}


def test_patch_snippet_returns_400_for_empty_payload(
    app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
):
    snippet = _snippet()
    user = _account("user-1")
    monkeypatch.setattr(snippets_module.SnippetService, "get_snippet_by_id", Mock(return_value=snippet))

    req_data = snippets_module.UpdateSnippetPayload()

    api = snippets_module.CustomizedSnippetDetailApi()
    handler = unwrap(api.patch)

    with app.test_request_context(
        "/workspaces/current/customized-snippets/snippet-1",
        method="PATCH",
        json={},
    ):
        response, status_code = handler(api, req_data, sqlite_session, "tenant-1", user, snippet_id="snippet-1")

    assert status_code == 400
    assert response == {"message": "No valid fields to update"}


def test_patch_snippet_updates_and_commits(app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session):
    _persist_snippet(sqlite_session)
    user = _account("account-1")
    snippet = _snippet()
    update_snippet = Mock(side_effect=_apply_update)

    monkeypatch.setattr(snippets_module.SnippetService, "get_snippet_by_id", Mock(return_value=snippet))
    monkeypatch.setattr(snippets_module.SnippetService, "update_snippet", update_snippet)

    req_data = snippets_module.UpdateSnippetPayload(name="New", icon_info={"icon": "star"})

    api = snippets_module.CustomizedSnippetDetailApi()
    handler = unwrap(api.patch)

    with app.test_request_context(
        "/workspaces/current/customized-snippets/snippet-1",
        method="PATCH",
        json={"name": "New", "icon_info": {"icon": "star"}},
    ):
        response, status_code = handler(api, req_data, sqlite_session, "tenant-1", user, snippet_id="snippet-1")

    assert status_code == 200
    assert response["id"] == "snippet-1"
    assert response["name"] == "New"
    update_snippet.assert_called_once()
    assert update_snippet.call_args.kwargs["session"] is sqlite_session
    assert update_snippet.call_args.kwargs["data"] == {
        "name": "New",
        "icon_info": {"icon": "star", "icon_background": None, "icon_type": None, "icon_url": None},
    }
    assert _persisted_name(sqlite_session) == "New"


def test_patch_snippet_does_not_report_a_committed_write_as_a_bad_request(
    app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
):
    """The ``except ValueError`` must scope the update call only, never the serialization.

    ``ValidationError`` subclasses ``ValueError``. Both routes end at a 400 either way — the app
    registers a ``ValueError`` handler in ``libs/external_api.py`` — so what matters is *where* it
    is handled: covering the serialization would blame the client's payload for a write that already
    succeeded, and swallow the failure before it ever reaches the error handlers. The committed row
    must survive regardless.
    """
    _persist_snippet(sqlite_session)
    user = _account("account-1")
    snippet = _snippet()

    monkeypatch.setattr(snippets_module.SnippetService, "get_snippet_by_id", Mock(return_value=snippet))
    monkeypatch.setattr(snippets_module.SnippetService, "update_snippet", Mock(side_effect=_apply_update))
    monkeypatch.setattr(CustomizedSnippet, "get_graph_dict", _unserializable_graph)

    req_data = snippets_module.UpdateSnippetPayload(name="New")

    api = snippets_module.CustomizedSnippetDetailApi()
    handler = unwrap(api.patch)

    with app.test_request_context(
        "/workspaces/current/customized-snippets/snippet-1",
        method="PATCH",
        json={"name": "New"},
    ):
        with pytest.raises(ValidationError):
            handler(api, req_data, sqlite_session, "tenant-1", user, snippet_id="snippet-1")

    assert _persisted_name(sqlite_session) == "New"


def test_patch_snippet_does_not_persist_a_rejected_update(
    app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
):
    """A rejected update must raise, not return a 400 tuple.

    ``with_session`` commits on any normal return, so returning ``{"message": ...}, 400`` would
    durably persist whatever ``update_snippet`` wrote before it rejected the payload; raising routes
    through the decorator's rollback instead. That commit lives *in the decorator*, so this test runs
    the handler through it rather than through ``unwrap`` — the autouse ``_sqlite_session_factory``
    fixture already points ``with_session`` at the same database as ``sqlite_session``.
    """
    _persist_snippet(sqlite_session)
    user = _account("account-1")
    snippet = _snippet()

    monkeypatch.setattr(snippets_module.SnippetService, "get_snippet_by_id", Mock(return_value=snippet))
    monkeypatch.setattr(snippets_module.SnippetService, "update_snippet", Mock(side_effect=_reject_update))

    req_data = snippets_module.UpdateSnippetPayload(name="New")

    api = snippets_module.CustomizedSnippetDetailApi()
    view = unwrap(api.patch)

    @snippets_module.with_session
    def patch_through_decorator(resource, session: Session, snippet_id: str):
        return view(resource, req_data, session, "tenant-1", user, snippet_id=snippet_id)

    with app.test_request_context(
        "/workspaces/current/customized-snippets/snippet-1",
        method="PATCH",
        json={"name": "New"},
    ):
        with pytest.raises(BadRequest, match="name already in use"):
            patch_through_decorator(api, snippet_id="snippet-1")

    assert _persisted_name(sqlite_session) == "Snippet"


def _apply_update(*, session: Session, snippet: CustomizedSnippet, account_id: str, data: dict) -> CustomizedSnippet:
    """Stand in for ``SnippetService.update_snippet``: write the payload onto the merged row."""
    del session, account_id
    for field, value in data.items():
        setattr(snippet, field, value)
    return snippet


def _reject_update(*, session: Session, snippet: CustomizedSnippet, account_id: str, data: dict) -> CustomizedSnippet:
    """Stand in for an ``update_snippet`` that writes some fields and then rejects the payload."""
    _apply_update(session=session, snippet=snippet, account_id=account_id, data=data)
    raise ValueError("name already in use")


def _unserializable_graph(self: CustomizedSnippet, *, session: Session) -> str:
    """Return a non-dict graph so response validation fails after the write is committed."""
    del self, session
    return "not-a-dict"


def _persist_snippet(session: Session) -> None:
    """Persist the baseline row so the handler's ``merge`` takes the UPDATE path, as in production."""
    with Session(bind=session.get_bind()) as setup_session:
        setup_session.add(_snippet())
        setup_session.commit()


def _persisted_name(session: Session) -> str | None:
    """Read the snippet name back through a second session to prove what was committed."""
    with Session(bind=session.get_bind()) as verification_session:
        stored = verification_session.get(CustomizedSnippet, "snippet-1")
        return stored.name if stored else None


def test_delete_snippet_deletes_and_commits(app: Flask, monkeypatch: pytest.MonkeyPatch):
    snippet = _snippet()
    user = _account()
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
        response, status_code = handler(api, "tenant-1", user, snippet_id="snippet-1")

    assert status_code == 204
    assert response == ""
    delete_snippet.assert_called_once_with(session=session, snippet=snippet, account_id=user.id)
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

    with app.test_request_context(
        "/workspaces/current/customized-snippets/snippet-1/export?include_secret=true&workflow_id=workflow-1"
    ):
        response = handler(api, "tenant-1", snippet_id="snippet-1")

    assert response.status_code == 200
    assert response.get_data(as_text=True) == "version: 0.1.0\nkind: snippet\n"
    assert response.headers["Content-Type"] == "application/x-yaml"
    assert "Snippet%20One.snippet" in response.headers["Content-Disposition"]
    export_snippet_dsl.assert_called_once_with(snippet=snippet, include_secret=True, workflow_id="workflow-1")


def test_export_snippet_raises_not_found_for_missing_workflow(app: Flask, monkeypatch: pytest.MonkeyPatch):
    snippet = _snippet(name="Snippet One")

    monkeypatch.setattr(snippets_module.SnippetService, "get_snippet_by_id", Mock(return_value=snippet))
    monkeypatch.setattr(
        snippets_module,
        "SnippetDslService",
        Mock(
            return_value=SimpleNamespace(
                export_snippet_dsl=Mock(side_effect=ValueError("Missing published workflow workflow-1"))
            )
        ),
    )
    monkeypatch.setattr(snippets_module, "Session", _SessionContext)
    monkeypatch.setattr(snippets_module, "db", SimpleNamespace(engine=object()))

    api = snippets_module.CustomizedSnippetExportApi()
    handler = unwrap(api.get)

    with app.test_request_context("/workspaces/current/customized-snippets/snippet-1/export?workflow_id=workflow-1"):
        with pytest.raises(NotFound, match="Missing published workflow workflow-1"):
            handler(api, "tenant-1", snippet_id="snippet-1")


def test_import_snippet_returns_202_for_pending_confirmation(app: Flask, monkeypatch: pytest.MonkeyPatch):
    user = _account("account-1")
    result = SnippetImportInfo(id="import-1", status=ImportStatus.PENDING, imported_dsl_version="999.0.0")
    import_snippet = Mock(return_value=result)
    session = SimpleNamespace(commit=Mock(), rollback=Mock())

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

    req_data = snippets_module.SnippetImportPayload(mode="yaml-content", yaml_content="kind: snippet")

    api = snippets_module.CustomizedSnippetImportApi()
    handler = unwrap(api.post)

    with app.test_request_context(
        "/workspaces/current/customized-snippets/imports",
        method="POST",
        json={"mode": "yaml-content", "yaml_content": "kind: snippet"},
    ):
        response, status_code = handler(api, req_data, session, user)

    assert status_code == 202
    assert response["status"] == ImportStatus.PENDING.value
    import_snippet.assert_called_once()
    session.rollback.assert_not_called()
    session.commit.assert_not_called()


def test_import_snippet_returns_400_for_failed_import(app: Flask, monkeypatch: pytest.MonkeyPatch):
    user = _account("account-1")
    result = SnippetImportInfo(id="import-1", status=ImportStatus.FAILED, error="Invalid DSL")
    import_snippet = Mock(return_value=result)
    session = SimpleNamespace(commit=Mock(), rollback=Mock())

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

    req_data = snippets_module.SnippetImportPayload(mode="yaml-content", yaml_content="kind: snippet")

    api = snippets_module.CustomizedSnippetImportApi()
    handler = unwrap(api.post)

    with app.test_request_context(
        "/workspaces/current/customized-snippets/imports",
        method="POST",
        json={"mode": "yaml-content", "yaml_content": "kind: snippet"},
    ):
        response, status_code = handler(api, req_data, session, user)

    assert status_code == 400
    assert response["error"] == "Invalid DSL"
    session.rollback.assert_not_called()
    session.commit.assert_not_called()


def test_import_confirm_returns_200_for_completed_import(app: Flask, monkeypatch: pytest.MonkeyPatch):
    user = _account("account-1")
    result = SnippetImportInfo(id="import-1", status=ImportStatus.COMPLETED, snippet_id="snippet-1")
    confirm_import = Mock(return_value=result)
    session = SimpleNamespace(commit=Mock(), rollback=Mock())

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
        response, status_code = handler(api, session, user, import_id="import-1")

    assert status_code == 200
    assert response["snippet_id"] == "snippet-1"
    confirm_import.assert_called_once_with(import_id="import-1", account=user)
    session.commit.assert_not_called()


def test_check_dependencies_raises_when_snippet_missing(app: Flask, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(snippets_module.SnippetService, "get_snippet_by_id", Mock(return_value=None))

    api = snippets_module.CustomizedSnippetCheckDependenciesApi()
    handler = unwrap(api.get)

    with app.test_request_context("/workspaces/current/customized-snippets/snippet-1/check-dependencies"):
        with pytest.raises(NotFound, match="Snippet not found"):
            handler(api, "tenant-1", snippet_id="snippet-1")


def test_check_dependencies_returns_dependency_result(app: Flask, monkeypatch: pytest.MonkeyPatch):
    snippet = _snippet()
    check_dependencies = Mock(return_value=SimpleNamespace(model_dump=Mock(return_value={"leaked_dependencies": []})))
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
