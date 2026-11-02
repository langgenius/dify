"""Unit tests for controllers.web.app endpoints."""

from __future__ import annotations

from collections.abc import Callable, Iterator
from importlib import import_module
from types import SimpleNamespace
from unittest.mock import MagicMock

import jwt
import pytest
import sqlalchemy as sa
from flask import Flask
from flask.testing import FlaskClient
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.exceptions import Unauthorized

from controllers.common.errors import InvalidArgumentError
from controllers.web import app as app_controller
from controllers.web import bp, wraps
from controllers.web.app import AppAccessMode, AppMeta, AppParameterApi, AppWebAuthPermission
from controllers.web.error import (
    AgentNotPublishedError,
    AppUnavailableError,
    WebAppAccessServiceUnavailableError,
    WebAppAuthRequiredError,
    WebAppNotFoundError,
)
from core.app.app_config.common.parameters_mapping import get_parameters_from_feature_dict
from core.plugin.impl.exc import PluginDaemonBadRequestError
from enums import WebAppAccessMode
from extensions.ext_application_services import ApplicationServices
from libs.exception import BaseHTTPException
from libs.passport import PassportService
from models.enums import EndUserType
from models.model import App, AppMode, EndUser
from models.workflow import Workflow
from repositories.app_definition_query_repository import AppDefinitionQueryRepository
from services.app_definition_query_service import (
    AppDefinitionNotPublishedError,
    AppDefinitionQueryService,
    AppDefinitionUnavailableError,
    WebAppParametersDict,
)
from services.end_user_connection_revision_adapters import PluginConnectionRevisions
from services.webapp_access_query_service import (
    WebAppAccessAppNotFoundError,
    WebAppAccessReferenceRequiredError,
    WebAppAccessUnavailableError,
)
from services.workflow.tool_credentials import get_tool_connection_requirements
from tests.helpers.end_user_oauth import OAuthHarness, make_oauth_harness
from tests.helpers.unit.config_override import config_overrides_context

PASSPORT_SECRET = "test-secret-that-is-at-least-32-bytes"
OTHER_PASSPORT_SECRET = "other-secret-that-is-at-least-32-bytes"


def _make_app() -> App:
    return App(
        id="app-1",
        tenant_id="tenant-1",
        name="Web app",
        mode=AppMode.CHAT,
        enable_site=True,
        enable_api=True,
    )


def _make_end_user() -> EndUser:
    return EndUser(
        id="end-user-1",
        tenant_id="tenant-1",
        app_id="app-1",
        type=EndUserType.BROWSER,
        session_id="session-1",
    )


@pytest.fixture
def real_application_services(
    monkeypatch: pytest.MonkeyPatch,
    account_application_services: ApplicationServices,
) -> ApplicationServices:
    """Route the web controllers through the real application-service graph."""
    app_module = import_module("controllers.web.app")
    monkeypatch.setattr(app_module, "application_services", lambda: account_application_services)
    return account_application_services


