from __future__ import annotations

from datetime import datetime
from typing import Any, Never
from uuid import UUID

from flask_restx import Resource
from pydantic import AliasChoices, BaseModel, Field, field_validator
from werkzeug.exceptions import Forbidden, InternalServerError, NotFound

from controllers.common.fields import UsageCountResponse
from controllers.common.rbac import DatasetId, RBACCheck, Workspace
from controllers.common.schema import (
    query_params_from_model,
    register_response_schema_models,
    register_schema_models,
)
from controllers.console import console_ns
from controllers.console.datasets.error import DatasetNameDuplicateError
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import (
    RBACPermission,
    model_validate,
)
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from fields.dataset_fields import (
    DatasetDetailResponse,
)
from libs.helper import dump_response
from machinery.context import RequestContext
from models.account import TenantAccountRole
from services.entities.external_knowledge_entities.external_knowledge_entities import ExternalDatasetCreatePayload
from services.errors.dataset import DatasetNameDuplicateError as DatasetNameDuplicateFailure
from services.knowledge.dataset_access import DatasetAccessDeniedError, DatasetNotFoundError
from services.knowledge.external.application import ExternalHitTestingError, ExternalTemplateNotFoundError

_DATASET_EDIT_ROLES = frozenset(
    {TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.EDITOR, TenantAccountRole.DATASET_OPERATOR}
)
_EXTERNAL_CONNECT_ROLES = frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.EDITOR})


def _raise_external_error(error: Exception) -> Never:
    if isinstance(error, (DatasetNotFoundError, ExternalTemplateNotFoundError)):
        raise NotFound(str(error)) from error
    if isinstance(error, DatasetAccessDeniedError):
        raise Forbidden(str(error)) from error
    if isinstance(error, DatasetNameDuplicateFailure):
        raise DatasetNameDuplicateError() from error
    if isinstance(error, ExternalHitTestingError):
        raise InternalServerError(str(error)) from error
    raise error


class ExternalKnowledgeApiPayload(BaseModel):
    name: str = Field(..., min_length=1, max_length=40)
    settings: dict[str, Any]


class ExternalHitTestingPayload(BaseModel):
    query: str
    external_retrieval_model: dict[str, Any] | None = None
    metadata_filtering_conditions: dict[str, Any] | None = None


class ExternalApiTemplateListQuery(BaseModel):
    page: int = Field(default=1, description="Page number")
    limit: int = Field(default=20, description="Number of items per page")
    keyword: str | None = Field(default=None, description="Search keyword")


class ExternalKnowledgeApiBindingResponse(ResponseModel):
    id: str
    name: str


class ExternalKnowledgeApiResponse(ResponseModel):
    id: str
    tenant_id: str
    name: str
    description: str
    settings: dict[str, Any] | None = Field(validation_alias=AliasChoices("settings_dict", "settings"))
    dataset_bindings: list[ExternalKnowledgeApiBindingResponse]
    created_by: str
    created_at: str

    @field_validator("created_at", mode="before")
    @classmethod
    def _normalize_created_at(cls, value: datetime | str) -> str:
        if isinstance(value, datetime):
            return value.isoformat()
        return value


class ExternalKnowledgeApiListResponse(ResponseModel):
    data: list[ExternalKnowledgeApiResponse]
    has_more: bool
    limit: int
    total: int | None
    page: int


class ExternalHitTestingQueryResponse(ResponseModel):
    content: str


class ExternalHitTestingRecordResponse(ResponseModel):
    content: str | None = None
    title: str | None = None
    score: float | None = None
    metadata: dict[str, Any] | None = None


class ExternalHitTestingResponse(ResponseModel):
    query: ExternalHitTestingQueryResponse
    records: list[ExternalHitTestingRecordResponse]


