from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Any

import sqlalchemy as sa
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import aliased

from core.app.entities.app_invoke_entities import InvokeFrom
from libs.helper import convert_datetime_to_date, escape_like_pattern, to_timestamp
from models.agent import WorkflowAgentNodeBinding
from models.enums import MessageStatus
from models.model import App, Conversation, Message
from models.workflow import WorkflowNodeExecutionModel, WorkflowRun


@dataclass(frozen=True)
class AgentLogQueryParams:
    page: int = 1
    limit: int = 20
    keyword: str | None = None
    statuses: tuple[str, ...] = ()
    sources: tuple[str, ...] = ()
    sort_by: str = "updated_at"
    sort_order: str = "desc"
    start: datetime | None = None
    end: datetime | None = None


@dataclass(frozen=True)
class AgentStatisticsQueryParams:
    source: str | None = None
    start: datetime | None = None
    end: datetime | None = None
    timezone: str = "UTC"


@dataclass(frozen=True)
class AgentSourceFilter:
    kind: str
    app_id: str | None = None
    workflow_id: str | None = None
    workflow_version: str | None = None
    node_id: str | None = None
    invoke_from: InvokeFrom | None = None


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

    @classmethod
    def resolve_source_filter(cls, source: str | None) -> AgentSourceFilter:
        if not source or source.strip().lower() == "all":
            return AgentSourceFilter(kind="all")
        normalized = source.strip()
        lowered = normalized.lower()
        if lowered == "webapp":
            return AgentSourceFilter(kind="webapp")
        if lowered.startswith("webapp:"):
            return AgentSourceFilter(kind="webapp", app_id=normalized.split(":", 1)[1] or None)
        if lowered == "workflow":
            return AgentSourceFilter(kind="workflow")
        if lowered.startswith("workflow:"):
            parts = normalized.split(":")
            if len(parts) == 2 and parts[1]:
                return AgentSourceFilter(kind="workflow", app_id=parts[1])
            if len(parts) < 5 or not all(parts[1:]):
                raise ValueError(f"Unsupported source: {source}")
            return AgentSourceFilter(
                kind="workflow",
                app_id=parts[1],
                workflow_id=parts[2],
                workflow_version=":".join(parts[3:-1]),
                node_id=parts[-1],
            )
        return AgentSourceFilter(kind="webapp", invoke_from=cls.resolve_source(source))

    @classmethod
    def resolve_source_filters(cls, sources: tuple[str, ...]) -> list[AgentSourceFilter]:
        if not sources:
            return [AgentSourceFilter(kind="all")]
        filters: list[AgentSourceFilter] = []
        for source in sources:
            source_filter = cls.resolve_source_filter(source)
            if source_filter.kind == "all":
                return [source_filter]
            filters.append(source_filter)
        return filters

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

    def list_logs(self, *, app: App, agent_id: str, params: AgentLogQueryParams) -> dict[str, Any]:
        source_filters = self.resolve_source_filters(params.sources)
        rows: list[dict[str, Any]] = []
        for source_filter in source_filters:
            if source_filter.kind in {"all", "webapp"}:
                rows.extend(self._list_webapp_conversation_logs(app=app, params=params, source_filter=source_filter))
            if source_filter.kind in {"all", "workflow"}:
                rows.extend(
                    self._list_workflow_conversation_logs(
                        app=app,
                        agent_id=agent_id,
                        params=params,
                        source_filter=source_filter,
                    )
                )
        rows_by_scope = {(row["id"], row["source"]["id"] if row.get("source") else ""): row for row in rows}
        rows = list(rows_by_scope.values())
        sort_by = "created_at" if params.sort_by == "created_at" else "updated_at"
        rows.sort(key=lambda row: (row[sort_by] or 0, row["id"]), reverse=params.sort_order != "asc")

        total = len(rows)
        start = (params.page - 1) * params.limit
        end = start + params.limit
        return {
            "data": rows[start:end],
            "page": params.page,
            "limit": params.limit,
            "total": total,
            "has_more": end < total,
        }

    def list_log_messages(
        self, *, app: App, agent_id: str, conversation_id: str, params: AgentLogQueryParams
    ) -> dict[str, Any]:
        source_filters = self.resolve_source_filters(params.sources)
        rows: list[Message] = []
        for source_filter in source_filters:
            if source_filter.kind in {"all", "webapp"}:
                rows.extend(
                    self._list_webapp_messages(
                        app=app,
                        conversation_id=conversation_id,
                        params=params,
                        source_filter=source_filter,
                    )
                )
            if source_filter.kind in {"all", "workflow"}:
                rows.extend(
                    self._list_workflow_messages(
                        app=app,
                        agent_id=agent_id,
                        conversation_id=conversation_id,
                        params=params,
                        source_filter=source_filter,
                    )
                )

        deduped = {message.id: message for message in rows}
        sort_column = Message.created_at if params.sort_by == "created_at" else Message.updated_at
        sorted_rows = sorted(
            deduped.values(),
            key=lambda message: (getattr(message, sort_column.key), message.id),
            reverse=params.sort_order != "asc",
        )
        total = len(sorted_rows)
        start = (params.page - 1) * params.limit
        end = start + params.limit
        return {
            "data": [self.serialize_log_message(message) for message in sorted_rows[start:end]],
            "page": params.page,
            "limit": params.limit,
            "total": total,
            "has_more": end < total,
        }

    def list_log_sources(self, *, app: App, agent_id: str) -> dict[str, Any]:
        webapp_source = self._serialize_webapp_source(app)
        workflow_sources = self._list_workflow_sources(app=app, agent_id=agent_id)
        return {
            "data": [webapp_source, *workflow_sources],
            "groups": [
                {"type": "webapp", "label": "WEBAPP", "sources": [webapp_source]},
                {"type": "workflow", "label": "WORKFLOW", "sources": workflow_sources},
            ],
        }

    def _list_webapp_conversation_logs(
        self, *, app: App, params: AgentLogQueryParams, source_filter: AgentSourceFilter
    ) -> list[dict[str, Any]]:
        stmt = (
            select(
                Conversation,
                func.count(Message.id).label("message_count"),
                func.max(Message.created_at).label("created_at"),
                func.max(Message.updated_at).label("updated_at"),
                func.sum(sa.case((Message.status == MessageStatus.PAUSED, 1), else_=0)).label("paused_count"),
                func.sum(
                    sa.case((or_(Message.error.is_not(None), Message.status == MessageStatus.ERROR), 1), else_=0)
                ).label("failed_count"),
            )
            .join(Message, Message.conversation_id == Conversation.id)
            .where(Message.app_id == app.id, Conversation.app_id == app.id)
            .group_by(Conversation.id)
        )
        stmt = self._apply_observability_filters(stmt, params=params, source_filter=source_filter)
        rows = list(self._session.execute(stmt).all())
        return [
            self._serialize_conversation_log(
                conversation=row[0],
                message_count=row.message_count,
                paused_count=row.paused_count,
                failed_count=row.failed_count,
                source=self._serialize_webapp_source(app),
                created_at=row.created_at,
                updated_at=row.updated_at,
            )
            for row in rows
        ]

    def _list_workflow_conversation_logs(
        self, *, app: App, agent_id: str, params: AgentLogQueryParams, source_filter: AgentSourceFilter
    ) -> list[dict[str, Any]]:
        workflow_app = aliased(App)
        stmt = (
            select(
                Conversation,
                workflow_app,
                WorkflowAgentNodeBinding.workflow_id,
                WorkflowAgentNodeBinding.workflow_version,
                WorkflowAgentNodeBinding.node_id,
                func.count(sa.distinct(Message.id)).label("message_count"),
                func.max(Message.created_at).label("created_at"),
                func.max(Message.updated_at).label("updated_at"),
                func.sum(sa.case((Message.status == MessageStatus.PAUSED, 1), else_=0)).label("paused_count"),
                func.sum(
                    sa.case((or_(Message.error.is_not(None), Message.status == MessageStatus.ERROR), 1), else_=0)
                ).label("failed_count"),
            )
            .select_from(Message)
            .join(Conversation, Conversation.id == Message.conversation_id)
            .join(WorkflowRun, WorkflowRun.id == Message.workflow_run_id)
            .join(
                WorkflowAgentNodeBinding,
                and_(
                    WorkflowAgentNodeBinding.tenant_id == app.tenant_id,
                    WorkflowAgentNodeBinding.agent_id == agent_id,
                    WorkflowAgentNodeBinding.app_id == WorkflowRun.app_id,
                    WorkflowAgentNodeBinding.workflow_id == WorkflowRun.workflow_id,
                    WorkflowAgentNodeBinding.workflow_version == WorkflowRun.version,
                ),
            )
            .join(
                WorkflowNodeExecutionModel,
                and_(
                    WorkflowNodeExecutionModel.workflow_run_id == WorkflowRun.id,
                    WorkflowNodeExecutionModel.node_id == WorkflowAgentNodeBinding.node_id,
                ),
            )
            .join(workflow_app, workflow_app.id == WorkflowAgentNodeBinding.app_id)
            .where(Message.workflow_run_id.is_not(None), Conversation.app_id == WorkflowAgentNodeBinding.app_id)
            .group_by(
                Conversation.id,
                workflow_app.id,
                WorkflowAgentNodeBinding.workflow_id,
                WorkflowAgentNodeBinding.workflow_version,
                WorkflowAgentNodeBinding.node_id,
            )
        )
        stmt = self._apply_observability_filters(stmt, params=params, source_filter=source_filter)
        stmt = self._apply_workflow_source_filter(stmt, source_filter)
        rows = list(self._session.execute(stmt).all())
        return [
            self._serialize_conversation_log(
                conversation=row[0],
                message_count=row.message_count,
                paused_count=row.paused_count,
                failed_count=row.failed_count,
                source=self._serialize_workflow_source(
                    app=row[1],
                    workflow_id=row.workflow_id,
                    workflow_version=row.workflow_version,
                    node_id=row.node_id,
                ),
                created_at=row.created_at,
                updated_at=row.updated_at,
            )
            for row in rows
        ]

    def _list_webapp_messages(
        self, *, app: App, conversation_id: str, params: AgentLogQueryParams, source_filter: AgentSourceFilter
    ) -> list[Message]:
        stmt = select(Message).where(Message.app_id == app.id, Message.conversation_id == conversation_id)
        stmt = self._apply_message_filters(stmt, params=params, source_filter=source_filter)
        return list(self._session.scalars(stmt.order_by(Message.created_at.desc(), Message.id.desc())).all())

    def _list_workflow_messages(
        self,
        *,
        app: App,
        agent_id: str,
        conversation_id: str,
        params: AgentLogQueryParams,
        source_filter: AgentSourceFilter,
    ) -> list[Message]:
        stmt = (
            select(Message)
            .join(WorkflowRun, WorkflowRun.id == Message.workflow_run_id)
            .join(
                WorkflowAgentNodeBinding,
                and_(
                    WorkflowAgentNodeBinding.tenant_id == app.tenant_id,
                    WorkflowAgentNodeBinding.agent_id == agent_id,
                    WorkflowAgentNodeBinding.app_id == WorkflowRun.app_id,
                    WorkflowAgentNodeBinding.workflow_id == WorkflowRun.workflow_id,
                    WorkflowAgentNodeBinding.workflow_version == WorkflowRun.version,
                ),
            )
            .join(
                WorkflowNodeExecutionModel,
                and_(
                    WorkflowNodeExecutionModel.workflow_run_id == WorkflowRun.id,
                    WorkflowNodeExecutionModel.node_id == WorkflowAgentNodeBinding.node_id,
                ),
            )
            .where(Message.conversation_id == conversation_id)
        )
        stmt = self._apply_message_filters(stmt, params=params, source_filter=source_filter)
        stmt = self._apply_workflow_source_filter(stmt, source_filter)
        return list(self._session.scalars(stmt.order_by(Message.created_at.desc(), Message.id.desc())).all())

    def _list_workflow_sources(self, *, app: App, agent_id: str) -> list[dict[str, Any]]:
        workflow_app = aliased(App)
        stmt = (
            select(workflow_app)
            .select_from(WorkflowAgentNodeBinding)
            .join(workflow_app, workflow_app.id == WorkflowAgentNodeBinding.app_id)
            .where(WorkflowAgentNodeBinding.tenant_id == app.tenant_id, WorkflowAgentNodeBinding.agent_id == agent_id)
            .order_by(workflow_app.name.asc(), workflow_app.id.asc())
        )
        rows = self._session.execute(stmt).all()
        deduped: dict[str, dict[str, Any]] = {}
        for row in rows:
            source_app = row[0]
            deduped[source_app.id] = self._serialize_workflow_app_source(app=source_app)
        return list(deduped.values())

    @classmethod
    def _apply_observability_filters(cls, stmt, *, params: AgentLogQueryParams, source_filter: AgentSourceFilter):
        stmt = cls._apply_message_filters(stmt, params=params, source_filter=source_filter, include_keyword=False)
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
        return stmt

    @classmethod
    def _apply_message_filters(
        cls, stmt, *, params: AgentLogQueryParams, source_filter: AgentSourceFilter, include_keyword: bool = True
    ):
        stmt = cls._apply_source_filter(stmt, source_filter.invoke_from)
        if params.start:
            stmt = stmt.where(Message.created_at >= params.start)
        if params.end:
            stmt = stmt.where(Message.created_at < params.end)
        if include_keyword and params.keyword:
            escaped_keyword = escape_like_pattern(params.keyword)
            pattern = f"%{escaped_keyword}%"
            stmt = stmt.where(
                or_(
                    Message.query.ilike(pattern, escape="\\"),
                    Message.answer.ilike(pattern, escape="\\"),
                )
            )
        if params.statuses:
            stmt = cls._apply_status_filter(stmt, params.statuses)
        return stmt

    @staticmethod
    def _apply_workflow_source_filter(stmt, source_filter: AgentSourceFilter):
        if source_filter.app_id:
            stmt = stmt.where(WorkflowAgentNodeBinding.app_id == source_filter.app_id)
        if source_filter.workflow_id:
            stmt = stmt.where(WorkflowAgentNodeBinding.workflow_id == source_filter.workflow_id)
        if source_filter.workflow_version:
            stmt = stmt.where(WorkflowAgentNodeBinding.workflow_version == source_filter.workflow_version)
        if source_filter.node_id:
            stmt = stmt.where(WorkflowAgentNodeBinding.node_id == source_filter.node_id)
        return stmt

    @classmethod
    def _apply_source_filter(cls, stmt, source: InvokeFrom | None):
        if source is None:
            return stmt.where(Message.invoke_from != InvokeFrom.DEBUGGER)
        return stmt.where(Message.invoke_from == source)

    @staticmethod
    def _apply_status_filter(stmt, statuses: tuple[str, ...]):
        conditions = []
        for status in statuses:
            normalized = status.strip().lower()
            if normalized in {"success", "normal"}:
                conditions.append(and_(Message.error.is_(None), Message.status == MessageStatus.NORMAL))
            elif normalized in {"failed", "error"}:
                conditions.append(or_(Message.error.is_not(None), Message.status == MessageStatus.ERROR))
            elif normalized == "paused":
                conditions.append(Message.status == MessageStatus.PAUSED)
            else:
                raise ValueError(f"Unsupported status: {status}")
        if not conditions:
            return stmt
        return stmt.where(or_(*conditions))

    @classmethod
    def _serialize_conversation_log(
        cls,
        *,
        conversation: Conversation,
        message_count: int,
        paused_count: int,
        failed_count: int,
        source: dict[str, Any],
        created_at: datetime | None,
        updated_at: datetime | None,
    ) -> dict[str, Any]:
        return {
            "id": conversation.id,
            "conversation_id": conversation.id,
            "title": conversation.name,
            "end_user_id": conversation.from_end_user_id,
            "message_count": int(message_count or 0),
            "user_rate": None,
            "operation_rate": None,
            "unread": conversation.read_at is None,
            "source": source,
            "status": cls._conversation_status(paused_count=paused_count, failed_count=failed_count),
            "created_at": to_timestamp(created_at or conversation.created_at),
            "updated_at": to_timestamp(updated_at or conversation.updated_at),
        }

    @staticmethod
    def _conversation_status(*, paused_count: int, failed_count: int) -> str:
        if paused_count:
            return "paused"
        if failed_count:
            return "failed"
        return "success"

    @staticmethod
    def _serialize_webapp_source(app: App) -> dict[str, Any]:
        icon_type = app.icon_type.value if app.icon_type else None
        return {
            "id": f"webapp:{app.id}",
            "type": "webapp",
            "app_id": app.id,
            "app_name": app.name,
            "app_icon_type": icon_type,
            "app_icon": app.icon,
            "app_icon_background": app.icon_background,
            "workflow_id": None,
            "workflow_version": None,
            "node_id": None,
        }

    @staticmethod
    def _serialize_workflow_app_source(*, app: App) -> dict[str, Any]:
        """Serialize the app-level source used by log and monitoring filters."""
        icon_type = app.icon_type.value if app.icon_type else None
        return {
            "id": f"workflow:{app.id}",
            "type": "workflow",
            "app_id": app.id,
            "app_name": app.name,
            "app_icon_type": icon_type,
            "app_icon": app.icon,
            "app_icon_background": app.icon_background,
            "workflow_id": None,
            "workflow_version": None,
            "node_id": None,
        }

    @staticmethod
    def _serialize_workflow_source(
        *,
        app: App,
        workflow_id: str,
        workflow_version: str,
        node_id: str,
    ) -> dict[str, Any]:
        icon_type = app.icon_type.value if app.icon_type else None
        return {
            "id": f"workflow:{app.id}:{workflow_id}:{workflow_version}:{node_id}",
            "type": "workflow",
            "app_id": app.id,
            "app_name": app.name,
            "app_icon_type": icon_type,
            "app_icon": app.icon,
            "app_icon_background": app.icon_background,
            "workflow_id": workflow_id,
            "workflow_version": workflow_version,
            "node_id": node_id,
        }

    def get_statistics_summary(self, *, app: App, agent_id: str, params: AgentStatisticsQueryParams) -> dict[str, Any]:
        source_filter = self.resolve_source_filter(params.source)
        rows = self._load_daily_statistics(app=app, agent_id=agent_id, params=params, source_filter=source_filter)
        charts = self._build_charts(rows)
        summary = self._build_summary(rows)
        return {
            "source": params.source or "all",
            "summary": summary,
            "charts": charts,
        }

    def _load_daily_statistics(
        self, *, app: App, agent_id: str, params: AgentStatisticsQueryParams, source_filter: AgentSourceFilter
    ) -> list[dict[str, Any]]:
        converted_created_at = convert_datetime_to_date("m.created_at")
        message_scope = self._statistics_message_scope_sql(source_filter)
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
    {message_scope}"""
        args: dict[str, Any] = {
            "tz": params.timezone,
            "app_id": app.id,
            "tenant_id": app.tenant_id,
            "agent_id": agent_id,
            "debugger": InvokeFrom.DEBUGGER,
        }
        if source_filter.invoke_from is not None:
            args["source"] = source_filter.invoke_from
        if source_filter.app_id:
            args["source_app_id"] = source_filter.app_id
        if source_filter.workflow_id:
            args["workflow_id"] = source_filter.workflow_id
        if source_filter.workflow_version:
            args["workflow_version"] = source_filter.workflow_version
        if source_filter.node_id:
            args["node_id"] = source_filter.node_id
        if params.start:
            sql_query += " AND m.created_at >= :start"
            args["start"] = params.start
        if params.end:
            sql_query += " AND m.created_at < :end"
            args["end"] = params.end
        sql_query += " GROUP BY date ORDER BY date"

        return [dict(row._mapping) for row in self._session.execute(sa.text(sql_query), args).all()]

    @staticmethod
    def _statistics_message_scope_sql(source_filter: AgentSourceFilter) -> str:
        app_scope = "m.app_id = :app_id"
        if source_filter.invoke_from is not None:
            app_scope += " AND m.invoke_from = :source"
        workflow_binding_filters = []
        if source_filter.app_id:
            workflow_binding_filters.append("wanb.app_id = :source_app_id")
        if source_filter.workflow_id:
            workflow_binding_filters.append("wanb.workflow_id = :workflow_id")
        if source_filter.workflow_version:
            workflow_binding_filters.append("wanb.workflow_version = :workflow_version")
        if source_filter.node_id:
            workflow_binding_filters.append("wanb.node_id = :node_id")
        extra_workflow_filters = f"AND {' AND '.join(workflow_binding_filters)}" if workflow_binding_filters else ""
        workflow_scope = f"""m.workflow_run_id IS NOT NULL
        AND EXISTS (
            SELECT 1
            FROM workflow_runs wr
            JOIN workflow_agent_node_bindings wanb
                ON wanb.tenant_id = :tenant_id
                AND wanb.agent_id = :agent_id
                AND wanb.app_id = wr.app_id
                AND wanb.workflow_id = wr.workflow_id
                AND wanb.workflow_version = wr.version
                {extra_workflow_filters}
            JOIN workflow_node_executions wne
                ON wne.workflow_run_id = wr.id
                AND wne.node_id = wanb.node_id
            WHERE wr.id = m.workflow_run_id
        )"""
        if source_filter.kind == "webapp":
            return app_scope
        if source_filter.kind == "workflow":
            return workflow_scope
        return f"(({app_scope}) OR ({workflow_scope}))"

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
