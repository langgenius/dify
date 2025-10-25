import json
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from core.trigger.trigger_manager import TriggerManager
from core.workflow.enums import WorkflowExecutionStatus
from models import Account, App, EndUser, WorkflowAppLog, WorkflowRun
from models.enums import AppTriggerType, CreatorUserRole
from models.provider_ids import TriggerProviderID
from models.trigger import WorkflowPluginTrigger, WorkflowTriggerLog


class WorkflowAppService:
    def get_paginate_workflow_app_logs(
        self,
        *,
        session: Session,
        app_model: App,
        keyword: str | None = None,
        status: WorkflowExecutionStatus | None = None,
        created_at_before: datetime | None = None,
        created_at_after: datetime | None = None,
        page: int = 1,
        limit: int = 20,
        created_by_end_user_session_id: str | None = None,
        created_by_account: str | None = None,
    ):
        """
        Get paginate workflow app logs using SQLAlchemy 2.0 style
        :param session: SQLAlchemy session
        :param app_model: app model
        :param keyword: search keyword
        :param status: filter by status
        :param created_at_before: filter logs created before this timestamp
        :param created_at_after: filter logs created after this timestamp
        :param page: page number
        :param limit: items per page
        :param created_by_end_user_session_id: filter by end user session id
        :param created_by_account: filter by account email
        :return: Pagination object
        """
        # Build base statement using SQLAlchemy 2.0 style
        stmt = select(WorkflowAppLog).where(
            WorkflowAppLog.tenant_id == app_model.tenant_id, WorkflowAppLog.app_id == app_model.id
        )

        if keyword or status:
            stmt = stmt.join(WorkflowRun, WorkflowRun.id == WorkflowAppLog.workflow_run_id)

        if keyword:
            keyword_like_val = f"%{keyword[:30].encode('unicode_escape').decode('utf-8')}%".replace(r"\u", r"\\u")
            keyword_conditions = [
                WorkflowRun.inputs.ilike(keyword_like_val),
                WorkflowRun.outputs.ilike(keyword_like_val),
                # filter keyword by end user session id if created by end user role
                and_(WorkflowRun.created_by_role == "end_user", EndUser.session_id.ilike(keyword_like_val)),
            ]

            # filter keyword by workflow run id
            keyword_uuid = self._safe_parse_uuid(keyword)
            if keyword_uuid:
                keyword_conditions.append(WorkflowRun.id == keyword_uuid)

            stmt = stmt.outerjoin(
                EndUser,
                and_(WorkflowRun.created_by == EndUser.id, WorkflowRun.created_by_role == CreatorUserRole.END_USER),
            ).where(or_(*keyword_conditions))

        if status:
            stmt = stmt.where(WorkflowRun.status == status)

        # Add time-based filtering
        if created_at_before:
            stmt = stmt.where(WorkflowAppLog.created_at <= created_at_before)

        if created_at_after:
            stmt = stmt.where(WorkflowAppLog.created_at >= created_at_after)

        # Filter by end user session id or account email
        if created_by_end_user_session_id:
            stmt = stmt.join(
                EndUser,
                and_(
                    WorkflowAppLog.created_by == EndUser.id,
                    WorkflowAppLog.created_by_role == CreatorUserRole.END_USER,
                    EndUser.session_id == created_by_end_user_session_id,
                ),
            )
        if created_by_account:
            account = session.scalar(select(Account).where(Account.email == created_by_account))
            if not account:
                raise ValueError(f"Account not found: {created_by_account}")

            stmt = stmt.join(
                Account,
                and_(
                    WorkflowAppLog.created_by == Account.id,
                    WorkflowAppLog.created_by_role == CreatorUserRole.ACCOUNT,
                    Account.id == account.id,
                ),
            )

        stmt = stmt.order_by(WorkflowAppLog.created_at.desc())

        # Get total count using the same filters
        count_stmt = select(func.count()).select_from(stmt.subquery())
        total = session.scalar(count_stmt) or 0

        # Apply pagination limits
        offset_stmt = stmt.offset((page - 1) * limit).limit(limit)

        # Execute query and get items
        items = list(session.scalars(offset_stmt).all())

        trigger_info_map = self._build_trigger_info_map(session, app_model, items)
        for log in items:
            log.trigger_info = trigger_info_map.get(log.workflow_run_id)

        return {
            "page": page,
            "limit": limit,
            "total": total,
            "has_more": total > page * limit,
            "data": items,
        }

    @staticmethod
    def _safe_parse_uuid(value: str):
        # fast check
        if len(value) < 32:
            return None

        try:
            return uuid.UUID(value)
        except ValueError:
            return None

    def _build_trigger_info_map(self, session: Session, app_model: App, logs: list[WorkflowAppLog]) -> dict[str, dict]:
        run_ids = [log.workflow_run_id for log in logs if log.workflow_run_id]
        if not run_ids:
            return {}

        trigger_logs = (
            session.execute(select(WorkflowTriggerLog).where(WorkflowTriggerLog.workflow_run_id.in_(run_ids)))
            .scalars()
            .all()
        )
        if not trigger_logs:
            return {}

        trigger_data_map: dict[str, dict] = {}
        node_ids: set[str] = set()
        for trigger_log in trigger_logs:
            if not trigger_log.workflow_run_id:
                continue
            try:
                trigger_data = json.loads(trigger_log.trigger_data)
            except json.JSONDecodeError:
                trigger_data = {}
            node_id = trigger_data.get("root_node_id")
            if node_id:
                node_ids.add(node_id)
            trigger_data_map[trigger_log.workflow_run_id] = {
                "log": trigger_log,
                "node_id": node_id,
            }

        plugin_trigger_map: dict[str, WorkflowPluginTrigger] = {}
        if node_ids:
            plugin_triggers = (
                session.execute(
                    select(WorkflowPluginTrigger).where(
                        WorkflowPluginTrigger.app_id == app_model.id,
                        WorkflowPluginTrigger.node_id.in_(node_ids),
                    )
                )
                .scalars()
                .all()
            )
            plugin_trigger_map = {plugin.node_id: plugin for plugin in plugin_triggers}

        provider_cache: dict[str, dict[str, Any]] = {}

        def resolve_provider(provider_id: str) -> dict[str, Any]:
            if provider_id in provider_cache:
                return provider_cache[provider_id]
            metadata: dict[str, Any] = {}
            try:
                controller = TriggerManager.get_trigger_provider(app_model.tenant_id, TriggerProviderID(provider_id))
                api_entity = controller.to_api_entity()
                metadata = {
                    "provider_name": api_entity.name,
                    "provider_label": api_entity.label.to_dict(),
                    "icon": api_entity.icon or "",
                    "plugin_id": controller.plugin_id,
                    "plugin_unique_identifier": controller.plugin_unique_identifier,
                }
            except Exception:
                metadata = {}
            provider_cache[provider_id] = metadata
            return metadata

        trigger_info_map: dict[str, dict] = {}
        for run_id, context in trigger_data_map.items():
            trigger_log = context["log"]
            if isinstance(trigger_log.trigger_type, AppTriggerType):
                trigger_type_value = trigger_log.trigger_type.value
            else:
                trigger_type_value = trigger_log.trigger_type
            info = {
                "type": trigger_type_value,
                "node_id": context["node_id"],
                "workflow_trigger_log_id": trigger_log.id,
            }

            if (
                trigger_log.trigger_type == AppTriggerType.TRIGGER_PLUGIN  # type: ignore[comparison-overlap]
                and context["node_id"]
            ):
                plugin_trigger = plugin_trigger_map.get(context["node_id"])
                if plugin_trigger:
                    info.update(
                        {
                            "provider_id": plugin_trigger.provider_id,
                            "subscription_id": plugin_trigger.subscription_id,
                            "event_name": plugin_trigger.event_name,
                        }
                    )
                    provider_metadata = resolve_provider(plugin_trigger.provider_id)
                    if provider_metadata:
                        info.update(provider_metadata)

            trigger_info_map[run_id] = info

        return trigger_info_map