# ---------------------------------------------------------------------------
# AppParameterApi
# ---------------------------------------------------------------------------
class TestAppParameterApi:
    @pytest.mark.parametrize("allow_anonymous", [True, False])
    def test_get_returns_public_parameters(
        self,
        real_application_services: ApplicationServices,
        monkeypatch: pytest.MonkeyPatch,
        app: Flask,
        config_overrides: Callable[..., None],
        allow_anonymous: bool,
    ) -> None:
        config_overrides(
            END_USER_AUTH_ALLOW_ANONYMOUS=allow_anonymous,
            WEBAPP_ACCOUNT_PASSPORT_ENABLED=True,
            CONSOLE_WEB_URL="https://console.example.com/base",
        )
        calls: list[tuple[str, str]] = []

        def get_web_parameters(app_id: str, tenant_id: str) -> WebAppParametersDict:
            calls.append((app_id, tenant_id))
            parameters = get_parameters_from_feature_dict(
                features_dict={"opening_statement": "Hello"}, user_input_form=[]
            )
            return WebAppParametersDict(
                opening_statement=parameters["opening_statement"],
                suggested_questions=parameters["suggested_questions"],
                suggested_questions_after_answer=parameters["suggested_questions_after_answer"],
                speech_to_text=parameters["speech_to_text"],
                text_to_speech=parameters["text_to_speech"],
                retriever_resource=parameters["retriever_resource"],
                annotation_reply=parameters["annotation_reply"],
                more_like_this=parameters["more_like_this"],
                user_input_form=parameters["user_input_form"],
                sensitive_word_avoidance=parameters["sensitive_word_avoidance"],
                file_upload=parameters["file_upload"],
                system_parameters=parameters["system_parameters"],
                connection_revision=None,
                requires_end_user_connections=False,
                connection_requirements=(),
            )

        monkeypatch.setattr(
            real_application_services.app_definitions,
            "get_web_parameters",
            get_web_parameters,
        )
        app_model = _make_app()

        with app.test_request_context("/parameters"):
            result = AppParameterApi().get(app_model, _make_end_user())

        assert result["opening_statement"] == "Hello"
        assert calls == [("app-1", "tenant-1")]
        assert result["connection_revision"] is None
        assert result["requires_end_user_connections"] is False
        assert result["connection_requirements"] == []
        assert result["allow_anonymous_end_user_auth"] is allow_anonymous
        assert result["account_login_enabled"] is True
        assert result["account_login_url"] == "https://console.example.com/base/signin"

    @pytest.mark.parametrize(
        ("service_error", "http_error"),
        [
            pytest.param(AppDefinitionNotPublishedError(), AgentNotPublishedError, id="not-published"),
            pytest.param(AppDefinitionUnavailableError(), AppUnavailableError, id="unavailable"),
        ],
    )
    def test_get_maps_query_errors(
        self,
        real_application_services: ApplicationServices,
        monkeypatch: pytest.MonkeyPatch,
        service_error: Exception,
        http_error: type[Exception],
        app: Flask,
    ) -> None:
        def get_web_parameters(app_id: str, tenant_id: str) -> None:
            _ = app_id, tenant_id
            raise service_error

        monkeypatch.setattr(
            real_application_services.app_definitions,
            "get_web_parameters",
            get_web_parameters,
        )

        with app.test_request_context("/parameters"):
            with pytest.raises(http_error):
                AppParameterApi().get(_make_app(), _make_end_user())


# ---------------------------------------------------------------------------
# AppMeta
# ---------------------------------------------------------------------------
class TestAppMeta:
    def test_get_returns_meta(
        self,
        real_application_services: ApplicationServices,
        monkeypatch: pytest.MonkeyPatch,
        app: Flask,
    ) -> None:
        calls: list[str] = []

        def get_tool_icons(app_id: str) -> dict[str, object]:
            calls.append(app_id)
            return {}

        monkeypatch.setattr(real_application_services.app_definitions, "get_tool_icons", get_tool_icons)
        app_model = _make_app()

        with app.test_request_context("/meta"):
            result = AppMeta().get(app_model, _make_end_user())

        assert result == {"tool_icons": {}}
        assert calls == ["app-1"]

    def test_maps_unavailable_definition_to_app_unavailable(
        self,
        real_application_services: ApplicationServices,
        monkeypatch: pytest.MonkeyPatch,
        app: Flask,
    ) -> None:
        def get_tool_icons(app_id: str) -> None:
            _ = app_id
            raise AppDefinitionUnavailableError

        monkeypatch.setattr(real_application_services.app_definitions, "get_tool_icons", get_tool_icons)

        with app.test_request_context("/meta"):
            with pytest.raises(AppUnavailableError) as raised:
                AppMeta().get(_make_app(), _make_end_user())

        assert raised.value.data == {
            "code": "app_unavailable",
            "message": "App unavailable, please check your app configurations.",
            "status": 400,
        }


