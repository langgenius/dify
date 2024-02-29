from core.app.advanced_chat.config_validator import AdvancedChatAppConfigValidator
from core.app.agent_chat.config_validator import AgentChatAppConfigValidator
from core.app.chat.config_validator import ChatAppConfigValidator
from core.app.completion.config_validator import CompletionAppConfigValidator
from core.app.workflow.config_validator import WorkflowAppConfigValidator
from models.model import AppMode


class AppModelConfigService:

    @classmethod
    def validate_configuration(cls, tenant_id: str, config: dict, app_mode: AppMode) -> dict:
        if app_mode == AppMode.CHAT:
            return ChatAppConfigValidator.config_validate(tenant_id, config)
        elif app_mode == AppMode.AGENT_CHAT:
            return AgentChatAppConfigValidator.config_validate(tenant_id, config)
        elif app_mode == AppMode.COMPLETION:
            return CompletionAppConfigValidator.config_validate(tenant_id, config)
        else:
            raise ValueError(f"Invalid app mode: {app_mode}")
