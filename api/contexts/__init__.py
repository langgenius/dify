from contextvars import ContextVar
from threading import Lock
from typing import TYPE_CHECKING

from contexts.wrapper import RecyclableContextVar

if TYPE_CHECKING:
    from core.model_runtime.entities.model_entities import AIModelEntity
    from core.plugin.entities.plugin_daemon import PluginModelProviderEntity
    from core.tools.plugin_tool.provider import PluginToolProviderController
    from core.workflow.entities.variable_pool import VariablePool


tenant_id: ContextVar[str] = ContextVar("tenant_id")

workflow_variable_pool: ContextVar["VariablePool"] = ContextVar("workflow_variable_pool")

"""
To avoid race-conditions caused by gunicorn thread recycling, using RecyclableContextVar to replace with
"""
plugin_tool_providers: RecyclableContextVar[dict[str, "PluginToolProviderController"]] = RecyclableContextVar(
    ContextVar("plugin_tool_providers")
)

plugin_tool_providers_lock: RecyclableContextVar[Lock] = RecyclableContextVar(ContextVar("plugin_tool_providers_lock"))

plugin_model_providers: RecyclableContextVar[list["PluginModelProviderEntity"] | None] = RecyclableContextVar(
    ContextVar("plugin_model_providers")
)

plugin_model_providers_lock: RecyclableContextVar[Lock] = RecyclableContextVar(
    ContextVar("plugin_model_providers_lock")
)

plugin_model_schema_lock: RecyclableContextVar[Lock] = RecyclableContextVar(ContextVar("plugin_model_schema_lock"))

plugin_model_schemas: RecyclableContextVar[dict[str, "AIModelEntity"]] = RecyclableContextVar(
    ContextVar("plugin_model_schemas")
)
