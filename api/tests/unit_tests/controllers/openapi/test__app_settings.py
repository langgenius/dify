import uuid
from collections.abc import Callable
from dataclasses import replace

import pytest
from sqlalchemy.orm import Session, sessionmaker

from constants.oauth_bearer import TokenType
from controllers.openapi import _app_settings
from controllers.openapi._app_settings import WebAppPath
from controllers.openapi._errors import WebAppAccessModeConsoleOnly, WebAppAccessUnavailable, WebAppPublicAccessDisabled
from controllers.openapi._models import WebAppAccessPayload
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.subjects import AccountSubject
from enums import WebAppAccessMode
from extensions.ext_application_services import ApplicationServices
from libs.oauth_bearer import AuthContext
from models import AppMode
from repositories.webapp_access_query_repository import WebAppAccessQueryRepository
from services.enterprise.enterprise_service import EnterpriseService, WebAppSettings
from services.errors.enterprise import EnterpriseServiceError
from services.webapp_access_adapters import EnterpriseWebAppAccessPolicyGateway
from services.webapp_access_query_service import WebAppAccessQueryService
from tests.helpers.unit.model_factories import make_app


def _context(session: Session) -> Context:
    subject = AccountSubject(
        AuthContext(
            subject_email="caller@example.com",
            subject_issuer="dify:account",
            account_id=uuid.uuid4(),
            client_id="difyctl",
            token_id=uuid.uuid4(),
            token_type=TokenType.OAUTH_ACCOUNT,
            expires_at=None,
        )
    )
    ctx = Context(subject, session, {"app_id": "app-1"})
    ctx._app = make_app(app_id="app-1")
    return ctx


def _enterprise_cannot_read_access_modes(monkeypatch: pytest.MonkeyPatch) -> None:
    def get_app_access_mode_by_id(_app_id: str) -> WebAppSettings:
        raise EnterpriseServiceError("No data found.")

    monkeypatch.setattr(EnterpriseService.WebAppAuth, "get_app_access_mode_by_id", get_app_access_mode_by_id)


def _record_access_mode_writes(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, str]]:
    writes: list[tuple[str, str]] = []

    def update_app_access_mode(app_id: str, access_mode: str) -> None:
        writes.append((app_id, access_mode))

    monkeypatch.setattr(EnterpriseService.WebAppAuth, "update_app_access_mode", update_app_access_mode)
    return writes


def test_webapp_access_read_failure_is_unavailable(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    account_application_services: ApplicationServices,
) -> None:
    _enterprise_cannot_read_access_modes(monkeypatch)
    webapp_access = WebAppAccessQueryService(
        access=WebAppAccessQueryRepository(session_factory=sqlite_session_factory),
        policy=EnterpriseWebAppAccessPolicyGateway(webapp_auth=EnterpriseService.WebAppAuth),
        webapp_auth_enabled=True,
        get_access_modes=lambda **_: {},
        get_user_permissions=lambda **_: {},
    )
    services = replace(account_application_services, webapp_access=webapp_access)
    monkeypatch.setattr(_app_settings, "application_services", lambda: services)

    with pytest.raises(WebAppAccessUnavailable):
        _app_settings.webapp_access(_context(sqlite_session))


def test_set_webapp_access_returns_the_written_mode_without_reading_back(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    """A failing read after a saved write must not report the write as failed."""
    _enterprise_cannot_read_access_modes(monkeypatch)
    writes = _record_access_mode_writes(monkeypatch)

    result = _app_settings.update_webapp_access(
        _context(sqlite_session), WebAppAccessPayload(access_mode=WebAppAccessMode.PRIVATE_ALL)
    )

    assert result.access_mode == WebAppAccessMode.PRIVATE_ALL
    assert writes == [("app-1", WebAppAccessMode.PRIVATE_ALL)]


def test_set_webapp_access_public_is_refused_when_the_server_disables_public_access(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session, config_overrides: Callable[..., None]
) -> None:
    config_overrides(WEBAPP_PUBLIC_ACCESS_ENABLED=False)
    writes = _record_access_mode_writes(monkeypatch)

    with pytest.raises(WebAppPublicAccessDisabled):
        _app_settings.update_webapp_access(
            _context(sqlite_session), WebAppAccessPayload(access_mode=WebAppAccessMode.PUBLIC)
        )

    assert writes == []


@pytest.mark.parametrize("mode", [WebAppAccessMode.PRIVATE_ALL, WebAppAccessMode.SSO_VERIFIED])
def test_set_webapp_access_non_public_modes_are_unaffected_by_the_public_switch(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    config_overrides: Callable[..., None],
    mode: WebAppAccessMode,
) -> None:
    config_overrides(WEBAPP_PUBLIC_ACCESS_ENABLED=False)
    writes = _record_access_mode_writes(monkeypatch)

    result = _app_settings.update_webapp_access(_context(sqlite_session), WebAppAccessPayload(access_mode=mode))

    assert result.access_mode == mode
    assert writes == [("app-1", mode)]


def test_set_webapp_access_public_is_written_when_the_server_allows_it(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session, config_overrides: Callable[..., None]
) -> None:
    config_overrides(WEBAPP_PUBLIC_ACCESS_ENABLED=True)
    writes = _record_access_mode_writes(monkeypatch)

    result = _app_settings.update_webapp_access(
        _context(sqlite_session), WebAppAccessPayload(access_mode=WebAppAccessMode.PUBLIC)
    )

    assert result.access_mode == WebAppAccessMode.PUBLIC
    assert writes == [("app-1", WebAppAccessMode.PUBLIC)]


def test_set_webapp_access_private_still_answers_console_only_when_public_is_disabled(
    sqlite_session: Session, config_overrides: Callable[..., None]
) -> None:
    config_overrides(WEBAPP_PUBLIC_ACCESS_ENABLED=False)

    with pytest.raises(WebAppAccessModeConsoleOnly):
        _app_settings.update_webapp_access(
            _context(sqlite_session), WebAppAccessPayload(access_mode=WebAppAccessMode.PRIVATE)
        )


@pytest.mark.parametrize(
    ("mode", "path"),
    [
        (AppMode.WORKFLOW, WebAppPath.WORKFLOW),
        (AppMode.ADVANCED_CHAT, WebAppPath.CHAT),
        (AppMode.CHAT, WebAppPath.CHAT),
        (AppMode.AGENT_CHAT, WebAppPath.CHAT),
        (AppMode.COMPLETION, WebAppPath.COMPLETION),
        (AppMode.AGENT, WebAppPath.AGENT),
    ],
)
def test_web_app_path_follows_the_app_mode(mode: AppMode, path: WebAppPath) -> None:
    assert WebAppPath.of(mode) is path
