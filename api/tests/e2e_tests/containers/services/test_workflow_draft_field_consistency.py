"""ENG1205: committed dedicated edits must survive a stale public graph save.

These regressions exercise the public controller bodies and
real PostgreSQL transactions. Authentication decorators are unwrapped only to
supply the already-authorized persisted owner, as in the empty-draft tests.
"""

import inspect
import json
import logging
from copy import deepcopy
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from controllers.console.app import workflow as workflow_api
from controllers.console.app import workflow_draft_variable as variable_api
from graphon.variables import StringVariable
from models.model import AppMode
from models.workflow import Workflow, WorkflowType
from services.app_dsl_service import AppDslService
from services.workflow_service import WorkflowService
from tests.workflow_empty_draft_test_utils import POPULATED_GRAPH, seed_owner

UPDATED_GRAPH: dict[str, object] = {
    "nodes": [{"id": "start", "data": {"type": "start", "title": "Saved graph"}}],
    "edges": [],
}


def _snapshot(factory: sessionmaker[Session], workflow_id: str) -> dict[str, object]:
    """Witness committed state with a fresh session rather than an identity map."""
    with factory() as reader:
        draft = reader.scalar(select(Workflow).where(Workflow.id == workflow_id))
        assert draft is not None
        return {
            "hash": draft.unique_hash,
            "graph": draft.graph_dict,
            "features": json.loads(draft.serialized_features).get("opening_statement"),
            "conversation": [(variable.name, variable.value) for variable in draft.conversation_variables],
            "environment": [(variable.name, variable.value) for variable in draft.environment_variables],
        }


@pytest.mark.parametrize("field", ["features", "conversation", "environment-patch", "environment-omitted"])
@pytest.mark.parametrize("collaborative", [False, None], ids=["false-flag", "missing-flag"])
def test_dedicated_edit_survives_stale_noncollaborative_graph_save(
    flask_app_with_containers: Flask,
    db_session_with_containers: Session,
    field: str,
    collaborative: bool | None,
) -> None:
    """Catch a stale non-collaborative save overwriting a successful dedicated edit.

    Environment omission is a passing control: the public route already preserves
    that collection unless the request explicitly supplies a per-ID patch. An
    explicit same-ID patch is a deliberate write and must continue to apply.
    """
    session = db_session_with_containers
    assert session.get_bind().dialect.name == "postgresql"
    factory = sessionmaker(bind=session.get_bind(), expire_on_commit=False)
    owner = seed_owner(session, graph=POPULATED_GRAPH)
    assert owner.draft is not None
    owner.app.mode = AppMode.ADVANCED_CHAT
    owner.draft.type = WorkflowType.CHAT
    owner.draft.features = json.dumps({"opening_statement": "before"})
    session.commit()
    draft_id = owner.draft.id
    environment = owner.draft.environment_variables[0]
    conversation = owner.draft.conversation_variables[0]
    stale_environment = environment.model_dump(mode="json")
    stale_conversation = conversation.model_dump(mode="json")
    before = _snapshot(factory, draft_id)

    # This is the old tab's cached graph payload, captured before the dedicated edit.
    payload = {
        "graph": deepcopy(UPDATED_GRAPH),
        "features": {"opening_statement": "before"},
        "hash": before["hash"],
        "conversation_variables": [stale_conversation],
    }
    if collaborative is not None:
        payload["_is_collaborative"] = collaborative
    if field == "environment-patch":
        payload["environment_variable_patch"] = {"environment_variables": [stale_environment]}

    with flask_app_with_containers.test_request_context(method="POST"):
        if field == "features":
            api = workflow_api.WorkflowFeaturesApi()
            args = workflow_api.WorkflowFeaturesPayload.model_validate(
                {"features": {"opening_statement": "dedicated-after"}}
            )
        elif field == "conversation":
            api = variable_api.ConversationVariableCollectionApi()
            args = variable_api.ConversationVariableUpdatePayload.model_validate(
                {"conversation_variables": [{**stale_conversation, "value": "dedicated-after"}]}
            )
        else:
            api = variable_api.EnvironmentVariableCollectionApi()
            args = variable_api.EnvironmentVariableUpdatePayload.model_validate(
                {"environment_variables": [{**stale_environment, "value": "dedicated-after"}]}
            )
        dedicated_response = inspect.unwrap(api.post)(api, args, owner.account, app_model=owner.app)
    assert dedicated_response == {"result": "success"}
    after_dedicated = _snapshot(factory, draft_id)
    observed_field = "environment" if field.startswith("environment") else field
    expected = (
        "dedicated-after"
        if field == "features"
        else [("SERVER_VALUE" if field.startswith("environment") else "topic", "dedicated-after")]
    )
    assert after_dedicated[observed_field] == expected
    assert after_dedicated["hash"] == before["hash"]

    graph_api = workflow_api.DraftWorkflowApi()
    with flask_app_with_containers.test_request_context(
        f"/apps/{owner.app.id}/workflows/draft", method="POST", json=payload
    ):
        graph_response = inspect.unwrap(graph_api.post)(graph_api, owner.account, app_model=owner.app)
    assert graph_response["result"] == "success"
    after_stale_save = _snapshot(factory, draft_id)
    assert after_stale_save["graph"] == UPDATED_GRAPH
    assert after_stale_save["hash"] != before["hash"]
    assert after_stale_save["hash"] == graph_response["hash"]
    evidence = {
        "case": field,
        "dedicated_response": dedicated_response,
        "graph_result": graph_response["result"],
        "before": before,
        "after_dedicated": after_dedicated,
        "after_stale_save": after_stale_save,
    }
    logging.getLogger(__name__).warning("ENG1205_EVIDENCE %s", json.dumps(evidence, sort_keys=True))
    if field == "environment-patch":
        assert after_stale_save["environment"] == [("SERVER_VALUE", "keep-env")], evidence
    else:
        assert after_stale_save[observed_field] == expected, evidence


