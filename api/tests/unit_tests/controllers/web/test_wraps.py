from dataclasses import dataclass, replace
from datetime import UTC, datetime
from typing import Never
from unittest import mock
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from flask import Blueprint, Flask
from flask.testing import FlaskClient
from pytest_mock import MockerFixture
from sqlalchemy import func, select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.exceptions import NotFound, Unauthorized

from controllers.web import app as app_controller
from controllers.web import bp, login, passport, site, wraps
from core.logging.context import clear_request_context, get_identity_context
from enums import DeploymentEdition
from extensions.ext_application_services import ApplicationServices
from libs.passport import PassportService
from models import App as _wraps_App
from models import EndUser as _wraps_EndUser
from models.account import Tenant
from models.enums import EndUserType
from models.model import App as _public_app_admission_App
from models.model import AppMode, AppModelConfig, CustomizeTokenStrategy, Message, Site
from models.model import EndUser as _public_app_admission_EndUser
from models.workflow import Workflow, WorkflowRun, WorkflowType
from repositories.app_definition_query_repository import AppDefinitionQueryRepository
from repositories.web_passport_repository import WebPassportRepository
from repositories.webapp_access_query_repository import WebAppAccessQueryRepository
from services.app_definition_query_service import AppDefinitionQueryService
from services.entities.feature_entities import FeatureModel
from services.file_service import FileService
from services.web_app_runtime_query_service import WebAppRuntimeQueryService
from services.web_authentication_adapters import PassportWebAppSessionGateway
from services.web_passport_gateways import PassportTokenGateway
from services.web_passport_service import WebPassportService
from tests.helpers.unit.config_override import apply_config_overrides

"""Public bootstrap admission with real SQL repositories and the canonical hook."""


@dataclass
class AdmissionHarness:
    app: _public_app_admission_App
    old_user: _public_app_admission_EndUser
    client: FlaskClient
    services: ApplicationServices
    issue: MagicMock
    auth_calls: tuple[MagicMock, ...]
    mode_lookup: MagicMock
    login_verify: MagicMock
    session_verify: MagicMock
    metadata_calls: tuple[MagicMock, ...]
    access_repo: WebAppAccessQueryRepository


