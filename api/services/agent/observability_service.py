from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Any

import sqlalchemy as sa
from sqlalchemy import func, or_, select

from core.app.entities.app_invoke_entities import InvokeFrom
from libs.helper import convert_datetime_to_date, escape_like_pattern, to_timestamp
from models.enums import MessageStatus
from models.model import App, Conversation, Message


@dataclass(frozen=True)
class AgentLogQueryParams:
    page: int = 1
    limit: int = 20
    keyword: str | None = None
    status: str | None = None
    source: str | None = None
    start: datetime | None = None
    end: datetime | None = None


@dataclass(frozen=True)
class AgentStatisticsQueryParams:
    source: str | None = None
    start: datetime | None = None
    end: datetime | None = None
    timezone: str = "UTC"


class AgentObservabilityService:
    _SOURCE_ALIASES: dict[str, InvokeFrom] = {
        "api": InvokeFrom.SERVICE_API,
        "service-api": InvokeFrom.SERVICE_API,
        "service_api": InvokeFrom.SERVICE_API,
        "console": InvokeFrom.EXPLORE,
        "explore": InvokeFrom.EXPLORE,
        "explore-app": InvokeFrom.EXPLORE,
        "explore_app": InvokeFrom.EXPLORE,
        "web": InvokeFrom.WEB_APP,
        "web-app": InvokeFrom.WEB_APP,
        "web_app": InvokeFrom.WEB_APP,
        "debugger": InvokeFrom.DEBUGGER,
        "dev": InvokeFrom.DEBUGGER,
        "openapi": InvokeFrom.OPENAPI,
        "trigger": InvokeFrom.TRIGGER,
    }

    def __init__(self, session: Any):
        self._session = session

    @classmethod
    def resolve_source(cls, source: str | None) -> InvokeFrom | None:
        if not source or source == "all":
            return None
        normalized = source.strip().lower()
        if not normalized or normalized == "all":
            return None
        try:
            return cls._SOURCE_ALIASES[normalized]
        except KeyError as exc:
            raise ValueError(f"Unsupported source: {source}") from exc

    @staticmethod
    def _message_status(message: Message) -> str:
        if message.error or message.status == MessageStatus.ERROR:
            return "failed"
        if message.status == MessageStatus.PAUSED:
            return "paused"
        return "success"

    @staticmethod
    def _total_tokens(message: Message) -> int:
        return int(message.message_tokens or 0) + int(message.answer_tokens or 0)

    @classmethod
    def serialize_log_message(cls, message: Message, conversation: Conversation | None = None) -> dict[str, Any]:
        invoke_from = message.invoke_from.value if message.invoke_from else None
        return {
            "id": message.id,
            "message_id": message.id,
            "conversation_id": message.conversation_id,
            "conversation_name": conversation.name if conversation else None,
            "query": message.query,
            "answer": message.answer,
            "status": cls._message_status(message),
            "error": message.error,
            "source": invoke_from,
            "from_source": message.from_source.value if message.from_source else None,
            "from_end_user_id": message.from_end_user_id,
            "from_account_id": message.from_account_id,
            "message_tokens": int(message.message_tokens or 0),
            "answer_tokens": int(message.answer_tokens or 0),
            "total_tokens": cls._total_tokens(message),
            "total_price": str(message.total_price or Decimal(0)),
            "currency": message.currency,
            "latency": float(message.provider_response_latency or 0),
            "created_at": to_timestamp(message.created_at),
            "updated_at": to_timestamp(message.updated_at),
        }

    def list_logs(self, *, app: App, params: AgentLogQueryParams) -> dict[str, Any]:
        source = self.resolve_source(params.source)
        stmt = (
            select(Message, Conversation)
            .join(Conversation, Conversation.id == Message.conversation_id)
            .where(Message.app_id == app.id, Conversation.app_id == app.id)
        )
        stmt = self._apply_source_filter(stmt, source)

        if params.start:
            stmt = stmt.where(Message.created_at >= params.start)
        if params.end:
            stmt = stmt.where(Message.created_at < params.end)
        if params.keyword:
            escaped_keyword = escape_like_pattern(params.keyword)
            pattern = f"%{escaped_keyword}%"
            stmt = stmt.where(
                or_(
                    Message.query.ilike(pattern, escape="\\"),
                    Message.answer.ilike(pattern, escape="\\"),
                    Conversation.name.ilike(pattern, escape="\\"),
                )
            )
        if params.status:
            stmt = self._apply_status_filter(stmt, params.status)

        total = self._session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
        rows = list(
            self._session.execute(
                stmt.order_by(Message.created_at.desc(), Message.id.desc())
                .offset((params.page - 1) * params.limit)
                .limit(params.limit)
            ).all()
        )
        data = []
        for message, conversation in rows:
            data.append(self.serialize_log_message(message, conversation))
        return {
            "data": data,
            "page": params.page,
            "limit": params.limit,
            "total": total,
            "has_more": params.page * params.limit < total,
        }

    @classmethod
    def _apply_source_filter(cls, stmt, source: InvokeFrom | None):
        if source is None:
            return stmt.where(Message.invoke_from != InvokeFrom.DEBUGGER)
        return stmt.where(Message.invoke_from == source)

    @staticmethod
    def _apply_status_filter(stmt, status: str):
        normalized = status.strip().lower()
        if normalized in {"success", "normal"}:
            return stmt.where(Message.error.is_(None), Message.status == MessageStatus.NORMAL)
        if normalized in {"failed", "error"}:
            return stmt.where(or_(Message.error.is_not(None), Message.status == MessageStatus.ERROR))
        if normalized == "paused":
            return stmt.where(Message.status == MessageStatus.PAUSED)
        raise ValueError(f"Unsupported status: {status}")

    def get_statistics_summary(self, *, app: App, params: AgentStatisticsQueryParams) -> dict[str, Any]:
        source = self.resolve_source(params.source)
        rows = self._load_daily_statistics(app=app, params=params, source=source)
        charts = self._build_charts(rows)
        summary = self._build_summary(rows)
        return {
            "source": source.value if source else "all",
            "summary": summary,
            "charts": charts,
        }

    def _load_daily_statistics(
        self, *, app: App, params: AgentStatisticsQueryParams, source: InvokeFrom | None
    ) -> list[dict[str, Any]]:
        converted_created_at = convert_datetime_to_date("m.created_at")
        source_condition = "AND m.invoke_from != :debugger" if source is None else "AND m.invoke_from = :source"
        sql_query = f"""SELECT
    {converted_created_at} AS date,
    COUNT(m.id) AS message_count,
    COUNT(DISTINCT m.conversation_id) AS conversation_count,
    COUNT(DISTINCT m.from_end_user_id) AS end_user_count,
    COALESCE(SUM(COALESCE(m.message_tokens, 0) + COALESCE(m.answer_tokens, 0)), 0) AS token_count,
    COALESCE(SUM(COALESCE(m.total_price, 0)), 0) AS total_price,
    COALESCE(AVG(m.provider_response_latency), 0) AS avg_latency,
    COALESCE(SUM(m.provider_response_latency), 0) AS latency_sum,
    COALESCE(SUM(m.answer_tokens), 0) AS answer_tokens,
    COUNT(mf.id) AS like_count
FROM messages m
LEFT JOIN message_feedbacks mf
    ON mf.message_id = m.id AND mf.rating = 'like'
WHERE
    m.app_id = :app_id
    {source_condition}"""
        args: dict[str, Any] = {
            "tz": params.timezone,
            "app_id": app.id,
            "debugger": InvokeFrom.DEBUGGER,
        }
        if source is not None:
            args["source"] = source
        if params.start:
            sql_query += " AND m.created_at >= :start"
            args["start"] = params.start
        if params.end:
            sql_query += " AND m.created_at < :end"
            args["end"] = params.end
        sql_query += " GROUP BY date ORDER BY date"

        return [dict(row._mapping) for row in self._session.execute(sa.text(sql_query), args).all()]

    @staticmethod
    def _build_charts(rows: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
        messages = []
        conversations = []
        end_users = []
        token_usage = []
        average_session_interactions = []
        average_response_time = []
        tokens_per_second = []
        user_satisfaction_rate = []

        for row in rows:
            date = str(row["date"])
            message_count = int(row["message_count"] or 0)
            conversation_count = int(row["conversation_count"] or 0)
            token_count = int(row["token_count"] or 0)
            total_price = row["total_price"] or Decimal(0)
            avg_latency = float(row["avg_latency"] or 0)
            latency_sum = float(row["latency_sum"] or 0)
            answer_tokens = int(row["answer_tokens"] or 0)
            like_count = int(row["like_count"] or 0)

            messages.append({"date": date, "message_count": message_count})
            conversations.append({"date": date, "conversation_count": conversation_count})
            end_users.append({"date": date, "terminal_count": int(row["end_user_count"] or 0)})
            token_usage.append(
                {
                    "date": date,
                    "token_count": token_count,
                    "total_price": str(total_price),
                    "currency": "USD",
                }
            )
            average_session_interactions.append(
                {
                    "date": date,
                    "interactions": round(message_count / conversation_count, 2) if conversation_count else 0,
                }
            )
            average_response_time.append({"date": date, "latency": round(avg_latency * 1000, 4)})
            tokens_per_second.append({"date": date, "tps": round(answer_tokens / latency_sum, 4) if latency_sum else 0})
            user_satisfaction_rate.append(
                {"date": date, "rate": round(like_count * 100 / message_count, 2) if message_count else 0}
            )

        return {
            "daily_messages": messages,
            "daily_conversations": conversations,
            "daily_end_users": end_users,
            "token_usage": token_usage,
            "average_session_interactions": average_session_interactions,
            "average_response_time": average_response_time,
            "tokens_per_second": tokens_per_second,
            "user_satisfaction_rate": user_satisfaction_rate,
        }

    @staticmethod
    def _build_summary(rows: list[dict[str, Any]]) -> dict[str, Any]:
        total_messages = sum(int(row["message_count"] or 0) for row in rows)
        total_conversations = sum(int(row["conversation_count"] or 0) for row in rows)
        total_end_users = sum(int(row["end_user_count"] or 0) for row in rows)
        total_tokens = sum(int(row["token_count"] or 0) for row in rows)
        total_price = sum(Decimal(str(row["total_price"] or 0)) for row in rows)
        total_answer_tokens = sum(int(row["answer_tokens"] or 0) for row in rows)
        total_latency = sum(float(row["latency_sum"] or 0) for row in rows)
        weighted_latency = sum(float(row["avg_latency"] or 0) * int(row["message_count"] or 0) for row in rows)
        total_likes = sum(int(row["like_count"] or 0) for row in rows)

        return {
            "total_messages": total_messages,
            "total_conversations": total_conversations,
            "total_end_users": total_end_users,
            "total_tokens": total_tokens,
            "total_price": str(total_price),
            "currency": "USD",
            "average_session_interactions": round(total_messages / total_conversations, 2)
            if total_conversations
            else 0,
            "average_response_time": round((weighted_latency / total_messages) * 1000, 4) if total_messages else 0,
            "tokens_per_second": round(total_answer_tokens / total_latency, 4) if total_latency else 0,
            "user_satisfaction_rate": round(total_likes * 100 / total_messages, 2) if total_messages else 0,
        }
