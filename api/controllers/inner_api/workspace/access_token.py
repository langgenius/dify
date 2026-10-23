"""Create and delete workspace resource access tokens for the enterprise control plane.

The enterprise caller holds the master inner API key, so it may create tokens
that no workspace member sees (``managed_by != "user"``) and delete any token by
id. Account-facing token management stays in the console controller.
"""

from __future__ import annotations

from uuid import UUID

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field, ValidationError

from constants.resource_access_token import ResourceAccessTokenManagedBy, ResourceAccessTokenResourceType
from controllers.common.fields import SimpleMessageResponse
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console.wraps import setup_required
from controllers.inner_api import inner_api_ns
from controllers.inner_api.wraps import enterprise_inner_api_only
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.exception import BaseHTTPException
from libs.external_api import error_responses
from services.auth.resource_access_token_contracts import (
    ResourceAccessTokenForbiddenError,
    ResourceAccessTokenInputError,
    ResourceAccessTokenNotFoundError,
    ResourceAccessTokenResource,
)


class InvalidAccessTokenRequestError(BaseHTTPException):
    error_code = "invalid_request"
    description = "The access token request is malformed."
    code = 400


class AccessTokenResourceNotFoundError(BaseHTTPException):
    error_code = "resource_not_found"
    description = "The creator or a resource does not exist in the workspace."
    code = 404


class AccessTokenResourceUnavailableError(BaseHTTPException):
    error_code = "resource_unavailable"
    description = "A resource cannot be bound to this access token."
    code = 403


class EnterpriseAccessTokenResourcePayload(BaseModel):
    type: ResourceAccessTokenResourceType
    id: UUID


class EnterpriseAccessTokenCreatePayload(BaseModel):
    tenant_id: UUID
    managed_by: ResourceAccessTokenManagedBy = Field(
        default=ResourceAccessTokenManagedBy.USER,
        description="`user` tokens appear in the workspace console; other values are hidden from members.",
    )
    name: str = Field(min_length=1, max_length=255)
    created_by: UUID | None = Field(
        default=None,
        description="Workspace member who owns the token. Required for `user` tokens.",
    )
    resources: list[EnterpriseAccessTokenResourcePayload] = Field(min_length=1)


class EnterpriseAccessTokenDeleteQuery(BaseModel):
    tenant_id: UUID


class EnterpriseAccessTokenCreateResponse(ResponseModel):
    id: str
    token: str


register_schema_models(inner_api_ns, EnterpriseAccessTokenResourcePayload, EnterpriseAccessTokenCreatePayload)
register_response_schema_models(inner_api_ns, EnterpriseAccessTokenCreateResponse, SimpleMessageResponse)


@inner_api_ns.route("/enterprise/access-tokens")
class EnterpriseAccessTokenListApi(Resource):
    @setup_required
    @enterprise_inner_api_only
    @error_responses(
        InvalidAccessTokenRequestError,
        AccessTokenResourceNotFoundError,
        AccessTokenResourceUnavailableError,
    )
    @inner_api_ns.doc("enterprise_create_access_token")
    @inner_api_ns.expect(inner_api_ns.models[EnterpriseAccessTokenCreatePayload.__name__])
    @inner_api_ns.response(
        201,
        "Access token created",
        inner_api_ns.models[EnterpriseAccessTokenCreateResponse.__name__],
    )
    def post(self):
        try:
            payload = EnterpriseAccessTokenCreatePayload.model_validate(inner_api_ns.payload or {})
        except ValidationError as exc:
            raise InvalidAccessTokenRequestError(str(exc)) from exc

        try:
            result = application_services().resource_access_tokens.create_for_enterprise(
                tenant_id=str(payload.tenant_id),
                managed_by=payload.managed_by,
                name=payload.name,
                created_by=str(payload.created_by) if payload.created_by else None,
                resources=tuple(
                    ResourceAccessTokenResource(type=resource.type, id=str(resource.id))
                    for resource in payload.resources
                ),
            )
        except ResourceAccessTokenInputError as exc:
            raise InvalidAccessTokenRequestError(str(exc)) from exc
        except ResourceAccessTokenNotFoundError as exc:
            raise AccessTokenResourceNotFoundError(str(exc)) from exc
        except ResourceAccessTokenForbiddenError as exc:
            raise AccessTokenResourceUnavailableError(str(exc)) from exc

        return EnterpriseAccessTokenCreateResponse(id=result.token_id, token=result.token).model_dump(mode="json"), 201


@inner_api_ns.route("/enterprise/access-tokens/<uuid:token_id>")
class EnterpriseAccessTokenApi(Resource):
    @setup_required
    @enterprise_inner_api_only
    @error_responses(InvalidAccessTokenRequestError)
    @inner_api_ns.doc(
        "enterprise_delete_access_token",
        params=query_params_from_model(EnterpriseAccessTokenDeleteQuery),
    )
    @inner_api_ns.response(
        200,
        "Access token deleted, or it did not exist",
        inner_api_ns.models[SimpleMessageResponse.__name__],
    )
    def delete(self, token_id: UUID):
        try:
            query = EnterpriseAccessTokenDeleteQuery.model_validate(request.args.to_dict(flat=True))
        except ValidationError as exc:
            raise InvalidAccessTokenRequestError(str(exc)) from exc

        application_services().resource_access_tokens.delete_for_enterprise(
            tenant_id=str(query.tenant_id), token_id=str(token_id)
        )
        return SimpleMessageResponse(message="access token deleted.").model_dump(mode="json")