# ---------------------------------------------------------------------------
# AppAccessMode
# ---------------------------------------------------------------------------
class TestAppAccessMode:
    def test_delegates_validated_app_references(
        self,
        real_application_services: ApplicationServices,
        monkeypatch: pytest.MonkeyPatch,
        app: Flask,
    ) -> None:
        calls: list[dict[str, str | None]] = []

        def get_access_mode(*, app_id: str | None, app_code: str | None) -> WebAppAccessMode:
            calls.append({"app_id": app_id, "app_code": app_code})
            return WebAppAccessMode.SSO_VERIFIED

        monkeypatch.setattr(real_application_services.webapp_access, "get_access_mode", get_access_mode)

        with app.test_request_context("/webapp/access-mode?appId=app-1&appCode=code-1"):
            result = AppAccessMode().get()

        assert result == {"accessMode": "sso_verified"}
        assert calls == [{"app_id": "app-1", "app_code": "code-1"}]

    @pytest.mark.parametrize(
        ("service_error", "http_error", "expected_data"),
        [
            pytest.param(
                WebAppAccessReferenceRequiredError("appId or appCode must be provided"),
                InvalidArgumentError,
                {"code": "invalid_param", "message": "appId or appCode must be provided", "status": 400},
                id="missing-reference",
            ),
            pytest.param(
                WebAppAccessAppNotFoundError(),
                WebAppNotFoundError,
                {"code": "app_not_found", "message": "App not found.", "status": 404},
                id="app-not-found",
            ),
            pytest.param(
                WebAppAccessUnavailableError(),
                WebAppAccessServiceUnavailableError,
                {
                    "code": "web_app_access_unavailable",
                    "message": "Web app access service is unavailable.",
                    "status": 503,
                },
                id="access-unavailable",
            ),
        ],
    )
    def test_maps_query_errors(
        self,
        real_application_services: ApplicationServices,
        monkeypatch: pytest.MonkeyPatch,
        service_error: Exception,
        http_error: type[BaseHTTPException],
        expected_data: dict[str, object],
        app: Flask,
    ) -> None:
        def get_access_mode(*, app_id: str | None, app_code: str | None) -> None:
            _ = app_id, app_code
            raise service_error

        monkeypatch.setattr(real_application_services.webapp_access, "get_access_mode", get_access_mode)

        with app.test_request_context("/webapp/access-mode?appCode=code-1"):
            with pytest.raises(http_error) as raised:
                AppAccessMode().get()

        assert raised.value.data == expected_data


