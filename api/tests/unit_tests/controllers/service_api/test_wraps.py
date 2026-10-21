"""Unit tests for the Service API app-token transport helpers."""

import uuid
from dataclasses import dataclass, field
from unittest.mock import patch

import pytest
from flask import Flask
from sqlalchemy.orm import Session, scoped_session
from werkzeug.exceptions import Forbidden, Unauthorized

from controllers.service_api import wraps as wraps_module
from controllers.service_api.wraps import FetchUserArg, WhereisUserArg, validate_and_get_api_token, validate_app_token
from core.db.session_factory import get_session_maker
from extensions.application_services.resource_access_token import build_resource_access_token_service
from models import Account, Tenant, TenantAccountJoin
from models.account import TenantAccountRole
from models.enums import ApiTokenType, EndUserType
from models.model import ApiToken, App, AppMode, EndUser, IconType
from models.resource_access_token import (
    ResourceAccessToken,
    ResourceAccessTokenRelation,
    ResourceAccessTokenResourceType,
)


class _RecordingEndUserCommands:
    def __init__(self, result: EndUser) -> None:
        self._result = result
        self.calls: list[tuple[str, str, str | None]] = []

    def get_or_create_end_user(self, tenant_id: str, app_id: str, user_id: str | None = None) -> EndUser:
        self.calls.append((tenant_id, app_id, user_id))
        return self._result


@dataclass(frozen=True, slots=True)
class _AppScopedEndUserServices:
    commands: _RecordingEndUserCommands


@dataclass(frozen=True, slots=True)
class _EndUserApplicationServices:
    app_scoped_end_users: _AppScopedEndUserServices


@dataclass(frozen=True, slots=True)
class _ResourceTokenApplicationServices:
    resource_access_tokens: object


@dataclass(slots=True)
class _RecordingLoginManager:
    users: list[object] = field(default_factory=list)

    def _update_request_context_with_user(self, user: object) -> None:
        self.users.append(user)


@dataclass(slots=True)
class _RecordingSignal:
    calls: list[tuple[object, object]] = field(default_factory=list)

    def send(self, sender: object, *, user: object) -> None:
        self.calls.append((sender, user))


class _RecordingTokenValidator:
    def __init__(self, result: ApiToken) -> None:
        self.result = result
        self.scopes: list[str | None] = []

    def __call__(self, scope: str | None = None) -> ApiToken:
        self.scopes.append(scope)
        return self.result


@pytest.fixture
def app() -> Flask:
    application = Flask(__name__)
    application.config["TESTING"] = True
    application.login_manager = _RecordingLoginManager()  # type: ignore[attr-defined]
    return application


def _session_proxy(session: Session) -> scoped_session[Session]:
    """Expose the real SQLite session through Flask-SQLAlchemy's callable shape."""
    return scoped_session(lambda: session)


def _api_token(*, tenant_id: str, app_id: str | None = None, token_type: ApiTokenType) -> ApiToken:
    return ApiToken(
        id=str(uuid.uuid4()),
        tenant_id=tenant_id,
        app_id=app_id,
        type=token_type,
        token="test_token",
    )


def _persist_workspace(session: Session) -> tuple[Tenant, Account, TenantAccountJoin]:
    tenant = Tenant(name="Workspace")
    account = Account(name="Owner", email=f"owner-{uuid.uuid4()}@example.com")
    membership = TenantAccountJoin(
        tenant_id=tenant.id,
        account_id=account.id,
        current=True,
        role=TenantAccountRole.OWNER,
    )
    session.add_all([tenant, account, membership])
    session.commit()
    return tenant, account, membership


def _app_model(*, tenant_id: str, enable_api: bool = True) -> App:
    return App(
        id=str(uuid.uuid4()),
        tenant_id=tenant_id,
        name="Service API App",
        mode=AppMode.CHAT,
        icon_type=IconType.EMOJI,
        icon="chat",
        icon_background="#FFFFFF",
        enable_site=False,
        enable_api=enable_api,
    )


