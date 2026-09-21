"""Database read model for app monitoring statistics."""

from datetime import datetime
from decimal import Decimal
from typing import override

import sqlalchemy as sa
from sqlalchemy.engine import RowMapping
from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.app_invoke_entities import InvokeFrom
from libs.helper import convert_datetime_to_date
from services.app_statistic_query import (
    AppStatisticQuery,
    AverageResponseTimeStatisticRecord,
    AverageSessionInteractionStatisticRecord,
    DailyConversationStatisticRecord,
    DailyMessageStatisticRecord,
    DailyTerminalStatisticRecord,
    DailyTokenCostStatisticRecord,
    TokensPerSecondStatisticRecord,
    UserSatisfactionRateStatisticRecord,
)


def _append_time_range(
    sql_query: str,
    parameters: dict[str, object],
    *,
    column: str,
    start_date: datetime | None,
    end_date: datetime | None,
) -> str:
    if start_date is not None:
        sql_query += f" AND {column} >= :start_date"
        parameters["start_date"] = start_date

    if end_date is not None:
        sql_query += f" AND {column} < :end_date"
        parameters["end_date"] = end_date

    return sql_query


class AppStatisticQueryRepository(AppStatisticQuery):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    def _execute(self, sql_query: str, parameters: dict[str, object]) -> tuple[RowMapping, ...]:
        with self._session_factory() as session:
            return tuple(session.execute(sa.text(sql_query), parameters).mappings())

    @staticmethod
    def _parameters(
        *,
        app_id: str,
        timezone: str,
    ) -> dict[str, object]:
        return {
            "tz": timezone,
            "app_id": app_id,
            "excluded_invoke_from": InvokeFrom.DEBUGGER,
        }

    @override
    def get_daily_messages(
        self,
        *,
        app_id: str,
        start_date: datetime | None,
        end_date: datetime | None,
        timezone: str,
    ) -> tuple[DailyMessageStatisticRecord, ...]:
        converted_created_at = convert_datetime_to_date("created_at")
        sql_query = f"""SELECT
    {converted_created_at} AS date,
    COUNT(*) AS message_count
FROM
    messages
WHERE
    app_id = :app_id
    AND invoke_from != :excluded_invoke_from"""
        parameters = self._parameters(
            app_id=app_id,
            timezone=timezone,
        )
        sql_query = _append_time_range(
            sql_query,
            parameters,
            column="created_at",
            start_date=start_date,
            end_date=end_date,
        )
        sql_query += " GROUP BY date ORDER BY date"

        return tuple(
            DailyMessageStatisticRecord(date=str(row["date"]), message_count=row["message_count"])
            for row in self._execute(sql_query, parameters)
        )

    @override
    def get_daily_conversations(
        self,
        *,
        app_id: str,
        start_date: datetime | None,
        end_date: datetime | None,
        timezone: str,
    ) -> tuple[DailyConversationStatisticRecord, ...]:
        converted_created_at = convert_datetime_to_date("created_at")
        sql_query = f"""SELECT
    {converted_created_at} AS date,
    COUNT(DISTINCT conversation_id) AS conversation_count
FROM
    messages
WHERE
    app_id = :app_id
    AND invoke_from != :excluded_invoke_from"""
        parameters = self._parameters(
            app_id=app_id,
            timezone=timezone,
        )
        sql_query = _append_time_range(
            sql_query,
            parameters,
            column="created_at",
            start_date=start_date,
            end_date=end_date,
        )
        sql_query += " GROUP BY date ORDER BY date"

        return tuple(
            DailyConversationStatisticRecord(
                date=str(row["date"]),
                conversation_count=row["conversation_count"],
            )
            for row in self._execute(sql_query, parameters)
        )

    @override
    def get_daily_terminals(
        self,
        *,
        app_id: str,
        start_date: datetime | None,
        end_date: datetime | None,
        timezone: str,
    ) -> tuple[DailyTerminalStatisticRecord, ...]:
        converted_created_at = convert_datetime_to_date("created_at")
        sql_query = f"""SELECT
    {converted_created_at} AS date,
    COUNT(DISTINCT messages.from_end_user_id) AS terminal_count
FROM
    messages
WHERE
    app_id = :app_id
    AND invoke_from != :excluded_invoke_from"""
        parameters = self._parameters(
            app_id=app_id,
            timezone=timezone,
        )
        sql_query = _append_time_range(
            sql_query,
            parameters,
            column="created_at",
            start_date=start_date,
            end_date=end_date,
        )
        sql_query += " GROUP BY date ORDER BY date"

        return tuple(
            DailyTerminalStatisticRecord(date=str(row["date"]), terminal_count=row["terminal_count"])
            for row in self._execute(sql_query, parameters)
        )

    @override
    def get_daily_token_costs(
        self,
        *,
        app_id: str,
        start_date: datetime | None,
        end_date: datetime | None,
        timezone: str,
    ) -> tuple[DailyTokenCostStatisticRecord, ...]:
        converted_created_at = convert_datetime_to_date("created_at")
        sql_query = f"""SELECT
    {converted_created_at} AS date,
    (SUM(messages.message_tokens) + SUM(messages.answer_tokens)) AS token_count,
    SUM(total_price) AS total_price
FROM
    messages
WHERE
    app_id = :app_id
    AND invoke_from != :excluded_invoke_from"""
        parameters = self._parameters(
            app_id=app_id,
            timezone=timezone,
        )
        sql_query = _append_time_range(
            sql_query,
            parameters,
            column="created_at",
            start_date=start_date,
            end_date=end_date,
        )
        sql_query += " GROUP BY date ORDER BY date"

        return tuple(
            DailyTokenCostStatisticRecord(
                date=str(row["date"]),
                token_count=int(row["token_count"]) if row["token_count"] is not None else None,
                total_price=row["total_price"],
                currency="USD",
            )
            for row in self._execute(sql_query, parameters)
        )

    @override
    def get_average_session_interactions(
        self,
        *,
        app_id: str,
        start_date: datetime | None,
        end_date: datetime | None,
        timezone: str,
    ) -> tuple[AverageSessionInteractionStatisticRecord, ...]:
        converted_created_at = convert_datetime_to_date("c.created_at")
        sql_query = f"""SELECT
    {converted_created_at} AS date,
    AVG(subquery.message_count) AS interactions
FROM
    (
        SELECT
            m.conversation_id,
            COUNT(m.id) AS message_count
        FROM
            conversations c
        JOIN
            messages m
            ON c.id = m.conversation_id
        WHERE
            c.app_id = :app_id
            AND m.invoke_from != :excluded_invoke_from"""
        parameters = self._parameters(
            app_id=app_id,
            timezone=timezone,
        )
        sql_query = _append_time_range(
            sql_query,
            parameters,
            column="c.created_at",
            start_date=start_date,
            end_date=end_date,
        )
        sql_query += """
        GROUP BY m.conversation_id
    ) subquery
LEFT JOIN
    conversations c
    ON c.id = subquery.conversation_id
GROUP BY
    date
ORDER BY
    date"""

        return tuple(
            AverageSessionInteractionStatisticRecord(
                date=str(row["date"]),
                interactions=float(row["interactions"].quantize(Decimal("0.01"))),
            )
            for row in self._execute(sql_query, parameters)
        )

    @override
    def get_user_satisfaction_rates(
        self,
        *,
        app_id: str,
        start_date: datetime | None,
        end_date: datetime | None,
        timezone: str,
    ) -> tuple[UserSatisfactionRateStatisticRecord, ...]:
        converted_created_at = convert_datetime_to_date("m.created_at")
        sql_query = f"""SELECT
    {converted_created_at} AS date,
    COUNT(m.id) AS message_count,
    COUNT(mf.id) AS feedback_count
FROM
    messages m
LEFT JOIN
    message_feedbacks mf
    ON mf.message_id=m.id AND mf.rating='like'
WHERE
    m.app_id = :app_id
    AND m.invoke_from != :excluded_invoke_from"""
        parameters = self._parameters(
            app_id=app_id,
            timezone=timezone,
        )
        sql_query = _append_time_range(
            sql_query,
            parameters,
            column="m.created_at",
            start_date=start_date,
            end_date=end_date,
        )
        sql_query += " GROUP BY date ORDER BY date"

        return tuple(
            UserSatisfactionRateStatisticRecord(
                date=str(row["date"]),
                rate=float(
                    round(
                        row["feedback_count"] * 1000 / row["message_count"] if row["message_count"] > 0 else 0,
                        2,
                    )
                ),
            )
            for row in self._execute(sql_query, parameters)
        )

    @override
    def get_average_response_times(
        self,
        *,
        app_id: str,
        start_date: datetime | None,
        end_date: datetime | None,
        timezone: str,
    ) -> tuple[AverageResponseTimeStatisticRecord, ...]:
        converted_created_at = convert_datetime_to_date("created_at")
        sql_query = f"""SELECT
    {converted_created_at} AS date,
    AVG(provider_response_latency) AS latency
FROM
    messages
WHERE
    app_id = :app_id
    AND invoke_from != :excluded_invoke_from"""
        parameters = self._parameters(
            app_id=app_id,
            timezone=timezone,
        )
        sql_query = _append_time_range(
            sql_query,
            parameters,
            column="created_at",
            start_date=start_date,
            end_date=end_date,
        )
        sql_query += " GROUP BY date ORDER BY date"

        return tuple(
            AverageResponseTimeStatisticRecord(
                date=str(row["date"]),
                latency=round(row["latency"] * 1000, 4),
            )
            for row in self._execute(sql_query, parameters)
        )

    @override
    def get_tokens_per_second(
        self,
        *,
        app_id: str,
        start_date: datetime | None,
        end_date: datetime | None,
        timezone: str,
    ) -> tuple[TokensPerSecondStatisticRecord, ...]:
        converted_created_at = convert_datetime_to_date("created_at")
        sql_query = f"""SELECT
    {converted_created_at} AS date,
    CASE
        WHEN SUM(provider_response_latency) = 0 THEN 0
        ELSE (SUM(answer_tokens) / SUM(provider_response_latency))
    END as tokens_per_second
FROM
    messages
WHERE
    app_id = :app_id
    AND invoke_from != :excluded_invoke_from"""
        parameters = self._parameters(
            app_id=app_id,
            timezone=timezone,
        )
        sql_query = _append_time_range(
            sql_query,
            parameters,
            column="created_at",
            start_date=start_date,
            end_date=end_date,
        )
        sql_query += " GROUP BY date ORDER BY date"

        return tuple(
            TokensPerSecondStatisticRecord(
                date=str(row["date"]),
                tps=round(row["tokens_per_second"], 4),
            )
            for row in self._execute(sql_query, parameters)
        )
