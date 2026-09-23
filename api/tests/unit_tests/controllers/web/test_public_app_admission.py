"""Public bootstrap admission with real SQL repositories and the canonical hook."""

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy import func, select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, sessionmaker

from controllers.web import app as app_controller
from controllers.web import bp, login, passport, site, wraps
from enums import DeploymentEdition, WebAppAccessMode
from models.account import Tenant
from models.enums import EndUserType
from models.model import App, AppMode, CustomizeTokenStrategy, EndUser, Message, Site
from models.workflow import Workflow, WorkflowRun, WorkflowType
from repositories.app_definition_query_repository import AppDefinitionQueryRepository
from repositories.web_passport_repository import WebPassportRepository
from repositories.webapp_access_query_repository import WebAppAccessQueryRepository
from services.app_definition_query_service import AppDefinitionQueryService
from services.entities.feature_entities import FeatureModel
from services.web_app_runtime_query_service import WebAppRuntimeQueryService
from services.web_passport_service import WebPassportService
from services.webapp_access_query_service import WebAppAccessQueryService
from tests.unit_tests.config_override import apply_config_overrides


def _harness(
    session: Session,
    factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    *,
    published: bool,
    missing: bool = False,
) -> SimpleNamespace:
    app = App(
        id=str(uuid4()),
        tenant_id=str(uuid4()),
        mode=AppMode.ADVANCED_CHAT,
        name="Must not leak",
        enable_site=True,
        enable_api=True,
    )
    old_user = EndUser(
        id=str(uuid4()),
        tenant_id=app.tenant_id,
        app_id=app.id,
        session_id="old",
        is_anonymous=True,
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
            features="{}",
            created_by=str(uuid4()),
            environment_variables=[],
            conversation_variables=[],
            rag_pipeline_variables=[],
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
    auth, tokens, mode_lookup = MagicMock(), MagicMock(), MagicMock(return_value=WebAppAccessMode.PUBLIC)
    auth.is_webapp_auth_enabled.return_value = False
    tokens.issue.return_value = "new-passport"
    tokens.verify.return_value = {"app_id": app.id, "app_code": "fixture-code", "end_user_id": old_user.id}
    definitions = AppDefinitionQueryRepository(session_factory=factory)
    services = SimpleNamespace(
        webapp_access=WebAppAccessQueryService(
            access=access_repo,
            webapp_auth_enabled=False,
            access_mode_for_app=mode_lookup,
            is_user_allowed_for_app=MagicMock(),
        ),
        web_passport=WebPassportService(
            passports=passport_repo,
            auth=auth,
            tokens=tokens,
            now=lambda: datetime.now(UTC),
            access_token_expire_minutes=60,
        ),
        app_definitions=MagicMock(wraps=AppDefinitionQueryService(definitions=definitions, builtin_icon_url_prefix="")),
        web_app_runtime=MagicMock(
            wraps=WebAppRuntimeQueryService(
                runtime=definitions,
                file_service=MagicMock(),
                workspace_features=lambda _: FeatureModel(),
                files_url="https://files.example",
                deployment_edition=DeploymentEdition.CLOUD,
            )
        ),
    )
    for module in (app_controller, login, passport, site):
        monkeypatch.setattr(module, "application_services", lambda: services)
    monkeypatch.setattr(wraps, "PassportService", lambda: tokens)
    monkeypatch.setattr(wraps, "extract_webapp_passport", lambda *_: "old-passport")
    monkeypatch.setattr(wraps.SystemFeatureService, "is_webapp_auth_enabled", lambda: False)
    apply_config_overrides(monkeypatch, DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    apply_config_overrides(monkeypatch, NETWORK_ACCESS_TRUSTED_PROXY_CIDRS="172.18.0.0/16")
    flask = Flask(__name__)
    flask.config.update(TESTING=True, RESTX_ERROR_404_HELP=False)
    flask.register_blueprint(bp)
    return SimpleNamespace(
        app=app,
        old_user=old_user,
        client=flask.test_client(),
        services=services,
        tokens=tokens,
        auth=auth,
        mode_lookup=mode_lookup,
        access_repo=access_repo,
        passport_repo=passport_repo,
    )


ROUTES = (
    "/webapp/access-mode?appCode=fixture-code",
    "/login/status?app_code=fixture-code",
    "/passport?user_id=new-session",
    "/site",
    "/meta",
    "/parameters",
)


@pytest.mark.parametrize("route", ROUTES)
@pytest.mark.parametrize("missing", [False, True], ids=["unpublished", "missing"])
def test_all_bootstrap_routes_share_404_before_user_or_metadata_side_effects(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    route: str,
    missing: bool,
) -> None:
    h = _harness(sqlite_session, sqlite_session_factory, monkeypatch, published=False, missing=missing)
    response = h.client.get(
        "/api" + route,
        headers={"X-App-Code": "fixture-code"},
        environ_overrides={"REMOTE_ADDR": "172.18.0.2", "HTTP_X_FORWARDED_FOR": "203.0.113.42"},
    )
    assert response.status_code == 404
    assert (
        response.data == b'{"client_ip":"203.0.113.42","code":"app_not_found","message":"App not found.","status":404}'
    )
    assert response.headers["Content-Type"] == "application/json"
    assert response.headers["Cache-Control"] == "no-store"
    assert h.services.app_definitions.method_calls == []
    assert h.services.web_app_runtime.method_calls == []
    assert h.auth.method_calls == []
    h.mode_lookup.assert_not_called()
    h.tokens.issue.assert_not_called()
    assert sqlite_session.scalar(select(func.count()).select_from(EndUser)) == (0 if missing else 1)
    assert sqlite_session.scalar(select(func.count()).select_from(WorkflowRun)) == 0
    assert sqlite_session.scalar(select(func.count()).select_from(Message)) == 0


@pytest.mark.parametrize("route", ROUTES)
def test_published_bootstrap_remains_successful_with_normal_passport_behavior(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch, route: str
) -> None:
    h = _harness(sqlite_session, sqlite_session_factory, monkeypatch, published=True)
    response = h.client.get("/api" + route, headers={"X-App-Code": "fixture-code"})
    assert response.status_code == 200
    if route.startswith("/passport"):
        assert response.get_json() == {"access_token": "new-passport"}
        h.tokens.issue.assert_called_once()
        assert sqlite_session.scalar(select(func.count()).select_from(EndUser)) == 2
    else:
        h.tokens.issue.assert_not_called()
        assert sqlite_session.scalar(select(func.count()).select_from(EndUser)) == 1
        if route.startswith("/webapp"):
            assert response.get_json() == {"accessMode": "public"}
        elif route.startswith("/login"):
            assert response.get_json() == {"logged_in": True, "app_logged_in": True}
        elif route == "/site":
            assert response.get_json()["site"]["title"] == "Must not leak"
        elif route == "/meta":
            assert response.get_json() == {"tool_icons": {}}
        else:
            assert "user_input_form" in response.get_json()


@pytest.mark.parametrize("route", ["/site", "/meta", "/parameters"])
def test_old_passport_cannot_read_metadata_after_published_version_is_removed(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch, route: str
) -> None:
    h = _harness(sqlite_session, sqlite_session_factory, monkeypatch, published=True)
    assert h.access_repo.is_app_available(h.app.id)
    h.app.workflow_id = None
    sqlite_session.commit()
    response = h.client.get(
        "/api" + route, headers={"X-App-Code": "fixture-code"}, environ_overrides={"REMOTE_ADDR": "203.0.113.42"}
    )
    assert response.status_code == 404
    assert response.get_json()["code"] == "app_not_found"
    assert response.get_json()["client_ip"] == "203.0.113.42"
    assert h.services.app_definitions.method_calls == []
    assert h.services.web_app_runtime.method_calls == []


@pytest.mark.parametrize("changed_owner", ["site-app", "end-user-app", "end-user-tenant"])
def test_old_passport_cannot_cross_persisted_app_or_tenant_owner_chain(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    changed_owner: str,
) -> None:
    h = _harness(sqlite_session, sqlite_session_factory, monkeypatch, published=True)
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
    assert h.services.web_app_runtime.method_calls == []


@pytest.mark.parametrize("route", ROUTES)
def test_real_database_failure_is_not_reclassified_as_unpublished(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch, route: str
) -> None:
    h = _harness(sqlite_session, sqlite_session_factory, monkeypatch, published=False)
    failing_session = MagicMock()
    failure = OperationalError("select", {}, RuntimeError("database unavailable"))
    failing_session.__enter__.return_value.scalar.side_effect = failure
    failing_session.__enter__.return_value.execute.side_effect = failure
    failing_factory = MagicMock(return_value=failing_session)
    h.access_repo._session_factory = failing_factory
    h.passport_repo._session_factory = failing_factory
    monkeypatch.setattr(wraps.session_factory, "create_session", failing_factory)
    response = h.client.get("/api" + route, headers={"X-App-Code": "fixture-code"})
    assert response.status_code == (503 if route.startswith(("/webapp", "/login")) else 500)
    assert response.get_json()["code"] != "app_not_found"
    assert "client_ip" not in response.get_json()
    h.tokens.issue.assert_not_called()
