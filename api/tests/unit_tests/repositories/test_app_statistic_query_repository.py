from datetime import UTC, datetime
from decimal import Decimal
from typing import cast, override

import pytest
from sqlalchemy.engine import RowMapping
from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.app_invoke_entities import InvokeFrom
from repositories import app_statistic_query_repository as repository_module
from repositories.app_statistic_query_repository import AppStatisticQueryRepository
from services.app_statistic_query import (
    AverageResponseTimeStatisticRecord,
    AverageSessionInteractionStatisticRecord,
    DailyConversationStatisticRecord,
    DailyMessageStatisticRecord,
    DailyTerminalStatisticRecord,
    DailyTokenCostStatisticRecord,
    TokensPerSecondStatisticRecord,
    UserSatisfactionRateStatisticRecord,
)


class _RecordingRepository(AppStatisticQueryRepository):
    def __init__(self) -> None:
        super().__init__(session_factory=cast(sessionmaker[Session], object()))
        self.rows: tuple[RowMapping, ...] = ()
        self.calls: list[tuple[str, dict[str, object]]] = []

    @override
    def _execute(self, sql_query: str, parameters: dict[str, object]) -> tuple[RowMapping, ...]:
        self.calls.append((sql_query, parameters.copy()))
        return self.rows


def _row(**values: object) -> RowMapping:
    return cast(RowMapping, values)


def test_app_statistic_repository_maps_results_and_preserves_query_scope(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(repository_module, "convert_datetime_to_date", lambda field: field)
    repository = _RecordingRepository()
    start_date = datetime(2024, 1, 1, tzinfo=UTC)
    end_date = datetime(2024, 1, 2, tzinfo=UTC)

    repository.rows = (_row(date="2024-01-01", message_count=2),)
    assert repository.get_daily_messages(
        app_id="app-1",
        start_date=start_date,
        end_date=end_date,
        timezone="Asia/Shanghai",
    ) == (DailyMessageStatisticRecord(date="2024-01-01", message_count=2),)

    repository.rows = (_row(date="2024-01-01", conversation_count=3),)
    assert repository.get_daily_conversations(
        app_id="app-1",
        start_date=start_date,
        end_date=end_date,
        timezone="Asia/Shanghai",
    ) == (DailyConversationStatisticRecord(date="2024-01-01", conversation_count=3),)

    repository.rows = (_row(date="2024-01-01", terminal_count=4),)
    assert repository.get_daily_terminals(
        app_id="app-1",
        start_date=start_date,
        end_date=end_date,
        timezone="Asia/Shanghai",
    ) == (DailyTerminalStatisticRecord(date="2024-01-01", terminal_count=4),)

    repository.rows = (_row(date="2024-01-01", token_count=Decimal(5), total_price=Decimal("0.25")),)
    assert repository.get_daily_token_costs(
        app_id="app-1",
        start_date=start_date,
        end_date=end_date,
        timezone="Asia/Shanghai",
    ) == (
        DailyTokenCostStatisticRecord(
            date="2024-01-01",
            token_count=5,
            total_price=Decimal("0.25"),
            currency="USD",
        ),
    )

    repository.rows = (_row(date="2024-01-01", interactions=Decimal("2.345")),)
    assert repository.get_average_session_interactions(
        app_id="app-1",
        start_date=start_date,
        end_date=end_date,
        timezone="Asia/Shanghai",
    ) == (AverageSessionInteractionStatisticRecord(date="2024-01-01", interactions=2.34),)

    repository.rows = (_row(date="2024-01-01", message_count=10, feedback_count=1),)
    assert repository.get_user_satisfaction_rates(
        app_id="app-1",
        start_date=start_date,
        end_date=end_date,
        timezone="Asia/Shanghai",
    ) == (UserSatisfactionRateStatisticRecord(date="2024-01-01", rate=100.0),)

    repository.rows = (_row(date="2024-01-01", latency=1.234),)
    assert repository.get_average_response_times(
        app_id="app-1",
        start_date=start_date,
        end_date=end_date,
        timezone="Asia/Shanghai",
    ) == (AverageResponseTimeStatisticRecord(date="2024-01-01", latency=1234.0),)

    repository.rows = (_row(date="2024-01-01", tokens_per_second=15.55555),)
    assert repository.get_tokens_per_second(
        app_id="app-1",
        start_date=start_date,
        end_date=end_date,
        timezone="Asia/Shanghai",
    ) == (TokensPerSecondStatisticRecord(date="2024-01-01", tps=15.5556),)

    assert len(repository.calls) == 8
    for sql_query, parameters in repository.calls:
        assert "created_at >= :start_date" in sql_query
        assert "created_at < :end_date" in sql_query
        assert parameters == {
            "tz": "Asia/Shanghai",
            "app_id": "app-1",
            "excluded_invoke_from": InvokeFrom.DEBUGGER,
            "start_date": start_date,
            "end_date": end_date,
        }


def test_daily_messages_omit_time_range_when_not_provided(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(repository_module, "convert_datetime_to_date", lambda field: field)
    repository = _RecordingRepository()

    assert (
        repository.get_daily_messages(
            app_id="app-1",
            start_date=None,
            end_date=None,
            timezone="Asia/Shanghai",
        )
        == ()
    )

    sql_query, parameters = repository.calls[0]
    assert ":start_date" not in sql_query
    assert ":end_date" not in sql_query
    assert parameters == {
        "tz": "Asia/Shanghai",
        "app_id": "app-1",
        "excluded_invoke_from": InvokeFrom.DEBUGGER,
    }