def _harness(
    session: Session,
    factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    mocker: MockerFixture,
    base_services: ApplicationServices,
    *,
    published: bool,
    missing: bool = False,
) -> AdmissionHarness:
    app = _public_app_admission_App(
        id=str(uuid4()),
        tenant_id=str(uuid4()),
        mode=AppMode.ADVANCED_CHAT,
        name="Must not leak",
        enable_site=True,
        enable_api=True,
    )
    old_user = _public_app_admission_EndUser(
        id=str(uuid4()),
        tenant_id=app.tenant_id,
        app_id=app.id,
        session_id="old",
        _is_anonymous=True,
        type=EndUserType.BROWSER,
    )
    if not missing:
        tenant = Tenant(name="Private workspace")
        tenant.id = app.tenant_id
        session.add(tenant)
        workflow = Workflow(
            id=str(uuid4()),
            tenant_id=app.tenant_id,
            app_id=app.id,
            type=WorkflowType.CHAT,
            version="published" if published else "draft",
            graph='{"nodes":[]}',
            _features="{}",
            created_by=str(uuid4()),
            _environment_variables=[],
            _conversation_variables=[],
            _rag_pipeline_variables=[],
        )
        if published:
            app.workflow_id = workflow.id
        session.add_all(
            [
                app,
                old_user,
                workflow,
                Site(
                    app_id=app.id,
                    code="fixture-code",
                    title="Must not leak",
                    default_language="en-US",
                    customize_token_strategy=CustomizeTokenStrategy.UUID,
                ),
            ]
        )
        session.commit()

    access_repo = WebAppAccessQueryRepository(session_factory=factory)
    passport_repo = WebPassportRepository(session_factory=factory, generate_session_id=lambda: "new-session")
    access = base_services.webapp_access
    monkeypatch.setattr(access, "_access", access_repo)
    monkeypatch.setattr(access, "_webapp_auth_enabled", False)
    mode_lookup = mocker.spy(access._policy, "get_access_mode")
    auth = base_services.web_passport._auth
    auth_calls = (
        mocker.spy(auth, "is_webapp_auth_enabled"),
        mocker.spy(auth, "get_app_auth_type"),
    )
    tokens = PassportTokenGateway(passport=PassportService())
    issue = mocker.patch.object(PassportService, "issue", return_value="new-passport")
    mocker.patch.object(
        PassportService,
        "verify",
        return_value={"app_id": app.id, "app_code": "fixture-code", "end_user_id": old_user.id},
    )
    app_sessions = PassportWebAppSessionGateway(sessions=access_repo, app_access=access)
    session_verify = mocker.spy(app_sessions, "verify")
    authentication = base_services.web_authentication
    monkeypatch.setattr(authentication, "_app_access", access)
    monkeypatch.setattr(authentication, "_app_sessions", app_sessions)
    monkeypatch.setattr(authentication, "_private_app_access_enabled", False)
    login_verify = mocker.spy(authentication._tokens, "verify_access_token")
    definitions = AppDefinitionQueryRepository(session_factory=factory)
    services = replace(
        base_services,
        webapp_access=access,
        web_authentication=authentication,
        web_passport=WebPassportService(
            passports=passport_repo,
            auth=auth,
            tokens=tokens,
            now=lambda: datetime.now(UTC),
            access_token_expire_minutes=60,
        ),
        app_definitions=AppDefinitionQueryService(definitions=definitions, builtin_icon_url_prefix=""),
        web_app_runtime=WebAppRuntimeQueryService(
            runtime=definitions,
            file_service=FileService(session_factory=factory),
            workspace_features=lambda _: FeatureModel(),
            files_url="https://files.example",
            deployment_edition=DeploymentEdition.CLOUD,
        ),
    )
    metadata_calls = tuple(
        mocker.spy(services.app_definitions, method)
        for method in (
            "get_mode",
            "get_parameters",
            "get_public_parameters",
            "get_tool_icons",
            "get_summary",
            "get_site_configuration",
        )
    ) + (mocker.spy(services.web_app_runtime, "get_bootstrap"),)
    for module in (app_controller, login, passport, site, wraps):
        monkeypatch.setattr(module, "application_services", lambda: services)
    monkeypatch.setattr(wraps, "extract_webapp_passport", lambda *_: "old-passport")
    monkeypatch.setattr(login, "extract_webapp_passport", lambda *_: "old-passport")
    monkeypatch.setattr(wraps.SystemFeatureService, "is_webapp_auth_enabled", lambda: False)
    apply_config_overrides(
        monkeypatch,
        DEPLOYMENT_EDITION=DeploymentEdition.CLOUD,
        NETWORK_ACCESS_TRUSTED_PROXY_CIDRS="172.18.0.0/16",
    )
    flask = Flask(__name__)
    flask.config.update(TESTING=True, RESTX_ERROR_404_HELP=False)
    flask.register_blueprint(bp)
    return AdmissionHarness(
        app=app,
        old_user=old_user,
        client=flask.test_client(),
        services=services,
        issue=issue,
        auth_calls=auth_calls,
        mode_lookup=mode_lookup,
        login_verify=login_verify,
        session_verify=session_verify,
        metadata_calls=metadata_calls,
        access_repo=access_repo,
    )


ROUTES = (
    "/webapp/access-mode?appCode=fixture-code",
    "/login/status?app_code=fixture-code",
    "/passport?user_id=new-session",
    "/site",
    "/meta",
    "/parameters",
)


