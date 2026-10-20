"""Real HTTP and SQLite coverage for Console statistics admission.

Metric aggregation uses PostgreSQL/MySQL functions, so successful query results
are exercised by the controller integration tests against PostgreSQL. These tests
exercise the real identity and app queries without substituting query services.
"""

from collections.abc import Iterator
from dataclasses import dataclass
from http import HTTPStatus
from uuid import uuid4

import pytest
from flask import Blueprint, Flask, Response
from flask.testing import FlaskClient
from flask_restx import Resource
from redis import Redis
from sqlalchemy import Connection, Engine, event, text
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker
from werkzeug.test import TestResponse

from constants import HEADER_NAME_CSRF_TOKEN
from controllers.console.app import statistic, workflow_statistic
from controllers.console.wraps import _is_setup_completed
from enums import DeploymentEdition
from extensions.ext_application_services import build_application_services
from extensions.ext_login import DifyLoginManager, bind_account_loader, load_user_from_request, unauthorized_handler
from extensions.ext_redis import RedisClientWrapper
from libs.datetime_utils import naive_utc_now
from libs.external_api import ExternalApi
from libs.passport import PassportService
from libs.token import _real_cookie_name, generate_csrf_token
from models import Account, DifySetup, Tenant, TenantAccountJoin
from models.account import AccountStatus, TenantAccountRole
from models.agent import Agent, AgentScope, AgentSource
from models.engine import db
from models.model import App, AppMode
from tests.unit_tests.config_override import config_overrides_context


@dataclass(frozen=True)
class _Endpoint:
    path: str
    resource: type[Resource]
    mode: AppMode


_ENDPOINTS = (
    _Endpoint("statistics/daily-messages", statistic.DailyMessageStatistic, AppMode.CHAT),
    _Endpoint("statistics/daily-conversations", statistic.DailyConversationStatistic, AppMode.CHAT),
    _Endpoint("statistics/daily-end-users", statistic.DailyTerminalsStatistic, AppMode.CHAT),
    _Endpoint("statistics/token-costs", statistic.DailyTokenCostStatistic, AppMode.CHAT),
    _Endpoint("statistics/average-session-interactions", statistic.AverageSessionInteractionStatistic, AppMode.CHAT),
    _Endpoint("statistics/user-satisfaction-rate", statistic.UserSatisfactionRateStatistic, AppMode.CHAT),
    _Endpoint("statistics/average-response-time", statistic.AverageResponseTimeStatistic, AppMode.COMPLETION),
    _Endpoint("statistics/tokens-per-second", statistic.TokensPerSecondStatistic, AppMode.CHAT),
    _Endpoint(
        "workflow/statistics/daily-conversations", workflow_statistic.WorkflowDailyRunsStatistic, AppMode.WORKFLOW
    ),
    _Endpoint(
        "workflow/statistics/daily-terminals", workflow_statistic.WorkflowDailyTerminalsStatistic, AppMode.WORKFLOW
    ),
    _Endpoint("workflow/statistics/token-costs", workflow_statistic.WorkflowDailyTokenCostStatistic, AppMode.WORKFLOW),
    _Endpoint(
        "workflow/statistics/average-app-interactions",
        workflow_statistic.WorkflowAverageAppInteractionStatistic,
        AppMode.WORKFLOW,
    ),
)


@dataclass(frozen=True)
class _Harness:
    client: FlaskClient
    session_factory: sessionmaker[Session]
    account_id: str
    tenant_id: str
    headers: dict[str, str]
    sessions: list[Session]

    def create_app(self, mode: AppMode, *, tenant_id: str | None = None) -> str:
        with self.session_factory.begin() as session:
            app = App(
                tenant_id=tenant_id or self.tenant_id,
                name="Statistics app",
                mode=mode,
                created_by=self.account_id,
                enable_api=True,
                enable_site=True,
            )
            session.add(app)
            session.flush()
            return app.id

    def get(self, endpoint: _Endpoint, app_id: str, *, query: dict[str, str] | None = None) -> TestResponse:
        self.sessions.clear()
        return self.client.get(f"/console/api/apps/{app_id}/{endpoint.path}", headers=self.headers, query_string=query)


