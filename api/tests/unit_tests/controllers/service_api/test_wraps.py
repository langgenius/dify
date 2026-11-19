"""Unit tests for the Service API app-token transport helpers."""

import uuid
from dataclasses import dataclass, field
from typing import override
from unittest.mock import Mock, patch

import pytest
from flask import Flask, g
from sqlalchemy import inspect as sa_inspect
from sqlalchemy.orm import Session, scoped_session
from werkzeug.exceptions import Forbidden

from controllers.common.errors import UnauthorizedError
from controllers.service_api import wraps as wraps_module
from controllers.service_api.wraps import (
    FetchUserArg,
    WhereisUserArg,
    validate_and_get_api_token,
    validate_app_token,
)
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
from services.api_token_service import ApiTokenInvalidError
from services.resource_access_token_service import ResourceAccessTokenService


@dataclass(frozen=True, slots=True)
class _ResourceTokenApplicationServices:
    resource_access_tokens: object


def _configure_current_app_mock(mock_current_app):
    mock_current_app.login_manager = Mock()
    mock_current_app._get_current_object = Mock(return_value=Mock())


class _RecordingEndUserCommands:
    def __init__(self, result: EndUser) -> None:
        self._result = result
        self.calls: list[tuple[str, str, str | None]] = []

    def get_or_create_end_user(self, tenant_id: str, app_id: str, user_id: str | None = None) -> EndUser:
        self.calls.append((tenant_id, app_id, user_id))
        return self._result


class _SessionStateRecordingEndUserCommands(_RecordingEndUserCommands):
    """Record whether the request-scoped session is inside a transaction when provisioning runs."""

    def __init__(self, result: EndUser, request_session: Session) -> None:
        super().__init__(result)
        self._request_session = request_session
        self.in_transaction_during_calls: list[bool] = []

    @override
    def get_or_create_end_user(self, tenant_id: str, app_id: str, user_id: str | None = None) -> EndUser:
        self.in_transaction_during_calls.append(self._request_session.in_transaction())
        return super().get_or_create_end_user(tenant_id, app_id, user_id)


@dataclass(frozen=True, slots=True)
class _AppScopedEndUserServices:
    commands: _RecordingEndUserCommands


@dataclass(frozen=True, slots=True)
class _EndUserApplicationServices:
    app_scoped_end_users: _AppScopedEndUserServices


@dataclass(eq=False, repr=False)
class _ResourceAccessTokenServicesStub:
    resource_access_tokens: ResourceAccessTokenService


class _RequestLoginManager:
    def _update_request_context_with_user(self, user: Account) -> None:
        g._login_user = user


class _RateLimitRedisStub:
    def __init__(self, *, request_count: int = 0) -> None:
        self.request_count = request_count
        self.added_keys: list[str] = []
        self.trimmed_keys: list[str] = []

    def zadd(self, key: str, _values: dict[int, int]) -> None:
        self.added_keys.append(key)

    def zremrangebyscore(self, key: str, _minimum: int, _maximum: int) -> None:
        self.trimmed_keys.append(key)

    def zcard(self, _key: str) -> int:
        return self.request_count


@dataclass(eq=False, repr=False)
class _DatabaseEngineStub:
    engine: object


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
            with pytest.raises(UnauthorizedError, match="Authorization header must be provided"):
                validate_and_get_api_token("app")

    def test_invalid_auth_scheme(self, app: Flask) -> None:
        with app.test_request_context("/", method="GET", headers={"Authorization": "Basic token123"}):
            with pytest.raises(
                UnauthorizedError,
                match="Authorization header must be provided and start with 'Bearer'",
            ):
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
            raise ApiTokenInvalidError("Access token is invalid")

        monkeypatch.setattr(wraps_module, "fetch_token_with_single_flight", reject_token)
        with app.test_request_context("/", headers={"Authorization": "Bearer invalid_token"}):
            with pytest.raises(UnauthorizedError, match="Access token is invalid"):
                validate_and_get_api_token("app")


