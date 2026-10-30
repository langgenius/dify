"""Authenticated Console Workspace policy and actor/App availability APIs."""

from flask import request
from flask_restx import Resource
from pydantic import ValidationError
from werkzeug.exceptions import BadRequest, Forbidden, NotFound

from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.flask_admission import console_account_admission
from core.dify_builder.models import Actor
from extensions.application_services.dify_builder_cognition_policy import (
    build_cognition_policy_service,
    policy_projection,
)
from libs.exception import BaseHTTPException
from libs.external_api import error_responses
from libs.helper import dump_response
from machinery.context import RequestContext
from services.dify_builder.application.cognition_policy import CognitionPolicyDeniedError
from services.dify_builder.service import AppAccess
from services.dify_builder.wiring import _authorize_app

from .dify_builder_policy_fields import (
    DifyBuilderAvailabilityResponse,
    DifyBuilderPolicyPayload,
    DifyBuilderPolicyResponse,
)


class BuilderPolicyConflictError(BaseHTTPException):
    error_code = "builder_policy_conflict"
    code = 409
    description = "Workspace Builder policy changed; reload before saving."


register_schema_models(console_ns, DifyBuilderPolicyPayload)
register_response_schema_models(console_ns, DifyBuilderPolicyResponse, DifyBuilderAvailabilityResponse)


def _actor(context: RequestContext) -> Actor:
    return Actor(tenant_id=context.active_workspace_id, account_id=context.account_id)


def _raise_policy_error(error: CognitionPolicyDeniedError):
    if error.reason == "policy_revision_conflict":
        raise BuilderPolicyConflictError() from error
    raise Forbidden("Workspace administrator permission is required.") from error


@console_ns.route("/workspaces/current/dify-builder/policy")
class DifyBuilderPolicyApi(Resource):
    @console_ns.response(200, "Success", console_ns.models[DifyBuilderPolicyResponse.__name__])
    @console_account_admission()
    def get(self, context: RequestContext):
        actor = _actor(context)
        service = build_cognition_policy_service()
        try:
            result = policy_projection(service.availability(actor, admin=True))
        except CognitionPolicyDeniedError as error:
            _raise_policy_error(error)
        return dump_response(DifyBuilderPolicyResponse, result), 200

    @error_responses(BuilderPolicyConflictError)
    @console_ns.expect(console_ns.models[DifyBuilderPolicyPayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[DifyBuilderPolicyResponse.__name__])
    @console_account_admission()
    def put(self, context: RequestContext):
        actor = _actor(context)
        try:
            payload = DifyBuilderPolicyPayload.model_validate(request.get_json(silent=True))
            service = build_cognition_policy_service()
            result = policy_projection(
                service.put_status(actor, payload.policy(), expected_revision=payload.expected_revision)
            )
        except (ValidationError, ValueError) as error:
            raise BadRequest("Invalid Workspace Builder policy.") from error
        except CognitionPolicyDeniedError as error:
            _raise_policy_error(error)
        return dump_response(DifyBuilderPolicyResponse, result), 200


@console_ns.route("/apps/<uuid:app_id>/dify-builder/availability")
class DifyBuilderAvailabilityApi(Resource):
    @console_ns.response(200, "Success", console_ns.models[DifyBuilderAvailabilityResponse.__name__])
    @console_account_admission()
    def get(self, context: RequestContext, app_id):
        actor = _actor(context)
        from core.dify_builder.errors import NotFoundError

        try:
            _authorize_app(actor, str(app_id), AppAccess.EDIT)
            result = policy_projection(build_cognition_policy_service().availability(actor))
        except NotFoundError as error:
            raise NotFound() from error
        except CognitionPolicyDeniedError as error:
            _raise_policy_error(error)
        return dump_response(DifyBuilderAvailabilityResponse, result), 200
