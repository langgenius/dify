from flask_restx import Resource

from controllers.common.schema import register_response_schema_models
from fields.base import ResponseModel
from libs.helper import dump_response
from libs.login import login_required
from services.feature_service import (
    FeatureModel,
    FeatureService,
    LicenseModel,
    LimitationModel,
    SystemFeatureModel,
)

from . import console_ns
from .wraps import (
    account_initialization_required,
    cloud_utm_record,
    setup_required,
    with_current_tenant_id,
)


class TrialModelsResponse(ResponseModel):
    trial_models: list[str]


class AppDslVersionResponse(ResponseModel):
    app_dsl_version: str


register_response_schema_models(
    console_ns,
    AppDslVersionResponse,
    FeatureModel,
    LicenseModel,
    LimitationModel,
    SystemFeatureModel,
    TrialModelsResponse,
)


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


@console_ns.route("/trial-models")
class TrialModelsApi(Resource):
    @console_ns.doc("get_trial_models")
    @console_ns.doc(description="Get hosted trial model provider configuration")
    @console_ns.response(
        200,
        "Success",
        console_ns.models[TrialModelsResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        """Get hosted trial model provider configuration for model-provider pages."""
        return dump_response(
            TrialModelsResponse,
            {"trial_models": FeatureService.get_trial_models()},
        )


@console_ns.route("/app-dsl-version")
class AppDslVersionApi(Resource):
    @console_ns.doc("get_app_dsl_version")
    @console_ns.doc(description="Get current app DSL version")
    @console_ns.response(
        200,
        "Success",
        console_ns.models[AppDslVersionResponse.__name__],
    )
    def get(self):
        """Get current app DSL version for workflow clipboard compatibility."""
        return dump_response(
            AppDslVersionResponse,
            {"app_dsl_version": FeatureService.get_app_dsl_version()},
        )


@console_ns.route("/system-features")
class SystemFeatureApi(Resource):
    @console_ns.doc("get_system_features")
    @console_ns.doc(
        description="Get the non-sensitive bootstrap snapshot exposed before Console or Web authentication. "
        "This is not a general feature registry."
    )
    @console_ns.response(
        200,
        "Success",
        console_ns.models[SystemFeatureModel.__name__],
    )
    def get(self):
        """Get the non-sensitive bootstrap snapshot exposed before authentication.

        This endpoint is unauthenticated by design because its data is required to initialize
        authentication flows for Console and Web clients.

        Authentication would create circular dependency (can't login without dashboard loading).

        This is not a general feature registry. Authenticated license detail is served separately
        by SystemFeatureLicenseApi.
        """
        return dump_response(SystemFeatureModel, FeatureService.get_system_features())


@console_ns.route("/system-features/license")
class SystemFeatureLicenseApi(Resource):
    @console_ns.doc("get_system_license")
    @console_ns.doc(description="Get license status and usage detail")
    @console_ns.response(
        200,
        "Success",
        console_ns.models[LicenseModel.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        """Get full license detail (status, expiry, workspace/seat usage).

        Authenticated counterpart to the license *status* exposed on the public
        system-features endpoint.
        """
        return FeatureService.get_license().model_dump()
