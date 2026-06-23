from datetime import datetime
from typing import Any
from uuid import UUID

from flask import request
from flask_restx import Resource
from pydantic import AliasChoices, BaseModel, Field, field_validator
from werkzeug.exceptions import Forbidden, InternalServerError, NotFound

import services
from controllers.common.fields import UsageCountResponse
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.datasets.error import DatasetNameDuplicateError
from controllers.console.wraps import (
    RBACPermission,
    RBACResourceScope,
    account_initialization_required,
    edit_permission_required,
    rbac_permission_required,
    setup_required,
    with_current_tenant_id,
    with_current_user,
)
from extensions.ext_database import db
from fields.base import ResponseModel
from fields.dataset_fields import DatasetDetailResponse
from libs.helper import dump_response
from libs.login import login_required
from models import Account
from services.dataset_service import DatasetService
from services.enterprise import rbac_service as enterprise_rbac_service
from services.external_knowledge_service import ExternalDatasetService
from services.hit_testing_service import HitTestingService
from services.knowledge_service import BedrockRetrievalSetting, ExternalDatasetTestService


class ExternalKnowledgeApiPayload(BaseModel):
    name: str = Field(..., min_length=1, max_length=40)
    settings: dict[str, Any]


class ExternalDatasetCreatePayload(BaseModel):
    external_knowledge_api_id: str
    external_knowledge_id: str
    name: str = Field(..., min_length=1, max_length=100)
    description: str | None = Field(None, max_length=400)
    external_retrieval_model: dict[str, Any] | None = None


class ExternalHitTestingPayload(BaseModel):
    query: str
    external_retrieval_model: dict[str, Any] | None = None
    metadata_filtering_conditions: dict[str, Any] | None = None


class BedrockRetrievalPayload(BaseModel):
    retrieval_setting: "BedrockRetrievalSetting"
    query: str
    knowledge_id: str


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


class BedrockRetrievalRecordResponse(ResponseModel):
    metadata: dict[str, Any] | None = None
    score: float
    title: str | None = None
    content: str | None = None


class BedrockRetrievalResponse(ResponseModel):
    records: list[BedrockRetrievalRecordResponse]


