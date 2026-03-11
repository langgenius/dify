from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask, request
from werkzeug.local import LocalProxy

from controllers.console.app.statistic import (
    AverageResponseTimeStatistic,
    AverageSessionInteractionStatistic,
    DailyConversationStatistic,
    DailyMessageStatistic,
    DailyTerminalsStatistic,
    DailyTokenCostStatistic,
    TokensPerSecondStatistic,
    UserSatisfactionRateStatistic,
)
from models import App, AppMode


@pytest.fixture
def app():
    flask_app = Flask(__name__)
    flask_app.config["TESTING"] = True
    return flask_app


@pytest.fixture
def mock_account():
    from models.account import Account, AccountStatus

    account = MagicMock(spec=Account)
    account.id = "user_123"
    account.timezone = "UTC"
    account.status = AccountStatus.ACTIVE
    account.is_admin_or_owner = True
    account.current_tenant.current_role = "owner"
    account.has_edit_permission = True
    return account


@pytest.fixture
def mock_app_model():
    app_model = MagicMock(spec=App)
    app_model.id = "app_123"
    app_model.mode = AppMode.CHAT
    app_model.tenant_id = "tenant_123"
    return app_model


@pytest.fixture(autouse=True)
def mock_csrf():
    with patch("libs.login.check_csrf_token") as mock:
        yield mock


def setup_test_context(
    test_app, endpoint_class, route_path, mock_account, mock_app_model, mock_rs, mock_parse_ret=(None, None)
):
    with (
        patch("controllers.console.app.statistic.db") as mock_db_stat,
        patch("controllers.console.app.wraps.db") as mock_db_wraps,
        patch("controllers.console.wraps.db", mock_db_wraps),
        patch(
            "controllers.console.app.statistic.current_account_with_tenant", return_value=(mock_account, "tenant_123")
        ),
        patch("controllers.console.app.wraps.current_account_with_tenant", return_value=(mock_account, "tenant_123")),
        patch("controllers.console.wraps.current_account_with_tenant", return_value=(mock_account, "tenant_123")),
    ):
        mock_conn = MagicMock()
        mock_conn.execute.return_value = mock_rs

        mock_begin = MagicMock()
        mock_begin.__enter__.return_value = mock_conn
        mock_db_stat.engine.begin.return_value = mock_begin

        mock_query = MagicMock()
        mock_query.filter.return_value.first.return_value = mock_app_model
        mock_query.filter.return_value.filter.return_value.first.return_value = mock_app_model
        mock_query.where.return_value.first.return_value = mock_app_model
        mock_query.where.return_value.where.return_value.first.return_value = mock_app_model
        mock_db_wraps.session.query.return_value = mock_query

        proxy_mock = LocalProxy(lambda: mock_account)

        with patch("libs.login.current_user", proxy_mock), patch("flask_login.current_user", proxy_mock):
            with test_app.test_request_context(route_path, method="GET"):
                request.view_args = {"app_id": "app_123"}
                api_instance = endpoint_class()
                response = api_instance.get(app_id="app_123")
                return response


