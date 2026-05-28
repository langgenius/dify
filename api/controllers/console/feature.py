from flask_restx import Resource
from werkzeug.exceptions import Unauthorized

from controllers.common.schema import register_response_schema_models
from libs.login import current_user, login_required
from services.feature_service import FeatureModel, FeatureService, LimitationModel, SystemFeatureModel

from . import console_ns
from .wraps import account_initialization_required, cloud_utm_record, setup_required, with_current_tenant_id

register_response_schema_models(console_ns, FeatureModel, LimitationModel, SystemFeatureModel)


@console_ns.route("/features")
class FeatureApi(Resource):
    @console_ns.doc("get_tenant_features")
    @console_ns.doc(description="Get feature configuration for current tenant")
    @console_ns.response(
        200,
        "Success",
        console_ns.models[FeatureModel.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_utm_record
    @with_current_tenant_id
    def get(self, current_tenant_id: str):
        """Get feature configuration for current tenant"""
        payload = FeatureService.get_features(
            current_tenant_id,
            exclude_vector_space=True,
        ).model_dump()
        payload.pop("vector_space", None)
        return payload


@console_ns.route("/features/vector-space")
class FeatureVectorSpaceApi(Resource):
    @console_ns.doc("get_tenant_feature_vector_space")
    @console_ns.doc(description="Get vector-space usage and limit for current tenant")
    @console_ns.response(
        200,
        "Success",
        console_ns.models[LimitationModel.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_utm_record
    @with_current_tenant_id
    def get(self, current_tenant_id: str):
        """Get vector-space usage and limit for current tenant"""
        return FeatureService.get_vector_space(current_tenant_id).model_dump()


@console_ns.route("/system-features")
class SystemFeatureApi(Resource):
    @console_ns.doc("get_system_features")
    @console_ns.doc(description="Get system-wide feature configuration")
    @console_ns.response(
        200,
        "Success",
        console_ns.models[SystemFeatureModel.__name__],
    )
    def get(self):
        """Get system-wide feature configuration

        NOTE: This endpoint is unauthenticated by design, as it provides system features
        data required for dashboard initialization.

        Authentication would create circular dependency (can't login without dashboard loading).

        Only non-sensitive configuration data should be returned by this endpoint.
        """
        # NOTE(QuantumGhost): ideally we should access `current_user.is_authenticated`
        # without a try-catch. However, due to the implementation of user loader (the `load_user_from_request`
        # in api/extensions/ext_login.py), accessing `current_user.is_authenticated` will
        # raise `Unauthorized` exception if authentication token is not provided.
        try:
            is_authenticated = current_user.is_authenticated
        except Unauthorized:
            is_authenticated = False
        return FeatureService.get_system_features(is_authenticated=is_authenticated).model_dump()