class TestValidateAppToken:
    @pytest.mark.parametrize("separator", ["\u00a0", "\u001c", "\u000b", "\u2003"])
    def test_non_http_whitespace_never_resolves_resource_token(self, app: Flask, separator: str) -> None:
        with (
            app.test_request_context("/", headers={"Authorization": f"Bearer{separator}dify_rt_token"}),
            patch.object(wraps_module, "application_services") as services,
            pytest.raises(UnauthorizedError),
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

    @patch("controllers.service_api.wraps.validate_and_get_api_token")
    @pytest.mark.parametrize("sqlite_session", [(App,)], indirect=True)
    def test_app_status_abnormal_raises_forbidden(self, mock_validate_token, app: Flask, sqlite_session: Session):
        """Test that Forbidden is raised when app status is abnormal."""
        # Arrange
        app_model = _app_model(tenant_id=str(uuid.uuid4()))
        sqlite_session.add(app_model)
        sqlite_session.commit()
        app_model.status = "abnormal"
        mock_validate_token.return_value = _api_token(
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            token_type=ApiTokenType.APP,
        )

        @validate_app_token
        def protected_view(**kwargs):
            return {"success": True}

        # Act & Assert
        with (
            app.test_request_context("/", method="GET"),
            patch("controllers.service_api.wraps.db.session", _session_proxy(sqlite_session)),
        ):
            with pytest.raises(Forbidden) as exc_info:
                protected_view()
            assert "status is abnormal" in str(exc_info.value)

    @patch("controllers.service_api.wraps.validate_and_get_api_token")
    @pytest.mark.parametrize("sqlite_session", [(App,)], indirect=True)
    def test_app_api_disabled_raises_forbidden(self, mock_validate_token, app: Flask, sqlite_session: Session):
        """Test that Forbidden is raised when app API is disabled."""
        # Arrange
        app_model = _app_model(tenant_id=str(uuid.uuid4()), enable_api=False)
        sqlite_session.add(app_model)
        sqlite_session.commit()
        mock_validate_token.return_value = _api_token(
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            token_type=ApiTokenType.APP,
        )

        @validate_app_token
        def protected_view(**kwargs):
            return {"success": True}

        # Act & Assert
        with (
            app.test_request_context("/", method="GET"),
            patch("controllers.service_api.wraps.db.session", _session_proxy(sqlite_session)),
        ):
            with pytest.raises(Forbidden) as exc_info:
                protected_view()
            assert "API service has been disabled" in str(exc_info.value)

    @patch("controllers.service_api.wraps.validate_and_get_api_token")
    def test_fetch_user_arg_releases_request_session_before_provisioning_end_user(
        self,
        mock_validate_token: Mock,
        app: Flask,
        sqlite_session: Session,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Admission must not hold a pooled connection while end-user provisioning opens its own session."""
        tenant = Tenant(name="Workspace")
        app_model = _app_model(tenant_id=tenant.id)
        sqlite_session.add_all([tenant, app_model])
        sqlite_session.commit()
        tenant_id, app_id = tenant.id, app_model.id
        # Admission must read the app and workspace from the database, as it does on a fresh request.
        sqlite_session.expunge_all()
        mock_validate_token.return_value = _api_token(
            tenant_id=tenant_id,
            app_id=app_id,
            token_type=ApiTokenType.APP,
        )
        end_user = EndUser(
            id=str(uuid.uuid4()),
            tenant_id=tenant_id,
            app_id=app_id,
            type=EndUserType.SERVICE_API,
            session_id="query-user",
        )
        commands = _SessionStateRecordingEndUserCommands(end_user, sqlite_session)
        app.login_manager = _RecordingLoginManager()  # type: ignore[attr-defined]
        monkeypatch.setattr(
            wraps_module,
            "application_services",
            lambda: _EndUserApplicationServices(_AppScopedEndUserServices(commands)),
        )
        monkeypatch.setattr(wraps_module, "user_logged_in", _RecordingSignal())
        expire_on_commit = sqlite_session.expire_on_commit

        admitted_apps: list[App] = []

        @validate_app_token(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.QUERY, required=True))
        def protected_view(*, app_model: App, end_user: EndUser) -> str:
            admitted_apps.append(app_model)
            return end_user.session_id

        app.add_url_rule("/protected", view_func=protected_view)
        with (
            app.test_request_context("/protected?user=query-user", method="GET"),
            patch("controllers.service_api.wraps.db.session", _session_proxy(sqlite_session)),
        ):
            assert app.dispatch_request() == "query-user"

        assert commands.calls == [(tenant_id, app_id, "query-user")]
        assert commands.in_transaction_during_calls == [False]
        (injected_app,) = admitted_apps
        assert injected_app in sqlite_session
        assert sa_inspect(injected_app).expired_attributes == set()
        # Reading the admitted app must not send a refresh query that takes the connection back.
        assert injected_app.id == app_id
        assert not sqlite_session.in_transaction()
        assert sqlite_session.expire_on_commit is expire_on_commit

    @patch("controllers.service_api.wraps.user_logged_in")
    @patch("controllers.service_api.wraps.validate_and_get_api_token")
    @patch("controllers.service_api.wraps.current_app")
    def test_account_admission_releases_request_session_before_handler(
        self,
        mock_current_app: Mock,
        mock_validate_token: Mock,
        mock_user_logged_in: Mock,
        app: Flask,
        sqlite_session: Session,
    ) -> None:
        """Account-backed handlers start without the request-scoped session holding a connection."""
        _configure_current_app_mock(mock_current_app)
        tenant, account, _ = _persist_workspace(sqlite_session)
        app_model = _app_model(tenant_id=tenant.id)
        api_token = _api_token(tenant_id=tenant.id, app_id=app_model.id, token_type=ApiTokenType.APP)
        sqlite_session.add_all([app_model, api_token])
        sqlite_session.commit()
        mock_validate_token.return_value = api_token

        observed: list[tuple[bool, str, bool]] = []

        @validate_app_token
        def protected_view(app_model: App) -> str:
            in_transaction_on_entry = sqlite_session.in_transaction()
            observed.append((in_transaction_on_entry, app_model.id, sqlite_session.in_transaction()))
            return "ok"

        app.add_url_rule("/protected", view_func=protected_view)
        with (
            app.test_request_context("/protected", method="GET", headers={"Authorization": "Bearer test_token"}),
            patch("controllers.service_api.wraps.db.session", _session_proxy(sqlite_session)),
        ):
            assert app.dispatch_request() == "ok"

        assert observed == [(False, app_model.id, False)]
        assert account.current_tenant_id == tenant.id


class TestFetchUserArg:
    def test_fetch_user_arg_defaults(self) -> None:
        arg = FetchUserArg(fetch_from=WhereisUserArg.JSON)

        assert arg.fetch_from == WhereisUserArg.JSON
        assert arg.required is False

    def test_fetch_user_arg_required(self) -> None:
        arg = FetchUserArg(fetch_from=WhereisUserArg.QUERY, required=True)

        assert arg.fetch_from == WhereisUserArg.QUERY
        assert arg.required is True