# ---------------------------------------------------------------------------
# AppWebAuthPermission
# ---------------------------------------------------------------------------
class TestAppWebAuthPermission:
    def test_returns_true_without_reading_passport_when_no_permission_check_required(
        self,
        real_application_services: ApplicationServices,
        monkeypatch: pytest.MonkeyPatch,
        app: Flask,
    ) -> None:
        permission_checks: list[str] = []

        def requires_permission_check(app_id: str) -> bool:
            permission_checks.append(app_id)
            return False

        def unexpected_call(*_args: object, **_kwargs: object) -> None:
            raise AssertionError("passport or user-permission lookup must not run")

        monkeypatch.setattr(
            real_application_services.webapp_access,
            "requires_permission_check",
            requires_permission_check,
        )
        monkeypatch.setattr(real_application_services.webapp_access, "is_user_allowed", unexpected_call)
        monkeypatch.setattr(import_module("controllers.web.app"), "extract_webapp_passport", unexpected_call)

        with app.test_request_context("/webapp/permission?appId=app-1", headers={"X-App-Code": "code1"}):
            result = AppWebAuthPermission().get()

        assert result == {"result": True}
        assert permission_checks == ["app-1"]

    @pytest.mark.parametrize(
        ("user_id", "allowed"),
        [
            pytest.param("user-1", True, id="allowed-user"),
            pytest.param("user-2", False, id="denied-user"),
        ],
    )
    def test_checks_private_app_permission(
        self,
        real_application_services: ApplicationServices,
        monkeypatch: pytest.MonkeyPatch,
        user_id: str,
        allowed: bool,
        app: Flask,
    ) -> None:
        permission_checks: list[str] = []
        access_checks: list[tuple[str, str]] = []

        def requires_permission_check(app_id: str) -> bool:
            permission_checks.append(app_id)
            return True

        def is_user_allowed(*, user_id: str, app_id: str) -> bool:
            access_checks.append((user_id, app_id))
            return allowed

        monkeypatch.setattr(
            real_application_services.webapp_access,
            "requires_permission_check",
            requires_permission_check,
        )
        monkeypatch.setattr(real_application_services.webapp_access, "is_user_allowed", is_user_allowed)

        with config_overrides_context(SECRET_KEY=PASSPORT_SECRET):
            passport = PassportService().issue({"user_id": user_id, "auth_type": "internal"})
            monkeypatch.setattr(
                import_module("controllers.web.app"),
                "extract_webapp_passport",
                lambda app_code, request: passport,
            )
            with app.test_request_context("/webapp/permission?appId=app-1", headers={"X-App-Code": "code1"}):
                result = AppWebAuthPermission().get()

        assert result == {"result": allowed}
        assert permission_checks == ["app-1"]
        assert access_checks == [(user_id, "app-1")]

    @pytest.mark.parametrize(
        "decoded",
        [
            pytest.param({}, id="missing-auth-type"),
            pytest.param({"auth_type": "internal"}, id="missing-user-id"),
            pytest.param({"user_id": "sso_external_user", "auth_type": "external"}, id="external-auth-type"),
        ],
    )
    def test_private_app_requires_internal_identity(
        self,
        real_application_services: ApplicationServices,
        monkeypatch: pytest.MonkeyPatch,
        decoded: dict[str, str],
        app: Flask,
    ) -> None:
        access_checks: list[tuple[str, str]] = []
        monkeypatch.setattr(
            real_application_services.webapp_access,
            "requires_permission_check",
            lambda app_id: True,
        )
        monkeypatch.setattr(
            real_application_services.webapp_access,
            "is_user_allowed",
            lambda *, user_id, app_id: access_checks.append((user_id, app_id)),
        )

        with config_overrides_context(SECRET_KEY=PASSPORT_SECRET):
            passport = PassportService().issue(decoded)
            monkeypatch.setattr(
                import_module("controllers.web.app"),
                "extract_webapp_passport",
                lambda app_code, request: passport,
            )
            with app.test_request_context("/webapp/permission?appId=app-1", headers={"X-App-Code": "code1"}):
                with pytest.raises(WebAppAuthRequiredError):
                    AppWebAuthPermission().get()

        assert access_checks == []

    @pytest.mark.parametrize("failing_method", ["requires_permission_check", "is_user_allowed"])
    def test_maps_access_dependency_failure_to_service_unavailable(
        self,
        real_application_services: ApplicationServices,
        monkeypatch: pytest.MonkeyPatch,
        failing_method: str,
        app: Flask,
    ) -> None:
        def requires_permission_check(app_id: str) -> bool:
            _ = app_id
            if failing_method == "requires_permission_check":
                raise WebAppAccessUnavailableError
            return True

        def is_user_allowed(*, user_id: str, app_id: str) -> bool:
            _ = user_id, app_id
            if failing_method == "is_user_allowed":
                raise WebAppAccessUnavailableError
            return True

        monkeypatch.setattr(
            real_application_services.webapp_access,
            "requires_permission_check",
            requires_permission_check,
        )
        monkeypatch.setattr(real_application_services.webapp_access, "is_user_allowed", is_user_allowed)

        with config_overrides_context(SECRET_KEY=PASSPORT_SECRET):
            passport = PassportService().issue({"user_id": "user-1", "auth_type": "internal"})
            monkeypatch.setattr(
                import_module("controllers.web.app"),
                "extract_webapp_passport",
                lambda app_code, request: passport,
            )
            with (
                app.test_request_context("/webapp/permission?appId=app-1", headers={"X-App-Code": "code1"}),
                pytest.raises(WebAppAccessServiceUnavailableError) as raised,
            ):
                AppWebAuthPermission().get()

        assert raised.value.data == {
            "code": "web_app_access_unavailable",
            "message": "Web app access service is unavailable.",
            "status": 503,
        }

    def test_private_app_requires_passport(
        self,
        real_application_services: ApplicationServices,
        monkeypatch: pytest.MonkeyPatch,
        app: Flask,
    ) -> None:
        access_checks: list[tuple[str, str]] = []
        monkeypatch.setattr(
            real_application_services.webapp_access,
            "requires_permission_check",
            lambda app_id: True,
        )
        monkeypatch.setattr(
            real_application_services.webapp_access,
            "is_user_allowed",
            lambda *, user_id, app_id: access_checks.append((user_id, app_id)),
        )
        monkeypatch.setattr(
            import_module("controllers.web.app"),
            "extract_webapp_passport",
            lambda app_code, request: None,
        )

        with (
            app.test_request_context("/webapp/permission?appId=app-1", headers={"X-App-Code": "code1"}),
            pytest.raises(WebAppAuthRequiredError) as raised,
        ):
            AppWebAuthPermission().get()

        assert raised.value.data == {
            "code": "web_sso_auth_required",
            "message": "Web app authentication required.",
            "status": 401,
        }
        assert access_checks == []

    @pytest.mark.parametrize(
        "description",
        ["Token has expired.", "Invalid token signature.", "Invalid token."],
    )
    def test_invalid_passport_is_normalized_to_web_app_auth_required(
        self,
        real_application_services: ApplicationServices,
        monkeypatch: pytest.MonkeyPatch,
        description: str,
        app: Flask,
    ) -> None:
        access_checks: list[tuple[str, str]] = []
        monkeypatch.setattr(
            real_application_services.webapp_access,
            "requires_permission_check",
            lambda app_id: True,
        )
        monkeypatch.setattr(
            real_application_services.webapp_access,
            "is_user_allowed",
            lambda *, user_id, app_id: access_checks.append((user_id, app_id)),
        )

        with config_overrides_context(SECRET_KEY=PASSPORT_SECRET):
            if description == "Token has expired.":
                passport = jwt.encode({"exp": 0}, PASSPORT_SECRET, algorithm="HS256")
            elif description == "Invalid token signature.":
                passport = jwt.encode({"user_id": "user-1"}, OTHER_PASSPORT_SECRET, algorithm="HS256")
            else:
                passport = "not-a-jwt"
            monkeypatch.setattr(
                import_module("controllers.web.app"),
                "extract_webapp_passport",
                lambda app_code, request: passport,
            )

            with app.test_request_context("/webapp/permission?appId=app-1", headers={"X-App-Code": "code1"}):
                with pytest.raises(WebAppAuthRequiredError) as raised:
                    AppWebAuthPermission().get()

        assert raised.value.data == {
            "code": "web_sso_auth_required",
            "message": "Web app authentication required.",
            "status": 401,
        }
        assert access_checks == []

    @pytest.mark.parametrize(
        ("path", "headers"),
        [
            pytest.param("/webapp/permission", {"X-App-Code": "code1"}, id="missing-app-id"),
            pytest.param("/webapp/permission?appId=app-1", {}, id="missing-app-code"),
        ],
    )
    def test_raises_when_app_reference_is_missing(
        self,
        monkeypatch: pytest.MonkeyPatch,
        path: str,
        headers: dict[str, str],
        app: Flask,
    ) -> None:
        def unexpected_application_services() -> None:
            raise AssertionError("application services must not be loaded")

        monkeypatch.setattr(
            import_module("controllers.web.app"),
            "application_services",
            unexpected_application_services,
        )
        with app.test_request_context(path, headers=headers):
            with pytest.raises(ValueError, match="appId"):
                AppWebAuthPermission().get()


