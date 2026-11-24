"""Creator resolution keeps tenant/app ownership and native trigger attribution."""

from unittest.mock import MagicMock, Mock

import pytest

from models.enums import CreatorUserRole, EndUserType
from services.account_errors import AccountNotFoundError
from services.enterprise.trigger_creator import TriggerCreatorService


def service_with_rows(*rows):
    session = MagicMock()
    session.scalar.side_effect = rows
    sessions = Mock()
    sessions.return_value.__enter__ = Mock(return_value=session)
    sessions.return_value.__exit__ = Mock(return_value=False)
    users = Mock()
    users.get_or_create_end_user_by_type.return_value = Mock(id="end-user")
    return TriggerCreatorService(sessions=sessions, end_users=users), users


def test_schedule_uses_account_without_provisioning_user():
    service, users = service_with_rows("app", "owner-or-admin")
    actor = service.resolve(tenant_id="tenant", app_id="app", trigger_type="trigger-schedule", subscription_id="")
    assert (actor.id, actor.role) == ("owner-or-admin", CreatorUserRole.ACCOUNT)
    users.get_or_create_end_user_by_type.assert_not_called()


def test_schedule_without_account_fails():
    service, _ = service_with_rows("app", None)
    with pytest.raises(AccountNotFoundError):
        service.resolve(tenant_id="tenant", app_id="app", trigger_type="trigger-schedule", subscription_id="")


def test_webhook_uses_app_scoped_trigger_user():
    service, users = service_with_rows("app")
    actor = service.resolve(tenant_id="tenant", app_id="app", trigger_type="trigger-webhook", subscription_id="")
    assert (actor.id, actor.role) == ("end-user", CreatorUserRole.END_USER)
    users.get_or_create_end_user_by_type.assert_called_once_with(
        type=EndUserType.TRIGGER, tenant_id="tenant", app_id="app", user_id=None
    )


def test_plugin_falls_back_to_subscription_creator():
    service, users = service_with_rows("app", "subscription-owner")
    users.get_or_create_end_user_by_type.side_effect = RuntimeError("provisioning failed")
    actor = service.resolve(tenant_id="tenant", app_id="app", trigger_type="trigger-plugin", subscription_id="sub")
    assert (actor.id, actor.role) == ("subscription-owner", CreatorUserRole.ACCOUNT)


@pytest.mark.parametrize(("rows", "kind"), [([None], "trigger-webhook"), (["app", None], "trigger-plugin")])
def test_unknown_owner_reference_never_provisions(rows, kind):
    service, users = service_with_rows(*rows)
    with pytest.raises(LookupError):
        service.resolve(tenant_id="tenant", app_id="app", trigger_type=kind, subscription_id="sub")
    users.get_or_create_end_user_by_type.assert_not_called()