class TestPublicAppAdmissionCases:
    @staticmethod
    @pytest.mark.parametrize("route", ROUTES)
    @pytest.mark.parametrize("missing", [False, True], ids=["unpublished", "missing"])
    def test_all_bootstrap_routes_share_404_before_user_or_metadata_side_effects(
        sqlite_session: Session,
        sqlite_session_factory: sessionmaker[Session],
        monkeypatch: pytest.MonkeyPatch,
        mocker: MockerFixture,
        account_application_services: ApplicationServices,
        route: str,
        missing: bool,
    ) -> None:
        h = _harness(
            sqlite_session,
            sqlite_session_factory,
            monkeypatch,
            mocker,
            account_application_services,
            published=False,
            missing=missing,
        )
        response = h.client.get(
            "/api" + route,
            headers={"X-App-Code": "fixture-code"},
            environ_overrides={"REMOTE_ADDR": "172.18.0.2", "HTTP_X_FORWARDED_FOR": "203.0.113.42"},
        )
        assert response.status_code == 404
        assert (
            response.data
            == b'{"client_ip":"203.0.113.42","code":"app_not_found","message":"App not found.","status":404}'
        )
        assert response.headers["Content-Type"] == "application/json"
        assert response.headers["Cache-Control"] == "no-store"
        assert all(call.call_count == 0 for call in h.metadata_calls)
        assert all(call.call_count == 0 for call in h.auth_calls)
        h.mode_lookup.assert_not_called()
        h.issue.assert_not_called()
        h.login_verify.assert_not_called()
        h.session_verify.assert_not_called()
        assert sqlite_session.scalar(select(func.count()).select_from(_public_app_admission_EndUser)) == (
            0 if missing else 1
        )
        assert sqlite_session.scalar(select(func.count()).select_from(WorkflowRun)) == 0
        assert sqlite_session.scalar(select(func.count()).select_from(Message)) == 0

    @staticmethod
    @pytest.mark.parametrize("route", ROUTES)
    def test_published_bootstrap_remains_successful_with_normal_passport_behavior(
        sqlite_session: Session,
        sqlite_session_factory: sessionmaker[Session],
        monkeypatch: pytest.MonkeyPatch,
        route: str,
        mocker: MockerFixture,
        account_application_services: ApplicationServices,
    ) -> None:
        h = _harness(
            sqlite_session, sqlite_session_factory, monkeypatch, mocker, account_application_services, published=True
        )
        response = h.client.get("/api" + route, headers={"X-App-Code": "fixture-code"})
        assert response.status_code == 200
        if route.startswith("/passport"):
            assert response.get_json() == {"access_token": "new-passport"}
            h.issue.assert_called_once()
            assert sqlite_session.scalar(select(func.count()).select_from(_public_app_admission_EndUser)) == 2
        else:
            h.issue.assert_not_called()
            assert sqlite_session.scalar(select(func.count()).select_from(_public_app_admission_EndUser)) == 1
            if route.startswith("/webapp"):
                assert response.get_json() == {"accessMode": "public"}
            elif route.startswith("/login"):
                assert response.get_json() == {"logged_in": True, "app_logged_in": True}
                h.session_verify.assert_called_once_with(token="old-passport", app_code="fixture-code", user_id=None)
                h.login_verify.assert_not_called()
            elif route == "/site":
                assert response.get_json()["site"]["title"] == "Must not leak"
            elif route == "/meta":
                assert response.get_json() == {"tool_icons": {}}
            else:
                assert "user_input_form" in response.get_json()

    @staticmethod
    @pytest.mark.parametrize("route", ["/site", "/meta", "/parameters"])
    def test_old_passport_cannot_read_metadata_after_published_version_is_removed(
        sqlite_session: Session,
        sqlite_session_factory: sessionmaker[Session],
        monkeypatch: pytest.MonkeyPatch,
        route: str,
        mocker: MockerFixture,
        account_application_services: ApplicationServices,
    ) -> None:
        h = _harness(
            sqlite_session, sqlite_session_factory, monkeypatch, mocker, account_application_services, published=True
        )
        assert h.access_repo.is_app_available(h.app.id)
        h.app.workflow_id = None
        sqlite_session.commit()
        response = h.client.get(
            "/api" + route, headers={"X-App-Code": "fixture-code"}, environ_overrides={"REMOTE_ADDR": "203.0.113.42"}
        )
        assert response.status_code == 404
        assert response.get_json()["code"] == "app_not_found"
        assert response.get_json()["client_ip"] == "203.0.113.42"
        assert all(call.call_count == 0 for call in h.metadata_calls)

    @staticmethod
    @pytest.mark.parametrize("changed_owner", ["site-app", "end-user-app", "end-user-tenant"])
    def test_old_passport_cannot_cross_persisted_app_or_tenant_owner_chain(
        sqlite_session: Session,
        sqlite_session_factory: sessionmaker[Session],
        monkeypatch: pytest.MonkeyPatch,
        mocker: MockerFixture,
        account_application_services: ApplicationServices,
        changed_owner: str,
    ) -> None:
        h = _harness(
            sqlite_session, sqlite_session_factory, monkeypatch, mocker, account_application_services, published=True
        )
        if changed_owner == "site-app":
            persisted_site = sqlite_session.scalar(select(Site).where(Site.app_id == h.app.id))
            assert persisted_site is not None
            persisted_site.app_id = str(uuid4())
        elif changed_owner == "end-user-app":
            h.old_user.app_id = str(uuid4())
        else:
            h.old_user.tenant_id = str(uuid4())
        sqlite_session.commit()
        response = h.client.get("/api/site", headers={"X-App-Code": "fixture-code"})
        assert response.status_code == 404
        assert response.get_json()["code"] == "app_not_found"
        assert all(call.call_count == 0 for call in h.metadata_calls)

    @staticmethod
    @pytest.mark.parametrize("route", ROUTES)
    def test_real_database_failure_is_not_reclassified_as_unpublished(
        sqlite_session: Session,
        sqlite_session_factory: sessionmaker[Session],
        monkeypatch: pytest.MonkeyPatch,
        route: str,
        mocker: MockerFixture,
        account_application_services: ApplicationServices,
    ) -> None:
        h = _harness(
            sqlite_session, sqlite_session_factory, monkeypatch, mocker, account_application_services, published=False
        )
        failure = OperationalError("select", {}, RuntimeError("database unavailable"))
        mocker.patch.object(Session, "scalar", side_effect=failure)
        mocker.patch.object(Session, "execute", side_effect=failure)
        response = h.client.get("/api" + route, headers={"X-App-Code": "fixture-code"})
        assert response.status_code == (503 if route.startswith(("/webapp", "/login")) else 500)
        assert response.get_json()["code"] != "app_not_found"
        assert "client_ip" not in response.get_json()
        h.issue.assert_not_called()
        h.login_verify.assert_not_called()
        h.session_verify.assert_not_called()


