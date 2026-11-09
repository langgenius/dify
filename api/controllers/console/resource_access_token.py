from __future__ import annotations

from datetime import datetime
from uuid import UUID

from flask_restx import Resource
from pydantic import Field, field_validator

from constants.resource_access_token import ResourceAccessTokenResourceType
from controllers.common.resource_access_token_errors import resource_access_token_errors
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import model_validate
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.helper import dump_response, to_timestamp
from machinery.context import RequestContext
from models.account import TenantAccountRole
from services.auth.resource_access_token_contracts import (
    ResourceAccessTokenResource,
    ResourceAccessTokenRow,
)


class ResourceAccessTokenResourcePayload(ResponseModel):
    type: ResourceAccessTokenResourceType
    id: str


class ResourceAccessTokenCreatePayload(ResponseModel):
    name: str = Field(min_length=1)
    resources: list[ResourceAccessTokenResourcePayload] = Field(min_length=1)


class ResourceAccessTokenUpdatePayload(ResponseModel):
    name: str = Field(min_length=1)
    resources: list[ResourceAccessTokenResourcePayload] = Field(min_length=1)


class ResourceAccessTokenListQuery(ResponseModel):
    page: int = Field(default=1, ge=1)
    limit: int = Field(default=20, ge=1, le=100)
    keyword: str | None = Field(default=None, min_length=1, max_length=100)


class ResourceAccessTokenRowResponse(ResponseModel):
    token_id: str
    relation_id: str
    name: str
    track_id: str
    token: str | None = None
    masked_token: str
    resource_type: ResourceAccessTokenResourceType
    resource_id: str
    resource_name: str
    created_at: int
    last_used_at: int | None = None

    @field_validator("created_at", "last_used_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class ResourceAccessTokenListResponse(ResponseModel):
    data: list[ResourceAccessTokenRowResponse]
    page: int
    limit: int
    total: int
    has_more: bool


class ResourceAccessTokenCreateResponse(ResponseModel):
    token: str
    data: list[ResourceAccessTokenRowResponse]


register_schema_models(
    console_ns,
    ResourceAccessTokenResourcePayload,
    ResourceAccessTokenCreatePayload,
    ResourceAccessTokenUpdatePayload,
    ResourceAccessTokenListQuery,
)
register_response_schema_models(
    console_ns,
    ResourceAccessTokenRowResponse,
    ResourceAccessTokenListResponse,
    ResourceAccessTokenCreateResponse,
)


_OWNER_ROLES = frozenset({TenantAccountRole.OWNER})


def _dump_rows(rows: tuple[ResourceAccessTokenRow, ...]) -> list[dict[str, object]]:
    return [
        dump_response(
            ResourceAccessTokenRowResponse,
            ResourceAccessTokenRowResponse.model_validate(row, from_attributes=True),
        )
        for row in rows
    ]


@console_ns.route("/resource-access-tokens")
class ResourceAccessTokenListApi(Resource):
    @console_ns.doc("list_resource_access_tokens")
    @console_ns.doc(params=query_params_from_model(ResourceAccessTokenListQuery))
    @console_ns.response(200, "Resource access tokens", console_ns.models[ResourceAccessTokenListResponse.__name__])
    @console_account_admission(allowed_roles=_OWNER_ROLES)
    @model_validate(ResourceAccessTokenListQuery)
    def get(
        self,
        query: ResourceAccessTokenListQuery,
        context: RequestContext,
    ) -> dict[str, object]:
        with resource_access_token_errors():
            rows = application_services().resource_access_tokens.list_rows(
                context,
                page=query.page,
                limit=query.limit,
                keyword=query.keyword,
            )
            total = application_services().resource_access_tokens.count_rows(context, keyword=query.keyword)
        return dump_response(
            ResourceAccessTokenListResponse,
            {
                "data": _dump_rows(rows),
                "page": query.page,
                "limit": query.limit,
                "total": total,
                "has_more": query.page * query.limit < total,
            },
        )

    @console_ns.doc("create_resource_access_token")
    @console_ns.expect(console_ns.models[ResourceAccessTokenCreatePayload.__name__])
    @console_ns.response(
        201,
        "Resource access token created",
        console_ns.models[ResourceAccessTokenCreateResponse.__name__],
    )
    @console_account_admission(allowed_roles=_OWNER_ROLES)
    @model_validate(ResourceAccessTokenCreatePayload)
    def post(
        self,
        payload: ResourceAccessTokenCreatePayload,
        context: RequestContext,
    ) -> tuple[dict[str, object], int]:
        with resource_access_token_errors():
            result = application_services().resource_access_tokens.create(
                context,
                name=payload.name,
                resources=tuple(
                    ResourceAccessTokenResource(type=resource.type, id=resource.id) for resource in payload.resources
                ),
            )
        return dump_response(
            ResourceAccessTokenCreateResponse,
            {"token": result.token, "data": _dump_rows(result.rows)},
        ), 201


@console_ns.route("/resource-access-tokens/<uuid:token_id>")
class ResourceAccessTokenApi(Resource):
    @console_ns.doc("update_resource_access_token")
    @console_ns.expect(console_ns.models[ResourceAccessTokenUpdatePayload.__name__])
    @console_ns.response(
        200,
        "Resource access token updated",
        console_ns.models[ResourceAccessTokenListResponse.__name__],
    )
    @console_account_admission(allowed_roles=_OWNER_ROLES)
    @model_validate(ResourceAccessTokenUpdatePayload)
    def patch(
        self,
        payload: ResourceAccessTokenUpdatePayload,
        context: RequestContext,
        token_id: UUID,
    ) -> dict[str, object]:
        with resource_access_token_errors():
            rows = application_services().resource_access_tokens.update(
                context,
                token_id=str(token_id),
                name=payload.name,
                resources=tuple(
                    ResourceAccessTokenResource(type=resource.type, id=resource.id) for resource in payload.resources
                ),
            )
        return dump_response(
            ResourceAccessTokenListResponse,
            {
                "data": _dump_rows(rows),
                "page": 1,
                "limit": len(rows),
                "total": len(rows),
                "has_more": False,
            },
        )


@console_ns.route("/resource-access-tokens/<uuid:token_id>/relations/<uuid:relation_id>")
class ResourceAccessTokenRelationApi(Resource):
    @console_ns.doc("delete_resource_access_token_relation")
    @console_ns.response(204, "Resource access token relation deleted")
    @console_account_admission(allowed_roles=_OWNER_ROLES)
    def delete(
        self,
        context: RequestContext,
        token_id: UUID,
        relation_id: UUID,
    ) -> tuple[str, int]:
        with resource_access_token_errors():
            application_services().resource_access_tokens.delete_relation(
                context,
                token_id=str(token_id),
                relation_id=str(relation_id),
            )
        return "", 204