@pytest.fixture
def asset_harness(sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch) -> OAuthHarness:
    return make_oauth_harness(sqlite_session_factory, monkeypatch)


@pytest.fixture
def asset_reader() -> MagicMock:
    return MagicMock(return_value=b"\x89PNG\r\n\x1a\n\x00\xff")


@pytest.fixture
def asset_client(
    asset_harness: OAuthHarness, asset_reader: MagicMock, monkeypatch: pytest.MonkeyPatch
) -> Iterator[FlaskClient]:
    def identity() -> tuple[App, EndUser]:
        with asset_harness.base.sessions() as session:
            app = session.get(App, asset_harness.base.context.app_id)
            user = session.get(EndUser, asset_harness.base.context.end_user_id)
            assert app is not None
            assert user is not None
            return app, user

    definitions = AppDefinitionQueryService(
        get_connection_requirements=get_tool_connection_requirements,
        definitions=AppDefinitionQueryRepository(session_factory=asset_harness.base.sessions),
        plugin_readme=lambda *_args: "",
        plugin_asset=asset_reader,
        builtin_icon_url_prefix="",
        connection_revisions=PluginConnectionRevisions(
            providers=asset_harness.providers, snapshots=asset_harness.base.repository
        ),
    )
    monkeypatch.setattr(wraps, "decode_jwt_token", identity)
    monkeypatch.setattr(app_controller, "application_services", lambda: SimpleNamespace(app_definitions=definitions))
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(bp)
    with app.test_client() as asset_client:
        yield asset_client


def test_asset_returns_package_bytes(
    asset_client: FlaskClient, asset_harness: OAuthHarness, asset_reader: MagicMock
) -> None:
    identifier = asset_harness.providers.controller.plugin_unique_identifier
    response = asset_client.get(
        "/api/connections/asset", query_string={"plugin_unique_identifier": identifier, "file_name": "images/setup.png"}
    )
    assert response.status_code == 200
    assert response.data == asset_reader.return_value
    assert response.mimetype == "application/octet-stream"
    assert response.headers["Cache-Control"] == "no-store"
    asset_reader.assert_called_once_with(asset_harness.base.context.tenant_id, identifier, "images/setup.png")
    assert asset_harness.base.auth.calls == []


