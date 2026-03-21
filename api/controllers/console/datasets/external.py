from flask import request
from flask_restx import Resource, fields, marshal
from pydantic import BaseModel, Field
from werkzeug.exceptions import Forbidden, InternalServerError, NotFound

import services
from controllers.common.schema import get_or_create_model, register_schema_models
from controllers.console import console_ns
from controllers.console.datasets.error import DatasetNameDuplicateError
from controllers.console.wraps import account_initialization_required, edit_permission_required, setup_required
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
from libs.login import current_account_with_tenant, login_required
from services.dataset_service import DatasetService
from services.external_knowledge_service import ExternalDatasetService
from services.hit_testing_service import HitTestingService
from services.knowledge_service import ExternalDatasetTestService


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
    external_retrieval_model: dict[str, object] | None = None


class ExternalHitTestingPayload(BaseModel):
    query: str
    external_retrieval_model: dict[str, object] | None = None
    metadata_filtering_conditions: dict[str, object] | None = None


class BedrockRetrievalPayload(BaseModel):
    retrieval_setting: dict[str, object]
    query: str
    knowledge_id: str


class ExternalApiTemplateListQuery(BaseModel):
    page: int = Field(default=1, description="Page number")
    limit: int = Field(default=20, description="Number of items per page")
    keyword: str | None = Field(default=None, description="Search keyword")


register_schema_models(
    console_ns,
    ExternalKnowledgeApiPayload,
    ExternalDatasetCreatePayload,
    ExternalHitTestingPayload,
    BedrockRetrievalPayload,
    ExternalApiTemplateListQuery,
)


@console_ns.route("/datasets/external-knowledge-api")
class ExternalApiTemplateListApi(Resource):
    @console_ns.doc("get_external_api_templates")
    @console_ns.doc(description="Get external knowledge API templates")
    @console_ns.doc(
        params={
            "page": "Page number (default: 1)",
            "limit": "Number of items per page (default: 20)",
            "keyword": "Search keyword",
        }
    )
    @console_ns.response(200, "External API templates retrieved successfully")
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        _, current_tenant_id = current_account_with_tenant()
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
    def post(self):
        current_user, current_tenant_id = current_account_with_tenant()
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

        return external_knowledge_api.to_dict(), 201


@console_ns.route("/datasets/external-knowledge-api/<uuid:external_knowledge_api_id>")
class ExternalApiTemplateApi(Resource):
    @console_ns.doc("get_external_api_template")
    @console_ns.doc(description="Get external knowledge API template details")
    @console_ns.doc(params={"external_knowledge_api_id": "External knowledge API ID"})
    @console_ns.response(200, "External API template retrieved successfully")
    @console_ns.response(404, "Template not found")
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, external_knowledge_api_id):
        external_knowledge_api_id = str(external_knowledge_api_id)
        external_knowledge_api = ExternalDatasetService.get_external_knowledge_api(external_knowledge_api_id)
        if external_knowledge_api is None:
            raise NotFound("API template not found.")

        return external_knowledge_api.to_dict(), 200

    @setup_required
    @login_required
    @account_initialization_required
    @console_ns.expect(console_ns.models[ExternalKnowledgeApiPayload.__name__])
    def patch(self, external_knowledge_api_id):
        current_user, current_tenant_id = current_account_with_tenant()
        external_knowledge_api_id = str(external_knowledge_api_id)

        payload = ExternalKnowledgeApiPayload.model_validate(console_ns.payload or {})
        ExternalDatasetService.validate_api_list(payload.settings)

        external_knowledge_api = ExternalDatasetService.update_external_knowledge_api(
            tenant_id=current_tenant_id,
            user_id=current_user.id,
            external_knowledge_api_id=external_knowledge_api_id,
            args=payload.model_dump(),
        )

        return external_knowledge_api.to_dict(), 200

    @setup_required
    @login_required
    @account_initialization_required
    def delete(self, external_knowledge_api_id):
        current_user, current_tenant_id = current_account_with_tenant()
        external_knowledge_api_id = str(external_knowledge_api_id)

        if not (current_user.has_edit_permission or current_user.is_dataset_operator):
            raise Forbidden()

        ExternalDatasetService.delete_external_knowledge_api(current_tenant_id, external_knowledge_api_id)
        return {"result": "success"}, 204


@console_ns.route("/datasets/external-knowledge-api/<uuid:external_knowledge_api_id>/use-check")
class ExternalApiUseCheckApi(Resource):
    @console_ns.doc("check_external_api_usage")
    @console_ns.doc(description="Check if external knowledge API is being used")
    @console_ns.doc(params={"external_knowledge_api_id": "External knowledge API ID"})
    @console_ns.response(200, "Usage check completed successfully")
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, external_knowledge_api_id):
        external_knowledge_api_id = str(external_knowledge_api_id)

        external_knowledge_api_is_using, count = ExternalDatasetService.external_knowledge_api_use_check(
            external_knowledge_api_id
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
    def post(self):
        # The role of the current user in the ta table must be admin, owner, or editor
        current_user, current_tenant_id = current_account_with_tenant()
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

        return marshal(dataset, dataset_detail_fields), 201


@console_ns.route("/datasets/<uuid:dataset_id>/external-hit-testing")
class ExternalKnowledgeHitTestingApi(Resource):
    @console_ns.doc("test_external_knowledge_retrieval")
    @console_ns.doc(description="Test external knowledge retrieval for dataset")
    @console_ns.doc(params={"dataset_id": "Dataset ID"})
    @console_ns.expect(console_ns.models[ExternalHitTestingPayload.__name__])
    @console_ns.response(200, "External hit testing completed successfully")
    @console_ns.response(404, "Dataset not found")
    @console_ns.response(400, "Invalid parameters")
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, dataset_id):
        current_user, _ = current_account_with_tenant()
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
    @console_ns.response(200, "Bedrock retrieval test completed")
    def post(self):
        payload = BedrockRetrievalPayload.model_validate(console_ns.payload or {})

        # Call the knowledge retrieval service
        result = ExternalDatasetTestService.knowledge_retrieval(
            payload.retrieval_setting, payload.query, payload.knowledge_id
        )
        return result, 200
