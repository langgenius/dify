from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from inspect import unwrap
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest
from flask import Flask
from pytest_mock import MockerFixture
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.exceptions import BadRequest

from controllers.console.app import statistic as statistic_module
from machinery.context import RequestContext
from models.model import App
from repositories.app_statistic_query_repository import AppStatisticQueryRepository
from services.app_statistic_query import AppStatisticQuery


def _request_context() -> RequestContext:
    return RequestContext(
        request_id="request-1",
        trace_id="trace-1",
        account_id="account-1",
        active_workspace_id="tenant-1",
    )


def _app_model() -> App:
    return App(id="app-1", tenant_id="tenant-1", name="Statistics App")


def _install_dependencies(
    monkeypatch: pytest.MonkeyPatch,
    statistics: AppStatisticQuery,
    *,
    time_range: tuple[datetime | None, datetime | None] = (None, None),
) -> None:
    monkeypatch.setattr(
        statistic_module,
        "application_services",
        lambda: SimpleNamespace(app_statistics=statistics),
    )
    monkeypatch.setattr(
        statistic_module,
        "current_account_with_tenant",
        lambda: SimpleNamespace(account=SimpleNamespace(timezone="UTC")),
    )
    monkeypatch.setattr(statistic_module, "parse_time_range", lambda *_args, **_kwargs: time_range)


def _invoke(
    app: Flask,
    resource_type: type,
    *,
    start: str | None = None,
    end: str | None = None,
) -> dict[str, Any]:
    resource = resource_type()
    method = unwrap(resource.get)
    with app.test_request_context("/console/api/apps/app-1/statistics", method="GET"):
        response = method(
            resource,
            statistic_module.StatisticTimeRangeQuery(start=start, end=end),
            _request_context(),
            app_model=_app_model(),
        )
    return response if isinstance(response, dict) else response.get_json()


@pytest.mark.parametrize(
    ("resource_type", "query_method", "row", "expected"),
    [
        pytest.param(
            statistic_module.DailyMessageStatistic,
            "get_daily_messages",
            {"date": "2024-01-01", "message_count": 3},
            {"date": "2024-01-01", "message_count": 3},
            id="daily-messages",
        ),
        pytest.param(
            statistic_module.DailyConversationStatistic,
            "get_daily_conversations",
            {"date": "2024-01-02", "conversation_count": 5},
            {"date": "2024-01-02", "conversation_count": 5},
            id="daily-conversations",
        ),
        pytest.param(
            statistic_module.DailyTerminalsStatistic,
            "get_daily_terminals",
            {"date": "2024-01-03", "terminal_count": 7},
            {"date": "2024-01-03", "terminal_count": 7},
            id="daily-terminals",
        ),
        pytest.param(
            statistic_module.DailyTokenCostStatistic,
            "get_daily_token_costs",
            {
                "date": "2024-01-04",
                "token_count": 10,
                "total_price": Decimal("0.25"),
            },
            {"date": "2024-01-04", "token_count": 10, "total_price": "0.25", "currency": "USD"},
            id="daily-token-costs",
        ),
        pytest.param(
            statistic_module.AverageSessionInteractionStatistic,
            "get_average_session_interactions",
            {"date": "2024-01-05", "interactions": Decimal("2.5")},
            {"date": "2024-01-05", "interactions": 2.5},
            id="average-session-interactions",
        ),
        pytest.param(
            statistic_module.UserSatisfactionRateStatistic,
            "get_user_satisfaction_rates",
            {"date": "2024-01-06", "feedback_count": 1, "message_count": 10},
            {"date": "2024-01-06", "rate": 100.0},
            id="user-satisfaction-rate",
        ),
        pytest.param(
            statistic_module.AverageResponseTimeStatistic,
            "get_average_response_times",
            {"date": "2024-01-07", "latency": 1.234},
            {"date": "2024-01-07", "latency": 1234.0},
            id="average-response-time",
        ),
        pytest.param(
            statistic_module.TokensPerSecondStatistic,
            "get_tokens_per_second",
            {"date": "2024-01-08", "tokens_per_second": 15.5},
            {"date": "2024-01-08", "tps": 15.5},
            id="tokens-per-second",
        ),
    ],
)
def test_statistic_endpoint_delegates_to_statistic_query(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    resource_type: type,
    query_method: str,
    row: dict[str, object],
    mocker: MockerFixture,
    sqlite_session_factory: sessionmaker[Session],
    expected: dict[str, Any],
) -> None:
    statistics = AppStatisticQueryRepository(session_factory=sqlite_session_factory)
    mocker.patch.object(statistics, "_execute", return_value=(row,))
    query_call = mocker.spy(statistics, query_method)
    _install_dependencies(monkeypatch, statistics)

    assert _invoke(app, resource_type) == {"data": [expected]}
    query_call.assert_called_once_with(
        app_id="app-1",
        start_date=None,
        end_date=None,
        timezone="UTC",
    )


def test_statistic_endpoint_passes_time_range(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    mocker: MockerFixture,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    statistics = AppStatisticQueryRepository(session_factory=sqlite_session_factory)
    query_call = mocker.spy(statistics, "get_daily_messages")
    mocker.patch.object(statistics, "_execute", return_value=())
    start_date = datetime(2024, 1, 1, tzinfo=UTC)
    end_date = datetime(2024, 1, 2, tzinfo=UTC)
    _install_dependencies(monkeypatch, statistics, time_range=(start_date, end_date))

    assert _invoke(app, statistic_module.DailyMessageStatistic, start="start", end="end") == {"data": []}
    query_call.assert_called_once_with(
        app_id="app-1",
        start_date=start_date,
        end_date=end_date,
        timezone="UTC",
    )


def test_statistic_endpoint_rejects_invalid_time_range(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    mocker: MockerFixture,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    statistics = AppStatisticQueryRepository(session_factory=sqlite_session_factory)
    query_call = mocker.spy(statistics, "get_daily_messages")
    _install_dependencies(monkeypatch, statistics)
    monkeypatch.setattr(
        statistic_module,
        "parse_time_range",
        MagicMock(side_effect=ValueError("Invalid time range")),
    )

    with pytest.raises(BadRequest, match="Invalid time range"):
        _invoke(app, statistic_module.DailyMessageStatistic)

    query_call.assert_not_called()
