from typing import Any

from core.app.apps.agent_chat.app_config_manager import AgentChatAppConfigManager
from core.app.apps.chat.app_config_manager import ChatAppConfigManager
from core.app.apps.completion.app_config_manager import CompletionAppConfigManager
from models.model import AppMode, AppModelConfigDict


class AppModelConfigService:
    @classmethod
    def validate_configuration(cls, tenant_id: str, config: dict[str, Any], app_mode: AppMode) -> AppModelConfigDict:
        match app_mode:
            case AppMode.CHAT:
                return ChatAppConfigManager.config_validate(tenant_id, config)
            case AppMode.AGENT_CHAT:
                return AgentChatAppConfigManager.config_validate(tenant_id, config)
            case AppMode.COMPLETION:
                return CompletionAppConfigManager.config_validate(tenant_id, config)
            case AppMode.WORKFLOW | AppMode.ADVANCED_CHAT | AppMode.CHANNEL | AppMode.RAG_PIPELINE:
                raise ValueError(f"Invalid app mode: {app_mode}")
