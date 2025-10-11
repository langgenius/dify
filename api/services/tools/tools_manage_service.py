import logging

from core.tools.entities.api_entities import ToolProviderTypeApiLiteral
from core.tools.tool_manager import ToolManager
from services.tools.tools_transform_service import ToolTransformService

logger = logging.getLogger(__name__)


class ToolCommonService:
    @staticmethod
    def list_tool_providers(user_id: str, tenant_id: str, typ: ToolProviderTypeApiLiteral | None = None):
        """
        list tool providers

        :return: the list of tool providers
        """
        providers = ToolManager.list_providers_from_api(user_id, tenant_id, typ)

        # add icon
        for provider in providers:
            ToolTransformService.repack_provider(tenant_id=tenant_id, provider=provider)

        result = [provider.to_dict() for provider in providers]

        return result
