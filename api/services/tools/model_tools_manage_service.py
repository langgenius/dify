import logging

from core.model_runtime.utils.encoders import jsonable_encoder
from core.tools.entities.user_entities import UserTool
from core.tools.tool_manager import ToolManager
from services.model_provider_service import ModelProviderService

logger = logging.getLogger(__name__)


class ModelToolManageService:
    @staticmethod
    def get_model_tool_provider_icon(
        provider: str
    ):
        """
            get tool provider icon and it's mimetype
        """
        
        service = ModelProviderService()
        icon_bytes, mime_type = service.get_model_provider_icon(provider=provider, icon_type='icon_small', lang='en_US')

        if icon_bytes is None:
            raise ValueError(f'provider {provider} does not exists')

        return icon_bytes, mime_type
    
    @staticmethod
    def list_model_tool_provider_tools(
        user_id: str, tenant_id: str, provider: str
    ) -> list[UserTool]:
        """
            list model tool provider tools
        """
        provider_controller = ToolManager.get_model_provider(tenant_id=tenant_id, provider_name=provider)
        tools = provider_controller.get_tools(user_id=user_id, tenant_id=tenant_id)

        result = [
            UserTool(
                author=tool.identity.author,
                name=tool.identity.name,
                label=tool.identity.label,
                description=tool.description.human,
                parameters=tool.parameters or []
            ) for tool in tools
        ]

        return jsonable_encoder(result)