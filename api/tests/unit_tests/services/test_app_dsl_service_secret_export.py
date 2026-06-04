from types import SimpleNamespace

import pytest
from werkzeug.exceptions import Forbidden

from services.app_dsl_service import AppDslService


def _account(*, is_admin_or_owner: bool) -> SimpleNamespace:
    return SimpleNamespace(is_admin_or_owner=is_admin_or_owner)


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
