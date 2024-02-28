from core.apps.app_config_validators.advanced_chat_app import AdvancedChatAppConfigValidator
from core.apps.app_config_validators.agent_chat_app import AgentChatAppConfigValidator
from core.apps.app_config_validators.chat_app import ChatAppConfigValidator
from core.apps.app_config_validators.completion_app import CompletionAppConfigValidator
from core.apps.app_config_validators.workflow_app import WorkflowAppConfigValidator
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

    @classmethod
    def validate_features(cls, tenant_id: str, config: dict, app_mode: AppMode) -> dict:
        if app_mode == AppMode.ADVANCED_CHAT:
            return AdvancedChatAppConfigValidator.config_validate(tenant_id, config)
        elif app_mode == AppMode.WORKFLOW:
            return WorkflowAppConfigValidator.config_validate(tenant_id, config)
        else:
            raise ValueError(f"Invalid app mode: {app_mode}")
