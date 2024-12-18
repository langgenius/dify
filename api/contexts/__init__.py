from contextvars import ContextVar
from threading import Lock
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from core.plugin.entities.plugin_daemon import PluginModelProviderEntity
    from core.tools.plugin_tool.provider import PluginToolProviderController
    from core.workflow.entities.variable_pool import VariablePool


tenant_id: ContextVar[str] = ContextVar("tenant_id")

workflow_variable_pool: ContextVar["VariablePool"] = ContextVar("workflow_variable_pool")

plugin_tool_providers: ContextVar[dict[str, "PluginToolProviderController"]] = ContextVar("plugin_tool_providers")
plugin_tool_providers_lock: ContextVar[Lock] = ContextVar("plugin_tool_providers_lock")

plugin_model_providers: ContextVar[list["PluginModelProviderEntity"] | None] = ContextVar("plugin_model_providers")
plugin_model_providers_lock: ContextVar[Lock] = ContextVar("plugin_model_providers_lock")
