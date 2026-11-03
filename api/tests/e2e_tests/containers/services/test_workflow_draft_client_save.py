"""Unload saves supersede only the same editor's accepted pending save.

The real POST parser, service and PostgreSQL transactions exercise both request
orders. Authentication decorators are unwrapped to supply persisted authorized
owners, matching the existing draft consistency tests.
"""

import inspect
import json
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy.orm import Session, sessionmaker

from controllers.console.app import workflow as workflow_api
from controllers.console.app.error import DraftWorkflowNotSync
from graphon.variables import StringVariable
from models.account import Account, TenantAccountJoin, TenantAccountRole
from models.workflow import Workflow
from services.workflow_service import WorkflowService
from tests.workflow_empty_draft_test_utils import POPULATED_GRAPH, DraftOwner, seed_owner


def _graph(title: str) -> dict[str, object]:
    return {"nodes": [{"id": "start", "data": {"type": "start", "title": title}}], "edges": []}


def _post(
    app: Flask,
    owner: DraftOwner,
    *,
    title: str,
    unique_hash: str,
    save_id: str | None,
    predecessors: tuple[str, ...] = (),
    base_save_id: str | None = None,
    predecessor_patches: dict[str, dict[str, object]] | None = None,
    environment_patch: dict[str, object] | None = None,
    collaborative: bool = False,
    content_type: str = "application/json",
    account: Account | None = None,
) -> dict[str, object]:
    payload = {
        "graph": _graph(title),
        "features": {},
        "hash": unique_hash,
        "client_save_id": save_id,
        "base_client_save_id": base_save_id,
        "predecessor_saves": [
            {
                "client_save_id": predecessor_id,
                "environment_variable_patch": (predecessor_patches or {}).get(predecessor_id),
            }
            for predecessor_id in predecessors
        ],
        "environment_variable_patch": environment_patch,
        "_is_collaborative": collaborative,
    }
    api = workflow_api.DraftWorkflowApi()
    with app.test_request_context(
        f"/apps/{owner.app.id}/workflows/draft",
        method="POST",
        data=json.dumps(payload),
        content_type=content_type,
    ):
        return inspect.unwrap(api.post)(api, account or owner.account, app_model=owner.app)


def _read(session: Session, owner: DraftOwner) -> Workflow:
    assert owner.draft is not None
    with Session(session.get_bind(), expire_on_commit=False) as reader:
        draft = reader.get(Workflow, owner.draft.id)
        assert draft is not None
        return draft


@pytest.mark.parametrize("collaborative", [False, True], ids=["regular", "collaborative"])
@pytest.mark.parametrize("content_type", ["application/json", "text/plain"], ids=["json", "beacon"])
@pytest.mark.parametrize("unload_first", [False, True], ids=["autosave-first", "unload-first"])
def test_unload_keeps_latest_graph_in_both_arrival_orders(
    flask_app_with_containers: Flask,
    db_session_with_containers: Session,
    collaborative: bool,
    content_type: str,
    unload_first: bool,
) -> None:
    session = db_session_with_containers
    assert session.get_bind().dialect.name == "postgresql"
    owner = seed_owner(session, graph=POPULATED_GRAPH)
    assert owner.draft is not None
    initial_hash = owner.draft.unique_hash
    autosave_id, unload_id = str(uuid4()), str(uuid4())

    def autosave() -> None:
        _post(
            flask_app_with_containers,
            owner,
            title="Autosave A",
            unique_hash=initial_hash,
            save_id=autosave_id,
            collaborative=collaborative,
        )

    def unload() -> dict[str, object]:
        return _post(
            flask_app_with_containers,
            owner,
            title="Latest edit B",
            unique_hash=initial_hash,
            save_id=unload_id,
            predecessors=(str(uuid4()), autosave_id),
            collaborative=collaborative,
            content_type=content_type,
        )

    if unload_first:
        response = unload()
        with pytest.raises(DraftWorkflowNotSync):
            autosave()
    else:
        autosave()
        response = unload()

    saved = _read(session, owner)
    assert saved.graph_dict == _graph("Latest edit B")
    assert saved.unique_hash == response["hash"]
    assert saved.draft_client_save_id == unload_id
    assert response["client_save_id"] == unload_id
    assert saved.draft_client_save_account_id == owner.account.id
    assert saved.draft_client_save_hash == saved.unique_hash
    assert [(value.name, value.value) for value in saved.environment_variables] == [("SERVER_VALUE", "keep-env")]
    assert [(value.name, value.value) for value in saved.conversation_variables] == [("topic", "keep-conversation")]
    assert json.loads(saved.serialized_features) == {"file_upload": {"enabled": False}}


