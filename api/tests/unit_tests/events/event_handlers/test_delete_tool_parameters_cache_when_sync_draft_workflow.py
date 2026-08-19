import logging

import pytest

from core.tools.errors import ToolProviderNotFoundError
from events.event_handlers import delete_tool_parameters_cache_when_sync_draft_workflow as handler_module
from graphon.nodes.tool.entities import ToolEntity, ToolProviderType
from models.model import App, AppMode, IconType
from models.workflow import Workflow


def test_missing_tool_provider_does_not_log_error_traceback(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
):
    app = App(
        id="workflow-id",
        tenant_id="tenant-id",
        name="Workflow app",
        description="",
        mode=AppMode.WORKFLOW,
        icon_type=IconType.EMOJI,
        icon="workflow",
        icon_background="#FFFFFF",
        enable_site=False,
        enable_api=False,
        max_active_requests=0,
    )
    workflow = Workflow(
        tenant_id=app.tenant_id,
        app_id=app.id,
        type="workflow",
        version="draft",
        graph='{"nodes": [{"id": "node-id", "data": {"type": "tool"}}]}',
        features="{}",
        created_by="account-id",
        environment_variables=[],
        conversation_variables=[],
    )
    tool_entity = ToolEntity(
        provider_type=ToolProviderType.MCP,
        provider_id="my-test-mcp-server",
        provider_name="my-test-mcp-server",
        tool_name="echo",
        tool_label="Echo",
        tool_configurations={},
        credential_id=None,
    )

    monkeypatch.setattr(
        handler_module,
        "adapt_node_config_for_graph",
        lambda node_data: {
            "data": node_data["data"],
        },
    )
    monkeypatch.setattr(handler_module.ToolEntity, "model_validate", lambda _data: tool_entity)
    monkeypatch.setattr(
        handler_module.ToolManager,
        "get_tool_runtime",
        lambda **_kwargs: (_ for _ in ()).throw(ToolProviderNotFoundError("mcp provider not found")),
    )

    with caplog.at_level(logging.INFO, logger=handler_module.logger.name):
        handler_module.handle(app, synced_draft_workflow=workflow)

    assert not [record for record in caplog.records if record.levelno >= logging.ERROR]
    assert "Skipped deleting tool parameters cache" in caplog.text
