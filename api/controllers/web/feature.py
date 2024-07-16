from flask_restful import Resource

from controllers.web import api
from services.feature_service import FeatureService


class SystemFeatureApi(Resource):
    def get(self):
        return FeatureService.get_system_features().model_dump()


api.add_resource(SystemFeatureApi, '/system-features')
