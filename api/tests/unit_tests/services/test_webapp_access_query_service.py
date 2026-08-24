from unittest.mock import MagicMock, create_autospec

import pytest

from enums import WebAppAccessMode
from services.webapp_access_query_service import (
    WebAppAccessAppNotFoundError,
    WebAppAccessQuery,
    WebAppAccessQueryService,
    WebAppAccessReferenceRequiredError,
)


def _service(
    *,
    access: MagicMock,
    enabled: bool = True,
    access_mode: WebAppAccessMode = WebAppAccessMode.PRIVATE,
    allowed: bool = True,
) -> tuple[WebAppAccessQueryService, MagicMock, MagicMock]:
    access_mode_for_app = MagicMock(return_value=access_mode)
    is_user_allowed_for_app = MagicMock(return_value=allowed)
    return (
        WebAppAccessQueryService(
            access=access,
            webapp_auth_enabled=enabled,
            access_mode_for_app=access_mode_for_app,
            is_user_allowed_for_app=is_user_allowed_for_app,
        ),
        access_mode_for_app,
        is_user_allowed_for_app,
    )


def test_disabled_auth_returns_public_before_resolving_app() -> None:
    access: MagicMock = create_autospec(WebAppAccessQuery, instance=True, spec_set=True)
    service, access_mode_for_app, _ = _service(access=access, enabled=False)

    assert service.get_access_mode(app_id=None, app_code=None) is WebAppAccessMode.PUBLIC
    access.find_app_id_by_code.assert_not_called()
    access_mode_for_app.assert_not_called()


def test_enabled_auth_reads_access_mode_by_app_id() -> None:
    access: MagicMock = create_autospec(WebAppAccessQuery, instance=True, spec_set=True)
    service, access_mode_for_app, _ = _service(access=access)

    assert service.get_access_mode(app_id="app-1", app_code=None) is WebAppAccessMode.PRIVATE
    access.find_app_id_by_code.assert_not_called()
    access_mode_for_app.assert_called_once_with("app-1")


def test_app_code_takes_precedence_over_app_id() -> None:
    access: MagicMock = create_autospec(WebAppAccessQuery, instance=True, spec_set=True)
    access.find_app_id_by_code.return_value = "resolved-id"
    service, access_mode_for_app, _ = _service(access=access, access_mode=WebAppAccessMode.SSO_VERIFIED)

    assert service.get_access_mode(app_id="ignored-id", app_code="code-1") is WebAppAccessMode.SSO_VERIFIED
    access.find_app_id_by_code.assert_called_once_with("code-1")
    access_mode_for_app.assert_called_once_with("resolved-id")


def test_missing_app_code_raises_not_found() -> None:
    access: MagicMock = create_autospec(WebAppAccessQuery, instance=True, spec_set=True)
    access.find_app_id_by_code.return_value = None
    service, access_mode_for_app, _ = _service(access=access)

    with pytest.raises(WebAppAccessAppNotFoundError):
        service.get_access_mode(app_id="must-not-fallback", app_code="missing-code")

    access_mode_for_app.assert_not_called()


def test_enabled_auth_requires_app_id_or_code() -> None:
    access: MagicMock = create_autospec(WebAppAccessQuery, instance=True, spec_set=True)
    service, access_mode_for_app, _ = _service(access=access)

    with pytest.raises(WebAppAccessReferenceRequiredError, match="^appId or appCode must be provided$"):
        service.get_access_mode(app_id=None, app_code=None)

    access_mode_for_app.assert_not_called()


def test_repository_failure_is_not_hidden() -> None:
    access: MagicMock = create_autospec(WebAppAccessQuery, instance=True, spec_set=True)
    failure = TypeError("repository bug")
    access.find_app_id_by_code.side_effect = failure
    service, _, _ = _service(access=access)

    with pytest.raises(TypeError) as raised:
        service.get_access_mode(app_id=None, app_code="code-1")

    assert raised.value is failure


def test_access_mode_failure_is_not_hidden() -> None:
    access: MagicMock = create_autospec(WebAppAccessQuery, instance=True, spec_set=True)
    service, access_mode_for_app, _ = _service(access=access)
    failure = TypeError("adapter bug")
    access_mode_for_app.side_effect = failure

    with pytest.raises(TypeError) as raised:
        service.get_access_mode(app_id="app-1", app_code=None)

    assert raised.value is failure


@pytest.mark.parametrize(
    ("access_mode", "expected"),
    [
        pytest.param(WebAppAccessMode.PUBLIC, False, id="public"),
        pytest.param(WebAppAccessMode.SSO_VERIFIED, False, id="sso-verified"),
        pytest.param(WebAppAccessMode.PRIVATE, True, id="private"),
        pytest.param(WebAppAccessMode.PRIVATE_ALL, True, id="private-all"),
    ],
)
def test_requires_permission_check_for_private_modes(access_mode: WebAppAccessMode, expected: bool) -> None:
    access: MagicMock = create_autospec(WebAppAccessQuery, instance=True, spec_set=True)
    service, access_mode_for_app, _ = _service(access=access, access_mode=access_mode)

    assert service.requires_permission_check("app-1") is expected
    access_mode_for_app.assert_called_once_with("app-1")


def test_disabled_auth_still_reads_configured_mode_before_passport() -> None:
    access: MagicMock = create_autospec(WebAppAccessQuery, instance=True, spec_set=True)
    service, access_mode_for_app, _ = _service(
        access=access,
        enabled=False,
        access_mode=WebAppAccessMode.PRIVATE,
    )

    assert service.requires_permission_check("app-1") is True
    access_mode_for_app.assert_called_once_with("app-1")


def test_disabled_auth_allows_after_passport_without_querying_user_permission() -> None:
    access: MagicMock = create_autospec(WebAppAccessQuery, instance=True, spec_set=True)
    service, _, is_user_allowed_for_app = _service(access=access, enabled=False, allowed=False)

    assert service.is_user_allowed(user_id="user-1", app_id="app-1") is True
    is_user_allowed_for_app.assert_not_called()


def test_enabled_auth_delegates_user_permission() -> None:
    access: MagicMock = create_autospec(WebAppAccessQuery, instance=True, spec_set=True)
    service, _, is_user_allowed_for_app = _service(access=access, allowed=False)

    assert service.is_user_allowed(user_id="user-1", app_id="app-1") is False
    is_user_allowed_for_app.assert_called_once_with("user-1", "app-1")
