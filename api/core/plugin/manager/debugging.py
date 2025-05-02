from pydantic import BaseModel

from core.plugin.manager.base import BasePluginManager


class PluginDebuggingManager(BasePluginManager):
    def get_debugging_key(self, tenant_id: str) -> str:
        """
        Get the debugging key for the given tenant.
        """

        class Response(BaseModel):
            key: str

        response = self._request_with_plugin_daemon_response("POST", f"plugin/{tenant_id}/debugging/key", Response)

        return response.key
