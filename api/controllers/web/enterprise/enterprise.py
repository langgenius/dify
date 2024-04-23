from flask_restful import Resource

from controllers.web import api
from services.enterprise.enterprise_feature_service import EnterpriseFeatureService


class EnterpriseFeature(Resource):

    def get(self):
        return EnterpriseFeatureService.get_enterprise_features().dict()


api.add_resource(EnterpriseFeature, '/enterprise-features')