register_schema_models(
    console_ns,
    ExternalKnowledgeApiPayload,
    ExternalDatasetCreatePayload,
    ExternalHitTestingPayload,
    BedrockRetrievalPayload,
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
    BedrockRetrievalRecordResponse,
    BedrockRetrievalResponse,
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
    @setup_required
    @login_required
    @with_current_tenant_id
    @account_initialization_required
    def get(self, current_tenant_id: str):
        query = ExternalApiTemplateListQuery.model_validate(request.args.to_dict())

        external_knowledge_apis, total = ExternalDatasetService.get_external_knowledge_apis(
            query.page, query.limit, current_tenant_id, query.keyword
        )
        return ExternalKnowledgeApiListResponse(
            data=[ExternalKnowledgeApiResponse.model_validate(item) for item in external_knowledge_apis],
            has_more=len(external_knowledge_apis) == query.limit,
            limit=query.limit,
            total=total,
            page=query.page,
        ).model_dump(mode="json"), 200

    @console_ns.doc("create_external_api_template")
    @console_ns.doc(description="Create external knowledge API template")
    @console_ns.expect(console_ns.models[ExternalKnowledgeApiPayload.__name__])
    @console_ns.response(
        201,
        "External API template created successfully",
        console_ns.models[ExternalKnowledgeApiResponse.__name__],
    )
    @console_ns.response(403, "Permission denied")
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def post(self, current_tenant_id: str, current_user: Account):
        payload = ExternalKnowledgeApiPayload.model_validate(console_ns.payload or {})

        ExternalDatasetService.validate_api_list(payload.settings)

        # The role of the current user in the ta table must be admin, owner, or editor, or dataset_operator
        if not current_user.is_dataset_editor:
            raise Forbidden()

        try:
            external_knowledge_api = ExternalDatasetService.create_external_knowledge_api(
                tenant_id=current_tenant_id, user_id=current_user.id, args=payload.model_dump()
            )
        except services.errors.dataset.DatasetNameDuplicateError:
            raise DatasetNameDuplicateError()

        return dump_response(ExternalKnowledgeApiResponse, external_knowledge_api), 201


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
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def get(self, current_tenant_id: str, external_knowledge_api_id: UUID):
        external_knowledge_api_id_str = str(external_knowledge_api_id)
        external_knowledge_api = ExternalDatasetService.get_external_knowledge_api(
            external_knowledge_api_id_str, current_tenant_id
        )
        if external_knowledge_api is None:
            raise NotFound("API template not found.")

        return dump_response(ExternalKnowledgeApiResponse, external_knowledge_api), 200

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
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def patch(self, current_tenant_id: str, current_user: Account, external_knowledge_api_id: UUID):
        external_knowledge_api_id_str = str(external_knowledge_api_id)

        payload = ExternalKnowledgeApiPayload.model_validate(console_ns.payload or {})
        ExternalDatasetService.validate_api_list(payload.settings)

        external_knowledge_api = ExternalDatasetService.update_external_knowledge_api(
            tenant_id=current_tenant_id,
            user_id=current_user.id,
            external_knowledge_api_id=external_knowledge_api_id_str,
            args=payload.model_dump(),
        )

        return dump_response(ExternalKnowledgeApiResponse, external_knowledge_api), 200

    @setup_required
    @login_required
    @account_initialization_required
    @console_ns.response(204, "External knowledge API deleted successfully")
    @with_current_user
    @with_current_tenant_id
    def delete(self, current_tenant_id: str, current_user: Account, external_knowledge_api_id: UUID):
        external_knowledge_api_id_str = str(external_knowledge_api_id)

        if not (current_user.has_edit_permission or current_user.is_dataset_operator):
            raise Forbidden()

        ExternalDatasetService.delete_external_knowledge_api(current_tenant_id, external_knowledge_api_id_str)
        return "", 204


@console_ns.route("/datasets/external-knowledge-api/<uuid:external_knowledge_api_id>/use-check")
class ExternalApiUseCheckApi(Resource):
    @console_ns.doc("check_external_api_usage")
    @console_ns.doc(description="Check if external knowledge API is being used")
    @console_ns.doc(params={"external_knowledge_api_id": "External knowledge API ID"})
    @console_ns.response(200, "Usage check completed successfully", console_ns.models[UsageCountResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def get(self, current_tenant_id: str, external_knowledge_api_id: UUID):
        external_knowledge_api_id_str = str(external_knowledge_api_id)

        external_knowledge_api_is_using, count = ExternalDatasetService.external_knowledge_api_use_check(
            external_knowledge_api_id_str, current_tenant_id
        )
        return UsageCountResponse(is_using=external_knowledge_api_is_using, count=count).model_dump(mode="json"), 200


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
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_EXTERNAL_CONNECT)
    @with_current_user
    @with_current_tenant_id
    def post(self, current_tenant_id: str, current_user: Account):
        # The role of the current user in the ta table must be admin, owner, or editor
        payload = ExternalDatasetCreatePayload.model_validate(console_ns.payload or {})
        args = payload.model_dump(exclude_none=True)

        # The role of the current user in the ta table must be admin, owner, or editor, or dataset_operator
        if not current_user.is_dataset_editor:
            raise Forbidden()

        try:
            dataset = ExternalDatasetService.create_external_dataset(
                tenant_id=current_tenant_id,
                user_id=current_user.id,
                args=args,
            )
        except services.errors.dataset.DatasetNameDuplicateError:
            raise DatasetNameDuplicateError()

        dataset_id_str = str(dataset.id)
        permission_keys_map = enterprise_rbac_service.RBACService.DatasetPermissions.batch_get(
            str(current_tenant_id),
            current_user.id,
            [dataset_id_str],
        )
        data = DatasetDetailResponse.model_validate(dataset).model_dump(mode="json")
        data["permission_keys"] = permission_keys_map.get(dataset_id_str, [])
        return data, 201


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
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_PIPELINE_TEST)
    def post(self, current_user: Account, dataset_id: UUID):
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")

        try:
            DatasetService.check_dataset_permission(dataset, current_user)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))

        payload = ExternalHitTestingPayload.model_validate(console_ns.payload or {})
        HitTestingService.hit_testing_args_check(payload.model_dump())

        try:
            response = HitTestingService.external_retrieve(
                session=db.session,
                dataset=dataset,
                query=payload.query,
                account=current_user,
                external_retrieval_model=payload.external_retrieval_model,
                metadata_filtering_conditions=payload.metadata_filtering_conditions,
            )

            return dump_response(ExternalHitTestingResponse, response)
        except Exception as e:
            raise InternalServerError(str(e))


@console_ns.route("/test/retrieval")
class BedrockRetrievalApi(Resource):
    # this api is only for internal testing
    @console_ns.doc("bedrock_retrieval_test")
    @console_ns.doc(description="Bedrock retrieval test (internal use only)")
    @console_ns.expect(console_ns.models[BedrockRetrievalPayload.__name__])
    @console_ns.response(200, "Bedrock retrieval test completed", console_ns.models[BedrockRetrievalResponse.__name__])
    def post(self):
        payload = BedrockRetrievalPayload.model_validate(console_ns.payload or {})

        # Call the knowledge retrieval service
        result = ExternalDatasetTestService.knowledge_retrieval(
            payload.retrieval_setting, payload.query, payload.knowledge_id
        )
        return dump_response(BedrockRetrievalResponse, result), 200