@pytest.fixture
def harness(sqlite_engine: Engine, sqlite_session_factory: sessionmaker[Session]) -> Iterator[_Harness]:
    with (
        Redis() as redis_client,
        config_overrides_context(
            DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY,
            RBAC_ENABLED=False,
            LOGIN_DISABLED=False,
            INIT_PASSWORD="",
            SECRET_KEY="statistics-http-test-secret-at-least-32-bytes",
        ),
    ):
        app = Flask(__name__)
        app.config.update(TESTING=True, SQLALCHEMY_DATABASE_URI=str(sqlite_engine.url))
        db.init_app(app)
        redis = RedisClientWrapper()
        redis.initialize(redis_client)
        services = build_application_services(
            database_client=sqlite_session_factory,
            deployment_edition=DeploymentEdition.COMMUNITY,
            initialization_password="",
            redis=redis,
        )
        app.extensions["application_services"] = services
        bind_account_loader(app, services.accounts.identity.load_user)
        login_manager = DifyLoginManager()
        login_manager.request_loader(load_user_from_request)
        login_manager.unauthorized_handler(unauthorized_handler)
        login_manager.init_app(app)
        blueprint = Blueprint("console", __name__, url_prefix="/console/api")
        api = ExternalApi(blueprint)
        for endpoint in _ENDPOINTS:
            api.add_resource(endpoint.resource, f"/apps/<uuid:app_id>/{endpoint.path}")
        app.register_blueprint(blueprint)

        now = naive_utc_now()
        with sqlite_session_factory.begin() as session:
            account = Account(
                email="statistics@example.com",
                name="Statistics viewer",
                status=AccountStatus.ACTIVE,
                initialized_at=now,
                timezone="America/New_York",
            )
            account.last_active_at = now
            tenant = Tenant(name="Statistics workspace")
            session.add_all([account, tenant, DifySetup(version="test")])
            session.flush()
            session.add(
                TenantAccountJoin(
                    tenant_id=tenant.id,
                    account_id=account.id,
                    role=TenantAccountRole.OWNER,
                    current=True,
                )
            )
            account_id, tenant_id = account.id, tenant.id

        # Complete the one-time setup check before observing request transactions.
        # The legacy setup cache still owns a Flask-scoped Session independently.
        with app.app_context():
            _is_setup_completed.reset_success()
            assert _is_setup_completed()
            db.session.remove()

        client = app.test_client()
        csrf_token = generate_csrf_token(account_id)
        client.set_cookie(_real_cookie_name("csrf_token"), csrf_token)
        headers = {
            "Authorization": f"Bearer {PassportService().issue({'user_id': account_id})}",
            HEADER_NAME_CSRF_TOKEN: csrf_token,
        }
        sessions: list[Session] = []

        def observe_session(session: Session, transaction: SessionTransaction, connection: Connection) -> None:
            sessions.append(session)

        @app.after_request
        def assert_request_sessions_closed(response: Response) -> Response:
            assert all(not session.in_transaction() and not session.identity_map for session in sessions)
            return response

        event.listen(Session, "after_begin", observe_session)
        try:
            yield _Harness(client, sqlite_session_factory, account_id, tenant_id, headers, sessions)
        finally:
            event.remove(Session, "after_begin", observe_session)
            _is_setup_completed.reset_success()
            with app.app_context():
                db.session.remove()
                db.engine.dispose()


@pytest.mark.parametrize("endpoint", _ENDPOINTS, ids=lambda endpoint: endpoint.path)
@pytest.mark.parametrize("visibility", ["missing", "different-workspace", "non-normal", "workflow-only"])
def test_statistics_reject_inaccessible_apps(harness: _Harness, endpoint: _Endpoint, visibility: str) -> None:
    app_id = str(uuid4())
    if visibility != "missing":
        app_id = harness.create_app(
            endpoint.mode, tenant_id=str(uuid4()) if visibility == "different-workspace" else None
        )
        with harness.session_factory.begin() as session:
            app = session.get(App, app_id)
            assert app is not None
            if visibility == "non-normal":
                # Persist a historical status not accepted by the current enum.
                session.execute(
                    text("UPDATE apps SET status = :status WHERE id = :app_id"),
                    {"status": "archived", "app_id": app_id},
                )
            elif visibility == "workflow-only":
                app.mode = AppMode.AGENT
                session.add(
                    Agent(
                        tenant_id=harness.tenant_id,
                        name="Hidden workflow agent",
                        scope=AgentScope.WORKFLOW_ONLY,
                        source=AgentSource.WORKFLOW,
                        app_id=str(uuid4()),
                        backing_app_id=app_id,
                    )
                )

    response = harness.get(endpoint, app_id)

    assert response.status_code == HTTPStatus.NOT_FOUND
    body = response.get_json()
    assert isinstance(body, dict)
    assert body["code"] == "app_not_found"
    assert response.content_type == "application/json"
    assert harness.sessions


