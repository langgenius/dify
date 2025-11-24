from flask import request
from flask_restx import Resource, fields, marshal, reqparse
from werkzeug.exceptions import Forbidden, InternalServerError, NotFound

import services
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


def _get_or_create_model(model_name: str, field_def):
    existing = api.models.get(model_name)
    if existing is None:
        existing = console_ns.model(model_name, field_def)
    return existing


def _build_dataset_detail_model():
    keyword_setting_model = _get_or_create_model("DatasetKeywordSetting", keyword_setting_fields)
    vector_setting_model = _get_or_create_model("DatasetVectorSetting", vector_setting_fields)

    weighted_score_fields_copy = weighted_score_fields.copy()
    weighted_score_fields_copy["keyword_setting"] = fields.Nested(keyword_setting_model)
    weighted_score_fields_copy["vector_setting"] = fields.Nested(vector_setting_model)
    weighted_score_model = _get_or_create_model("DatasetWeightedScore", weighted_score_fields_copy)

    reranking_model = _get_or_create_model("DatasetRerankingModel", reranking_model_fields)

    dataset_retrieval_model_fields_copy = dataset_retrieval_model_fields.copy()
    dataset_retrieval_model_fields_copy["reranking_model"] = fields.Nested(reranking_model)
    dataset_retrieval_model_fields_copy["weights"] = fields.Nested(weighted_score_model, allow_null=True)
    dataset_retrieval_model = _get_or_create_model("DatasetRetrievalModel", dataset_retrieval_model_fields_copy)

    tag_model = _get_or_create_model("Tag", tag_fields)
    doc_metadata_model = _get_or_create_model("DatasetDocMetadata", doc_metadata_fields)
    external_knowledge_info_model = _get_or_create_model("ExternalKnowledgeInfo", external_knowledge_info_fields)
    external_retrieval_model = _get_or_create_model("ExternalRetrievalModel", external_retrieval_model_fields)
    icon_info_model = _get_or_create_model("DatasetIconInfo", icon_info_fields)

    dataset_detail_fields_copy = dataset_detail_fields.copy()
    dataset_detail_fields_copy["retrieval_model_dict"] = fields.Nested(dataset_retrieval_model)
    dataset_detail_fields_copy["tags"] = fields.List(fields.Nested(tag_model))
    dataset_detail_fields_copy["external_knowledge_info"] = fields.Nested(external_knowledge_info_model)
    dataset_detail_fields_copy["external_retrieval_model"] = fields.Nested(external_retrieval_model, allow_null=True)
    dataset_detail_fields_copy["doc_metadata"] = fields.List(fields.Nested(doc_metadata_model))
    dataset_detail_fields_copy["icon_info"] = fields.Nested(icon_info_model)
    return _get_or_create_model("DatasetDetail", dataset_detail_fields_copy)


try:
    dataset_detail_model = api.models["DatasetDetail"]
except KeyError:
    dataset_detail_model = _build_dataset_detail_model()


