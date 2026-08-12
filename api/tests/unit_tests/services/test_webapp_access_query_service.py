from unittest.mock import MagicMock, create_autospec

import pytest

from enums import WebAppAccessMode
from services.webapp_access_query_service import WebAppAccessQuery, WebAppAccessQueryService


def _service(
    *,
    access: MagicMock,
    enabled: bool = True,
    access_mode: WebAppAccessMode = WebAppAccessMode.PRIVATE,
) -> tuple[WebAppAccessQueryService, MagicMock]:
    access_mode_for_app = MagicMock(return_value=access_mode)
    return (
        WebAppAccessQueryService(
            access=access,
            webapp_auth_enabled=enabled,
            access_mode_for_app=access_mode_for_app,
        ),
        access_mode_for_app,
    )


def test_disabled_auth_returns_public_before_resolving_app() -> None:
    access: MagicMock = create_autospec(WebAppAccessQuery, instance=True, spec_set=True)
    service, access_mode_for_app = _service(access=access, enabled=False)

    assert service.get_access_mode(app_id=None, app_code=None) is WebAppAccessMode.PUBLIC
    access.find_app_id_by_code.assert_not_called()
    access_mode_for_app.assert_not_called()


def test_enabled_auth_reads_access_mode_by_app_id() -> None:
    access: MagicMock = create_autospec(WebAppAccessQuery, instance=True, spec_set=True)
    service, access_mode_for_app = _service(access=access)

    assert service.get_access_mode(app_id="app-1", app_code=None) is WebAppAccessMode.PRIVATE
    access.find_app_id_by_code.assert_not_called()
    access_mode_for_app.assert_called_once_with("app-1")


def test_app_code_takes_precedence_over_app_id() -> None:
    access: MagicMock = create_autospec(WebAppAccessQuery, instance=True, spec_set=True)
    access.find_app_id_by_code.return_value = "resolved-id"
    service, access_mode_for_app = _service(access=access, access_mode=WebAppAccessMode.SSO_VERIFIED)

    assert service.get_access_mode(app_id="ignored-id", app_code="code-1") is WebAppAccessMode.SSO_VERIFIED
    access.find_app_id_by_code.assert_called_once_with("code-1")
    access_mode_for_app.assert_called_once_with("resolved-id")


def test_missing_app_code_uses_existing_error_contract() -> None:
    access: MagicMock = create_autospec(WebAppAccessQuery, instance=True, spec_set=True)
    access.find_app_id_by_code.return_value = None
    service, access_mode_for_app = _service(access=access)

    with pytest.raises(ValueError, match="^App with code missing-code not found$"):
        service.get_access_mode(app_id="must-not-fallback", app_code="missing-code")

    access_mode_for_app.assert_not_called()


def test_enabled_auth_requires_app_id_or_code() -> None:
    access: MagicMock = create_autospec(WebAppAccessQuery, instance=True, spec_set=True)
    service, access_mode_for_app = _service(access=access)

    with pytest.raises(ValueError, match="^appId or appCode must be provided$"):
        service.get_access_mode(app_id=None, app_code=None)

    access_mode_for_app.assert_not_called()
