import json
from collections.abc import Mapping
from dataclasses import dataclass, replace
from datetime import datetime
from typing import Any, Protocol

from core.plugin.plugin_service import PluginService
from graphon.enums import WorkflowExecutionStatus
from models.enums import AppTriggerType
from services.workflow.entities import TriggerMetadata


@dataclass(frozen=True, slots=True)
class WorkflowAppLogAccount:
    id: str
    name: str
    email: str


@dataclass(frozen=True, slots=True)
class WorkflowAppLogEndUser:
    id: str
    type: str
    is_anonymous: bool
    session_id: str | None


@dataclass(frozen=True, slots=True)
class WorkflowAppLogRunSummary:
    id: str
    version: str | None
    status: str
    triggered_from: str
    error: str | None
    elapsed_time: float | None
    total_tokens: int | None
    total_steps: int | None
    created_at: datetime | None
    finished_at: datetime | None
    exceptions_count: int | None


@dataclass(frozen=True, slots=True)
class WorkflowAppLogItem:
    id: str
    workflow_run: WorkflowAppLogRunSummary | None
    details: dict[str, Any] | None
    created_from: str
    created_by_role: str
    created_by_account: WorkflowAppLogAccount | None
    created_by_end_user: WorkflowAppLogEndUser | None
    created_at: datetime


@dataclass(frozen=True, slots=True)
class WorkflowAppLogPage:
    page: int
    limit: int
    total: int
    has_more: bool
    data: tuple[WorkflowAppLogItem, ...]


class WorkflowAppLogQuery(Protocol):
    def get_paginated(
        self,
        *,
        tenant_id: str,
        app_id: str,
        keyword: str | None = None,
        status: WorkflowExecutionStatus | None = None,
        created_at_before: datetime | None = None,
        created_at_after: datetime | None = None,
        page: int = 1,
        limit: int = 20,
        detail: bool = False,
        created_by_end_user_session_id: str | None = None,
        created_by_account: str | None = None,
    ) -> WorkflowAppLogPage: ...


class WorkflowAppLogQueryService:
    def __init__(
        self,
        *,
        logs: WorkflowAppLogQuery,
    ) -> None:
        self._logs = logs

    def list_logs(
        self,
        *,
        tenant_id: str,
        app_id: str,
        keyword: str | None = None,
        status: WorkflowExecutionStatus | None = None,
        created_at_before: datetime | None = None,
        created_at_after: datetime | None = None,
        page: int = 1,
        limit: int = 20,
        detail: bool = False,
        created_by_end_user_session_id: str | None = None,
        created_by_account: str | None = None,
    ) -> WorkflowAppLogPage:
        result = self._logs.get_paginated(
            tenant_id=tenant_id,
            app_id=app_id,
            keyword=keyword,
            status=status,
            created_at_before=created_at_before,
            created_at_after=created_at_after,
            page=page,
            limit=limit,
            detail=detail,
            created_by_end_user_session_id=created_by_end_user_session_id,
            created_by_account=created_by_account,
        )

        return WorkflowAppLogPage(
            page=result.page,
            limit=result.limit,
            total=result.total,
            has_more=result.has_more,
            data=tuple(self._resolve_details(tenant_id=tenant_id, item=item) for item in result.data),
        )

    def _resolve_details(
        self,
        *,
        tenant_id: str,
        item: WorkflowAppLogItem,
    ) -> WorkflowAppLogItem:
        if item.details is None:
            return item

        return replace(
            item,
            details={
                "trigger_metadata": self._resolve_trigger_metadata(
                    tenant_id,
                    item.details.get("trigger_metadata"),
                )
            },
        )

    @staticmethod
    def _resolve_trigger_metadata(
        tenant_id: str,
        value: str | Mapping[str, Any] | None,
    ) -> dict[str, Any]:
        metadata = WorkflowAppLogQueryService._safe_json_loads(value)
        if not metadata:
            return {}

        trigger_metadata = TriggerMetadata.model_validate(metadata)
        if trigger_metadata.type == AppTriggerType.TRIGGER_PLUGIN:
            icon = metadata.get("icon_filename")
            icon_dark = metadata.get("icon_dark_filename")
            metadata["icon"] = PluginService.get_plugin_icon_url(tenant_id=tenant_id, filename=icon) if icon else None
            metadata["icon_dark"] = (
                PluginService.get_plugin_icon_url(tenant_id=tenant_id, filename=icon_dark) if icon_dark else None
            )
        return metadata

    @staticmethod
    def _safe_json_loads(value: Any) -> Any:
        if not value:
            return None
        if isinstance(value, str):
            try:
                return json.loads(value)
            except Exception:
                return None
        return value
