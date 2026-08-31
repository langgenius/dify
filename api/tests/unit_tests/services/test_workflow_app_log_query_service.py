import json
import uuid
from collections.abc import Mapping
from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import pytest

from models.enums import AppTriggerType
from repositories.workflow_app_log_query_repository import WorkflowAppLogQueryRepository
from services.workflow_app_log_query_service import (
    WorkflowAppLogItem,
    WorkflowAppLogPage,
    WorkflowAppLogQueryService,
)


def _service_with_metadata(
    value: str | Mapping[str, object] | None,
    *,
    detail: bool = True,
) -> WorkflowAppLogQueryService:
    logs = MagicMock()
    logs.get_paginated.return_value = WorkflowAppLogPage(
        page=1,
        limit=20,
        total=1,
        has_more=False,
        data=(
            WorkflowAppLogItem(
                id="log-1",
                workflow_run=None,
                details={"trigger_metadata": value} if detail else None,
                created_from="web-app",
                created_by_role="account",
                created_by_account=None,
                created_by_end_user=None,
                created_at=datetime(2026, 1, 1, tzinfo=UTC),
            ),
        ),
    )
    return WorkflowAppLogQueryService(logs=logs)


def test_list_logs_preserves_missing_workflow_run_and_resolves_empty_metadata() -> None:
    service = _service_with_metadata(None)

    result = service.list_logs(tenant_id="tenant-1", app_id="app-1", detail=True)

    assert result.data[0].details == {"trigger_metadata": {}}
    assert result.data[0].workflow_run is None


def test_list_logs_enriches_plugin_icons() -> None:
    metadata = {
        "type": AppTriggerType.TRIGGER_PLUGIN.value,
        "icon_filename": "light.png",
        "icon_dark_filename": "dark.png",
    }
    service = _service_with_metadata(json.dumps(metadata))

    with patch(
        "services.workflow_app_log_query_service.PluginService.get_plugin_icon_url",
        side_effect=["https://cdn/light.png", "https://cdn/dark.png"],
    ) as get_icon_url:
        result = service.list_logs(tenant_id="tenant-1", app_id="app-1", detail=True)

    details = result.data[0].details
    assert details is not None
    trigger_metadata = details["trigger_metadata"]
    assert trigger_metadata["icon"] == "https://cdn/light.png"
    assert trigger_metadata["icon_dark"] == "https://cdn/dark.png"
    assert get_icon_url.call_count == 2


def test_list_logs_does_not_fetch_icons_for_non_plugin_metadata() -> None:
    service = _service_with_metadata(json.dumps({"type": AppTriggerType.TRIGGER_WEBHOOK.value}))

    with patch("services.workflow_app_log_query_service.PluginService.get_plugin_icon_url") as get_icon_url:
        result = service.list_logs(tenant_id="tenant-1", app_id="app-1", detail=True)

    assert result.data[0].details == {"trigger_metadata": {"type": AppTriggerType.TRIGGER_WEBHOOK.value}}
    get_icon_url.assert_not_called()


def test_list_logs_does_not_resolve_metadata_without_detail() -> None:
    service = _service_with_metadata("not-json", detail=False)

    result = service.list_logs(tenant_id="tenant-1", app_id="app-1")

    assert result.data[0].details is None


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (None, None),
        ("", None),
        ('{"k":"v"}', {"k": "v"}),
        ("not-json", None),
        ({"raw": True}, {"raw": True}),
    ],
)
def test_safe_json_loads(value: object, expected: object) -> None:
    assert WorkflowAppLogQueryService._safe_json_loads(value) == expected


def test_safe_parse_uuid_rejects_short_and_invalid_values() -> None:
    assert WorkflowAppLogQueryRepository._safe_parse_uuid("short") is None
    assert WorkflowAppLogQueryRepository._safe_parse_uuid("x" * 40) is None


def test_safe_parse_uuid_accepts_uuid() -> None:
    raw = str(uuid.uuid4())

    result = WorkflowAppLogQueryRepository._safe_parse_uuid(raw)

    assert result is not None
    assert str(result) == raw
