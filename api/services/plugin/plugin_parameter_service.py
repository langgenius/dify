from collections.abc import Mapping, Sequence
from typing import Any, Literal

from sqlalchemy.orm import Session

from core.plugin.entities.parameters import PluginParameterOption
from core.plugin.impl.dynamic_select import DynamicSelectClient
from core.tools.tool_manager import ToolManager
from core.tools.utils.configuration import ProviderConfigEncrypter
from extensions.ext_database import db
from models.tools import BuiltinToolProvider


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
        credentials: Mapping[str, Any] = {}

        match provider_type:
            case "tool":
                provider_controller = ToolManager.get_builtin_provider(provider, tenant_id)
                # init tool configuration
                tool_configuration = ProviderConfigEncrypter(
                    tenant_id=tenant_id,
                    config=[x.to_basic_provider_config() for x in provider_controller.get_credentials_schema()],
                    provider_type=provider_controller.provider_type.value,
                    provider_identity=provider_controller.entity.identity.name,
                )

                # check if credentials are required
                if not provider_controller.need_credentials:
                    credentials = {}
                else:
                    # fetch credentials from db
                    with Session(db.engine) as session:
                        db_record = (
                            session.query(BuiltinToolProvider)
                            .filter(
                                BuiltinToolProvider.tenant_id == tenant_id,
                                BuiltinToolProvider.provider == provider,
                            )
                            .first()
                        )

                    if db_record is None:
                        raise ValueError(f"Builtin provider {provider} not found when fetching credentials")

                    credentials = tool_configuration.decrypt(db_record.credentials)
            case _:
                raise ValueError(f"Invalid provider type: {provider_type}")

        return (
            DynamicSelectClient()
            .fetch_dynamic_select_options(tenant_id, user_id, plugin_id, provider, action, credentials, parameter)
            .options
        )
