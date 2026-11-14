import json
from uuid import uuid4

import pytest
from sqlalchemy import event, select
from sqlalchemy.orm import Session, sessionmaker

from events.event_handlers.update_app_dataset_join_when_app_published_workflow_updated import (
    get_dataset_ids_from_workflow,
    handle,
)
from models.account import Account
from models.dataset import AppDatasetJoin
from models.model import App, AppMode, IconType
from models.workflow import Workflow, WorkflowType


@pytest.fixture
def account(sqlite_session: Session) -> Account:
    account = Account(name="Dataset Join Tester", email="dataset-join@example.com")
    sqlite_session.add(account)
    sqlite_session.commit()
    return account


@pytest.fixture
def app_model(sqlite_session: Session, account: Account) -> App:
    app = App(
        tenant_id=str(uuid4()),
        name="Workflow App",
        description="",
        mode=AppMode.WORKFLOW,
        icon_type=IconType.EMOJI,
        icon="🤖",
        icon_background="#fff",
        enable_site=True,
        enable_api=True,
        created_by=account.id,
        updated_by=account.id,
    )
    sqlite_session.add(app)
    sqlite_session.commit()
    return app


def _published_workflow(*, app: App, dataset_ids: list[str]) -> Workflow:
    graph = {
        "nodes": [
            {
                "id": "knowledge-1",
                "data": {
                    "type": "knowledge-retrieval",
                    "title": "Knowledge",
                    "dataset_ids": dataset_ids,
                    "retrieval_mode": "multiple",
                },
            }
        ],
        "edges": list[dict[str, object]](),
    }
    return Workflow.new(
        tenant_id=app.tenant_id,
        app_id=app.id,
        type=WorkflowType.WORKFLOW,
        version="1",
        graph=json.dumps(graph),
        features="{}",
        created_by=app.created_by or "account-1",
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )


def test_requires_caller_session(app_model: App) -> None:
    with pytest.raises(TypeError, match="session"):
        handle(app_model, published_workflow=_published_workflow(app=app_model, dataset_ids=["dataset-1"]))  # pyrefly: ignore[missing-argument]


@pytest.mark.parametrize("sqlite_session", [(App, Account, AppDatasetJoin, Workflow)], indirect=True)
def test_reuses_provided_session_without_committing(
    sqlite_session_factory: sessionmaker[Session], app_model: App, sqlite_session: Session
) -> None:
    sqlite_session.add(AppDatasetJoin(app_id="other-app", dataset_id="dataset-1"))
    sqlite_session.flush()
    commits: list[str] = []

    def after_commit(_session: Session) -> None:
        commits.append("commit")

    event.listen(sqlite_session_factory, "after_commit", after_commit)
    try:
        handle(
            app_model,
            published_workflow=_published_workflow(app=app_model, dataset_ids=["dataset-1"]),
            session=sqlite_session,
        )
    finally:
        event.remove(sqlite_session_factory, "after_commit", after_commit)

    added_joins = [row for row in sqlite_session.new if isinstance(row, AppDatasetJoin)]
    assert len(added_joins) == 1
    assert added_joins[0].app_id == app_model.id
    assert added_joins[0].dataset_id == "dataset-1"
    assert commits == []

    sqlite_session.flush()
    persisted = sqlite_session.scalars(select(AppDatasetJoin).where(AppDatasetJoin.app_id == app_model.id)).all()
    assert [(row.app_id, row.dataset_id) for row in persisted] == [(app_model.id, "dataset-1")]


@pytest.mark.parametrize("sqlite_session", [(App, Account, AppDatasetJoin, Workflow)], indirect=True)
def test_removes_obsolete_joins_without_committing(
    sqlite_session_factory: sessionmaker[Session], app_model: App, sqlite_session: Session
) -> None:
    obsolete = AppDatasetJoin(app_id=app_model.id, dataset_id="old-dataset")
    keep = AppDatasetJoin(app_id=app_model.id, dataset_id="dataset-1")
    sqlite_session.add_all([obsolete, keep])
    sqlite_session.flush()
    commits: list[str] = []

    def after_commit(_session: Session) -> None:
        commits.append("commit")

    event.listen(sqlite_session_factory, "after_commit", after_commit)
    try:
        handle(
            app_model,
            published_workflow=_published_workflow(app=app_model, dataset_ids=["dataset-1", "dataset-2"]),
            session=sqlite_session,
        )
    finally:
        event.remove(sqlite_session_factory, "after_commit", after_commit)

    assert commits == []
    sqlite_session.flush()
    persisted = {
        row.dataset_id
        for row in sqlite_session.scalars(select(AppDatasetJoin).where(AppDatasetJoin.app_id == app_model.id)).all()
    }
    assert persisted == {"dataset-1", "dataset-2"}


def test_get_dataset_ids_from_workflow_reads_knowledge_nodes(app_model: App) -> None:
    workflow = _published_workflow(app=app_model, dataset_ids=["dataset-1", "dataset-2"])

    assert get_dataset_ids_from_workflow(workflow) == {"dataset-1", "dataset-2"}
