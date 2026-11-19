"""HTTP-level tests for application statistics Service API endpoints."""

from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

import pytest
from flask import Flask, request
from flask_login import LoginManager
from sqlalchemy.orm import Session, scoped_session
from werkzeug.exceptions import Unauthorized

from controllers.service_api import service_api_ns
from controllers.service_api import wraps as wraps_module
from controllers.service_api.app import statistic
from libs.external_api import ExternalApi
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.model import App, AppMode, IconType

ENDPOINTS = [
    ("daily-messages", "get_daily_messages"),
    ("daily-conversations", "get_daily_conversations"),
    ("daily-end-users", "get_daily_terminals"),
    ("token-costs", "get_daily_token_costs"),
    ("average-session-interactions", "get_average_session_interactions"),
    ("user-satisfaction-rate", "get_user_satisfaction_rates"),
    ("average-response-time", "get_average_response_times"),
    ("tokens-per-second", "get_tokens_per_second"),
]


@pytest.fixture
def http_harness(sqlite_session: Session, monkeypatch: pytest.MonkeyPatch):
    """Create a Flask Service API with two SQLite-backed applications."""

    flask_app = Flask(__name__)
    flask_app.config["TESTING"] = True
    LoginManager().init_app(flask_app)

    ExternalApi(
        flask_app,
        register_default_root=False,
    ).add_namespace(service_api_ns, path="/v1")

    tenant = Tenant(name="Statistics HTTP Test Workspace")
    owner = Account(
        name="Statistics HTTP Test Owner",
        email=f"statistics-http-{uuid4()}@example.com",
    )

    membership = TenantAccountJoin(
        tenant_id=tenant.id,
        account_id=owner.id,
        current=True,
        role=TenantAccountRole.OWNER,
    )

    def create_app(name: str, mode: AppMode) -> App:
        return App(
            id=str(uuid4()),
            tenant_id=tenant.id,
            name=name,
            mode=mode,
            icon_type=IconType.EMOJI,
            icon="chat",
            icon_background="#FFFFFF",
            enable_site=False,
            enable_api=True,
        )

    app_a = create_app("Application A", AppMode.COMPLETION)
    app_b = create_app("Application B", AppMode.CHAT)

    sqlite_session.add_all([tenant, owner, membership, app_a, app_b])
    sqlite_session.commit()

    sessions = scoped_session(lambda: sqlite_session)
    monkeypatch.setattr(wraps_module.db, "session", sessions)

    token_to_app = {
        "token-a": app_a.id,
        "token-b": app_b.id,
    }

    def authenticate(_token_type: str):
        authorization = request.headers.get("Authorization", "")
        if not authorization.startswith("Bearer "):
            raise Unauthorized("Missing API token")

        token = authorization.removeprefix("Bearer ")
        app_id = token_to_app.get(token)

        if app_id is None:
            raise Unauthorized("Invalid API token")

        return SimpleNamespace(
            app_id=app_id,
            tenant_id=tenant.id,
        )

    monkeypatch.setattr(
        wraps_module,
        "validate_and_get_api_token",
        authenticate,
    )

    # Avoid emitting login signals outside the authentication test.
    monkeypatch.setattr(
        wraps_module,
        "user_logged_in",
        Mock(),
    )

    service = Mock()

    for _, method_name in ENDPOINTS:
        getattr(service, method_name).return_value = []

    monkeypatch.setattr(
        statistic,
        "application_services",
        lambda: SimpleNamespace(app_statistics=service),
    )

    return SimpleNamespace(
        client=flask_app.test_client(),
        app_a=app_a,
        app_b=app_b,
        service=service,
    )


@pytest.mark.parametrize(
    "sqlite_session",
    [(App, Tenant, Account, TenantAccountJoin)],
    indirect=True,
)
class TestStatisticHTTP:
    @pytest.mark.parametrize(
        ("endpoint", "method_name"),
        ENDPOINTS,
    )
    def test_all_endpoints_return_200(
        self,
        http_harness,
        endpoint: str,
        method_name: str,
    ):
        """All eight GET routes are reachable with an app token."""

        token = "token-a"

        # This endpoint is only supported in chat-like modes.
        if endpoint == "average-session-interactions":
            token = "token-b"

        response = http_harness.client.get(
            f"/v1/statistics/{endpoint}",
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 200, response.get_data(as_text=True)
        assert response.json == {"data": []}

        expected_app_id = http_harness.app_b.id if token == "token-b" else http_harness.app_a.id

        method = getattr(http_harness.service, method_name)
        assert method.call_count == 1
        assert method.call_args.kwargs["app_id"] == expected_app_id

    @pytest.mark.parametrize(
        ("token", "app_attribute"),
        [
            ("token-a", "app_a"),
            ("token-b", "app_b"),
        ],
    )
    def test_token_scopes_statistics_to_own_app(
        self,
        http_harness,
        token: str,
        app_attribute: str,
    ):
        """The statistics query uses the authenticated app."""

        expected_app = getattr(http_harness, app_attribute)

        response = http_harness.client.get(
            "/v1/statistics/daily-messages",
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 200
        assert response.json == {"data": []}

        call = http_harness.service.get_daily_messages.call_args
        assert call.kwargs["app_id"] == expected_app.id

    def test_client_cannot_override_authenticated_app(
        self,
        http_harness,
    ):
        """An app_id query parameter cannot select another app."""

        response = http_harness.client.get(
            "/v1/statistics/daily-messages",
            query_string={"app_id": http_harness.app_b.id},
            headers={"Authorization": "Bearer token-a"},
        )

        assert response.status_code == 200

        call = http_harness.service.get_daily_messages.call_args
        assert call.kwargs["app_id"] == http_harness.app_a.id
        assert call.kwargs["app_id"] != http_harness.app_b.id

    @pytest.mark.parametrize(
        "authorization",
        [None, "Bearer invalid-token"],
    )
    def test_missing_or_invalid_token_is_rejected(
        self,
        http_harness,
        authorization: str | None,
    ):
        """Unauthenticated requests must not reach the statistics service."""

        headers = {"Authorization": authorization} if authorization is not None else {}

        response = http_harness.client.get(
            "/v1/statistics/daily-messages",
            headers=headers,
        )

        assert response.status_code == 401
        http_harness.service.get_daily_messages.assert_not_called()

    def test_invalid_time_range_is_rejected(
        self,
        http_harness,
    ):
        """Invalid time ranges should produce a client error."""

        response = http_harness.client.get(
            "/v1/statistics/daily-messages",
            query_string={
                "start": "invalid-date",
                "end": "2026-11-19 12:00",
            },
            headers={"Authorization": "Bearer token-a"},
        )

        assert response.status_code == 400
        http_harness.service.get_daily_messages.assert_not_called()

    def test_unsupported_app_mode_is_rejected(
        self,
        http_harness,
    ):
        """Average response time is restricted to completion apps."""

        response = http_harness.client.get(
            "/v1/statistics/average-response-time",
            headers={"Authorization": "Bearer token-b"},
        )

        assert response.status_code == 400
        http_harness.service.get_average_response_times.assert_not_called()
