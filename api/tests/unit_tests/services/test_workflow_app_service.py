from __future__ import annotations

import json
import uuid
from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import MagicMock

import pytest
from pytest_mock import MockerFixture

from dify_graph.enums import WorkflowExecutionStatus
from models import App, WorkflowAppLog
from models.enums import AppTriggerType, CreatorUserRole
from services.workflow_app_service import LogView, WorkflowAppService


@pytest.fixture
def service() -> WorkflowAppService:
    # Arrange
    return WorkflowAppService()


@pytest.fixture
def app_model() -> App:
    # Arrange
    return cast(App, SimpleNamespace(id="app-1", tenant_id="tenant-1"))


def _workflow_app_log(**kwargs: Any) -> WorkflowAppLog:
    return cast(WorkflowAppLog, SimpleNamespace(**kwargs))


def test_log_view_details_should_return_wrapped_details_and_proxy_attributes() -> None:
    # Arrange
    log = _workflow_app_log(id="log-1", status="succeeded")
    view = LogView(log=log, details={"trigger_metadata": {"type": "plugin"}})

    # Act
    details = view.details
    proxied_status = view.status

    # Assert
    assert details == {"trigger_metadata": {"type": "plugin"}}
    assert proxied_status == "succeeded"


def test_get_paginate_workflow_app_logs_should_return_paginated_summary_when_detail_false(
    service: WorkflowAppService,
    app_model: App,
) -> None:
    # Arrange
    session = MagicMock()
    log_1 = SimpleNamespace(id="log-1")
    log_2 = SimpleNamespace(id="log-2")
    session.scalar.return_value = 3
    session.scalars.return_value.all.return_value = [log_1, log_2]

    # Act
    result = service.get_paginate_workflow_app_logs(
        session=session,
        app_model=app_model,
        page=1,
        limit=2,
        detail=False,
    )

    # Assert
    assert result["page"] == 1
    assert result["limit"] == 2
    assert result["total"] == 3
    assert result["has_more"] is True
    assert len(result["data"]) == 2
    assert isinstance(result["data"][0], LogView)
    assert result["data"][0].details is None


def test_get_paginate_workflow_app_logs_should_return_detailed_rows_when_detail_true(
    service: WorkflowAppService,
    app_model: App,
    mocker: MockerFixture,
) -> None:
    # Arrange
    session = MagicMock()
    session.scalar.side_effect = [1]
    log_1 = SimpleNamespace(id="log-1")
    session.execute.return_value.all.return_value = [(log_1, '{"type":"trigger_plugin"}')]
    mock_handle = mocker.patch.object(
        service,
        "handle_trigger_metadata",
        return_value={"type": "trigger_plugin", "icon": "url"},
    )

    # Act
    result = service.get_paginate_workflow_app_logs(
        session=session,
        app_model=app_model,
        keyword="run-1",
        status=WorkflowExecutionStatus.SUCCEEDED,
        created_at_before=None,
        created_at_after=None,
        page=1,
        limit=20,
        detail=True,
    )

    # Assert
    assert result["total"] == 1
    assert len(result["data"]) == 1
    assert result["data"][0].details == {"trigger_metadata": {"type": "trigger_plugin", "icon": "url"}}
    mock_handle.assert_called_once()


def test_get_paginate_workflow_app_logs_should_raise_when_account_filter_email_not_found(
    service: WorkflowAppService,
    app_model: App,
) -> None:
    # Arrange
    session = MagicMock()
    session.scalar.return_value = None

    # Act + Assert
    with pytest.raises(ValueError, match="Account not found: account@example.com"):
        service.get_paginate_workflow_app_logs(
            session=session,
            app_model=app_model,
            created_by_account="account@example.com",
        )


def test_get_paginate_workflow_app_logs_should_filter_by_account_when_account_exists(
    service: WorkflowAppService,
    app_model: App,
) -> None:
    # Arrange
    session = MagicMock()
    session.scalar.side_effect = [SimpleNamespace(id="account-1"), 0]
    session.scalars.return_value.all.return_value = []

    # Act
    result = service.get_paginate_workflow_app_logs(
        session=session,
        app_model=app_model,
        created_by_account="account@example.com",
    )

    # Assert
    assert result["total"] == 0
    assert result["data"] == []


