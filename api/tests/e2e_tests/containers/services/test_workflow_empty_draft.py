"""CI-only empty-draft saves through real PostgreSQL service transactions."""

from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from controllers.common.errors import InvalidArgumentError
from controllers.console.app.error import DraftWorkflowNotSync
from models.model import App, AppMode
from models.workflow import Workflow
from services.workflow_service import WorkflowService
from tests.workflow_empty_draft_test_utils import (
    EMPTY_GRAPH,
    POPULATED_GRAPH,
    assert_saved_empty,
    post_empty_draft,
    seed_owner,
    workflow_rows,
)


@pytest.mark.parametrize("content_type", ["application/json", "text/plain"], ids=["json", "beacon"])
@pytest.mark.parametrize(
    ("graph", "confirmation", "stale_hash", "expected_status"),
    [
        (EMPTY_GRAPH, {}, False, 200),
        (EMPTY_GRAPH, {"force": False}, False, 200),
        (POPULATED_GRAPH, {}, False, 400),
        (POPULATED_GRAPH, {"force": False}, False, 400),
        (POPULATED_GRAPH, {"force": True}, False, 200),
        (POPULATED_GRAPH, {"force": True}, True, 409),
        (EMPTY_GRAPH, {}, True, 409),
        (EMPTY_GRAPH, {"force": True}, True, 409),
        (None, {"force": True}, False, 200),
        (None, {}, False, 400),
    ],
    ids=[
        "empty-presave",
        "empty-force-false",
        "clear-unconfirmed",
        "clear-force-false",
        "clear-confirmed",
        "clear-stale-confirmed",
        "empty-stale",
        "empty-stale-confirmed",
        "initialization-confirmed",
        "initialization-unconfirmed",
    ],
)
def test_postgres_empty_save_state_transition(
    flask_app_with_containers: Flask,
    db_session_with_containers: Session,
    monkeypatch: pytest.MonkeyPatch,
    content_type: str,
    graph: dict[str, object] | None,
    confirmation: dict[str, bool],
    stale_hash: bool,
    expected_status: int,
) -> None:
    # Catches policy/hash ordering errors and proves the result in a fresh PostgreSQL session.
    session = db_session_with_containers
    assert session.get_bind().dialect.name == "postgresql"
    factory = sessionmaker(bind=session.get_bind(), expire_on_commit=False)
    owner = seed_owner(session, graph=graph)
    before = workflow_rows(factory)
    unique_hash = "stale-hash" if stale_hash else owner.draft.unique_hash if owner.draft else None
    if expected_status == 200:
        response = post_empty_draft(
            flask_app_with_containers,
            monkeypatch,
            session,
            owner,
            content_type=content_type,
            unique_hash=unique_hash,
            confirmation=confirmation,
        )
        assert_saved_empty(factory, owner, response)
    else:
        error_type = DraftWorkflowNotSync if expected_status == 409 else InvalidArgumentError
        with pytest.raises(error_type) as exc:
            post_empty_draft(
                flask_app_with_containers,
                monkeypatch,
                session,
                owner,
                content_type=content_type,
                unique_hash=unique_hash,
                confirmation=confirmation,
            )
        assert exc.value.code == expected_status
        session.rollback()
        assert workflow_rows(factory) == before


@pytest.mark.parametrize("content_type", ["application/json", "text/plain"], ids=["json", "beacon"])
@pytest.mark.parametrize("scope", ["tenant", "app"], ids=["foreign-tenant", "other-app"])
def test_postgres_empty_draft_confirmation_is_scoped_to_full_owner_chain(
    flask_app_with_containers: Flask,
    db_session_with_containers: Session,
    monkeypatch: pytest.MonkeyPatch,
    content_type: str,
    scope: str,
) -> None:
    # Removing either predicate must not let another app/tenant's empty draft authorize initialization.
    session = db_session_with_containers
    assert session.get_bind().dialect.name == "postgresql"
    factory = sessionmaker(bind=session.get_bind(), expire_on_commit=False)
    original = seed_owner(session, graph=EMPTY_GRAPH)
    assert original.draft is not None
    if scope == "tenant":
        requester = seed_owner(session, graph=None)
        # An app reference crossing a tenant boundary cannot read the original tenant's draft.
        target = App(
            id=original.app.id, tenant_id=requester.app.tenant_id, name="Foreign reference", mode=AppMode.WORKFLOW
        )
    else:
        requester = original
        target = App(
            id=str(uuid4()),
            tenant_id=original.app.tenant_id,
            name="Other owned app",
            mode=AppMode.WORKFLOW,
            enable_site=False,
            enable_api=False,
            created_by=original.account.id,
            updated_by=original.account.id,
        )
        session.add(target)
        session.commit()
    before = workflow_rows(factory)
    with pytest.raises(InvalidArgumentError) as exc:
        post_empty_draft(
            flask_app_with_containers,
            monkeypatch,
            session,
            requester,
            content_type=content_type,
            unique_hash=original.draft.unique_hash,
            confirmation={},
            app_model=target,
        )
    assert exc.value.code == 400
    session.rollback()
    assert workflow_rows(factory) == before


@pytest.mark.parametrize(
    ("graph", "commit"), [(None, False), (POPULATED_GRAPH, True)], ids=["import-initialization", "rollback-clear"]
)
def test_postgres_trusted_internal_empty_sync_remains_supported(
    db_session_with_containers: Session,
    graph: dict[str, object] | None,
    commit: bool,
) -> None:
    # Catches changing the new confirmation-policy default for trusted import/rollback callers.
    session = db_session_with_containers
    assert session.get_bind().dialect.name == "postgresql"
    factory = sessionmaker(bind=session.get_bind(), expire_on_commit=False)
    owner = seed_owner(session, graph=graph)
    result = WorkflowService().sync_draft_workflow(
        app_model=owner.app,
        graph={"nodes": [], "edges": []},
        features={},
        unique_hash=owner.draft.unique_hash if owner.draft else None,
        account=owner.account,
        environment_variables=[],
        conversation_variables=[],
        session=session,
        graph_only=True,
        preserve_environment_variables=True,
        sync_agent_bindings=False,
        commit=commit,
    )
    if not commit:
        session.commit()
    with factory() as reader:
        saved = reader.scalar(
            select(Workflow).where(
                Workflow.tenant_id == owner.app.tenant_id,
                Workflow.app_id == owner.app.id,
                Workflow.version == Workflow.VERSION_DRAFT,
            )
        )
        assert saved is not None
        assert saved.id == result.id
        assert saved.graph_dict == {"nodes": [], "edges": []}
        if owner.draft is not None:
            assert saved.id == owner.draft.id
            assert [(variable.name, variable.value) for variable in saved.environment_variables] == [
                ("SERVER_VALUE", "keep-env")
            ]
