from __future__ import annotations

from datetime import datetime
from uuid import UUID

from flask_restx import Resource
from pydantic import Field, field_validator
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden

from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.common.session import with_session
from controllers.console import console_ns
from controllers.console.wraps import (
    account_initialization_required,
    model_validate,
    setup_required,
    with_current_tenant_id,
    with_current_user,
)
from fields.base import ResponseModel
from libs.helper import dump_response, to_timestamp
from libs.login import login_required
from models import Account
from models.account import TenantAccountRole
from models.resource_access_token import ResourceAccessTokenResourceType
from services.resource_access_token_service import (
    ResourceAccessTokenResource,
    ResourceAccessTokenRow,
    ResourceAccessTokenService,
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


def _require_owner(current_user: Account) -> None:
    if current_user.current_role != TenantAccountRole.OWNER:
        raise Forbidden()


def _dump_rows(rows: list[ResourceAccessTokenRow]) -> list[dict[str, object]]:
    return [
        dump_response(
            ResourceAccessTokenRowResponse,
            ResourceAccessTokenRowResponse.model_validate(row, from_attributes=True),
        )
        for row in rows
    ]


@console_ns.route("/resource-access-tokens")
class ResourceAccessTokenListApi(Resource):
    method_decorators = [account_initialization_required, login_required, setup_required]

    @console_ns.doc("list_resource_access_tokens")
    @console_ns.doc(params=query_params_from_model(ResourceAccessTokenListQuery))
    @console_ns.response(200, "Resource access tokens", console_ns.models[ResourceAccessTokenListResponse.__name__])
    @model_validate(ResourceAccessTokenListQuery)
    @with_current_user
    @with_current_tenant_id
    @with_session(write=False)
    def get(
        self,
        session: Session,
        current_tenant_id: str,
        current_user: Account,
        query: ResourceAccessTokenListQuery,
    ) -> dict[str, object]:
        _require_owner(current_user)
        rows = ResourceAccessTokenService.list_rows(
            tenant_id=current_tenant_id,
            page=query.page,
            limit=query.limit,
            session=session,
        )
        total = ResourceAccessTokenService.count_rows(tenant_id=current_tenant_id, session=session)
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
    @model_validate(ResourceAccessTokenCreatePayload)
    @with_current_user
    @with_current_tenant_id
    @with_session
    def post(
        self,
        session: Session,
        current_tenant_id: str,
        current_user: Account,
        payload: ResourceAccessTokenCreatePayload,
    ) -> tuple[dict[str, object], int]:
        _require_owner(current_user)
        result = ResourceAccessTokenService.create(
            tenant_id=current_tenant_id,
            created_by=current_user.id,
            name=payload.name,
            resources=[
                ResourceAccessTokenResource(type=resource.type, id=resource.id) for resource in payload.resources
            ],
            session=session,
        )
        return dump_response(
            ResourceAccessTokenCreateResponse,
            {"token": result.token, "data": _dump_rows(result.rows)},
        ), 201


@console_ns.route("/resource-access-tokens/<uuid:token_id>")
class ResourceAccessTokenApi(Resource):
    method_decorators = [account_initialization_required, login_required, setup_required]

    @console_ns.doc("update_resource_access_token")
    @console_ns.expect(console_ns.models[ResourceAccessTokenUpdatePayload.__name__])
    @console_ns.response(
        200,
        "Resource access token updated",
        console_ns.models[ResourceAccessTokenListResponse.__name__],
    )
    @model_validate(ResourceAccessTokenUpdatePayload)
    @with_current_user
    @with_current_tenant_id
    @with_session
    def patch(
        self,
        session: Session,
        current_tenant_id: str,
        current_user: Account,
        payload: ResourceAccessTokenUpdatePayload,
        token_id: UUID,
    ) -> dict[str, object]:
        _require_owner(current_user)
        rows = ResourceAccessTokenService.update(
            tenant_id=current_tenant_id,
            token_id=str(token_id),
            name=payload.name,
            resources=[
                ResourceAccessTokenResource(type=resource.type, id=resource.id) for resource in payload.resources
            ],
            session=session,
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
    method_decorators = [account_initialization_required, login_required, setup_required]

    @console_ns.doc("delete_resource_access_token_relation")
    @console_ns.response(204, "Resource access token relation deleted")
    @with_current_user
    @with_current_tenant_id
    @with_session
    def delete(
        self,
        session: Session,
        current_tenant_id: str,
        current_user: Account,
        token_id: UUID,
        relation_id: UUID,
    ) -> tuple[str, int]:
        _require_owner(current_user)
        ResourceAccessTokenService.delete_relation(
            tenant_id=current_tenant_id,
            token_id=str(token_id),
            relation_id=str(relation_id),
            session=session,
        )
        return "", 204