@pytest.mark.parametrize("collaborative", [False, True], ids=["regular", "collaborative"])
@pytest.mark.parametrize("writer", ["tagged", "untagged", "direct"], ids=["another-editor", "untagged-save", "builder"])
def test_intervening_writer_prevents_stale_unload_overwrite(
    flask_app_with_containers: Flask,
    db_session_with_containers: Session,
    collaborative: bool,
    writer: str,
) -> None:
    session = db_session_with_containers
    owner = seed_owner(session, graph=POPULATED_GRAPH)
    assert owner.draft is not None
    initial_hash = owner.draft.unique_hash
    autosave_id = str(uuid4())
    response = _post(
        flask_app_with_containers, owner, title="Autosave A", unique_hash=initial_hash, save_id=autosave_id
    )
    assert isinstance(response["hash"], str)
    if writer == "direct":
        with Session(session.get_bind()) as external, external.begin():
            draft = external.get(Workflow, owner.draft.id)
            assert draft is not None
            draft.graph = json.dumps(_graph("Builder edit"))
    else:
        _post(
            flask_app_with_containers,
            owner,
            title="Autosave A",
            unique_hash=response["hash"],
            save_id=str(uuid4()) if writer == "tagged" else None,
            base_save_id=autosave_id,
        )
    before = _read(session, owner)
    if writer == "untagged":
        assert before.draft_client_save_id is not None
        assert before.draft_client_save_id != autosave_id
        assert before.draft_client_save_account_id == owner.account.id
        assert before.draft_client_save_hash == before.unique_hash
    with pytest.raises(DraftWorkflowNotSync):
        _post(
            flask_app_with_containers,
            owner,
            title="Stale unload",
            unique_hash=initial_hash,
            save_id=str(uuid4()),
            predecessors=(autosave_id,),
            collaborative=collaborative,
        )
    after = _read(session, owner)
    assert after.graph == before.graph
    assert after.draft_client_save_id == before.draft_client_save_id


def test_predecessor_receipt_is_bound_to_the_saving_account(
    flask_app_with_containers: Flask,
    db_session_with_containers: Session,
) -> None:
    session = db_session_with_containers
    owner = seed_owner(session, graph=POPULATED_GRAPH)
    assert owner.draft is not None
    initial_hash = owner.draft.unique_hash
    autosave_id = str(uuid4())
    _post(flask_app_with_containers, owner, title="Autosave A", unique_hash=initial_hash, save_id=autosave_id)
    other_account = Account(name="Collaborator", email=f"{uuid4()}@example.invalid")
    session.add(other_account)
    session.flush()
    session.add(
        TenantAccountJoin(
            tenant_id=owner.app.tenant_id,
            account_id=other_account.id,
            role=TenantAccountRole.EDITOR,
            current=True,
        )
    )
    session.commit()
    with pytest.raises(DraftWorkflowNotSync):
        _post(
            flask_app_with_containers,
            owner,
            title="Other account stale edit",
            unique_hash=initial_hash,
            save_id=str(uuid4()),
            predecessors=(autosave_id,),
            collaborative=True,
            account=other_account,
        )
    assert _read(session, owner).graph_dict == _graph("Autosave A")


def test_receipt_rolls_back_with_the_graph(db_session_with_containers: Session) -> None:
    session = db_session_with_containers
    owner = seed_owner(session, graph=POPULATED_GRAPH)
    assert owner.draft is not None
    initial_hash = owner.draft.unique_hash
    service = WorkflowService(sessionmaker(bind=session.get_bind(), expire_on_commit=False))
    with Session(session.get_bind()) as writer:
        staged = service.sync_draft_workflow(
            app_model=owner.app,
            graph=_graph("Rolled back"),
            features={},
            unique_hash=initial_hash,
            account=owner.account,
            environment_variables=[],
            conversation_variables=[],
            session=writer,
            graph_only=True,
            commit=False,
            client_save_id=str(uuid4()),
        )
        writer.flush()
        assert staged.draft_client_save_hash == staged.unique_hash
        writer.rollback()
    saved = _read(session, owner)
    assert saved.unique_hash == initial_hash
    assert saved.draft_client_save_id is None
    assert saved.draft_client_save_account_id is None
    assert saved.draft_client_save_hash is None