@pytest.mark.parametrize("identifier", ["vendor/other:1.0.0@" + "a" * 64, "vendor/calendar:0.0.1@" + "b" * 64])
def test_asset_rejects_plugins_outside_current_requirements(
    asset_client: FlaskClient, asset_reader: MagicMock, identifier: str
) -> None:
    response = asset_client.get(
        "/api/connections/asset", query_string={"plugin_unique_identifier": identifier, "file_name": "setup.png"}
    )
    assert response.status_code == 400
    assert response.get_json()["code"] == "app_unavailable"
    asset_reader.assert_not_called()


def test_asset_rejects_removed_requirements(
    asset_client: FlaskClient, asset_harness: OAuthHarness, asset_reader: MagicMock
) -> None:
    with asset_harness.base.sessions.begin() as session:
        workflow = session.get(Workflow, asset_harness.base.workflow_id)
        assert workflow is not None
        workflow.graph = '{"nodes":[]}'
    response = asset_client.get(
        "/api/connections/asset",
        query_string={
            "plugin_unique_identifier": asset_harness.providers.controller.plugin_unique_identifier,
            "file_name": "x",
        },
    )
    assert response.status_code == 400
    assert response.get_json()["code"] == "app_unavailable"
    asset_reader.assert_not_called()


@pytest.mark.parametrize(
    "file_name", ["", "../secret", "images/../../secret", "/secret", "./setup.png", "a//b", "a/", "a\\b", "a\x00b"]
)
def test_asset_rejects_invalid_paths(
    asset_client: FlaskClient, asset_harness: OAuthHarness, asset_reader: MagicMock, file_name: str
) -> None:
    response = asset_client.get(
        "/api/connections/asset",
        query_string={
            "plugin_unique_identifier": asset_harness.providers.controller.plugin_unique_identifier,
            "file_name": file_name,
        },
    )
    assert response.status_code == 400
    assert response.get_json()["code"] == "invalid_param"
    asset_reader.assert_not_called()


@pytest.mark.parametrize("query", [{}, {"plugin_unique_identifier": "plugin"}, {"file_name": "setup.png"}])
def test_asset_requires_identifier_and_filename(
    asset_client: FlaskClient, asset_reader: MagicMock, query: dict[str, str]
) -> None:
    response = asset_client.get("/api/connections/asset", query_string=query)
    assert response.status_code == 400
    assert response.get_json()["code"] == "invalid_param"
    asset_reader.assert_not_called()


@pytest.mark.parametrize("error", [ValueError("asset missing"), PluginDaemonBadRequestError("asset missing")])
def test_asset_maps_package_lookup_failure(
    asset_client: FlaskClient, asset_harness: OAuthHarness, asset_reader: MagicMock, error: Exception
) -> None:
    asset_reader.side_effect = error
    response = asset_client.get(
        "/api/connections/asset",
        query_string={
            "plugin_unique_identifier": asset_harness.providers.controller.plugin_unique_identifier,
            "file_name": "x",
        },
    )
    assert response.status_code == 400
    assert response.get_json()["code"] == "app_unavailable"
    assert "asset missing" not in response.get_data(as_text=True)


def test_guest_can_read_assets_when_personal_connection_creation_requires_login(
    asset_client: FlaskClient, asset_harness: OAuthHarness, config_overrides: Callable[..., None]
) -> None:
    config_overrides(END_USER_AUTH_ALLOW_ANONYMOUS=False)
    with asset_harness.base.sessions.begin() as session:
        session.execute(
            sa.update(EndUser).where(EndUser.id == asset_harness.base.context.end_user_id).values(account_id=None)
        )
    response = asset_client.get(
        "/api/connections/asset",
        query_string={
            "plugin_unique_identifier": asset_harness.providers.controller.plugin_unique_identifier,
            "file_name": "x",
        },
    )
    assert response.status_code == 200


def test_asset_requires_web_passport(
    asset_client: FlaskClient, asset_reader: MagicMock, monkeypatch: pytest.MonkeyPatch
) -> None:
    def reject_identity() -> tuple[App, EndUser]:
        raise Unauthorized()

    monkeypatch.setattr(wraps, "decode_jwt_token", reject_identity)
    response = asset_client.get(
        "/api/connections/asset", query_string={"plugin_unique_identifier": "plugin", "file_name": "x"}
    )
    assert response.status_code == 401
    asset_reader.assert_not_called()