class TestValidateAndGetApiToken:
    def test_missing_authorization_header(self, app: Flask) -> None:
        with app.test_request_context("/", method="GET"):
            with pytest.raises(Unauthorized, match="Authorization header must be provided"):
                validate_and_get_api_token("app")

    def test_invalid_auth_scheme(self, app: Flask) -> None:
        with app.test_request_context("/", method="GET", headers={"Authorization": "Basic token123"}):
            with pytest.raises(Unauthorized, match="Authorization header must be provided and start with 'Bearer'"):
                validate_and_get_api_token("app")

    def test_valid_token_returns_api_token(self, app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        api_token = _api_token(
            tenant_id=str(uuid.uuid4()),
            app_id=str(uuid.uuid4()),
            token_type=ApiTokenType.APP,
        )
        api_token.token = "valid_token_123"
        monkeypatch.setattr(wraps_module.ApiTokenCache, "get", lambda _token, _scope: None)
        monkeypatch.setattr(wraps_module, "fetch_token_with_single_flight", lambda _token, _scope: api_token)

        with app.test_request_context("/", headers={"Authorization": "Bearer valid_token_123"}):
            assert validate_and_get_api_token("app") is api_token

    def test_invalid_token_raises_unauthorized(self, app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(wraps_module.ApiTokenCache, "get", lambda _token, _scope: None)

        def reject_token(_token: str, _scope: str | None) -> ApiToken:
            raise Unauthorized("Access token is invalid")

        monkeypatch.setattr(wraps_module, "fetch_token_with_single_flight", reject_token)
        with app.test_request_context("/", headers={"Authorization": "Bearer invalid_token"}):
            with pytest.raises(Unauthorized, match="Access token is invalid"):
                validate_and_get_api_token("app")


class TestValidateAppToken:
    @pytest.mark.parametrize("separator", ["\u00a0", "\u001c", "\u000b", "\u2003"])
    def test_non_http_whitespace_never_resolves_resource_token(self, app: Flask, separator: str) -> None:
        with (
            app.test_request_context("/", headers={"Authorization": f"Bearer{separator}dify_rt_token"}),
            patch.object(wraps_module, "application_services") as services,
            pytest.raises(Unauthorized),
        ):
            validate_app_token(lambda: "ok")()
        services.assert_not_called()

    @pytest.mark.parametrize(
        "sqlite_session",
        [(App, ApiToken, Tenant, Account, TenantAccountJoin)],
        indirect=True,
    )
    def test_valid_app_token_allows_access(
        self,
        app: Flask,
        sqlite_session: Session,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        tenant, account, _ = _persist_workspace(sqlite_session)
        app_model = _app_model(tenant_id=tenant.id)
        api_token = _api_token(tenant_id=tenant.id, app_id=app_model.id, token_type=ApiTokenType.APP)
        sqlite_session.add_all([app_model, api_token])
        sqlite_session.commit()
        token_validator = _RecordingTokenValidator(api_token)
        signal = _RecordingSignal()
        monkeypatch.setattr(wraps_module, "validate_and_get_api_token", token_validator)
        monkeypatch.setattr(wraps_module, "current_user", account)
        monkeypatch.setattr(wraps_module, "user_logged_in", signal)

        @validate_app_token
        def protected_view(*, app_model: App) -> str:
            return app_model.id

        with (
            app.test_request_context("/", headers={"Authorization": "Bearer test_token"}),
            monkeypatch.context() as request_patch,
        ):
            request_patch.setattr(wraps_module.db, "session", _session_proxy(sqlite_session))
            result = protected_view()

        assert result == app_model.id
        assert token_validator.scopes == ["app"]
        assert account.current_tenant_id == tenant.id
        assert app.login_manager.users == [account]  # type: ignore[attr-defined]
        assert signal.calls == [(app, account)]

    @pytest.mark.parametrize(
        ("fetch_from", "method", "path", "request_kwargs", "expected_user_id"),
        [
            pytest.param(WhereisUserArg.QUERY, "GET", "/?user=query-user", {}, "query-user", id="query"),
            pytest.param(
                WhereisUserArg.JSON,
                "POST",
                "/",
                {"json": {"user": "json-user"}},
                "json-user",
                id="json",
            ),
            pytest.param(
                WhereisUserArg.FORM,
                "POST",
                "/",
                {"data": {"user": "form-user"}},
                "form-user",
                id="form",
            ),
        ],
    )
    @pytest.mark.parametrize("sqlite_session", [(App, Tenant)], indirect=True)
    def test_fetch_user_arg_resolves_and_injects_end_user(
        self,
        app: Flask,
        sqlite_session: Session,
        monkeypatch: pytest.MonkeyPatch,
        fetch_from: WhereisUserArg,
        method: str,
        path: str,
        request_kwargs: dict[str, object],
        expected_user_id: str,
    ) -> None:
        tenant = Tenant(name="Workspace")
        app_model = _app_model(tenant_id=tenant.id)
        sqlite_session.add_all([tenant, app_model])
        sqlite_session.commit()
        token = _api_token(tenant_id=tenant.id, app_id=app_model.id, token_type=ApiTokenType.APP)
        monkeypatch.setattr(wraps_module, "validate_and_get_api_token", _RecordingTokenValidator(token))

        end_user = EndUser(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            app_id=app_model.id,
            type=EndUserType.SERVICE_API,
            session_id=expected_user_id,
        )
        commands = _RecordingEndUserCommands(end_user)
        services = _EndUserApplicationServices(_AppScopedEndUserServices(commands))
        signal = _RecordingSignal()
        monkeypatch.setattr(wraps_module, "application_services", lambda: services)
        monkeypatch.setattr(wraps_module, "user_logged_in", signal)

        @validate_app_token(fetch_user_arg=FetchUserArg(fetch_from=fetch_from, required=True))
        def protected_view(*, app_model: App, end_user: EndUser) -> tuple[App, EndUser]:
            return app_model, end_user

        with (
            app.test_request_context(path, method=method, **request_kwargs),
            monkeypatch.context() as request_patch,
        ):
            request_patch.setattr(wraps_module.db, "session", _session_proxy(sqlite_session))
            injected_app, injected_end_user = protected_view()

        assert injected_app is app_model
        assert injected_end_user is end_user
        assert commands.calls == [(tenant.id, app_model.id, expected_user_id)]
        assert app.login_manager.users == [end_user]  # type: ignore[attr-defined]
        assert signal.calls == [(app, end_user)]

    @pytest.mark.parametrize(
        "sqlite_session",
        [(App, ResourceAccessToken, ResourceAccessTokenRelation, Tenant, Account, TenantAccountJoin)],
        indirect=True,
    )
    def test_resource_access_token_allows_bound_app(
        self,
        app: Flask,
        sqlite_session: Session,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        token_service = build_resource_access_token_service(database_client=get_session_maker())
        services = _ResourceTokenApplicationServices(resource_access_tokens=token_service)
        monkeypatch.setattr(wraps_module, "application_services", lambda: services)
        tenant, account, _ = _persist_workspace(sqlite_session)
        monkeypatch.setattr(wraps_module, "current_user", account)
        monkeypatch.setattr(wraps_module, "user_logged_in", _RecordingSignal())
        app_model = _app_model(tenant_id=tenant.id)
        access_token = ResourceAccessToken(
            tenant_id=tenant.id,
            name="Production integration",
            track_id="a" * 32,
            token="sk-00000000-0000-0000-0000-000000000000",
            created_by=account.id,
        )
        sqlite_session.add_all([app_model, access_token])
        sqlite_session.flush()
        sqlite_session.add(
            ResourceAccessTokenRelation(
                token_id=access_token.id,
                resource_type=ResourceAccessTokenResourceType.APP,
                app_id=app_model.id,
                dataset_id=None,
            )
        )
        sqlite_session.commit()

        @validate_app_token
        def protected_view(*, app_model: App) -> str:
            return app_model.id

        with (
            app.test_request_context("/", headers={"Authorization": f"Bearer {access_token.token}"}),
            monkeypatch.context() as request_patch,
        ):
            request_patch.setattr(wraps_module.db, "session", _session_proxy(sqlite_session))
            assert protected_view() == app_model.id

        sqlite_session.expire_all()
        assert sqlite_session.get(ResourceAccessToken, access_token.id).last_used_at is not None

    @pytest.mark.parametrize("sqlite_session", [(App,)], indirect=True)
    def test_app_not_found_raises_forbidden(
        self, app: Flask, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        api_token = _api_token(
            tenant_id=str(uuid.uuid4()),
            app_id=str(uuid.uuid4()),
            token_type=ApiTokenType.APP,
        )
        monkeypatch.setattr(wraps_module, "validate_and_get_api_token", _RecordingTokenValidator(api_token))

        @validate_app_token
        def protected_view(**kwargs: object) -> None:
            raise AssertionError("unreachable")

        with app.test_request_context("/"), monkeypatch.context() as request_patch:
            request_patch.setattr(wraps_module.db, "session", _session_proxy(sqlite_session))
            with pytest.raises(Forbidden, match="no longer exists"):
                protected_view()

    @pytest.mark.parametrize(
        ("status", "enable_api", "message"),
        [("abnormal", True, "status"), ("normal", False, "disabled")],
    )
    @pytest.mark.parametrize("sqlite_session", [(App,)], indirect=True)
    def test_unavailable_app_raises_forbidden(
        self,
        app: Flask,
        sqlite_session: Session,
        monkeypatch: pytest.MonkeyPatch,
        status: str,
        enable_api: bool,
        message: str,
    ) -> None:
        app_model = _app_model(tenant_id=str(uuid.uuid4()), enable_api=enable_api)
        app_model.status = status
        token = _api_token(tenant_id=app_model.tenant_id, app_id=app_model.id, token_type=ApiTokenType.APP)
        monkeypatch.setattr(wraps_module, "validate_and_get_api_token", _RecordingTokenValidator(token))

        def get_app_by_id(app_id: str, *, session: Session) -> App:
            del app_id, session
            return app_model

        monkeypatch.setattr(wraps_module.AppService, "get_app_by_id", get_app_by_id)

        @validate_app_token
        def protected_view(**kwargs: object) -> None:
            raise AssertionError("unreachable")

        with app.test_request_context("/"), monkeypatch.context() as request_patch:
            request_patch.setattr(wraps_module.db, "session", _session_proxy(sqlite_session))
            with pytest.raises(Forbidden, match=message):
                protected_view()


class TestFetchUserArg:
    def test_fetch_user_arg_defaults(self) -> None:
        arg = FetchUserArg(fetch_from=WhereisUserArg.JSON)

        assert arg.fetch_from == WhereisUserArg.JSON
        assert arg.required is False

    def test_fetch_user_arg_required(self) -> None:
        arg = FetchUserArg(fetch_from=WhereisUserArg.QUERY, required=True)

        assert arg.fetch_from == WhereisUserArg.QUERY
        assert arg.required is True