@pytest.mark.parametrize("changes_graph", [False, True], ids=["variable-only-autosave", "graph-autosave"])
def test_inherited_committed_patch_does_not_overwrite_later_dedicated_variable_edit(
    flask_app_with_containers: Flask,
    db_session_with_containers: Session,
    changes_graph: bool,
) -> None:
    session = db_session_with_containers
    owner = seed_owner(session, graph=POPULATED_GRAPH)
    assert owner.draft is not None
    initial_hash = owner.draft.unique_hash
    original = owner.draft.environment_variables[0]
    patch_a = {"environment_variables": [original.model_copy(update={"value": "A"}).model_dump(mode="json")]}
    autosave_id, queued_id = str(uuid4()), str(uuid4())
    _post(
        flask_app_with_containers,
        owner,
        title="Autosave A" if changes_graph else "Start",
        unique_hash=initial_hash,
        save_id=autosave_id,
        environment_patch=patch_a,
    )
    with Session(session.get_bind()) as writer:
        WorkflowService().patch_draft_workflow_environment_variables(
            app_model=owner.app,
            environment_variables=[original.model_copy(update={"value": "Dedicated C"})],
            deleted_environment_variable_ids=[],
            account=owner.account,
            session=writer,
        )
    queued_variable = StringVariable(id=str(uuid4()), name="QUEUED", value="Q")
    current_variable = StringVariable(id=str(uuid4()), name="CURRENT", value="B")
    response = _post(
        flask_app_with_containers,
        owner,
        title="Unload B",
        unique_hash=initial_hash,
        save_id=str(uuid4()),
        predecessors=(autosave_id, queued_id),
        predecessor_patches={
            autosave_id: patch_a,
            queued_id: {"environment_variables": [queued_variable.model_dump(mode="json")]},
        },
        environment_patch={"environment_variables": [current_variable.model_dump(mode="json")]},
        collaborative=True,
    )
    saved = _read(session, owner)
    assert saved.graph_dict == _graph("Unload B")
    assert {variable.name: variable.value for variable in saved.environment_variables} == {
        "SERVER_VALUE": "Dedicated C",
        "QUEUED": "Q",
        "CURRENT": "B",
    }
    api = workflow_api.DraftWorkflowApi()
    with Session(session.get_bind()) as reader:
        draft_response = inspect.unwrap(api.get)(api, reader, app_model=owner.app)
    assert draft_response["client_save_id"] == response["client_save_id"]


@pytest.mark.parametrize("has_base_receipt", [False, True], ids=["initial-base", "acknowledged-base"])
def test_uncommitted_inherited_patches_apply_in_order_from_unchanged_base(
    flask_app_with_containers: Flask,
    db_session_with_containers: Session,
    has_base_receipt: bool,
) -> None:
    session = db_session_with_containers
    owner = seed_owner(session, graph=POPULATED_GRAPH)
    assert owner.draft is not None
    initial_hash = owner.draft.unique_hash
    base_id = None
    if has_base_receipt:
        base = _post(flask_app_with_containers, owner, title="Start", unique_hash=initial_hash, save_id=None)
        assert isinstance(base["client_save_id"], str)
        base_id = base["client_save_id"]
    original = owner.draft.environment_variables[0]
    queued_variable = StringVariable(id=str(uuid4()), name="QUEUED", value="Q")
    autosave_id, queued_id = str(uuid4()), str(uuid4())
    _post(
        flask_app_with_containers,
        owner,
        title="Unload B",
        unique_hash=initial_hash,
        save_id=str(uuid4()),
        base_save_id=base_id,
        predecessors=(autosave_id, queued_id),
        predecessor_patches={
            autosave_id: {"deleted_environment_variable_ids": [original.id]},
            queued_id: {
                "environment_variables": [
                    original.model_copy(update={"value": "Queued replacement"}).model_dump(mode="json"),
                    queued_variable.model_dump(mode="json"),
                ]
            },
        },
        environment_patch={"deleted_environment_variable_ids": [queued_variable.id]},
    )
    saved = _read(session, owner)
    assert saved.graph_dict == _graph("Unload B")
    assert [(variable.name, variable.value) for variable in saved.environment_variables] == [
        ("SERVER_VALUE", "Queued replacement")
    ]


