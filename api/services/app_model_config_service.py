from typing import Any

from sqlalchemy.orm import Session

from core.app.apps.agent_chat.app_config_manager import AgentChatAppConfigManager
from core.app.apps.chat.app_config_manager import ChatAppConfigManager
from core.app.apps.completion.app_config_manager import CompletionAppConfigManager
from models.model import AppMode, AppModelConfigDict


class AppModelConfigService:
    @classmethod
    def validate_configuration(
        cls, tenant_id: str, config: dict[str, Any], app_mode: AppMode, session: Session
    ) -> AppModelConfigDict:
        match app_mode:
            case AppMode.CHAT:
                return ChatAppConfigManager.config_validate(tenant_id, config, session)
            case AppMode.AGENT_CHAT:
                return AgentChatAppConfigManager.config_validate(tenant_id, config, session)
            case AppMode.COMPLETION:
                return CompletionAppConfigManager.config_validate(tenant_id, config, session)
            case AppMode.WORKFLOW | AppMode.ADVANCED_CHAT | AppMode.CHANNEL | AppMode.RAG_PIPELINE | AppMode.AGENT:
                # Agent App presentation features go through AgentAppFeatureConfigService,
                # not this legacy EasyUI model-config validator.
                raise ValueError(f"Invalid app mode: {app_mode}")