class TestStatisticEndpoints:
    def test_daily_message_statistic(self, app, mock_account, mock_app_model):
        mock_row = MagicMock()
        mock_row.date = "2023-01-01"
        mock_row.message_count = 10
        mock_row.interactions = Decimal(0)

        with patch("controllers.console.app.statistic.parse_time_range", return_value=(None, None)):
            response = setup_test_context(
                app,
                DailyMessageStatistic,
                "/apps/app_123/statistics/daily-messages?start=2023-01-01 00:00&end=2023-01-02 00:00",
                mock_account,
                mock_app_model,
                [mock_row],
            )
        assert response.status_code == 200
        assert response.json["data"][0]["message_count"] == 10

    def test_daily_conversation_statistic(self, app, mock_account, mock_app_model):
        mock_row = MagicMock()
        mock_row.date = "2023-01-01"
        mock_row.conversation_count = 5
        mock_row.interactions = Decimal(0)

        with patch("controllers.console.app.statistic.parse_time_range", return_value=(None, None)):
            response = setup_test_context(
                app,
                DailyConversationStatistic,
                "/apps/app_123/statistics/daily-conversations",
                mock_account,
                mock_app_model,
                [mock_row],
            )
        assert response.status_code == 200
        assert response.json["data"][0]["conversation_count"] == 5

    def test_daily_terminals_statistic(self, app, mock_account, mock_app_model):
        mock_row = MagicMock()
        mock_row.date = "2023-01-01"
        mock_row.terminal_count = 2
        mock_row.interactions = Decimal(0)

        with patch("controllers.console.app.statistic.parse_time_range", return_value=(None, None)):
            response = setup_test_context(
                app,
                DailyTerminalsStatistic,
                "/apps/app_123/statistics/daily-end-users",
                mock_account,
                mock_app_model,
                [mock_row],
            )
        assert response.status_code == 200
        assert response.json["data"][0]["terminal_count"] == 2

    def test_daily_token_cost_statistic(self, app, mock_account, mock_app_model):
        mock_row = MagicMock()
        mock_row.date = "2023-01-01"
        mock_row.token_count = 100
        mock_row.total_price = Decimal("0.02")
        mock_row.interactions = Decimal(0)

        with patch("controllers.console.app.statistic.parse_time_range", return_value=(None, None)):
            response = setup_test_context(
                app,
                DailyTokenCostStatistic,
                "/apps/app_123/statistics/token-costs",
                mock_account,
                mock_app_model,
                [mock_row],
            )
        assert response.status_code == 200
        assert response.json["data"][0]["token_count"] == 100
        assert response.json["data"][0]["total_price"] == "0.02"

    def test_average_session_interaction_statistic(self, app, mock_account, mock_app_model):
        mock_row = MagicMock()
        mock_row.date = "2023-01-01"
        mock_row.interactions = Decimal("3.523")

        with patch("controllers.console.app.statistic.parse_time_range", return_value=(None, None)):
            response = setup_test_context(
                app,
                AverageSessionInteractionStatistic,
                "/apps/app_123/statistics/average-session-interactions",
                mock_account,
                mock_app_model,
                [mock_row],
            )
        assert response.status_code == 200
        assert response.json["data"][0]["interactions"] == 3.52

    def test_user_satisfaction_rate_statistic(self, app, mock_account, mock_app_model):
        mock_row = MagicMock()
        mock_row.date = "2023-01-01"
        mock_row.message_count = 100
        mock_row.feedback_count = 10
        mock_row.interactions = Decimal(0)

        with patch("controllers.console.app.statistic.parse_time_range", return_value=(None, None)):
            response = setup_test_context(
                app,
                UserSatisfactionRateStatistic,
                "/apps/app_123/statistics/user-satisfaction-rate",
                mock_account,
                mock_app_model,
                [mock_row],
            )
        assert response.status_code == 200
        assert response.json["data"][0]["rate"] == 100.0

    def test_average_response_time_statistic(self, app, mock_account, mock_app_model):
        mock_app_model.mode = AppMode.COMPLETION
        mock_row = MagicMock()
        mock_row.date = "2023-01-01"
        mock_row.latency = 1.234
        mock_row.interactions = Decimal(0)

        with patch("controllers.console.app.statistic.parse_time_range", return_value=(None, None)):
            response = setup_test_context(
                app,
                AverageResponseTimeStatistic,
                "/apps/app_123/statistics/average-response-time",
                mock_account,
                mock_app_model,
                [mock_row],
            )
        assert response.status_code == 200
        assert response.json["data"][0]["latency"] == 1234.0

    def test_tokens_per_second_statistic(self, app, mock_account, mock_app_model):
        mock_row = MagicMock()
        mock_row.date = "2023-01-01"
        mock_row.tokens_per_second = 15.5
        mock_row.interactions = Decimal(0)

        with patch("controllers.console.app.statistic.parse_time_range", return_value=(None, None)):
            response = setup_test_context(
                app,
                TokensPerSecondStatistic,
                "/apps/app_123/statistics/tokens-per-second",
                mock_account,
                mock_app_model,
                [mock_row],
            )
        assert response.status_code == 200
        assert response.json["data"][0]["tps"] == 15.5

    @patch("controllers.console.app.statistic.parse_time_range")
    def test_invalid_time_range(self, mock_parse, app, mock_account, mock_app_model):
        mock_parse.side_effect = ValueError("Invalid time")

        from werkzeug.exceptions import BadRequest

        with pytest.raises(BadRequest):
            setup_test_context(
                app,
                DailyMessageStatistic,
                "/apps/app_123/statistics/daily-messages?start=invalid&end=invalid",
                mock_account,
                mock_app_model,
                [],
            )

    @patch("controllers.console.app.statistic.parse_time_range")
    def test_time_range_params_passed(self, mock_parse, app, mock_account, mock_app_model):
        import datetime

        start = datetime.datetime.now()
        end = datetime.datetime.now()
        mock_parse.return_value = (start, end)

        response = setup_test_context(
            app,
            DailyMessageStatistic,
            "/apps/app_123/statistics/daily-messages?start=something&end=something",
            mock_account,
            mock_app_model,
            [],
        )
        assert response.status_code == 200
        mock_parse.assert_called_once()
