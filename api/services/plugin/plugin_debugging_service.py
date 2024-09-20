from core.plugin.manager.debugging import PluginDebuggingManager


class PluginDebuggingService:
    @staticmethod
    def get_plugin_debugging_key(tenant_id: str) -> str:
        manager = PluginDebuggingManager()
        return manager.get_debugging_key(tenant_id)
