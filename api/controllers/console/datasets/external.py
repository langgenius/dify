from typing import Any
from uuid import UUID

from flask import request
from flask_restx import Resource, fields, marshal
from pydantic import BaseModel, Field, RootModel
from werkzeug.exceptions import Forbidden, InternalServerError, NotFound

import services
from controllers.common.fields import UsageCountResponse
from controllers.common.schema import (
    get_or_create_model,
    query_params_from_model,
    register_response_schema_models,
    register_schema_models,
)
from controllers.console import console_ns
from controllers.console.datasets.error import DatasetNameDuplicateError
from controllers.console.app.wraps import with_session
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
from sqlalchemy.orm import Session
from extensions.ext_database import db
from fields.base import ResponseModel
from fields.dataset_fields import (
    dataset_detail_fields,
    dataset_retrieval_model_fields,
    doc_metadata_fields,
    external_knowledge_info_fields,
    external_retrieval_model_fields,
    icon_info_fields,
    keyword_setting_fields,
    reranking_model_fields,
    tag_fields,
    vector_setting_fields,
    weighted_score_fields,
)
from libs.login import login_required
from models import Account
from services.dataset_service import DatasetService
from services.enterprise import rbac_service as enterprise_rbac_service
from services.external_knowledge_service import ExternalDatasetService
from services.hit_testing_service import HitTestingService
from services.knowledge_service import BedrockRetrievalSetting, ExternalDatasetTestService

register_response_schema_models(console_ns, UsageCountResponse)


def _build_dataset_detail_model():
    keyword_setting_model = get_or_create_model("DatasetKeywordSetting", keyword_setting_fields)
    vector_setting_model = get_or_create_model("DatasetVectorSetting", vector_setting_fields)

    weighted_score_fields_copy = weighted_score_fields.copy()
    weighted_score_fields_copy["keyword_setting"] = fields.Nested(keyword_setting_model)
    weighted_score_fields_copy["vector_setting"] = fields.Nested(vector_setting_model)
    weighted_score_model = get_or_create_model("DatasetWeightedScore", weighted_score_fields_copy)

    reranking_model = get_or_create_model("DatasetRerankingModel", reranking_model_fields)

    dataset_retrieval_model_fields_copy = dataset_retrieval_model_fields.copy()
    dataset_retrieval_model_fields_copy["reranking_model"] = fields.Nested(reranking_model)
    dataset_retrieval_model_fields_copy["weights"] = fields.Nested(weighted_score_model, allow_null=True)
    dataset_retrieval_model = get_or_create_model("DatasetRetrievalModel", dataset_retrieval_model_fields_copy)

    tag_model = get_or_create_model("Tag", tag_fields)
    doc_metadata_model = get_or_create_model("DatasetDocMetadata", doc_metadata_fields)
    external_knowledge_info_model = get_or_create_model("ExternalKnowledgeInfo", external_knowledge_info_fields)
    external_retrieval_model = get_or_create_model("ExternalRetrievalModel", external_retrieval_model_fields)
    icon_info_model = get_or_create_model("DatasetIconInfo", icon_info_fields)

    dataset_detail_fields_copy = dataset_detail_fields.copy()
    dataset_detail_fields_copy["retrieval_model_dict"] = fields.Nested(dataset_retrieval_model)
    dataset_detail_fields_copy["tags"] = fields.List(fields.Nested(tag_model))
    dataset_detail_fields_copy["external_knowledge_info"] = fields.Nested(external_knowledge_info_model)
    dataset_detail_fields_copy["external_retrieval_model"] = fields.Nested(external_retrieval_model, allow_null=True)
    dataset_detail_fields_copy["doc_metadata"] = fields.List(fields.Nested(doc_metadata_model))
    dataset_detail_fields_copy["icon_info"] = fields.Nested(icon_info_model)
    return get_or_create_model("DatasetDetail", dataset_detail_fields_copy)


try:
    dataset_detail_model = console_ns.models["DatasetDetail"]
except KeyError:
    dataset_detail_model = _build_dataset_detail_model()


class ExternalKnowledgeApiPayload(BaseModel):
    name: str = Field(..., min_length=1, max_length=40)
    settings: dict[str, object]


class ExternalDatasetCreatePayload(BaseModel):
    external_knowledge_api_id: str
    external_knowledge_id: str
    name: str = Field(..., min_length=1, max_length=100)
    description: str | None = Field(None, max_length=400)
    external_retrieval_model: dict[str, object] | None = Field(default=None)


