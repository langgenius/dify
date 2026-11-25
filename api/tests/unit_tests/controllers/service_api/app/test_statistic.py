"""Unit tests for Service API statistics controllers."""

from datetime import UTC, datetime
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from controllers.common.errors import InvalidArgumentError
from controllers.service_api.app import statistic
from models.model import AppMode


class TestStatisticQuery:
    """Tests for common statistics query parameters."""

    def test_default_values(self):
        query = statistic.StatisticQuery()

        assert query.start is None
        assert query.end is None
        assert query.timezone == "UTC"

    def test_empty_string_to_none(self):
        query = statistic.StatisticQuery(
            start="",
            end="",
        )

        assert query.start is None
        assert query.end is None


class TestResolveTimeRange:
    """Tests for time range parsing and validation."""

    def test_valid_utc_time_range(self):
        query = statistic.StatisticQuery(
            start="2026-11-01 00:00",
            end="2026-11-02 00:00",
            timezone="UTC",
        )

        start, end = statistic.resolve_time_range(query)

        assert start == datetime(2026, 11, 1, 0, 0, tzinfo=UTC)
        assert end == datetime(2026, 11, 2, 0, 0, tzinfo=UTC)

    def test_valid_timezone_conversion(self):
        query = statistic.StatisticQuery(
            start="2026-11-01 08:00",
            end="2026-11-01 16:00",
            timezone="Asia/Shanghai",
        )

        start, end = statistic.resolve_time_range(query)

        assert start == datetime(2026, 11, 1, 0, 0, tzinfo=UTC)
        assert end == datetime(2026, 11, 1, 8, 0, tzinfo=UTC)

    def test_invalid_time_format(self):
        query = statistic.StatisticQuery(
            start="invalid-date",
            timezone="UTC",
        )

        with pytest.raises(InvalidArgumentError):
            statistic.resolve_time_range(query)

    def test_start_later_than_end(self):
        query = statistic.StatisticQuery(
            start="2026-11-02 00:00",
            end="2026-11-01 00:00",
            timezone="UTC",
        )

        with pytest.raises(InvalidArgumentError):
            statistic.resolve_time_range(query)

    def test_invalid_timezone(self):
        query = statistic.StatisticQuery(
            start="2026-11-01 00:00",
            timezone="Invalid/Timezone",
        )

        with pytest.raises(InvalidArgumentError):
            statistic.resolve_time_range(query)


class TestQueryStatistics:
    """Tests for statistics service delegation."""

    def test_correct_app_id(self, monkeypatch):
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
            lambda _query: ("start_date", "end_date"),
        )

        app_model = SimpleNamespace(id="app-A")
        query = statistic.StatisticQuery()

        result = statistic.query_statistics(
            app_model,
            query,
            "get_daily_messages",
        )

        service.get_daily_messages.assert_called_once_with(
            app_id="app-A",
            start_date="start_date",
            end_date="end_date",
            timezone="UTC",
        )

        assert result == []


class TestCheckMode:
    """Tests for application mode restrictions."""

    def test_supported_mode(self):
        app_model = SimpleNamespace(mode=AppMode.CHAT)

        statistic.check_mode(
            app_model,
            (AppMode.CHAT, AppMode.AGENT_CHAT),
        )

    def test_unsupported_mode(self):
        app_model = SimpleNamespace(mode=AppMode.WORKFLOW)

        with pytest.raises(InvalidArgumentError):
            statistic.check_mode(
                app_model,
                (AppMode.CHAT, AppMode.AGENT_CHAT),
            )


class TestStatisticControllers:
    """Tests for statistics controller service delegation."""

    @pytest.mark.parametrize(
        ("controller_class", "service_method", "app_mode"),
        [
            pytest.param(
                statistic.DailyMessageApi,
                "get_daily_messages",
                AppMode.CHAT,
                id="daily-messages",
            ),
            pytest.param(
                statistic.DailyConversationApi,
                "get_daily_conversations",
                AppMode.CHAT,
                id="daily-conversations",
            ),
            pytest.param(
                statistic.DailyEndUsersApi,
                "get_daily_terminals",
                AppMode.CHAT,
                id="daily-end-users",
            ),
            pytest.param(
                statistic.TokenCostsApi,
                "get_daily_token_costs",
                AppMode.CHAT,
                id="token-costs",
            ),
            pytest.param(
                statistic.AverageSessionInteractionsApi,
                "get_average_session_interactions",
                AppMode.CHAT,
                id="average-session-interactions",
            ),
            pytest.param(
                statistic.UserSatisfactionApi,
                "get_user_satisfaction_rates",
                AppMode.CHAT,
                id="user-satisfaction-rate",
            ),
            pytest.param(
                statistic.AverageResponseTimeApi,
                "get_average_response_times",
                AppMode.COMPLETION,
                id="average-response-time",
            ),
            pytest.param(
                statistic.TokensPerSecondApi,
                "get_tokens_per_second",
                AppMode.CHAT,
                id="tokens-per-second",
            ),
        ],
    )
    def test_controller_calls_correct_service(
        self,
        monkeypatch,
        controller_class,
        service_method,
        app_mode,
    ):
        """Each controller delegates to its expected statistics method."""

        service = Mock()

        service_methods = {
            "get_daily_messages": service.get_daily_messages,
            "get_daily_conversations": service.get_daily_conversations,
            "get_daily_terminals": service.get_daily_terminals,
            "get_daily_token_costs": service.get_daily_token_costs,
            "get_average_session_interactions": service.get_average_session_interactions,
            "get_user_satisfaction_rates": service.get_user_satisfaction_rates,
            "get_average_response_times": service.get_average_response_times,
            "get_tokens_per_second": service.get_tokens_per_second,
        }

        expected_method = service_methods[service_method]
        expected_method.return_value = []

        monkeypatch.setattr(
            statistic,
            "application_services",
            lambda: SimpleNamespace(app_statistics=service),
        )

        monkeypatch.setattr(
            statistic,
            "resolve_time_range",
            lambda _query: ("start_date", "end_date"),
        )

        app_model = SimpleNamespace(
            id="app-A",
            mode=app_mode,
        )
        query = statistic.StatisticQuery(timezone="UTC")

        # Bypass HTTP decorators to test controller business logic.
        controller_get = unwrap(controller_class.get)

        response = controller_get(
            controller_class(),
            req_data=query,
            app_model=app_model,
        )

        expected_method.assert_called_once_with(
            app_id="app-A",
            start_date="start_date",
            end_date="end_date",
            timezone="UTC",
        )

        assert response == {"data": []}
