from flask_login import current_user
from flask_restful import Resource

from services.feature_service import FeatureService

from . import api
from .wraps import cloud_utm_record


class FeatureApi(Resource):

    @cloud_utm_record
    def get(self):
        return FeatureService.get_features(current_user.current_tenant_id).dict()


api.add_resource(FeatureApi, '/features')