class TestWrapsCases:
    @staticmethod
    @pytest.fixture(autouse=True)
    def _reset_logging_context():
        clear_request_context()
        yield
        clear_request_context()

    @staticmethod
    def test_validate_jwt_token_sets_logging_identity_before_view() -> None:
        from controllers.web import wraps

        app_model = _wraps_App(id="app-id", tenant_id="tenant-id")
        end_user = _wraps_EndUser(id="end-user-id", tenant_id="tenant-id", type=None)
        clear_request_context()

        @wraps.validate_jwt_token
        def protected_view(received_app, received_user):
            assert get_identity_context() == ("tenant-id", "end-user-id", "end_user")
            return received_app, received_user

        with mock.patch.object(wraps, "decode_jwt_token", return_value=(app_model, end_user)):
            result = protected_view()

        assert result == (app_model, end_user)

    @staticmethod
    def test_validate_jwt_token_does_not_set_identity_when_authentication_fails() -> None:
        from controllers.web import wraps

        clear_request_context()

        @wraps.validate_jwt_token
        def protected_view(_app, _user):
            raise AssertionError("view must not be called")

        with (
            mock.patch.object(wraps, "decode_jwt_token", side_effect=Unauthorized()),
            pytest.raises(Unauthorized),
        ):
            protected_view()

        assert get_identity_context() == ("", "", "")

    @staticmethod
    def test_decode_jwt_token_uses_shared_session_factory(sqlite_session: Session) -> None:
        from controllers.web import wraps
        from models.enums import EndUserType
        from models.model import AppMode, CustomizeTokenStrategy, Site

        tenant_id = str(uuid4())
        app_model = _wraps_App(
            tenant_id=tenant_id,
            mode=AppMode.CHAT.value,
            name="test-app",
            enable_site=True,
            enable_api=True,
        )
        sqlite_session.add(app_model)
        sqlite_session.flush()
        config = AppModelConfig(app_id=app_model.id)
        config.id = str(uuid4())
        app_model.app_model_config_id = config.id
        sqlite_session.add(config)
        sqlite_session.commit()

        site = Site(
            app_id=app_model.id,
            title="test-site",
            default_language="en-US",
            customize_token_strategy=CustomizeTokenStrategy.NOT_ALLOW,
            code="app-code",
        )
        end_user = _wraps_EndUser(
            tenant_id=tenant_id,
            app_id=app_model.id,
            type=EndUserType.BROWSER,
            session_id="session-id",
        )
        sqlite_session.add_all((site, end_user))
        sqlite_session.commit()

        with (
            mock.patch.object(wraps, "extract_webapp_passport", return_value="jwt-token"),
            mock.patch.object(wraps, "PassportService") as mock_passport_service,
            mock.patch.object(
                wraps.SystemFeatureService,
                "is_webapp_auth_enabled",
                return_value=False,
            ),
        ):
            mock_passport_service.return_value.verify.return_value = {
                "app_code": "app-code",
                "app_id": app_model.id,
                "end_user_id": end_user.id,
            }

            with Flask(__name__).test_request_context("/", headers={"X-App-Code": "app-code"}):
                result_app, result_end_user = wraps.decode_jwt_token()

        assert result_app.id == app_model.id
        assert result_end_user.id == end_user.id

    @staticmethod
    @pytest.mark.parametrize("missing", ["app", "site", "code", "disabled", "unpublished", "end_user", "resource"])
    def test_post_missing_app_is_canonical_but_other_not_found_keeps_its_owner(
        sqlite_session: Session, monkeypatch: pytest.MonkeyPatch, missing: str
    ) -> None:
        from controllers.common.app_access_error import register_app_access_error_metadata
        from controllers.web import wraps
        from libs.external_api import ExternalApi
        from models.enums import EndUserType
        from models.model import AppMode, CustomizeTokenStrategy, Site

        app_id, tenant_id, end_user_id = str(uuid4()), str(uuid4()), str(uuid4())
        config_id = str(uuid4())
        if missing != "app":
            sqlite_session.add(
                _wraps_App(
                    id=app_id,
                    tenant_id=tenant_id,
                    name="fixture",
                    mode=AppMode.CHAT,
                    enable_site=missing != "disabled",
                    enable_api=True,
                    app_model_config_id=config_id if missing != "unpublished" else None,
                )
            )
            if missing != "unpublished":
                config = AppModelConfig(app_id=app_id)
                config.id = config_id
                sqlite_session.add(config)
        if missing != "site":
            sqlite_session.add(
                Site(
                    app_id=app_id,
                    code="fixture-code",
                    title="fixture",
                    default_language="en-US",
                    customize_token_strategy=CustomizeTokenStrategy.NOT_ALLOW,
                )
            )
        if missing == "resource":
            sqlite_session.add(
                _wraps_EndUser(
                    id=end_user_id,
                    tenant_id=tenant_id,
                    app_id=app_id,
                    type=EndUserType.BROWSER,
                    session_id="fixture-session",
                )
            )
        sqlite_session.commit()
        apply_config_overrides(monkeypatch, NETWORK_ACCESS_TRUSTED_PROXY_CIDRS="172.18.0.0/16")
        app = Flask(__name__)
        app.config.update(TESTING=True, RESTX_ERROR_404_HELP=False)
        bp = Blueprint("web_post_fixture", __name__, url_prefix="/api")
        register_app_access_error_metadata(bp, surface="web")
        api = ExternalApi(bp)
        calls: list[str] = []

        class ProtectedResource(wraps.WebApiResource):
            def post(self, _app: _wraps_App, _end_user: _wraps_EndUser) -> Never:
                calls.append("view")
                raise NotFound("Conversation not found.")

        api.add_resource(ProtectedResource, "/chat-messages")
        app.register_blueprint(bp)
        with (
            mock.patch.object(wraps, "extract_webapp_passport", return_value="fixture-passport"),
            mock.patch.object(wraps, "PassportService") as passport,
            mock.patch.object(wraps.SystemFeatureService, "is_webapp_auth_enabled", return_value=False),
        ):
            passport.return_value.verify.return_value = {
                "app_code": None if missing == "code" else "fixture-code",
                "app_id": app_id,
                "end_user_id": end_user_id,
            }
            response = app.test_client().post(
                "/api/chat-messages",
                json={},
                headers={"X-App-Code": "fixture-code"},
                environ_overrides={"REMOTE_ADDR": "203.0.113.42"},
            )

        assert response.status_code == 404
        if missing in {"app", "site", "code", "disabled", "unpublished"}:
            assert (
                response.data
                == b'{"client_ip":"203.0.113.42","code":"app_not_found","message":"App not found.","status":404}'
            )
            assert response.headers["Content-Type"] == "application/json"
            assert response.headers["Cache-Control"] == "no-store"
        else:
            assert response.get_json()["code"] == "not_found"
            assert "client_ip" not in response.get_json()
            assert "Cache-Control" not in response.headers
            if missing == "resource":
                assert response.get_json()["message"] == "Conversation not found."
        assert calls == (["view"] if missing == "resource" else [])

    @staticmethod
    @pytest.mark.usefixtures("app_query_services")
    @pytest.mark.parametrize("token", [None, "expired-token"])
    def test_web_auth_rejects_unknown_app_code_with_http_not_found(app, monkeypatch, token):
        from controllers.web import wraps
        from libs.external_api import ExternalApi

        class ProtectedApi(wraps.WebApiResource):
            def get(self, _app, _user):
                pytest.fail("An unknown WebApp must not reach the protected resource")

        def reject_token(_self, _token):
            raise Unauthorized("Authentication has expired.")

        monkeypatch.setattr(wraps.SystemFeatureService, "is_webapp_auth_enabled", staticmethod(lambda: True))
        monkeypatch.setattr(wraps, "extract_webapp_passport", lambda _code, _request: token)
        monkeypatch.setattr(wraps.PassportService, "verify", reject_token)
        api = ExternalApi(app)
        api.add_resource(ProtectedApi, "/protected")
        response = app.test_client().get("/protected", headers={"X-App-Code": "does-not-exist"})
        assert response.status_code == 404
        assert response.get_json()["code"] == "app_not_found"