@pytest.mark.parametrize("tagged_writer", [False, True], ids=["untagged", "tagged"])
def test_same_graph_intervening_save_rejects_ambiguous_inherited_patch(
    flask_app_with_containers: Flask,
    db_session_with_containers: Session,
    tagged_writer: bool,
) -> None:
    session = db_session_with_containers
    owner = seed_owner(session, graph=POPULATED_GRAPH)
    assert owner.draft is not None
    initial_hash = owner.draft.unique_hash
    original = owner.draft.environment_variables[0]
    autosave_id = str(uuid4())
    patch_a = {"environment_variables": [original.model_copy(update={"value": "A"}).model_dump(mode="json")]}
    autosave = _post(
        flask_app_with_containers,
        owner,
        title="Start",
        unique_hash=initial_hash,
        save_id=autosave_id,
        environment_patch=patch_a,
    )
    assert isinstance(autosave["client_save_id"], str)
    _post(
        flask_app_with_containers,
        owner,
        title="Start",
        unique_hash=initial_hash,
        save_id=str(uuid4()) if tagged_writer else None,
        base_save_id=autosave["client_save_id"],
        environment_patch={
            "environment_variables": [original.model_copy(update={"value": "Newer C"}).model_dump(mode="json")]
        },
    )
    with pytest.raises(DraftWorkflowNotSync):
        _post(
            flask_app_with_containers,
            owner,
            title="Unload B",
            unique_hash=initial_hash,
            save_id=str(uuid4()),
            predecessors=(autosave_id,),
            predecessor_patches={autosave_id: patch_a},
            collaborative=True,
        )
    saved = _read(session, owner)
    assert saved.unique_hash == initial_hash
    assert saved.environment_variables[0].value == "Newer C"


@pytest.mark.parametrize("unload_first", [False, True], ids=["autosave-first", "unload-first"])
def test_variable_only_saves_keep_latest_patch_in_both_arrival_orders(
    flask_app_with_containers: Flask,
    db_session_with_containers: Session,
    unload_first: bool,
) -> None:
    session = db_session_with_containers
    owner = seed_owner(session, graph=POPULATED_GRAPH)
    assert owner.draft is not None
    initial_hash = owner.draft.unique_hash
    original = owner.draft.environment_variables[0]
    autosave_id = str(uuid4())
    patch_a = {"environment_variables": [original.model_copy(update={"value": "A"}).model_dump(mode="json")]}

    def autosave() -> None:
        _post(
            flask_app_with_containers,
            owner,
            title="Start",
            unique_hash=initial_hash,
            save_id=autosave_id,
            environment_patch=patch_a,
        )

    def unload() -> None:
        _post(
            flask_app_with_containers,
            owner,
            title="Start",
            unique_hash=initial_hash,
            save_id=str(uuid4()),
            predecessors=(autosave_id,),
            predecessor_patches={autosave_id: patch_a},
            environment_patch={
                "environment_variables": [original.model_copy(update={"value": "B"}).model_dump(mode="json")]
            },
            collaborative=True,
        )

    if unload_first:
        unload()
        with pytest.raises(DraftWorkflowNotSync):
            autosave()
    else:
        autosave()
        unload()
    saved = _read(session, owner)
    assert saved.unique_hash == initial_hash
    assert saved.environment_variables[0].value == "B"


@pytest.mark.parametrize("collaborative", [False, True], ids=["regular", "collaborative"])
def test_undo_unload_with_original_graph_hash_rejects_late_autosave(
    flask_app_with_containers: Flask,
    db_session_with_containers: Session,
    collaborative: bool,
) -> None:
    session = db_session_with_containers
    owner = seed_owner(session, graph=POPULATED_GRAPH)
    assert owner.draft is not None
    initial_hash = owner.draft.unique_hash
    autosave_id = str(uuid4())
    response = _post(
        flask_app_with_containers,
        owner,
        title="Start",
        unique_hash=initial_hash,
        save_id=str(uuid4()),
        predecessors=(autosave_id,),
        collaborative=collaborative,
    )
    assert response["hash"] == initial_hash
    with pytest.raises(DraftWorkflowNotSync):
        _post(
            flask_app_with_containers,
            owner,
            title="Earlier edit before undo",
            unique_hash=initial_hash,
            save_id=autosave_id,
            collaborative=collaborative,
        )
    saved = _read(session, owner)
    assert saved.graph_dict == POPULATED_GRAPH
    assert saved.draft_client_save_id == response["client_save_id"]