register_schema_models(
    console_ns,
    ExternalKnowledgeApiPayload,
    ExternalDatasetCreatePayload,
    ExternalHitTestingPayload,
    ExternalApiTemplateListQuery,
)
register_response_schema_models(
    console_ns,
    UsageCountResponse,
    DatasetDetailResponse,
    ExternalKnowledgeApiBindingResponse,
    ExternalKnowledgeApiResponse,
    ExternalKnowledgeApiListResponse,
    ExternalHitTestingQueryResponse,
    ExternalHitTestingRecordResponse,
    ExternalHitTestingResponse,
)


@console_ns.route("/datasets/external-knowledge-api")
class ExternalApiTemplateListApi(Resource):
    @console_ns.doc("get_external_api_templates")
    @console_ns.doc(description="Get external knowledge API templates")
    @console_ns.doc(params=query_params_from_model(ExternalApiTemplateListQuery))
    @console_ns.response(
        200,
        "External API templates retrieved successfully",
        console_ns.models[ExternalKnowledgeApiListResponse.__name__],
    )
    @console_account_admission()
    @model_validate(ExternalApiTemplateListQuery)
    def get(self, req_data: ExternalApiTemplateListQuery, request_context: RequestContext):
        result = application_services().knowledge.external.list_templates(
            request_context, page=req_data.page, limit=req_data.limit, keyword=req_data.keyword
        )
        return dump_response(ExternalKnowledgeApiListResponse, result), 200

    @console_ns.doc("create_external_api_template")
    @console_ns.doc(description="Create external knowledge API template")
    @console_ns.expect(console_ns.models[ExternalKnowledgeApiPayload.__name__])
    @console_ns.response(
        201,
        "External API template created successfully",
        console_ns.models[ExternalKnowledgeApiResponse.__name__],
    )
    @console_ns.response(403, "Permission denied")
    @console_account_admission(allowed_roles=_DATASET_EDIT_ROLES)
    @model_validate(ExternalKnowledgeApiPayload)
    def post(self, req_data: ExternalKnowledgeApiPayload, request_context: RequestContext):
        try:
            result = application_services().knowledge.external.create_template(
                request_context, name=req_data.name, settings=req_data.settings
            )
        except Exception as error:
            _raise_external_error(error)
        return dump_response(ExternalKnowledgeApiResponse, result), 201


@console_ns.route("/datasets/external-knowledge-api/<uuid:external_knowledge_api_id>")
class ExternalApiTemplateApi(Resource):
    @console_ns.doc("get_external_api_template")
    @console_ns.doc(description="Get external knowledge API template details")
    @console_ns.doc(params={"external_knowledge_api_id": "External knowledge API ID"})
    @console_ns.response(
        200,
        "External API template retrieved successfully",
        console_ns.models[ExternalKnowledgeApiResponse.__name__],
    )
    @console_ns.response(404, "Template not found")
    @console_account_admission()
    def get(self, request_context: RequestContext, external_knowledge_api_id: UUID):
        try:
            result = application_services().knowledge.external.get_template(
                request_context, template_id=str(external_knowledge_api_id)
            )
        except Exception as error:
            _raise_external_error(error)
        return dump_response(ExternalKnowledgeApiResponse, result), 200

    @console_ns.doc("update_external_api_template")
    @console_ns.doc(description="Update external knowledge API template")
    @console_ns.doc(params={"external_knowledge_api_id": "External knowledge API ID"})
    @console_ns.expect(console_ns.models[ExternalKnowledgeApiPayload.__name__])
    @console_ns.response(
        200,
        "External API template updated successfully",
        console_ns.models[ExternalKnowledgeApiResponse.__name__],
    )
    @console_ns.response(404, "Template not found")
    @console_account_admission()
    @model_validate(ExternalKnowledgeApiPayload)
    def patch(
        self, req_data: ExternalKnowledgeApiPayload, request_context: RequestContext, external_knowledge_api_id: UUID
    ):
        try:
            result = application_services().knowledge.external.update_template(
                request_context,
                template_id=str(external_knowledge_api_id),
                name=req_data.name,
                settings=req_data.settings,
            )
        except Exception as error:
            _raise_external_error(error)
        return dump_response(ExternalKnowledgeApiResponse, result), 200

    @console_ns.response(204, "External knowledge API deleted successfully")
    @console_account_admission(allowed_roles=_DATASET_EDIT_ROLES)
    def delete(self, request_context: RequestContext, external_knowledge_api_id: UUID):
        try:
            application_services().knowledge.external.delete_template(
                request_context, template_id=str(external_knowledge_api_id)
            )
        except Exception as error:
            _raise_external_error(error)
        return "", 204


