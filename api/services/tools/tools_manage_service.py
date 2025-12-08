import logging

from core.helper.tool_provider_cache import ToolProviderListCache
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
        # Try to get from cache first
        cached_result = ToolProviderListCache.get_cached_providers(tenant_id, typ)
        if cached_result is not None:
            logger.debug("Returning cached tool providers for tenant %s, type %s", tenant_id, typ)
            return cached_result

        # Cache miss - fetch from database
        logger.debug("Cache miss for tool providers, fetching from database for tenant %s, type %s", tenant_id, typ)
        providers = ToolManager.list_providers_from_api(user_id, tenant_id, typ)

        # add icon
        for provider in providers:
            ToolTransformService.repack_provider(tenant_id=tenant_id, provider=provider)

        result = [provider.to_dict() for provider in providers]

        # Cache the result
        ToolProviderListCache.set_cached_providers(tenant_id, typ, result)

        return result
