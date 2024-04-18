from flask import current_app
from pydantic import BaseModel

from services.enterprise.enterprise_service import EnterpriseService


class EnterpriseFeatureModel(BaseModel):
    sso_enforced_for_signin: bool = False
    sso_enforced_for_signin_protocol: str = ''


class EnterpriseFeatureService:

    @classmethod
    def get_enterprise_features(cls) -> EnterpriseFeatureModel:
        features = EnterpriseFeatureModel()

        if current_app.config['ENTERPRISE_ENABLED']:
            cls._fulfill_params_from_enterprise(features)

        return features

    @classmethod
    def _fulfill_params_from_enterprise(cls, features):
        enterprise_info = EnterpriseService.get_info()

        features.sso_enforced_for_signin = enterprise_info['sso_enforced_for_signin']
        features.sso_enforced_for_signin_protocol = enterprise_info['sso_enforced_for_signin_protocol']