@console_ns.route("/datasets/external-knowledge-api/<uuid:external_knowledge_api_id>/use-check")
class ExternalApiUseCheckApi(Resource):
    @console_ns.doc("check_external_api_usage")
    @console_ns.doc(description="Check if external knowledge API is being used")
    @console_ns.doc(params={"external_knowledge_api_id": "External knowledge API ID"})
    @console_ns.response(200, "Usage check completed successfully", console_ns.models[UsageCountResponse.__name__])
    @console_account_admission()
    def get(self, request_context: RequestContext, external_knowledge_api_id: UUID):
        is_using, count = application_services().knowledge.external.template_usage(
            request_context, template_id=str(external_knowledge_api_id)
        )
        return dump_response(UsageCountResponse, {"is_using": is_using, "count": count}), 200


@console_ns.route("/datasets/external")
class ExternalDatasetCreateApi(Resource):
    @console_ns.doc("create_external_dataset")
    @console_ns.doc(description="Create external knowledge dataset")
    @console_ns.expect(console_ns.models[ExternalDatasetCreatePayload.__name__])
    @console_ns.response(
        201, "External dataset created successfully", console_ns.models[DatasetDetailResponse.__name__]
    )
    @console_ns.response(400, "Invalid parameters")
    @console_ns.response(403, "Permission denied")
    @console_account_admission(
        allowed_roles=_EXTERNAL_CONNECT_ROLES,
        rbac_checks=(RBACCheck(RBACPermission.DATASET_EXTERNAL_CONNECT, Workspace()),),
    )
    @model_validate(ExternalDatasetCreatePayload)
    def post(self, req_data: ExternalDatasetCreatePayload, request_context: RequestContext):
        try:
            result = application_services().knowledge.external.create_dataset(request_context, payload=req_data)
        except Exception as error:
            _raise_external_error(error)
        return dump_response(DatasetDetailResponse, result), 201


@console_ns.route("/datasets/<uuid:dataset_id>/external-hit-testing")
class ExternalKnowledgeHitTestingApi(Resource):
    @console_ns.doc("test_external_knowledge_retrieval")
    @console_ns.doc(description="Test external knowledge retrieval for dataset")
    @console_ns.doc(params={"dataset_id": "Dataset ID"})
    @console_ns.expect(console_ns.models[ExternalHitTestingPayload.__name__])
    @console_ns.response(
        200,
        "External hit testing completed successfully",
        console_ns.models[ExternalHitTestingResponse.__name__],
    )
    @console_ns.response(404, "Dataset not found")
    @console_ns.response(400, "Invalid parameters")
    @console_account_admission(rbac_checks=(RBACCheck(RBACPermission.DATASET_PIPELINE_TEST, DatasetId()),))
    @model_validate(ExternalHitTestingPayload)
    def post(self, req_data: ExternalHitTestingPayload, request_context: RequestContext, dataset_id: UUID):
        try:
            result = application_services().knowledge.external.hit_testing(
                request_context,
                dataset_id=str(dataset_id),
                query=req_data.query,
                retrieval_model=req_data.external_retrieval_model,
                metadata_filters=req_data.metadata_filtering_conditions,
            )
        except Exception as error:
            _raise_external_error(error)
        return dump_response(ExternalHitTestingResponse, result)
