from typing import Optional

from core.moderation.factory import ModerationFactory, ModerationOutputsResult
from extensions.ext_database import db
from models.model import App, AppModelConfig


class ModerationService:
    def moderation_for_outputs(self, app_id: str, app_model: App, text: str) -> ModerationOutputsResult:
        app_model_config: Optional[AppModelConfig] = None

        app_model_config = (
            db.session.query(AppModelConfig).filter(AppModelConfig.id == app_model.app_model_config_id).first()
        )

        if not app_model_config:
            raise ValueError("app model config not found")

        name = app_model_config.sensitive_word_avoidance_dict["type"]
        config = app_model_config.sensitive_word_avoidance_dict["config"]

        moderation = ModerationFactory(name, app_id, app_model.tenant_id, config)
        return moderation.moderation_for_outputs(text)
