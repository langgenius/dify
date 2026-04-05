from core.app.apps.agent_chat.app_config_manager import AgentChatAppConfigManager
from core.app.apps.chat.app_config_manager import ChatAppConfigManager
from core.app.apps.completion.app_config_manager import CompletionAppConfigManager
from models.model import AppMode, AppModelConfigDict


class AppModelConfigService:
    @staticmethod
    def _coerce_app_mode(app_mode: AppMode | str) -> AppMode:
        if isinstance(app_mode, AppMode):
            return app_mode
        if isinstance(app_mode, str):
            try:
                return AppMode.value_of(app_mode)
            except ValueError as exc:
                raise ValueError(f"Invalid app mode: {app_mode}") from exc
        raise ValueError(f"Invalid app mode: {app_mode}")

    @classmethod
    def validate_configuration(cls, tenant_id: str, config: dict, app_mode: AppMode | str) -> AppModelConfigDict:
        app_mode = cls._coerce_app_mode(app_mode)

        match app_mode:
            case AppMode.CHAT:
                return ChatAppConfigManager.config_validate(tenant_id, config)
            case AppMode.AGENT_CHAT:
                return AgentChatAppConfigManager.config_validate(tenant_id, config)
            case AppMode.COMPLETION:
                return CompletionAppConfigManager.config_validate(tenant_id, config)
            case _:
                raise ValueError(f"Invalid app mode: {app_mode}")
