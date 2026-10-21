"""Persisted owner fixtures for empty-draft controller and PostgreSQL regressions."""

import inspect
import json
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from controllers.console.app import workflow as workflow_module
from graphon.variables import StringVariable
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.model import App, AppMode
from models.workflow import Workflow
from services.workflow_service import WorkflowService

EMPTY_GRAPH: dict[str, object] = {"nodes": [], "edges": []}
POPULATED_GRAPH: dict[str, object] = {
    "nodes": [{"id": "start", "data": {"type": "start", "title": "Start"}}],
    "edges": [],
}


@dataclass(frozen=True)
class DraftOwner:
    account: Account
    app: App
    draft: Workflow | None


def seed_owner(session: Session, *, graph: dict[str, object] | None) -> DraftOwner:
    """Create the complete tenant/account/membership/app/draft chain and a published sibling."""
    tenant = Tenant(name="Empty draft test")
    account = Account(name="Draft owner", email=f"{uuid4()}@example.invalid")
    session.add_all([tenant, account])
    session.flush()
    session.add(
        TenantAccountJoin(tenant_id=tenant.id, account_id=account.id, role=TenantAccountRole.OWNER, current=True)
    )
    app = App(
        id=str(uuid4()),
        tenant_id=tenant.id,
        name="Empty draft test",
        mode=AppMode.WORKFLOW,
        enable_site=False,
        enable_api=False,
        created_by=account.id,
        updated_by=account.id,
    )
    session.add(app)
    session.flush()

    def workflow(version: str, saved_graph: dict[str, object]) -> Workflow:
        return Workflow(
            id=str(uuid4()),
            tenant_id=tenant.id,
            app_id=app.id,
            type="workflow",
            version=version,
            graph=json.dumps(saved_graph),
            features=json.dumps({"file_upload": {"enabled": False}}),
            environment_variables=[StringVariable(id=str(uuid4()), name="SERVER_VALUE", value="keep-env")],
            conversation_variables=[StringVariable(id=str(uuid4()), name="topic", value="keep-conversation")],
            created_by=account.id,
            created_at=datetime(2024, 1, 1),
            updated_at=datetime(2024, 1, 2),
        )

    published = workflow("2024-01-01 00:00:00", POPULATED_GRAPH)
    session.add(published)
    session.flush()
    app.workflow_id = published.id
    draft = workflow(Workflow.VERSION_DRAFT, graph) if graph is not None else None
    if draft is not None:
        session.add(draft)
    session.commit()
    account.set_current_tenant_with_session(tenant, session=session)
    return DraftOwner(account, app, draft)


def workflow_rows(factory: sessionmaker[Session]) -> list[tuple[object, ...]]:
    """Read committed raw draft and published fields through a fresh session."""
    with factory() as session:
        return [
            tuple(row)
            for row in session.execute(
                select(
                    Workflow.id,
                    Workflow.tenant_id,
                    Workflow.app_id,
                    Workflow.version,
                    Workflow.graph,
                    Workflow._features,
                    Workflow._environment_variables,
                    Workflow._conversation_variables,
                    Workflow.created_by,
                    Workflow.updated_by,
                    Workflow.created_at,
                    Workflow.updated_at,
                ).order_by(Workflow.id)
            )
        ]


@dataclass
class EmptyDraftDatabase:
    owner_session: Session

    def session(self) -> Session:
        return self.owner_session


def post_empty_draft(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    session: Session,
    owner: DraftOwner,
    *,
    content_type: str,
    unique_hash: str | None,
    confirmation: Mapping[str, object],
    app_model: App | None = None,
    collaborative: bool = False,
):
    """Parse a genuine POST body with the real controller and real service transaction.

    As in the existing controller tests, authentication decorators are unwrapped:
    the already-authorized actor/app are supplied explicitly. Only the database
    handle and service repository factory are bound to the test database;
    parsing, validation, locking, hash checks and writes are real.
    """
    monkeypatch.setattr(workflow_module, "db", EmptyDraftDatabase(session))
    service = WorkflowService(sessionmaker(bind=session.get_bind(), expire_on_commit=False))
    monkeypatch.setattr(workflow_module, "WorkflowService", lambda: service)
    target = app_model if app_model is not None else owner.app
    payload = {
        "graph": {"nodes": [], "edges": []},
        "features": {},
        "hash": unique_hash,
        "_is_collaborative": collaborative,
        **confirmation,
    }
    api = workflow_module.DraftWorkflowApi()
    with app.test_request_context(
        f"/apps/{target.id}/workflows/draft", method="POST", data=json.dumps(payload), content_type=content_type
    ):
        return inspect.unwrap(api.post)(api, owner.account, app_model=target)


def assert_saved_empty(
    factory: sessionmaker[Session], owner: DraftOwner, response: dict[str, object], *, collaborative: bool = False
) -> None:
    """Assert public success and the persisted graph/metadata owned by the save."""
    assert response["result"] == "success"
    assert isinstance(response["hash"], str)
    assert response["hash"]
    assert isinstance(response["updated_at"], int)
    with factory() as session:
        draft = session.scalar(
            select(Workflow).where(
                Workflow.tenant_id == owner.app.tenant_id,
                Workflow.app_id == owner.app.id,
                Workflow.version == Workflow.VERSION_DRAFT,
            )
        )
        assert draft is not None
        assert draft.graph_dict == {"nodes": [], "edges": []}
        assert draft.unique_hash == response["hash"]
        assert draft.created_by == owner.account.id
        if collaborative and owner.draft is not None:
            assert json.loads(draft.serialized_features) == {"file_upload": {"enabled": False}}
        else:
            # Regular saves validate the omitted feature settings into their disabled defaults.
            # Read raw persisted JSON so the model's compatibility getter cannot mask a bad write.
            assert json.loads(draft.serialized_features) == {
                "file_upload": {},
                "text_to_speech": {"enabled": False, "voice": "", "language": ""},
                "sensitive_word_avoidance": {"enabled": False},
            }
        if owner.draft is not None:
            assert draft.id == owner.draft.id
            assert draft.updated_by == owner.account.id
            assert [(variable.name, variable.value) for variable in draft.environment_variables] == [
                ("SERVER_VALUE", "keep-env")
            ]
            assert [(variable.name, variable.value) for variable in draft.conversation_variables] == (
                [("topic", "keep-conversation")] if collaborative else []
            )
        else:
            assert draft.environment_variables == []
            assert draft.conversation_variables == []
        published = session.get(Workflow, owner.app.workflow_id)
        assert published is not None
        assert published.graph_dict == POPULATED_GRAPH
