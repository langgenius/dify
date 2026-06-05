import logging
from types import SimpleNamespace

from core.tools.errors import ToolProviderNotFoundError
from events.event_handlers import delete_tool_parameters_cache_when_sync_draft_workflow as handler_module


def test_missing_tool_provider_does_not_log_error_traceback(monkeypatch, caplog):
    app = SimpleNamespace(id="workflow-id", tenant_id="tenant-id")
    workflow = SimpleNamespace(
        graph_dict={
            "nodes": [
                {
                    "id": "node-id",
                    "data": {
                        "type": "tool",
                    },
                }
            ]
        }
    )
    tool_entity = SimpleNamespace(
        provider_type=SimpleNamespace(value="mcp"),
        provider_id="my-test-mcp-server",
        provider_name="my-test-mcp-server",
        tool_name="echo",
        credential_id=None,
    )

    monkeypatch.setattr(handler_module, "adapt_node_config_for_graph", lambda node_data: {"data": node_data["data"]})
    monkeypatch.setattr(handler_module.ToolEntity, "model_validate", lambda data: tool_entity)
    monkeypatch.setattr(
        handler_module.ToolManager,
        "get_tool_runtime",
        lambda **kwargs: (_ for _ in ()).throw(ToolProviderNotFoundError("mcp provider not found")),
    )

    with caplog.at_level(logging.INFO, logger=handler_module.logger.name):
        handler_module.handle(app, synced_draft_workflow=workflow)

    assert not [record for record in caplog.records if record.levelno >= logging.ERROR]
    assert "Skipped deleting tool parameters cache" in caplog.text
