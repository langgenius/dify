"""Application boundary for app monitoring statistics."""

from collections.abc import Sequence
from datetime import datetime
from decimal import Decimal
from typing import NamedTuple, Protocol


class DailyMessageStatisticRecord(NamedTuple):
    date: str
    message_count: int


class DailyConversationStatisticRecord(NamedTuple):
    date: str
    conversation_count: int


class DailyTerminalStatisticRecord(NamedTuple):
    date: str
    terminal_count: int


class DailyTokenCostStatisticRecord(NamedTuple):
    date: str
    token_count: int | None
    total_price: Decimal | None
    currency: str | None


class AverageSessionInteractionStatisticRecord(NamedTuple):
    date: str
    interactions: float


class UserSatisfactionRateStatisticRecord(NamedTuple):
    date: str
    rate: float


class AverageResponseTimeStatisticRecord(NamedTuple):
    date: str
    latency: float


class TokensPerSecondStatisticRecord(NamedTuple):
    date: str
    tps: float


class AppStatisticQuery(Protocol):
    def get_daily_messages(
        self,
        *,
        app_id: str,
        start_date: datetime | None,
        end_date: datetime | None,
        timezone: str,
    ) -> Sequence[DailyMessageStatisticRecord]: ...

    def get_daily_conversations(
        self,
        *,
        app_id: str,
        start_date: datetime | None,
        end_date: datetime | None,
        timezone: str,
    ) -> Sequence[DailyConversationStatisticRecord]: ...

    def get_daily_terminals(
        self,
        *,
        app_id: str,
        start_date: datetime | None,
        end_date: datetime | None,
        timezone: str,
    ) -> Sequence[DailyTerminalStatisticRecord]: ...

    def get_daily_token_costs(
        self,
        *,
        app_id: str,
        start_date: datetime | None,
        end_date: datetime | None,
        timezone: str,
    ) -> Sequence[DailyTokenCostStatisticRecord]: ...

    def get_average_session_interactions(
        self,
        *,
        app_id: str,
        start_date: datetime | None,
        end_date: datetime | None,
        timezone: str,
    ) -> Sequence[AverageSessionInteractionStatisticRecord]: ...

    def get_user_satisfaction_rates(
        self,
        *,
        app_id: str,
        start_date: datetime | None,
        end_date: datetime | None,
        timezone: str,
    ) -> Sequence[UserSatisfactionRateStatisticRecord]: ...

    def get_average_response_times(
        self,
        *,
        app_id: str,
        start_date: datetime | None,
        end_date: datetime | None,
        timezone: str,
    ) -> Sequence[AverageResponseTimeStatisticRecord]: ...

    def get_tokens_per_second(
        self,
        *,
        app_id: str,
        start_date: datetime | None,
        end_date: datetime | None,
        timezone: str,
    ) -> Sequence[TokensPerSecondStatisticRecord]: ...
