import json

from core.moderation.factory import ModerationFactory
from extensions.ext_database import db
from models.model import AppModelConfig, App

class ModerationService:

    def moderation_for_outputs(self, app_id: str, tenant_id: str, text: str) -> dict:

        app_model_config = db.session.query(AppModelConfig) \
            .join(App, App.app_model_config_id == AppModelConfig.id) \
            .filter(App.id == app_id) \
            .filter(App.tenant_id == tenant_id) \
            .first()
        
        if not app_model_config:
            raise ValueError("app model config not found")
        
        name = app_model_config.sensitive_word_avoidance_dict['type']
        config = app_model_config.sensitive_word_avoidance_dict['configs']

        moderation = ModerationFactory(name, tenant_id, config)
        json_str = moderation.moderation_for_outputs(text).json()
        return json.loads(json_str)