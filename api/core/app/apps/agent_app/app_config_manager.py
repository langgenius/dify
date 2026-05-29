"""Build the EasyUI-style app config for an Agent App from its Agent Soul.

An Agent App has no legacy ``app_model_config``: its model / prompt live in the
bound Agent Soul snapshot. To ride the existing chat message + SSE pipeline we
synthesize an ``app_model_config``-shaped dict from the Soul (model + system
prompt) plus any app-level feature flags (opening statement, follow-up, …)
stored on ``app_model_config`` when present, then reuse the same sub-managers
the chat app type uses.
"""

from typing import Any

from core.app.app_config.base_app_config_manager import BaseAppConfigManager
from core.app.app_config.common.sensitive_word_avoidance.manager import SensitiveWordAvoidanceConfigManager
from core.app.app_config.easy_ui_based_app.dataset.manager import DatasetConfigManager
from core.app.app_config.easy_ui_based_app.model_config.manager import ModelConfigManager
from core.app.app_config.easy_ui_based_app.prompt_template.manager import PromptTemplateConfigManager
from core.app.app_config.easy_ui_based_app.variables.manager import BasicVariablesConfigManager
from core.app.app_config.entities import EasyUIBasedAppConfig, EasyUIBasedAppModelConfigFrom
from models.agent_config_entities import AgentSoulConfig
from models.model import App, AppMode, AppModelConfig, Conversation


class AgentAppConfig(EasyUIBasedAppConfig):
    """Agent App config entity (EasyUI-shaped so it rides the chat pipeline)."""

    pass


class AgentAppConfigManager(BaseAppConfigManager):
    @classmethod
    def get_app_config(
        cls,
        *,
        app_model: App,
        agent_soul: AgentSoulConfig,
        app_model_config: AppModelConfig | None = None,
        conversation: Conversation | None = None,
    ) -> AgentAppConfig:
        """Build the Agent App config from the Agent Soul (+ optional feature flags)."""
        config_dict = cls._synthesize_config_dict(agent_soul, app_model_config)
        app_mode = AppMode.value_of(app_model.mode)

        app_config = AgentAppConfig(
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            app_mode=app_mode,
            # The config is derived from the Agent Soul snapshot, not a legacy
            # app_model_config row; the id is informational only.
            app_model_config_from=EasyUIBasedAppModelConfigFrom.APP_LATEST_CONFIG,
            app_model_config_id=app_model_config.id if app_model_config else "",
            app_model_config_dict=config_dict,
            model=ModelConfigManager.convert(config=config_dict),
            prompt_template=PromptTemplateConfigManager.convert(config=config_dict),
            sensitive_word_avoidance=SensitiveWordAvoidanceConfigManager.convert(config=config_dict),
            dataset=DatasetConfigManager.convert(config=config_dict),
            additional_features=cls.convert_features(config_dict, app_mode),
        )
        app_config.variables, app_config.external_data_variables = BasicVariablesConfigManager.convert(
            config=config_dict
        )
        return app_config

    @staticmethod
    def _synthesize_config_dict(
        agent_soul: AgentSoulConfig,
        app_model_config: AppModelConfig | None,
    ) -> dict[str, Any]:
        """Shape a Soul + feature flags into an ``app_model_config``-style dict.

        Feature flags (opening statement / follow-up / tts / stt / citations /
        moderation / annotation) come from ``app_model_config`` when present
        (Q3: stored there), otherwise defaults; model + prompt always come from
        the Agent Soul (the single source of truth for those).
        """
        base: dict[str, Any] = app_model_config.to_dict() if app_model_config else {}

        model = agent_soul.model
        if model is not None:
            base["model"] = {
                "provider": model.model_provider,
                "name": model.model,
                "mode": "chat",
                "completion_params": dict(model.model_settings or {}),
            }
        base["pre_prompt"] = agent_soul.prompt.system_prompt or ""
        # Agent App takes the user message directly; no completion-style inputs form.
        base.setdefault("user_input_form", [])
        return base


__all__ = ["AgentAppConfig", "AgentAppConfigManager"]