class ExternalHitTestingPayload(BaseModel):
    query: str
    external_retrieval_model: dict[str, object] | None = Field(default=None)
    metadata_filtering_conditions: dict[str, object] | None = Field(
        default=None,
    )


class BedrockRetrievalPayload(BaseModel):
    retrieval_setting: "BedrockRetrievalSetting"
    query: str
    knowledge_id: str


class ExternalApiTemplateListQuery(BaseModel):
    page: int = Field(default=1, description="Page number")
    limit: int = Field(default=20, description="Number of items per page")
    keyword: str | None = Field(default=None, description="Search keyword")


class ExternalKnowledgeDatasetBindingResponse(ResponseModel):
    id: str
    name: str


class ExternalKnowledgeApiResponse(ResponseModel):
    id: str
    tenant_id: str
    name: str
    description: str
    settings: dict[str, Any] | None = Field(default=None)
    dataset_bindings: list[ExternalKnowledgeDatasetBindingResponse] = Field(default_factory=list)
    created_by: str
    created_at: str


class ExternalKnowledgeApiListResponse(ResponseModel):
    data: list[ExternalKnowledgeApiResponse]
    has_more: bool
    limit: int
    total: int
    page: int


class ExternalRetrievalTestResponse(RootModel[dict[str, Any] | list[dict[str, Any]]]):
    root: dict[str, Any] | list[dict[str, Any]]


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
    ExternalKnowledgeApiResponse,
    ExternalKnowledgeApiListResponse,
    ExternalRetrievalTestResponse,
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
        response = {
            "data": [item.to_dict() for item in external_knowledge_apis],
            "has_more": len(external_knowledge_apis) == query.limit,
            "limit": query.limit,
            "total": total,
            "page": query.page,
        }
        return response, 200

    @setup_required
    @login_required
    @account_initialization_required
    @console_ns.expect(console_ns.models[ExternalKnowledgeApiPayload.__name__])
    @console_ns.response(
        201,
        "External API template created successfully",
        console_ns.models[ExternalKnowledgeApiResponse.__name__],
    )
    @with_current_user
    @with_current_tenant_id
    @with_session
    def post(self, session: Session, current_tenant_id: str, current_user: Account):
        payload = ExternalKnowledgeApiPayload.model_validate(console_ns.payload or {})

        ExternalDatasetService.validate_api_list(payload.settings)

        # The role of the current user in the ta table must be admin, owner, or editor, or dataset_operator
        if not current_user.is_dataset_editor:
            raise Forbidden()

        try:
            external_knowledge_api = ExternalDatasetService.create_external_knowledge_api(
                tenant_id=current_tenant_id, user_id=current_user.id, args=payload.model_dump(), session=session,
            )
        except services.errors.dataset.DatasetNameDuplicateError:
            raise DatasetNameDuplicateError()

        return external_knowledge_api.to_dict(), 201


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
    @with_session
    def get(self, session: Session, current_tenant_id: str, external_knowledge_api_id: UUID):
        external_knowledge_api_id_str = str(external_knowledge_api_id)
        external_knowledge_api = ExternalDatasetService.get_external_knowledge_api(
            external_knowledge_api_id=external_knowledge_api_id_str, tenant_id=current_tenant_id, session=session
        )
        if external_knowledge_api is None:
            raise NotFound("API template not found.")

        return external_knowledge_api.to_dict(), 200

    @console_ns.response(
        200,
        "External API template updated successfully",
        console_ns.models[ExternalKnowledgeApiResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @console_ns.expect(console_ns.models[ExternalKnowledgeApiPayload.__name__])
    @with_current_user
    @with_current_tenant_id
    @with_session
    def patch(self, session: Session, current_tenant_id: str, current_user: Account, external_knowledge_api_id: UUID):
        external_knowledge_api_id_str = str(external_knowledge_api_id)

        payload = ExternalKnowledgeApiPayload.model_validate(console_ns.payload or {})
        ExternalDatasetService.validate_api_list(payload.settings)

        external_knowledge_api = ExternalDatasetService.update_external_knowledge_api(
            tenant_id=current_tenant_id,
            user_id=current_user.id,
            external_knowledge_api_id=external_knowledge_api_id_str,
            args=payload.model_dump(),
            session=session,
        )

        return external_knowledge_api.to_dict(), 200

    @setup_required
    @login_required
    @account_initialization_required
    @console_ns.response(204, "External knowledge API deleted successfully")
    @with_current_user
    @with_current_tenant_id
    @with_session
    def delete(self, session: Session, current_tenant_id: str, current_user: Account, external_knowledge_api_id: UUID):
        external_knowledge_api_id_str = str(external_knowledge_api_id)

        if not (current_user.has_edit_permission or current_user.is_dataset_operator):
            raise Forbidden()

        ExternalDatasetService.delete_external_knowledge_api(session, current_tenant_id, external_knowledge_api_id_str)
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
    @with_session
    def get(self, session: Session, current_tenant_id: str, external_knowledge_api_id: UUID):
        external_knowledge_api_id_str = str(external_knowledge_api_id)

        external_knowledge_api_is_using, count = ExternalDatasetService.external_knowledge_api_use_check(
            session,
            external_knowledge_api_id_str,
            current_tenant_id,
        )
        return {"is_using": external_knowledge_api_is_using, "count": count}, 200


@console_ns.route("/datasets/external")
class ExternalDatasetCreateApi(Resource):
    @console_ns.doc("create_external_dataset")
    @console_ns.doc(description="Create external knowledge dataset")
    @console_ns.expect(console_ns.models[ExternalDatasetCreatePayload.__name__])
    @console_ns.response(201, "External dataset created successfully", dataset_detail_model)
    @console_ns.response(400, "Invalid parameters")
    @console_ns.response(403, "Permission denied")
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_EXTERNAL_CONNECT)
    @with_current_user
    @with_current_tenant_id
    @with_session
    def post(self, session: Session, current_tenant_id: str, current_user: Account):
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
                session=session,
            )
        except services.errors.dataset.DatasetNameDuplicateError:
            raise DatasetNameDuplicateError()

        item = marshal(dataset, dataset_detail_fields)
        dataset_id_str = item["id"]
        permission_keys_map = enterprise_rbac_service.RBACService.DatasetPermissions.batch_get(
            str(current_tenant_id),
            current_user.id,
            [dataset_id_str],
        )
        item["permission_keys"] = permission_keys_map.get(dataset_id_str, [])

        return item, 201


