"""Build the EasyUI-style app config for an Agent App from its Agent Soul.

An Agent App has no legacy ``app_model_config``: its model / prompt live in the
bound Agent Soul snapshot. To ride the existing chat message + SSE pipeline we
synthesize an ``app_model_config``-shaped dict from the Soul (model + system
prompt) plus any app-level feature flags (opening statement, follow-up, …)
stored on ``app_model_config`` when present, then reuse the same sub-managers
the chat app type uses.
"""

from typing import Any, cast

from core.app.app_config.base_app_config_manager import BaseAppConfigManager
from core.app.app_config.common.sensitive_word_avoidance.manager import SensitiveWordAvoidanceConfigManager
from core.app.app_config.easy_ui_based_app.dataset.manager import DatasetConfigManager
from core.app.app_config.easy_ui_based_app.model_config.manager import ModelConfigManager
from core.app.app_config.easy_ui_based_app.prompt_template.manager import PromptTemplateConfigManager
from core.app.app_config.easy_ui_based_app.variables.manager import BasicVariablesConfigManager
from core.app.app_config.entities import (
    EasyUIBasedAppConfig,
    EasyUIBasedAppModelConfigFrom,
    PromptTemplateEntity,
)
from models.agent_config_entities import AgentSoulConfig
from models.model import App, AppMode, AppModelConfig, AppModelConfigDict, Conversation


class AgentAppConfig(EasyUIBasedAppConfig):
    """Agent App config entity (EasyUI-shaped so it rides the chat pipeline).

    ``app_model_config_id`` is inherited as ``str | None``: an Agent App may have
    no legacy ``app_model_config`` row, in which case persistence stores ``NULL``
    for the conversation's ``app_model_config_id``.
    """


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
        # The synthesized dict is shaped like an app_model_config; the EasyUI
        # sub-managers type their param as AppModelConfigDict (a TypedDict).
        typed_config = cast(AppModelConfigDict, config_dict)
        app_mode = AppMode.value_of(app_model.mode)

        app_config = AgentAppConfig(
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            app_mode=app_mode,
            # The config is derived from the Agent Soul snapshot, not a legacy
            # app_model_config row; the id is informational only.
            app_model_config_from=EasyUIBasedAppModelConfigFrom.APP_LATEST_CONFIG,
            app_model_config_id=app_model_config.id if app_model_config else None,
            app_model_config_dict=config_dict,
            model=ModelConfigManager.convert(config=typed_config),
            prompt_template=PromptTemplateConfigManager.convert(config=typed_config),
            sensitive_word_avoidance=SensitiveWordAvoidanceConfigManager.convert(config=config_dict),
            dataset=DatasetConfigManager.convert(config=typed_config),
            additional_features=cls.convert_features(config_dict, app_mode),
        )
        app_config.variables, app_config.external_data_variables = BasicVariablesConfigManager.convert(
            config=typed_config
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
        base: dict[str, Any] = dict(app_model_config.to_dict()) if app_model_config else {}

        model = agent_soul.model
        if model is not None:
            base["model"] = {
                "provider": model.model_provider,
                "name": model.model,
                "mode": "chat",
                "completion_params": model.model_settings.model_dump(mode="json", exclude_none=True),
            }
        # The Agent Soul system prompt rides the EasyUI "simple" prompt slot; the
        # agent backend is the real prompt authority, this only feeds the chat
        # pipeline's bookkeeping (token counting, persistence).
        base["prompt_type"] = PromptTemplateEntity.PromptType.SIMPLE.value
        base["pre_prompt"] = agent_soul.prompt.system_prompt or ""
        # Agent App takes the user message directly; no completion-style inputs form.
        base.setdefault("user_input_form", [])
        return base


__all__ = ["AgentAppConfig", "AgentAppConfigManager"]
