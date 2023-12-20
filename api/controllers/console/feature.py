from flask_restful import Resource
from flask_login import current_user

from . import api
from services.feature_service import FeatureService


class FeatureApi(Resource):

    def get(self):
        return FeatureService.get_features(current_user.current_tenant_id).dict()


api.add_resource(FeatureApi, '/features')