@console_ns.route("/datasets/<uuid:dataset_id>/external-hit-testing")
class ExternalKnowledgeHitTestingApi(Resource):
    @console_ns.doc("test_external_knowledge_retrieval")
    @console_ns.doc(description="Test external knowledge retrieval for dataset")
    @console_ns.doc(params={"dataset_id": "Dataset ID"})
    @console_ns.expect(console_ns.models[ExternalHitTestingPayload.__name__])
    @console_ns.response(
        200,
        "External hit testing completed successfully",
        console_ns.models[ExternalRetrievalTestResponse.__name__],
    )
    @console_ns.response(404, "Dataset not found")
    @console_ns.response(400, "Invalid parameters")
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_PIPELINE_TEST)
    @with_session
    def post(self, session: Session, current_user: Account, dataset_id: UUID):
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str, db.session)
        if dataset is None:
            raise NotFound("Dataset not found.")

        try:
            DatasetService.check_dataset_permission(dataset, current_user, db.session)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))

        payload = ExternalHitTestingPayload.model_validate(console_ns.payload or {})
        HitTestingService.hit_testing_args_check(payload.model_dump())

        try:
            response = HitTestingService.external_retrieve(
                session=session,
                dataset=dataset,
                query=payload.query,
                account=current_user,
                external_retrieval_model=payload.external_retrieval_model,
                metadata_filtering_conditions=payload.metadata_filtering_conditions,
            )

            return response
        except Exception as e:
            raise InternalServerError(str(e))


@console_ns.route("/test/retrieval")
class BedrockRetrievalApi(Resource):
    # this api is only for internal testing
    @console_ns.doc("bedrock_retrieval_test")
    @console_ns.doc(description="Bedrock retrieval test (internal use only)")
    @console_ns.expect(console_ns.models[BedrockRetrievalPayload.__name__])
    @console_ns.response(
        200,
        "Bedrock retrieval test completed",
        console_ns.models[ExternalRetrievalTestResponse.__name__],
    )
    def post(self):
        payload = BedrockRetrievalPayload.model_validate(console_ns.payload or {})

        # Call the knowledge retrieval service
        result = ExternalDatasetTestService.knowledge_retrieval(
            payload.retrieval_setting, payload.query, payload.knowledge_id
        )
        return result, 200
