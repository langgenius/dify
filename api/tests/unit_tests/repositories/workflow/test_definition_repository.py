import json

import pytest
from sqlalchemy.orm import Session

from core.helper.encrypter import full_mask_token
from graphon.variables import FloatVariable, IntegerVariable, SecretVariable, StringVariable
from models.model import AppMode
from models.workflow import WorkflowKind
from repositories.workflow.definition_repository import WorkflowDefinitionStore, workflow_record
from tests.helpers.unit.model_factories import make_account, make_app, make_workflow


@pytest.mark.parametrize(
    ("active_kind", "draft_kind", "expected_kind"),
    [
        (None, WorkflowKind.EVALUATION, WorkflowKind.STANDARD),
        (WorkflowKind.STANDARD, WorkflowKind.EVALUATION, WorkflowKind.STANDARD),
        (WorkflowKind.EVALUATION, WorkflowKind.STANDARD, WorkflowKind.EVALUATION),
    ],
)
def test_publish_preserves_active_evaluator_kind(
    sqlite_session: Session,
    active_kind: WorkflowKind | None,
    draft_kind: WorkflowKind,
    expected_kind: WorkflowKind,
) -> None:
    """The active publication, not the editable draft, determines the new kind."""
    active_id = "active-1" if active_kind is not None else None
    app = make_app(app_id="app-1", mode=AppMode.WORKFLOW, workflow_id=active_id)
    draft = make_workflow(workflow_id="draft-1", app_id=app.id, kind=draft_kind)
    sqlite_session.add_all([app, draft])
    if active_kind is not None:
        sqlite_session.add(make_workflow(workflow_id="active-1", app_id=app.id, kind=active_kind, version="2026-01-01"))
    sqlite_session.flush()

    published = WorkflowDefinitionStore.publish_workflow(
        session=sqlite_session,
        app_model=app,
        account=make_account(account_id="account-1"),
        marked_name="Release",
        marked_comment="",
    )
    sqlite_session.commit()

    assert published.kind == expected_kind
    assert published.version != draft.version
    assert sqlite_session.get(type(draft), published.id) is published


def test_workflow_record_preserves_variable_types_and_masks_stored_secrets(sqlite_session: Session) -> None:
    """Project persisted variables without decrypting secrets or changing storage."""
    stored = json.dumps(
        {
            "TEXT": {"name": "TEXT", "value_type": "string", "value": "hello"},
            "COUNT": {"name": "COUNT", "value_type": "number", "value": 42},
            "RATIO": {"name": "RATIO", "value_type": "number", "value": 1.5},
            "TOKEN": {"name": "TOKEN", "value_type": "secret", "value": "opaque-ciphertext"},
        }
    )
    workflow = make_workflow()
    workflow._environment_variables = stored
    sqlite_session.add(workflow)
    sqlite_session.commit()

    record = workflow_record(workflow, sqlite_session)
    variables = {variable.name: variable for variable in record.environment_variables}

    assert isinstance(variables["TEXT"], StringVariable)
    assert variables["TEXT"].value == "hello"
    assert isinstance(variables["COUNT"], IntegerVariable)
    assert variables["COUNT"].value == 42
    assert isinstance(variables["RATIO"], FloatVariable)
    assert variables["RATIO"].value == 1.5
    assert isinstance(variables["TOKEN"], SecretVariable)
    assert variables["TOKEN"].value == full_mask_token()
    assert workflow._environment_variables == stored
    sqlite_session.refresh(workflow)
    assert workflow._environment_variables == stored


@pytest.mark.parametrize("stored", ["", "{}"])
def test_workflow_record_returns_empty_environment_variables(sqlite_session: Session, stored: str) -> None:
    """Project an empty stored environment to an empty list without rewriting it."""
    workflow = make_workflow()
    workflow._environment_variables = stored
    sqlite_session.add(workflow)
    sqlite_session.commit()

    record = workflow_record(workflow, sqlite_session)

    assert record.environment_variables == []
    assert workflow._environment_variables == stored