def test_preloaded_graph_save_environment_patch_preserves_independent_dedicated_edit(
    db_session_with_containers: Session,
) -> None:
    """A row lock must refresh cached variables before merging per-ID upserts."""
    session = db_session_with_containers
    assert session.get_bind().dialect.name == "postgresql"
    factory = sessionmaker(bind=session.get_bind(), expire_on_commit=False)
    owner = seed_owner(session, graph=POPULATED_GRAPH)
    assert owner.draft is not None
    draft_id = owner.draft.id
    service = WorkflowService(factory)
    with factory() as stale_session, factory() as writer:
        preloaded = service.get_draft_workflow(owner.app, session=stale_session)
        assert preloaded is not None
        initial_hash = preloaded.unique_hash
        explicit_patch = preloaded.environment_variables[0].model_copy(update={"value": "explicit-patch"})
        # Another committed request creates an ID that the explicit patch does not touch.
        service.update_draft_workflow_environment_variables(
            app_model=owner.app,
            environment_variables=[
                *preloaded.environment_variables,
                StringVariable(id=str(uuid4()), name="INDEPENDENT", value="keep-independent"),
            ],
            account=owner.account,
            session=writer,
        )
        after_dedicated = _snapshot(factory, draft_id)
        assert after_dedicated["environment"] == [
            ("SERVER_VALUE", "keep-env"),
            ("INDEPENDENT", "keep-independent"),
        ]
        assert preloaded.environment_variables[0].value == "keep-env"
        result = service.sync_draft_workflow(
            app_model=owner.app,
            graph=deepcopy(POPULATED_GRAPH),
            features={},
            unique_hash=initial_hash,
            account=owner.account,
            environment_variables=[],
            conversation_variables=[],
            environment_variable_upserts=[explicit_patch],
            preserve_environment_variables=True,
            graph_only=True,
            session=stale_session,
        )
        after_patch = _snapshot(factory, draft_id)
        assert result.unique_hash == initial_hash == after_dedicated["hash"] == after_patch["hash"]
        evidence = {
            "case": "preloaded-orm-unrelated-env",
            "after_dedicated": after_dedicated,
            "after_patch": after_patch,
        }
        logging.getLogger(__name__).warning("ENG1205_EVIDENCE %s", json.dumps(evidence, sort_keys=True))
        assert after_patch["environment"] == [
            ("SERVER_VALUE", "explicit-patch"),
            ("INDEPENDENT", "keep-independent"),
        ], evidence