def test_get_paginate_workflow_archive_logs_should_return_paginated_archive_items(
    service: WorkflowAppService,
    app_model: App,
) -> None:
    # Arrange
    session = MagicMock()
    log_account = SimpleNamespace(
        id="log-1",
        created_by="acc-1",
        created_by_role=CreatorUserRole.ACCOUNT,
        workflow_run_summary={"run": "1"},
        trigger_metadata='{"type":"trigger-webhook"}',
        log_created_at="2026-01-01",
    )
    log_end_user = SimpleNamespace(
        id="log-2",
        created_by="end-1",
        created_by_role=CreatorUserRole.END_USER,
        workflow_run_summary={"run": "2"},
        trigger_metadata='{"type":"trigger-webhook"}',
        log_created_at="2026-01-02",
    )
    log_unknown = SimpleNamespace(
        id="log-3",
        created_by="other",
        created_by_role="system",
        workflow_run_summary={"run": "3"},
        trigger_metadata='{"type":"trigger-webhook"}',
        log_created_at="2026-01-03",
    )
    session.scalar.return_value = 3
    session.scalars.side_effect = [
        SimpleNamespace(all=lambda: [log_account, log_end_user, log_unknown]),
        SimpleNamespace(all=lambda: [SimpleNamespace(id="acc-1", email="a@example.com")]),
        SimpleNamespace(all=lambda: [SimpleNamespace(id="end-1", session_id="session-1")]),
    ]

    # Act
    result = service.get_paginate_workflow_archive_logs(
        session=session,
        app_model=app_model,
        page=1,
        limit=20,
    )

    # Assert
    assert result["total"] == 3
    assert len(result["data"]) == 3
    assert result["data"][0]["created_by_account"].id == "acc-1"
    assert result["data"][1]["created_by_end_user"].id == "end-1"
    assert result["data"][2]["created_by_account"] is None
    assert result["data"][2]["created_by_end_user"] is None


def test_handle_trigger_metadata_should_return_empty_dict_when_metadata_missing(
    service: WorkflowAppService,
) -> None:
    # Arrange
    # Act
    result = service.handle_trigger_metadata("tenant-1", None)

    # Assert
    assert result == {}


def test_handle_trigger_metadata_should_enrich_plugin_icons_for_trigger_plugin(
    service: WorkflowAppService,
    mocker: MockerFixture,
) -> None:
    # Arrange
    meta = {
        "type": AppTriggerType.TRIGGER_PLUGIN.value,
        "icon_filename": "light.png",
        "icon_dark_filename": "dark.png",
    }
    mock_icon = mocker.patch(
        "services.workflow_app_service.PluginService.get_plugin_icon_url",
        side_effect=["https://cdn/light.png", "https://cdn/dark.png"],
    )

    # Act
    result = service.handle_trigger_metadata("tenant-1", json.dumps(meta))

    # Assert
    assert result["icon"] == "https://cdn/light.png"
    assert result["icon_dark"] == "https://cdn/dark.png"
    assert mock_icon.call_count == 2


def test_handle_trigger_metadata_should_return_non_plugin_metadata_without_icon_lookup(
    service: WorkflowAppService,
    mocker: MockerFixture,
) -> None:
    # Arrange
    meta = {"type": AppTriggerType.TRIGGER_WEBHOOK.value}
    mock_icon = mocker.patch("services.workflow_app_service.PluginService.get_plugin_icon_url")

    # Act
    result = service.handle_trigger_metadata("tenant-1", json.dumps(meta))

    # Assert
    assert result["type"] == AppTriggerType.TRIGGER_WEBHOOK.value
    mock_icon.assert_not_called()


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
def test_safe_json_loads_should_handle_various_inputs(
    value: object,
    expected: object,
    service: WorkflowAppService,
) -> None:
    # Arrange
    # Act
    result = service._safe_json_loads(value)

    # Assert
    assert result == expected


def test_safe_parse_uuid_should_return_none_for_short_or_invalid_values(service: WorkflowAppService) -> None:
    # Arrange
    # Act
    short_result = service._safe_parse_uuid("short")
    invalid_result = service._safe_parse_uuid("x" * 40)

    # Assert
    assert short_result is None
    assert invalid_result is None


def test_safe_parse_uuid_should_return_uuid_for_valid_uuid_string(service: WorkflowAppService) -> None:
    # Arrange
    raw_uuid = str(uuid.uuid4())

    # Act
    result = service._safe_parse_uuid(raw_uuid)

    # Assert
    assert result is not None
    assert str(result) == raw_uuid
