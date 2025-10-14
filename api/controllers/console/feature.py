from flask_restx import Resource, fields

from libs.login import current_account_with_tenant, login_required
from services.feature_service import FeatureService

from . import api, console_ns
from .wraps import account_initialization_required, cloud_utm_record, setup_required


@console_ns.route("/features")
class FeatureApi(Resource):
    @api.doc("get_tenant_features")
    @api.doc(description="Get feature configuration for current tenant")
    @api.response(
        200,
        "Success",
        api.model("FeatureResponse", {"features": fields.Raw(description="Feature configuration object")}),
    )
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_utm_record
    def get(self):
        """Get feature configuration for current tenant"""
        _, current_tenant_id = current_account_with_tenant()

        return FeatureService.get_features(current_tenant_id).model_dump()


@console_ns.route("/system-features")
class SystemFeatureApi(Resource):
    @api.doc("get_system_features")
    @api.doc(description="Get system-wide feature configuration")
    @api.response(
        200,
        "Success",
        api.model("SystemFeatureResponse", {"features": fields.Raw(description="System feature configuration object")}),
    )
    def get(self):
        """Get system-wide feature configuration"""
        return FeatureService.get_system_features().model_dump()