@pytest.mark.parametrize("collaborative", [False, True], ids=["regular", "collaborative"])
def test_public_new_draft_initializes_configuration(
    flask_app_with_containers: Flask,
    db_session_with_containers: Session,
    collaborative: bool,
) -> None:
    """Graph-only ownership on existing drafts must not discard initial config."""
    session = db_session_with_containers
    owner = seed_owner(session, graph=None)
    owner.app.mode = AppMode.ADVANCED_CHAT
    session.commit()
    conversation = StringVariable(id=str(uuid4()), name="initial_topic", value="initial-conversation")
    environment = StringVariable(id=str(uuid4()), name="INITIAL_ENV", value="initial-environment")
    api = workflow_api.DraftWorkflowApi()
    with flask_app_with_containers.test_request_context(
        f"/apps/{owner.app.id}/workflows/draft",
        method="POST",
        json={
            "graph": POPULATED_GRAPH,
            "features": {"opening_statement": "initial-feature"},
            "conversation_variables": [conversation.model_dump(mode="json")],
            "environment_variable_patch": {"environment_variables": [environment.model_dump(mode="json")]},
            "_is_collaborative": collaborative,
        },
    ):
        response = inspect.unwrap(api.post)(api, owner.account, app_model=owner.app)
    assert response["result"] == "success"
    factory = sessionmaker(bind=session.get_bind(), expire_on_commit=False)
    with factory() as reader:
        draft = WorkflowService.get_draft_workflow(owner.app, session=reader)
        assert draft is not None
        assert draft.features_dict["opening_statement"] == "initial-feature"
        assert [(variable.name, variable.value) for variable in draft.conversation_variables] == [
            ("initial_topic", "initial-conversation")
        ]
        assert [(variable.name, variable.value) for variable in draft.environment_variables] == [
            ("INITIAL_ENV", "initial-environment")
        ]
        assert draft.graph_dict == POPULATED_GRAPH
        assert draft.unique_hash == response["hash"]


@pytest.mark.parametrize("caller", ["service", "dsl"])
def test_trusted_full_replacement_still_writes_configuration(
    db_session_with_containers: Session,
    caller: str,
) -> None:
    """Changing public ownership must not change trusted full-write defaults."""
    session = db_session_with_containers
    owner = seed_owner(session, graph=POPULATED_GRAPH)
    assert owner.draft is not None
    owner.app.mode = AppMode.ADVANCED_CHAT
    owner.draft.type = WorkflowType.CHAT
    session.commit()
    conversation = StringVariable(id=str(uuid4()), name="replacement_topic", value="replacement-conversation")
    environment = StringVariable(id=str(uuid4()), name="REPLACEMENT_ENV", value="replacement-environment")
    if caller == "service":
        WorkflowService().sync_draft_workflow(
            app_model=owner.app,
            graph=deepcopy(UPDATED_GRAPH),
            features={"opening_statement": "replacement-feature"},
            unique_hash=owner.draft.unique_hash,
            account=owner.account,
            environment_variables=[environment],
            conversation_variables=[conversation],
            session=session,
        )
    else:
        AppDslService(session)._create_or_update_app(
            app=owner.app,
            account=owner.account,
            data={
                "app": {"mode": AppMode.ADVANCED_CHAT.value},
                "workflow": {
                    "graph": deepcopy(UPDATED_GRAPH),
                    "features": {"opening_statement": "replacement-feature"},
                    "environment_variables": [environment.model_dump(mode="json")],
                    "conversation_variables": [conversation.model_dump(mode="json")],
                },
            },
        )
        session.commit()
    factory = sessionmaker(bind=session.get_bind(), expire_on_commit=False)
    saved = _snapshot(factory, owner.draft.id)
    assert saved["features"] == "replacement-feature"
    assert saved["conversation"] == [("replacement_topic", "replacement-conversation")]
    assert saved["environment"] == [("REPLACEMENT_ENV", "replacement-environment")]
    assert saved["graph"] == UPDATED_GRAPH