def _validate_name(name: str) -> str:
    if not name or len(name) < 1 or len(name) > 100:
        raise ValueError("Name must be between 1 to 100 characters.")
    return name


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
        page = request.args.get("page", default=1, type=int)
        limit = request.args.get("limit", default=20, type=int)
        search = request.args.get("keyword", default=None, type=str)

        external_knowledge_apis, total = ExternalDatasetService.get_external_knowledge_apis(
            page, limit, current_tenant_id, search
        )
        response = {
            "data": [item.to_dict() for item in external_knowledge_apis],
            "has_more": len(external_knowledge_apis) == limit,
            "limit": limit,
            "total": total,
            "page": page,
        }
        return response, 200

    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        current_user, current_tenant_id = current_account_with_tenant()
        parser = (
            reqparse.RequestParser()
            .add_argument(
                "name",
                nullable=False,
                required=True,
                help="Name is required. Name must be between 1 to 100 characters.",
                type=_validate_name,
            )
            .add_argument(
                "settings",
                type=dict,
                location="json",
                nullable=False,
                required=True,
            )
        )
        args = parser.parse_args()

        ExternalDatasetService.validate_api_list(args["settings"])

        # The role of the current user in the ta table must be admin, owner, or editor, or dataset_operator
        if not current_user.is_dataset_editor:
            raise Forbidden()

        try:
            external_knowledge_api = ExternalDatasetService.create_external_knowledge_api(
                tenant_id=current_tenant_id, user_id=current_user.id, args=args
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
    def patch(self, external_knowledge_api_id):
        current_user, current_tenant_id = current_account_with_tenant()
        external_knowledge_api_id = str(external_knowledge_api_id)

        parser = (
            reqparse.RequestParser()
            .add_argument(
                "name",
                nullable=False,
                required=True,
                help="type is required. Name must be between 1 to 100 characters.",
                type=_validate_name,
            )
            .add_argument(
                "settings",
                type=dict,
                location="json",
                nullable=False,
                required=True,
            )
        )
        args = parser.parse_args()
        ExternalDatasetService.validate_api_list(args["settings"])

        external_knowledge_api = ExternalDatasetService.update_external_knowledge_api(
            tenant_id=current_tenant_id,
            user_id=current_user.id,
            external_knowledge_api_id=external_knowledge_api_id,
            args=args,
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
    @console_ns.expect(
        console_ns.model(
            "CreateExternalDatasetRequest",
            {
                "external_knowledge_api_id": fields.String(required=True, description="External knowledge API ID"),
                "external_knowledge_id": fields.String(required=True, description="External knowledge ID"),
                "name": fields.String(required=True, description="Dataset name"),
                "description": fields.String(description="Dataset description"),
            },
        )
    )
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
        parser = (
            reqparse.RequestParser()
            .add_argument("external_knowledge_api_id", type=str, required=True, nullable=False, location="json")
            .add_argument("external_knowledge_id", type=str, required=True, nullable=False, location="json")
            .add_argument(
                "name",
                nullable=False,
                required=True,
                help="name is required. Name must be between 1 to 100 characters.",
                type=_validate_name,
            )
            .add_argument("description", type=str, required=False, nullable=True, location="json")
            .add_argument("external_retrieval_model", type=dict, required=False, location="json")
        )

        args = parser.parse_args()

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
    @console_ns.expect(
        console_ns.model(
            "ExternalHitTestingRequest",
            {
                "query": fields.String(required=True, description="Query text for testing"),
                "retrieval_model": fields.Raw(description="Retrieval model configuration"),
                "external_retrieval_model": fields.Raw(description="External retrieval model configuration"),
            },
        )
    )
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

        parser = (
            reqparse.RequestParser()
            .add_argument("query", type=str, location="json")
            .add_argument("external_retrieval_model", type=dict, required=False, location="json")
            .add_argument("metadata_filtering_conditions", type=dict, required=False, location="json")
        )
        args = parser.parse_args()

        HitTestingService.hit_testing_args_check(args)

        try:
            response = HitTestingService.external_retrieve(
                dataset=dataset,
                query=args["query"],
                account=current_user,
                external_retrieval_model=args["external_retrieval_model"],
                metadata_filtering_conditions=args["metadata_filtering_conditions"],
            )

            return response
        except Exception as e:
            raise InternalServerError(str(e))


@console_ns.route("/test/retrieval")
class BedrockRetrievalApi(Resource):
    # this api is only for internal testing
    @console_ns.doc("bedrock_retrieval_test")
    @console_ns.doc(description="Bedrock retrieval test (internal use only)")
    @console_ns.expect(
        console_ns.model(
            "BedrockRetrievalTestRequest",
            {
                "retrieval_setting": fields.Raw(required=True, description="Retrieval settings"),
                "query": fields.String(required=True, description="Query text"),
                "knowledge_id": fields.String(required=True, description="Knowledge ID"),
            },
        )
    )
    @console_ns.response(200, "Bedrock retrieval test completed")
    def post(self):
        parser = (
            reqparse.RequestParser()
            .add_argument("retrieval_setting", nullable=False, required=True, type=dict, location="json")
            .add_argument(
                "query",
                nullable=False,
                required=True,
                type=str,
            )
            .add_argument("knowledge_id", nullable=False, required=True, type=str)
        )
        args = parser.parse_args()

        # Call the knowledge retrieval service
        result = ExternalDatasetTestService.knowledge_retrieval(
            args["retrieval_setting"], args["query"], args["knowledge_id"]
        )
        return result, 200
