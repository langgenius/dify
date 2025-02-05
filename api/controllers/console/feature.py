from flask_login import current_user  # type: ignore
from flask_restful import Resource  # type: ignore

from libs.login import login_required
from services.feature_service import FeatureService

from . import api
from .wraps import account_initialization_required, cloud_utm_record, setup_required


class FeatureApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_utm_record
    def get(self):
        return FeatureService.get_features(current_user.current_tenant_id).model_dump()


class SystemFeatureApi(Resource):
    def get(self):
        return FeatureService.get_system_features().model_dump()


api.add_resource(FeatureApi, "/features")
api.add_resource(SystemFeatureApi, "/system-features")
