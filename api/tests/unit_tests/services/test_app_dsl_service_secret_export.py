from types import SimpleNamespace
from typing import cast

import pytest
from werkzeug.exceptions import Forbidden

from models import Account
from services.app_dsl_service import AppDslService


def _account(*, is_admin_or_owner: bool) -> Account:
    # assert_secret_export_allowed only reads ``is_admin_or_owner``; a lightweight stub
    # avoids constructing a full ORM-backed Account in this unit test.
    return cast(Account, SimpleNamespace(is_admin_or_owner=is_admin_or_owner))


def test_assert_secret_export_allowed_blocks_non_privileged_with_secret() -> None:
    with pytest.raises(Forbidden):
        AppDslService.assert_secret_export_allowed(
            include_secret=True,
            account=_account(is_admin_or_owner=False),
        )


def test_assert_secret_export_allowed_permits_admin_or_owner_with_secret() -> None:
    # Should not raise for a privileged account.
    AppDslService.assert_secret_export_allowed(
        include_secret=True,
        account=_account(is_admin_or_owner=True),
    )


def test_assert_secret_export_allowed_permits_non_privileged_without_secret() -> None:
    # Exporting without secrets is allowed for everyone.
    AppDslService.assert_secret_export_allowed(
        include_secret=False,
        account=_account(is_admin_or_owner=False),
    )
