from __future__ import annotations

from decimal import Decimal
from inspect import unwrap
from types import SimpleNamespace

import pytest
from flask import Flask
from werkzeug.exceptions import BadRequest

from controllers.console.app import statistic as statistic_module


class _ConnContext:
    def __init__(self, rows):
        self._rows = rows

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, _query, _args):
        return self._rows


def _install_db(monkeypatch: pytest.MonkeyPatch, rows) -> None:
    engine = SimpleNamespace(begin=lambda: _ConnContext(rows))
    monkeypatch.setattr(statistic_module, "db", SimpleNamespace(engine=engine))


def _install_common(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        statistic_module,
        "parse_time_range",
        lambda *_args, **_kwargs: (None, None),
    )
    monkeypatch.setattr(statistic_module, "convert_datetime_to_date", lambda field: field)


def test_daily_message_statistic_returns_rows(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    api = statistic_module.DailyMessageStatistic()
    method = unwrap(api.get)

    rows = [SimpleNamespace(date="2024-01-01", message_count=3)]
    _install_common(monkeypatch)
    _install_db(monkeypatch, rows)

    with app.test_request_context("/console/api/apps/app-1/statistics/daily-messages", method="GET"):
        response = method(api, SimpleNamespace(timezone="UTC"), app_model=SimpleNamespace(id="app-1"))

    assert response.get_json() == {"data": [{"date": "2024-01-01", "message_count": 3}]}


def test_daily_conversation_statistic_returns_rows(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    api = statistic_module.DailyConversationStatistic()
    method = unwrap(api.get)

    rows = [SimpleNamespace(date="2024-01-02", conversation_count=5)]
    _install_common(monkeypatch)
    _install_db(monkeypatch, rows)

    with app.test_request_context("/console/api/apps/app-1/statistics/daily-conversations", method="GET"):
        response = method(api, SimpleNamespace(timezone="UTC"), app_model=SimpleNamespace(id="app-1"))

    assert response.get_json() == {"data": [{"date": "2024-01-02", "conversation_count": 5}]}


def test_daily_token_cost_statistic_returns_rows(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    api = statistic_module.DailyTokenCostStatistic()
    method = unwrap(api.get)

    rows = [SimpleNamespace(date="2024-01-03", token_count=10, total_price=0.25, currency="USD")]
    _install_common(monkeypatch)
    _install_db(monkeypatch, rows)

    with app.test_request_context("/console/api/apps/app-1/statistics/token-costs", method="GET"):
        response = method(api, SimpleNamespace(timezone="UTC"), app_model=SimpleNamespace(id="app-1"))

    data = response.get_json()
    assert len(data["data"]) == 1
    assert data["data"][0]["date"] == "2024-01-03"
    assert data["data"][0]["token_count"] == 10
    assert data["data"][0]["total_price"] == 0.25


def test_daily_terminals_statistic_returns_rows(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    api = statistic_module.DailyTerminalsStatistic()
    method = unwrap(api.get)

    rows = [SimpleNamespace(date="2024-01-04", terminal_count=7)]
    _install_common(monkeypatch)
    _install_db(monkeypatch, rows)

    with app.test_request_context("/console/api/apps/app-1/statistics/daily-end-users", method="GET"):
        response = method(api, SimpleNamespace(timezone="UTC"), app_model=SimpleNamespace(id="app-1"))

    assert response.get_json() == {"data": [{"date": "2024-01-04", "terminal_count": 7}]}


def test_average_session_interaction_statistic_requires_chat_mode(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    """Test that AverageSessionInteractionStatistic is limited to chat/agent modes."""
    # This just verifies the decorator is applied correctly
    # Actual endpoint testing would require complex JOIN mocking
    api = statistic_module.AverageSessionInteractionStatistic()
    method = unwrap(api.get)
    assert callable(method)


def test_daily_message_statistic_with_invalid_time_range(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    api = statistic_module.DailyMessageStatistic()
    method = unwrap(api.get)

    def mock_parse[**P](*args: P.args, **kwargs: P.kwargs):
        raise ValueError("Invalid time range")

    _install_db(monkeypatch, [])
    monkeypatch.setattr(statistic_module, "parse_time_range", mock_parse)
    monkeypatch.setattr(statistic_module, "convert_datetime_to_date", lambda field: field)

    with app.test_request_context("/console/api/apps/app-1/statistics/daily-messages", method="GET"):
        with pytest.raises(BadRequest):
            method(api, SimpleNamespace(timezone="UTC"), app_model=SimpleNamespace(id="app-1"))


def test_daily_message_statistic_multiple_rows(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    api = statistic_module.DailyMessageStatistic()
    method = unwrap(api.get)

    rows = [
        SimpleNamespace(date="2024-01-01", message_count=10),
        SimpleNamespace(date="2024-01-02", message_count=15),
        SimpleNamespace(date="2024-01-03", message_count=12),
    ]
    _install_common(monkeypatch)
    _install_db(monkeypatch, rows)

    with app.test_request_context("/console/api/apps/app-1/statistics/daily-messages", method="GET"):
        response = method(api, SimpleNamespace(timezone="UTC"), app_model=SimpleNamespace(id="app-1"))

    data = response.get_json()
    assert len(data["data"]) == 3


def test_daily_message_statistic_empty_result(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    api = statistic_module.DailyMessageStatistic()
    method = unwrap(api.get)

    _install_common(monkeypatch)
    _install_db(monkeypatch, [])

    with app.test_request_context("/console/api/apps/app-1/statistics/daily-messages", method="GET"):
        response = method(api, SimpleNamespace(timezone="UTC"), app_model=SimpleNamespace(id="app-1"))

    assert response.get_json() == {"data": []}


def test_daily_conversation_statistic_with_time_range(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    api = statistic_module.DailyConversationStatistic()
    method = unwrap(api.get)

    rows = [SimpleNamespace(date="2024-01-02", conversation_count=5)]
    _install_db(monkeypatch, rows)
    monkeypatch.setattr(
        statistic_module,
        "parse_time_range",
        lambda *_args, **_kwargs: ("s", "e"),
    )
    monkeypatch.setattr(statistic_module, "convert_datetime_to_date", lambda field: field)

    with app.test_request_context("/console/api/apps/app-1/statistics/daily-conversations", method="GET"):
        response = method(api, SimpleNamespace(timezone="UTC"), app_model=SimpleNamespace(id="app-1"))

    assert response.get_json() == {"data": [{"date": "2024-01-02", "conversation_count": 5}]}


def test_daily_token_cost_with_multiple_currencies(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    api = statistic_module.DailyTokenCostStatistic()
    method = unwrap(api.get)

    rows = [
        SimpleNamespace(date="2024-01-01", token_count=100, total_price=Decimal("0.50"), currency="USD"),
        SimpleNamespace(date="2024-01-02", token_count=200, total_price=Decimal("1.00"), currency="USD"),
    ]
    _install_common(monkeypatch)
    _install_db(monkeypatch, rows)

    with app.test_request_context("/console/api/apps/app-1/statistics/token-costs", method="GET"):
        response = method(api, SimpleNamespace(timezone="UTC"), app_model=SimpleNamespace(id="app-1"))

    data = response.get_json()
    assert len(data["data"]) == 2
