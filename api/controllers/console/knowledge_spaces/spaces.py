"""Console BFF for listing and creating Dataset 2.0 knowledge spaces."""

from __future__ import annotations

import logging
from datetime import datetime
from http import HTTPStatus
from typing import NoReturn

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from werkzeug.exceptions import (
    BadGateway,
    Forbidden,
    GatewayTimeout,
    ServiceUnavailable,
    abort,
)

from clients.knowledge_fs.generated.models import KnowledgeSpace, KnowledgeSpaceCreationResponse
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.wraps import (
    RBACPermission,
    RBACResourceScope,
    account_initialization_required,
    cloud_edition_billing_rate_limit_check,
    rbac_permission_required,
    setup_required,
)
from fields.base import ResponseModel
from libs.helper import dump_response
from libs.login import current_account_with_tenant, login_required
from services.knowledge_space_service import (
    KnowledgeFSConfigurationError,
    KnowledgeFSTimeoutError,
    KnowledgeFSUpstreamError,
    KnowledgeSpaceService,
    create_knowledge_space_service,
)

logger = logging.getLogger(__name__)


class KnowledgeSpaceListQuery(BaseModel):
    """Cursor pagination accepted by the Dify Console boundary."""

    limit: int = Field(default=30, ge=1, le=100)
    cursor: str | None = Field(default=None, min_length=1, max_length=1024)

    model_config = ConfigDict(extra="forbid")


class CreateKnowledgeSpacePayload(BaseModel):
    """Dify-facing payload for creating an empty Dataset 2.0 knowledge base."""

    idempotency_key: str = Field(min_length=1, max_length=255)
    name: str = Field(min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=2000)

    model_config = ConfigDict(extra="forbid")


class KnowledgeSpaceResponse(ResponseModel):
    """Stable Dify-facing representation of a KnowledgeFS space."""

    id: str
    name: str
    slug: str
    description: str | None
    created_at: datetime = Field(validation_alias="createdAt")
    updated_at: datetime = Field(validation_alias="updatedAt")


class KnowledgeSpaceListResponse(ResponseModel):
    """Feature availability and one real cursor page."""

    enabled: bool
    data: list[KnowledgeSpaceResponse] = Field(validation_alias="items")
    next_cursor: str | None = Field(validation_alias="nextCursor")


register_schema_models(console_ns, KnowledgeSpaceListQuery, CreateKnowledgeSpacePayload)
register_response_schema_models(console_ns, KnowledgeSpaceResponse, KnowledgeSpaceListResponse)


def _space_response_source(space: KnowledgeSpace | KnowledgeSpaceCreationResponse) -> dict[str, object]:
    return {
        "id": space.id,
        "name": space.name,
        "slug": space.slug,
        "description": space.description if isinstance(space.description, str) else None,
        "createdAt": space.created_at,
        "updatedAt": space.updated_at,
    }


def _optional_service() -> KnowledgeSpaceService | None:
    try:
        return create_knowledge_space_service()
    except KnowledgeFSConfigurationError as exc:
        logger.exception("KnowledgeFS integration is partially configured")
        raise ServiceUnavailable("KnowledgeFS integration is misconfigured") from exc


def _service_or_unavailable() -> KnowledgeSpaceService:
    service = _optional_service()
    if service is None:
        raise ServiceUnavailable("KnowledgeFS integration is not enabled")
    return service


def _translate_knowledge_fs_error(exc: Exception) -> NoReturn:
    if isinstance(exc, KnowledgeFSConfigurationError):
        logger.error("KnowledgeFS request was blocked by invalid tenant configuration")
        raise ServiceUnavailable("KnowledgeFS integration is misconfigured") from exc
    if isinstance(exc, KnowledgeFSTimeoutError):
        raise GatewayTimeout("KnowledgeFS request timed out") from exc
    if isinstance(exc, ValidationError):
        logger.warning("KnowledgeFS returned an invalid success response")
        raise BadGateway("KnowledgeFS returned an invalid response") from exc
    if isinstance(exc, KnowledgeFSUpstreamError):
        if exc.status_code in {400, 409, 422, 429, 503}:
            abort(exc.status_code, description="KnowledgeFS request failed")
        logger.warning("KnowledgeFS request failed: %s", exc)
        raise BadGateway("KnowledgeFS is unavailable") from exc
    raise exc


@console_ns.route("/knowledge-spaces")
class KnowledgeSpaceListApi(Resource):
    @console_ns.doc("list_knowledge_spaces")
    @console_ns.doc(description="List Dataset 2.0 knowledge bases from KnowledgeFS")
    @console_ns.doc(params=query_params_from_model(KnowledgeSpaceListQuery))
    @console_ns.response(200, "Success", console_ns.models[KnowledgeSpaceListResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(
        RBACResourceScope.DATASET,
        RBACPermission.DATASET_READONLY,
        resource_required=False,
    )
    def get(self):
        service = _optional_service()
        if service is None:
            return dump_response(
                KnowledgeSpaceListResponse,
                {"enabled": False, "data": [], "next_cursor": None},
            )

        query = KnowledgeSpaceListQuery.model_validate(request.args.to_dict(flat=True))
        _, tenant_id = current_account_with_tenant()
        try:
            result = service.list_knowledge_spaces(
                limit=query.limit,
                cursor=query.cursor,
                tenant_id=tenant_id,
            )
            return dump_response(
                KnowledgeSpaceListResponse,
                {
                    "enabled": True,
                    "items": [_space_response_source(space) for space in result.items],
                    "nextCursor": result.next_cursor if isinstance(result.next_cursor, str) else None,
                },
            )
        except Exception as exc:
            _translate_knowledge_fs_error(exc)

    @console_ns.doc("create_knowledge_space")
    @console_ns.doc(description="Create an empty Dataset 2.0 knowledge base in KnowledgeFS")
    @console_ns.expect(console_ns.models[CreateKnowledgeSpacePayload.__name__])
    @console_ns.response(
        HTTPStatus.CREATED,
        "Knowledge base created",
        console_ns.models[KnowledgeSpaceResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(
        RBACResourceScope.DATASET,
        RBACPermission.DATASET_CREATE_AND_MANAGEMENT,
        resource_required=False,
    )
    @cloud_edition_billing_rate_limit_check("knowledge")
    def post(self):
        service = _service_or_unavailable()
        current_user, tenant_id = current_account_with_tenant()
        if not current_user.is_dataset_editor:
            raise Forbidden()
        payload = CreateKnowledgeSpacePayload.model_validate(console_ns.payload or {})
        try:
            space = service.create_knowledge_space(
                idempotency_key=payload.idempotency_key,
                name=payload.name,
                description=payload.description,
                tenant_id=tenant_id,
            )
            return dump_response(KnowledgeSpaceResponse, _space_response_source(space)), HTTPStatus.CREATED
        except Exception as exc:
            _translate_knowledge_fs_error(exc)
