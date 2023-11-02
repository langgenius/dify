import json

from core.moderation.factory import ModerationFactory
from extensions.ext_database import db
from models.model import AppModelConfig, App

class ModerationService:

    def moderation_for_outputs(self, app_id: str, text: str) -> dict:

        app = db.session.query(App).filter(App.id == app_id).first()

        if not app:
            raise ValueError("app not found")
        
        app_model_config = db.session.query(AppModelConfig).filter(AppModelConfig.id == app.app_model_config_id).first()
        
        if not app_model_config:
            raise ValueError("app model config not found")
        
        name = app_model_config.sensitive_word_avoidance_dict['type']
        config = app_model_config.sensitive_word_avoidance_dict['configs']

        moderation = ModerationFactory(name, app.tenant_id, config)
        return moderation.moderation_for_outputs(text).dict()