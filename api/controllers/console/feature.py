from flask_login import current_user
from flask_restful import Resource

from services.enterprise.enterprise_feature_service import EnterpriseFeatureService
from services.feature_service import FeatureService

from . import api
from .wraps import cloud_utm_record


class FeatureApi(Resource):

    @cloud_utm_record
    def get(self):
        return FeatureService.get_features(current_user.current_tenant_id).dict()


class EnterpriseFeatureApi(Resource):
    def get(self):
        return EnterpriseFeatureService.get_enterprise_features().dict()


api.add_resource(FeatureApi, '/features')
api.add_resource(EnterpriseFeatureApi, '/enterprise-features')
