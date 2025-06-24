from collections.abc import Sequence
from typing import Literal

from core.plugin.entities.parameters import PluginParameterOption
from core.plugin.impl.dynamic_select import DynamicSelectClient


class PluginParameterService:
    @staticmethod
    def get_dynamic_select_options(
        tenant_id: str,
        user_id: str,
        plugin_id: str,
        provider: str,
        action: str,
        parameter: str,
        provider_type: Literal["tool"],
    ) -> Sequence[PluginParameterOption]:
        """
        Get dynamic select options for a plugin parameter.

        Args:
            tenant_id: The tenant ID.
            plugin_id: The plugin ID.
            provider: The provider name.
            action: The action name.
            parameter: The parameter name.
        """
        # TODO: get credentials from db
        credentials = {}

        return DynamicSelectClient().fetch_dynamic_select_options(
            tenant_id, user_id, plugin_id, provider, action, credentials, parameter
        )
