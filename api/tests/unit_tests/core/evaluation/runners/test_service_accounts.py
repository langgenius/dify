from collections.abc import Callable
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from sqlalchemy.orm import Session

from core.evaluation.runners import get_service_account_for_app, get_service_account_for_snippet
from models.account import Account


@pytest.mark.parametrize(
    ("get_service_account", "target_id"),
    [
        (get_service_account_for_app, "app-1"),
        (get_service_account_for_snippet, "snippet-1"),
    ],
)
def test_get_service_account_sets_tenant_with_caller_session(
    get_service_account: Callable[[Session, str, str], Account], target_id: str
) -> None:
    session = MagicMock(spec=Session)
    account = MagicMock(spec=Account)
    account.id = "account-1"
    session.scalar.side_effect = [SimpleNamespace(created_by=account.id), account]
    session.query.return_value.filter_by.return_value.first.return_value = object()

    result = get_service_account(session, target_id, "tenant-1")

    assert result is account
    account.set_tenant_id_with_session.assert_called_once_with("tenant-1", session=session)
