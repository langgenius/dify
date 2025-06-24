from core.plugin.entities.parameters import PluginParameterOption


class PluginParameterService:
    @staticmethod
    def get_dynamic_select_options(
        tenant_id: str, plugin_id: str, provider: str, action: str, parameter: str
    ) -> list[PluginParameterOption]:
        """
        Get dynamic select options for a plugin parameter.

        Args:
            tenant_id: The tenant ID.
            plugin_id: The plugin ID.
            provider: The provider name.
            action: The action name.
        """
        return []
