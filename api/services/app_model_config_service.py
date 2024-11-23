from core.app.apps.agent_chat.app_config_manager import AgentChatAppConfigManager
from core.app.apps.chat.app_config_manager import ChatAppConfigManager
from core.app.apps.completion.app_config_manager import CompletionAppConfigManager
from models.model import AppMode


class AppModelConfigService:
    @classmethod
    def validate_configuration(cls, tenant_id: str, config: dict, app_mode: AppMode) -> dict:
        if app_mode == AppMode.CHAT:
            return ChatAppConfigManager.config_validate(tenant_id, config)
        elif app_mode == AppMode.AGENT_CHAT:
            return AgentChatAppConfigManager.config_validate(tenant_id, config)
        elif app_mode == AppMode.COMPLETION:
            return CompletionAppConfigManager.config_validate(tenant_id, config)
        else:
            raise ValueError(f"Invalid app mode: {app_mode}")
