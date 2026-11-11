import json

import pytest
from sqlalchemy.orm import Session

from core.helper.encrypter import full_mask_token
from graphon.variables import FloatVariable, IntegerVariable, SecretVariable, StringVariable
from repositories.workflow.definition_repository import workflow_record
from tests.helpers.unit.model_factories import make_workflow


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
