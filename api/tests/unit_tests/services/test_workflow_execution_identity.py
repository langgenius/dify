"""Caller adapters distinguish actual roles independently of invocation source."""

from dataclasses import FrozenInstanceError

import pytest

from core.app.entities.app_invoke_entities import UserFrom
from models.model import EndUser
from services.workflow_execution_identity import build_workflow_execution_identity
from tests.helpers.unit.model_factories import make_account


def test_account_identity_is_detached_from_orm_state() -> None:
    account = make_account(account_id="account-id")
    identity = build_workflow_execution_identity(account)
    account.id = "changed-id"

    assert identity.user_id == "account-id"
    assert identity.user_from == UserFrom.ACCOUNT
    with pytest.raises(FrozenInstanceError):
        identity.user_id = "changed-id"  # type: ignore[read-only]


def test_end_user_identity_uses_record_id_not_session_id() -> None:
    user = EndUser(id="end-user-id", session_id="external-session")

    identity = build_workflow_execution_identity(user)

    assert identity.user_id == "end-user-id"
    assert identity.user_from == UserFrom.END_USER
