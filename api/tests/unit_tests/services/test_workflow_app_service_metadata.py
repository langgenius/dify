"""Unit tests for workflow app log views and trigger metadata helpers."""

import json
import uuid
from unittest.mock import patch

import pytest

from models.enums import AppTriggerType, CreatorUserRole
from models.workflow import WorkflowAppLog, WorkflowAppLogCreatedFrom
from services.workflow_app_service import LogView, WorkflowAppService


class TestLogView:
    def test_details_and_proxy_attributes(self) -> None:
        log = WorkflowAppLog(
            tenant_id="tenant-1",
            app_id="app-1",
            workflow_id="workflow-1",
            workflow_run_id="run-1",
            created_from=WorkflowAppLogCreatedFrom.WEB_APP,
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by="account-1",
        )
        log.id = "log-1"

        view = LogView(log=log, details={"trigger_metadata": {"type": "plugin"}})

        assert view.details == {"trigger_metadata": {"type": "plugin"}}
        assert view.id == "log-1"


class TestHandleTriggerMetadata:
    def test_returns_empty_dict_when_metadata_missing(self) -> None:
        assert WorkflowAppService().handle_trigger_metadata("tenant-1", None) == {}

    def test_enriches_plugin_icons(self) -> None:
        metadata = {
            "type": AppTriggerType.TRIGGER_PLUGIN.value,
            "icon_filename": "light.png",
            "icon_dark_filename": "dark.png",
        }
        with patch(
            "services.workflow_app_service.PluginService.get_plugin_icon_url",
            side_effect=["https://cdn/light.png", "https://cdn/dark.png"],
        ) as mock_icon:
            result = WorkflowAppService().handle_trigger_metadata("tenant-1", json.dumps(metadata))

        assert result["icon"] == "https://cdn/light.png"
        assert result["icon_dark"] == "https://cdn/dark.png"
        assert mock_icon.call_count == 2

    def test_non_plugin_metadata_without_icon_lookup(self) -> None:
        metadata = {"type": AppTriggerType.TRIGGER_WEBHOOK.value}
        with patch("services.workflow_app_service.PluginService.get_plugin_icon_url") as mock_icon:
            result = WorkflowAppService().handle_trigger_metadata("tenant-1", json.dumps(metadata))

        assert result["type"] == AppTriggerType.TRIGGER_WEBHOOK.value
        mock_icon.assert_not_called()


class TestSafeJsonLoads:
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
    def test_handles_various_inputs(self, value, expected) -> None:
        assert WorkflowAppService._safe_json_loads(value) == expected


class TestSafeParseUuid:
    def test_returns_none_for_short_or_invalid_values(self) -> None:
        assert WorkflowAppService._safe_parse_uuid("short") is None
        assert WorkflowAppService._safe_parse_uuid("x" * 40) is None

    def test_returns_uuid_for_valid_string(self) -> None:
        raw = str(uuid.uuid4())

        result = WorkflowAppService._safe_parse_uuid(raw)

        assert result is not None
        assert str(result) == raw
