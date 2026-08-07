from flask_restx import Resource

from controllers.common.schema import register_response_schema_models
from controllers.console.flask_admission import console_account_admission
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.helper import dump_response
from machinery.context import RequestContext
from services.entities.feature_entities import (
    FeatureModel,
    LicenseModel,
    LimitationModel,
    SystemFeatureModel,
    VectorSpaceLimitationModel,
)

from . import console_ns
from .wraps import cloud_utm_record


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
    VectorSpaceLimitationModel,
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
    @console_account_admission()
    @cloud_utm_record
    def get(self, request_context: RequestContext):
        """Get feature configuration for current tenant"""
        payload = application_services().feature_queries.get_features(request_context).model_dump()
        payload.pop("vector_space", None)
        return payload


@console_ns.route("/features/vector-space")
class FeatureVectorSpaceApi(Resource):
    @console_ns.doc("get_tenant_feature_vector_space")
    @console_ns.doc(description="Get vector-space usage and limit for current tenant")
    @console_ns.response(
        200,
        "Success",
        console_ns.models[VectorSpaceLimitationModel.__name__],
    )
    @console_account_admission()
    @cloud_utm_record
    def get(self, request_context: RequestContext):
        """Get vector-space usage and limit for current tenant"""
        return application_services().feature_queries.get_vector_space(request_context).model_dump()


@console_ns.route("/trial-models")
class TrialModelsApi(Resource):
    @console_ns.doc("get_trial_models")
    @console_ns.doc(description="Get hosted trial model provider configuration")
    @console_ns.response(
        200,
        "Success",
        console_ns.models[TrialModelsResponse.__name__],
    )
    @console_account_admission()
    def get(self, _request_context: RequestContext):
        """Get hosted trial model provider configuration for model-provider pages."""
        return dump_response(
            TrialModelsResponse,
            {"trial_models": application_services().feature_queries.get_trial_models()},
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
            {"app_dsl_version": application_services().feature_queries.get_app_dsl_version()},
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

        Authentication configuration must be available before the authentication flow can be selected.
        Authenticated license detail is served separately by SystemFeatureLicenseApi.
        """
        return dump_response(SystemFeatureModel, application_services().feature_queries.get_system_features())


@console_ns.route("/system-features/license")
class SystemFeatureLicenseApi(Resource):
    @console_ns.doc("get_system_license")
    @console_ns.doc(description="Get license status and usage detail")
    @console_ns.response(
        200,
        "Success",
        console_ns.models[LicenseModel.__name__],
    )
    @console_account_admission()
    def get(self, _request_context: RequestContext):
        """Get full license detail (status, expiry, workspace/seat usage).

        Authenticated counterpart to the license *status* exposed on the public
        system-features endpoint.
        """
        return application_services().feature_queries.get_license().model_dump()