@pytest.mark.parametrize("endpoint", _ENDPOINTS, ids=lambda endpoint: endpoint.path)
@pytest.mark.parametrize("field", ["start", "end"])
def test_statistics_reject_invalid_dates_after_app_admission(
    harness: _Harness, endpoint: _Endpoint, field: str
) -> None:
    app_id = harness.create_app(endpoint.mode)

    response = harness.get(endpoint, app_id, query={field: "not-a-date"})

    assert response.status_code == HTTPStatus.BAD_REQUEST
    body = response.get_json()
    assert isinstance(body, dict)
    assert body["code"] == "invalid_param"
    assert "not-a-date" in body["message"]
    assert harness.sessions


@pytest.mark.parametrize(
    ("endpoint", "unsupported_mode"),
    [
        (_ENDPOINTS[4], AppMode.COMPLETION),
        (_ENDPOINTS[6], AppMode.CHAT),
        (_ENDPOINTS[11], AppMode.ADVANCED_CHAT),
    ],
    ids=["session-interactions", "response-time", "workflow-interactions"],
)
def test_statistics_preserve_app_mode_restrictions(
    harness: _Harness, endpoint: _Endpoint, unsupported_mode: AppMode
) -> None:
    app_id = harness.create_app(unsupported_mode)

    response = harness.get(endpoint, app_id)

    assert response.status_code == HTTPStatus.NOT_FOUND
    body = response.get_json()
    assert isinstance(body, dict)
    assert body["code"] == "app_not_found"
    assert "App mode is not in the supported list" in body["message"]


@pytest.mark.parametrize("mode", [AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT, AppMode.AGENT])
def test_session_interactions_admits_supported_chat_modes_before_date_validation(
    harness: _Harness, mode: AppMode
) -> None:
    app_id = harness.create_app(mode)

    response = harness.get(_ENDPOINTS[4], app_id, query={"start": "invalid-date"})

    assert response.status_code == HTTPStatus.BAD_REQUEST
    body = response.get_json()
    assert isinstance(body, dict)
    assert body["code"] == "invalid_param"


def test_statistics_require_console_authentication(harness: _Harness) -> None:
    app_id = harness.create_app(AppMode.CHAT)

    response = harness.client.get(f"/console/api/apps/{app_id}/statistics/daily-messages")

    assert response.status_code == HTTPStatus.UNAUTHORIZED
    body = response.get_json()
    assert isinstance(body, dict)
    assert body["code"] == "unauthorized"


def test_statistics_require_valid_csrf_token(harness: _Harness) -> None:
    app_id = harness.create_app(AppMode.CHAT)

    response = harness.client.get(
        f"/console/api/apps/{app_id}/statistics/daily-messages",
        headers={"Authorization": harness.headers["Authorization"]},
    )

    assert response.status_code == HTTPStatus.UNAUTHORIZED
    body = response.get_json()
    assert isinstance(body, dict)
    assert body["code"] == "unauthorized"
    assert body["message"] == "CSRF token is missing or invalid."


@pytest.mark.parametrize("query_type", [statistic.StatisticTimeRangeQuery, workflow_statistic.WorkflowStatisticQuery])
def test_statistics_treat_blank_date_bounds_as_absent(
    query_type: type[statistic.StatisticTimeRangeQuery] | type[workflow_statistic.WorkflowStatisticQuery],
) -> None:
    query = query_type(start="", end="")
    assert query.start is None
    assert query.end is None
