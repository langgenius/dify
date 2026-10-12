import json
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


@pytest.mark.parametrize(
    ("provider_type", "provider_id", "provider_name", "tool_name", "credential_id", "expected_key"),
    [
        pytest.param(
            "builtin",
            "time",
            "time",
            "current_time",
            None,
            "tool_parameter_secret:tenant_id:tenant-id:provider:builtin.time:tool_name:current_time"
            ":identity_id:WORKFLOW.workflow-id.node-id",
            id="builtin-time",
        ),
        pytest.param(
            "builtin",
            "acme/huddle/huddle",
            "acme/huddle/huddle",
            "post",
            "99999999-0000-4000-8000-000000000001",
            "tool_parameter_secret:tenant_id:tenant-id:provider:builtin.acme/huddle/huddle:tool_name:post"
            ":identity_id:WORKFLOW.workflow-id.node-id",
            id="plugin-as-builtin-selected",
        ),
        pytest.param(
            "plugin",
            "acme/huddle/huddle",
            "acme/huddle/huddle",
            "post",
            None,
            "tool_parameter_secret:tenant_id:tenant-id:provider:plugin.acme/huddle/huddle:tool_name:post"
            ":identity_id:WORKFLOW.workflow-id.node-id",
            id="plugin-unconfigured",
        ),
    ],
)
def test_native_draft_cache_receiver_deletes_exact_key_without_resolving_runtime(
    monkeypatch,
    provider_type,
    provider_id,
    provider_name,
    tool_name,
    credential_id,
    expected_key,
):
    """Saving a Tool never needs declaration, credential, decrypt or OAuth owners.

    Real graph adaptation, ToolEntity parsing, receiver and ToolParameterCache
    key/deletion remain in the call path. Only Redis is an external double;
    sensitive runtime owners are fail-fast observers, not policy substitutes.
    """
    import core.tools.tool_manager as runtime_module
    from core.helper import provider_encryption, tool_parameter_cache
    from core.plugin.impl.oauth import OAuthHandler
    from core.plugin.impl.tool import PluginToolManager

    deleted = []
    forbidden = []

    class RedisBoundary:
        @staticmethod
        def delete(key):
            deleted.append(key)
            return 1

    def forbidden_owner(name):
        def fail(*_args, **_kwargs):
            forbidden.append(name)
            raise AssertionError(f"normal draft cache invalidation must not call {name}")

        return fail

    monkeypatch.setattr(tool_parameter_cache, "redis_client", RedisBoundary())
    for owner, name in (
        (handler_module.ToolManager, "get_tool_runtime"),
        (handler_module.ToolManager, "get_builtin_provider"),
        (runtime_module, "create_provider_encrypter"),
        (provider_encryption.ProviderConfigEncrypter, "decrypt"),
        (OAuthHandler, "refresh_credentials"),
        (PluginToolManager, "fetch_tool_provider"),
        (PluginToolManager, "invoke"),
    ):
        monkeypatch.setattr(owner, name, forbidden_owner(name))
    app = App(
        id="workflow-id",
        tenant_id="tenant-id",
        name="Workflow app",
        description="",
        mode=AppMode.WORKFLOW,
        enable_site=False,
        enable_api=False,
        max_active_requests=0,
    )
    workflow = Workflow(
        tenant_id=app.tenant_id,
        app_id=app.id,
        type="workflow",
        version="draft",
        graph=json.dumps(
            {
                "nodes": [
                    {
                        "id": "node-id",
                        "type": "custom",
                        "data": {
                            "type": "tool",
                            "title": "Tool",
                            "provider_type": provider_type,
                            "provider_id": provider_id,
                            "provider_name": provider_name,
                            "tool_name": tool_name,
                            "tool_label": "Action",
                            "tool_configurations": {},
                            "tool_parameters": {},
                            "credential_id": credential_id,
                        },
                    },
                ]
            }
        ),
        features="{}",
        created_by="account-id",
        environment_variables=[],
        conversation_variables=[],
    )
    handler_module.handle(app, synced_draft_workflow=workflow)
    assert forbidden == [], "cache receiver attempted sensitive native runtime resolution during normal save"
    assert deleted == [expected_key]
