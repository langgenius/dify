import pytest
from werkzeug.exceptions import Forbidden

from models.account import TenantAccountRole
from services.app_dsl_service import AppDslService


def test_non_secret_export_allowed_for_any_role() -> None:
    # Must not raise for a normal member exporting without secrets.
    AppDslService.assert_secret_export_allowed(include_secret=False, current_role=TenantAccountRole.NORMAL)


def test_secret_export_allowed_for_privileged_roles() -> None:
    AppDslService.assert_secret_export_allowed(include_secret=True, current_role=TenantAccountRole.OWNER)
    AppDslService.assert_secret_export_allowed(include_secret=True, current_role=TenantAccountRole.ADMIN)


def test_secret_export_forbidden_for_non_privileged_role() -> None:
    with pytest.raises(Forbidden):
        AppDslService.assert_secret_export_allowed(include_secret=True, current_role=TenantAccountRole.NORMAL)


def test_secret_export_forbidden_for_none_role() -> None:
    with pytest.raises(Forbidden):
        AppDslService.assert_secret_export_allowed(include_secret=True, current_role=None)
