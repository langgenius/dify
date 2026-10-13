"""Public empty presaves must distinguish an empty draft from a destructive clear."""

import pytest
from flask import Flask
from pydantic import ValidationError
from sqlalchemy.orm import Session, sessionmaker

from controllers.common.errors import InvalidArgumentError
from controllers.console.app.error import DraftWorkflowNotSync
from events.app_event import app_draft_workflow_was_synced
from tests.workflow_empty_draft_test_utils import (
    EMPTY_GRAPH,
    POPULATED_GRAPH,
    assert_saved_empty,
    post_empty_draft,
    seed_owner,
    workflow_rows,
)


@pytest.fixture(autouse=True)
def _isolate_post_commit_events(monkeypatch: pytest.MonkeyPatch) -> None:
    # Event listeners own separate Redis/global-engine transactions, outside this SQLite save contract.
    monkeypatch.setattr(app_draft_workflow_was_synced, "send", lambda *_args, **_kwargs: None)


@pytest.mark.parametrize("content_type", ["application/json", "text/plain"], ids=["json", "beacon"])
@pytest.mark.parametrize("collaborative", [False, True], ids=["regular", "collaborative"])
@pytest.mark.parametrize("confirmation", [{}, {"force": False}], ids=["missing-force", "force-false"])
def test_existing_empty_draft_presave_succeeds(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    content_type: str,
    collaborative: bool,
    confirmation: dict[str, bool],
) -> None:
    # Catches rejecting a legitimate presave before reading the locked existing empty draft.
    owner = seed_owner(sqlite_session, graph=EMPTY_GRAPH)
    assert owner.draft is not None
    response = post_empty_draft(
        app,
        monkeypatch,
        sqlite_session,
        owner,
        content_type=content_type,
        unique_hash=owner.draft.unique_hash,
        confirmation=confirmation,
        collaborative=collaborative,
    )
    assert_saved_empty(sqlite_session_factory, owner, response, collaborative=collaborative)


@pytest.mark.parametrize("content_type", ["application/json", "text/plain"], ids=["json", "beacon"])
@pytest.mark.parametrize("graph", [EMPTY_GRAPH, POPULATED_GRAPH], ids=["empty", "populated"])
@pytest.mark.parametrize("confirmation", [{}, {"force": True}], ids=["missing-force", "force-true"])
def test_stale_hash_refuses_empty_save_without_mutation(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    content_type: str,
    graph: dict[str, object],
    confirmation: dict[str, bool],
) -> None:
    # Catches empty/force policy bypassing the existing optimistic concurrency conflict.
    owner = seed_owner(sqlite_session, graph=graph)
    before = workflow_rows(sqlite_session_factory)
    with pytest.raises(DraftWorkflowNotSync) as exc:
        post_empty_draft(
            app,
            monkeypatch,
            sqlite_session,
            owner,
            content_type=content_type,
            unique_hash="stale-hash",
            confirmation=confirmation,
        )
    assert exc.value.code == 409
    sqlite_session.rollback()
    assert workflow_rows(sqlite_session_factory) == before


@pytest.mark.parametrize("content_type", ["application/json", "text/plain"], ids=["json", "beacon"])
@pytest.mark.parametrize("graph", [None, POPULATED_GRAPH], ids=["initialization", "destructive-clear"])
def test_force_confirms_empty_save(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    content_type: str,
    graph: dict[str, object] | None,
) -> None:
    # Catches dropping explicit confirmation while moving the policy into the service.
    owner = seed_owner(sqlite_session, graph=graph)
    response = post_empty_draft(
        app,
        monkeypatch,
        sqlite_session,
        owner,
        content_type=content_type,
        unique_hash=owner.draft.unique_hash if owner.draft else None,
        confirmation={"force": True},
    )
    assert_saved_empty(sqlite_session_factory, owner, response)


@pytest.mark.parametrize("content_type", ["application/json", "text/plain"], ids=["json", "beacon"])
@pytest.mark.parametrize("confirmation", [{}, {"force": False}], ids=["missing-force", "force-false"])
def test_missing_draft_still_requires_confirmation(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    content_type: str,
    confirmation: dict[str, bool],
) -> None:
    # Catches treating a missing draft as an already-persisted empty draft.
    owner = seed_owner(sqlite_session, graph=None)
    before = workflow_rows(sqlite_session_factory)
    with pytest.raises(InvalidArgumentError) as exc:
        post_empty_draft(
            app,
            monkeypatch,
            sqlite_session,
            owner,
            content_type=content_type,
            unique_hash=None,
            confirmation=confirmation,
        )
    assert exc.value.code == 400
    sqlite_session.rollback()
    assert workflow_rows(sqlite_session_factory) == before


@pytest.mark.parametrize("content_type", ["application/json", "text/plain"], ids=["json", "beacon"])
@pytest.mark.parametrize("force", ["true", 1, None], ids=["string", "integer", "null"])
def test_invalid_force_cannot_mutate_existing_empty_draft(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    content_type: str,
    force: str | int | None,
) -> None:
    # Catches loosening strict request booleans while making empty presaves succeed.
    owner = seed_owner(sqlite_session, graph=EMPTY_GRAPH)
    assert owner.draft is not None
    before = workflow_rows(sqlite_session_factory)
    if content_type == "application/json":
        with pytest.raises(ValidationError, match="Input should be a valid boolean"):
            post_empty_draft(
                app,
                monkeypatch,
                sqlite_session,
                owner,
                content_type=content_type,
                unique_hash=owner.draft.unique_hash,
                confirmation={"force": force},
            )
    else:
        response, status = post_empty_draft(
            app,
            monkeypatch,
            sqlite_session,
            owner,
            content_type=content_type,
            unique_hash=owner.draft.unique_hash,
            confirmation={"force": force},
        )
        assert status == 400
        assert response["message"] == "Invalid JSON data"
    sqlite_session.rollback()
    assert workflow_rows(sqlite_session_factory) == before
