"""Authentication and application isolation tests for statistics APIs."""

from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy.orm import Session, scoped_session

from controllers.service_api import wraps as wraps_module
from controllers.service_api.app import statistic
from controllers.service_api.wraps import validate_app_token
from models.account import (
    Account,
    Tenant,
    TenantAccountJoin,
    TenantAccountRole,
)
from models.model import App, AppMode, IconType


@pytest.fixture
def flask_app():
    app = Flask(__name__)
    app.config["TESTING"] = True
    return app


@pytest.fixture
def two_apps(sqlite_session: Session):
    """Create two applications in the same workspace."""

    tenant = Tenant(name="Statistics Test Workspace")

    owner = Account(
        name="Statistics Test Owner",
        email=f"statistics-{uuid4()}@example.com",
    )

    membership = TenantAccountJoin(
        tenant_id=tenant.id,
        account_id=owner.id,
        current=True,
        role=TenantAccountRole.OWNER,
    )

    def create_app(name: str):
        return App(
            id=str(uuid4()),
            tenant_id=tenant.id,
            name=name,
            mode=AppMode.CHAT,
            icon_type=IconType.EMOJI,
            icon="chat",
            icon_background="#FFFFFF",
            enable_site=False,
            enable_api=True,
        )

    app_a = create_app("Application A")
    app_b = create_app("Application B")

    sqlite_session.add_all([tenant, owner, membership, app_a, app_b])
    sqlite_session.commit()

    return tenant, app_a, app_b


@pytest.mark.parametrize(
    "sqlite_session",
    [(App, Tenant, Account, TenantAccountJoin)],
    indirect=True,
)
class TestStatisticAuthentication:
    @pytest.mark.parametrize(
        "requested_app",
        [
            pytest.param("A", id="own-app"),
            pytest.param("B", id="foreign-app-id-in-query"),
        ],
    )
    def test_token_is_bound_to_authenticated_app(
        self,
        flask_app,
        sqlite_session,
        two_apps,
        monkeypatch,
        requested_app,
    ):
        """The client cannot override the authenticated application."""

        tenant, app_a, app_b = two_apps

        # Simulate successful validation of App A's API token.
        token = SimpleNamespace(
            app_id=app_a.id,
            tenant_id=tenant.id,
        )

        monkeypatch.setattr(
            wraps_module,
            "validate_and_get_api_token",
            Mock(return_value=token),
        )

        # Use the real SQLite session for authorization.
        session_proxy = scoped_session(lambda: sqlite_session)

        monkeypatch.setattr(
            wraps_module.db,
            "session",
            session_proxy,
        )

        # Mock only Flask login signaling.
        current_app_mock = Mock()
        current_app_mock.login_manager = Mock()
        current_app_mock._get_current_object.return_value = Mock()

        monkeypatch.setattr(
            wraps_module,
            "current_app",
            current_app_mock,
        )
        monkeypatch.setattr(
            wraps_module,
            "user_logged_in",
            Mock(),
        )

        # Mock the statistics service, not the authentication.
        service = Mock()
        service.get_daily_messages.return_value = []

        monkeypatch.setattr(
            statistic,
            "application_services",
            lambda: SimpleNamespace(app_statistics=service),
        )

        monkeypatch.setattr(
            statistic,
            "resolve_time_range",
            lambda _query: (None, None),
        )

        requested_app_id = app_a.id if requested_app == "A" else app_b.id

        # Retain the real authentication decorator while
        # bypassing request-parameter parsing.
        authenticated_get = validate_app_token(unwrap(statistic.DailyMessageApi.get))

        with flask_app.test_request_context(
            f"/statistics/daily-messages?app_id={requested_app_id}",
            method="GET",
            headers={"Authorization": "Bearer test-token-a"},
        ):
            response = authenticated_get(
                statistic.DailyMessageApi(),
                req_data=statistic.StatisticQuery(),
            )

        # The statistics service must use App A, regardless
        # of which app_id the client supplies.
        service.get_daily_messages.assert_called_once_with(
            app_id=app_a.id,
            start_date=None,
            end_date=None,
            timezone="UTC",
        )

        assert response == {"data": []}
