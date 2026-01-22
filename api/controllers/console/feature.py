from flask_restx import Resource, fields

from libs.login import current_account_with_tenant, login_required
from services.feature_service import FeatureService

from . import console_ns
from .wraps import account_initialization_required, cloud_utm_record, setup_required


@console_ns.route("/features")
class FeatureApi(Resource):
    @console_ns.doc("get_tenant_features")
    @console_ns.doc(description="Get feature configuration for current tenant")
    @console_ns.response(
        200,
        "Success",
        console_ns.model("FeatureResponse", {"features": fields.Raw(description="Feature configuration object")}),
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
    @console_ns.doc("get_system_features")
    @console_ns.doc(description="Get system-wide feature configuration")
    @console_ns.response(
        200,
        "Success",
        console_ns.model(
            "SystemFeatureResponse", {"features": fields.Raw(description="System feature configuration object")}
        ),
    )
    def get(self):
        """Get system-wide feature configuration

        NOTE: This endpoint is unauthenticated by design, as it provides system features
        data required for dashboard initialization.

        Authentication would create circular dependency (can't login without dashboard loading).

        Only non-sensitive configuration data should be returned by this endpoint.
        """
        return FeatureService.get_system_features().model_dump()
