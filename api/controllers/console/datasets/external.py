from flask import request
from flask_login import current_user
from flask_restful import Resource, marshal, reqparse
from werkzeug.exceptions import Forbidden, InternalServerError, NotFound

import services
from controllers.console import api
from controllers.console.datasets.error import DatasetNameDuplicateError
from controllers.console.wraps import account_initialization_required, setup_required
from fields.dataset_fields import dataset_detail_fields
from libs.login import login_required
from services.dataset_service import DatasetService
from services.external_knowledge_service import ExternalDatasetService
from services.hit_testing_service import HitTestingService
from services.knowledge_service import ExternalDatasetTestService


def _validate_name(name):
    if not name or len(name) < 1 or len(name) > 100:
        raise ValueError("Name must be between 1 to 100 characters.")
    return name


def _validate_description_length(description):
    if description and len(description) > 400:
        raise ValueError("Description cannot exceed 400 characters.")
    return description


class ExternalApiTemplateListApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        page = request.args.get("page", default=1, type=int)
        limit = request.args.get("limit", default=20, type=int)
        search = request.args.get("keyword", default=None, type=str)

        external_knowledge_apis, total = ExternalDatasetService.get_external_knowledge_apis(
            page, limit, current_user.current_tenant_id, search
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
        parser = reqparse.RequestParser()
        parser.add_argument(
            "name",
            nullable=False,
            required=True,
            help="Name is required. Name must be between 1 to 100 characters.",
            type=_validate_name,
        )
        parser.add_argument(
            "settings",
            type=dict,
            location="json",
            nullable=False,
            required=True,
        )
        args = parser.parse_args()

        ExternalDatasetService.validate_api_list(args["settings"])

        # The role of the current user in the ta table must be admin, owner, or editor, or dataset_operator
        if not current_user.is_dataset_editor:
            raise Forbidden()

        try:
            external_knowledge_api = ExternalDatasetService.create_external_knowledge_api(
                tenant_id=current_user.current_tenant_id, user_id=current_user.id, args=args
            )
        except services.errors.dataset.DatasetNameDuplicateError:
            raise DatasetNameDuplicateError()

        return external_knowledge_api.to_dict(), 201


class ExternalApiTemplateApi(Resource):
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
        external_knowledge_api_id = str(external_knowledge_api_id)

        parser = reqparse.RequestParser()
        parser.add_argument(
            "name",
            nullable=False,
            required=True,
            help="type is required. Name must be between 1 to 100 characters.",
            type=_validate_name,
        )
        parser.add_argument(
            "settings",
            type=dict,
            location="json",
            nullable=False,
            required=True,
        )
        args = parser.parse_args()
        ExternalDatasetService.validate_api_list(args["settings"])

        external_knowledge_api = ExternalDatasetService.update_external_knowledge_api(
            tenant_id=current_user.current_tenant_id,
            user_id=current_user.id,
            external_knowledge_api_id=external_knowledge_api_id,
            args=args,
        )

        return external_knowledge_api.to_dict(), 200

    @setup_required
    @login_required
    @account_initialization_required
    def delete(self, external_knowledge_api_id):
        external_knowledge_api_id = str(external_knowledge_api_id)

        # The role of the current user in the ta table must be admin, owner, or editor
        if not current_user.is_editor or current_user.is_dataset_operator:
            raise Forbidden()

        ExternalDatasetService.delete_external_knowledge_api(current_user.current_tenant_id, external_knowledge_api_id)
        return {"result": "success"}, 200


class ExternalApiUseCheckApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, external_knowledge_api_id):
        external_knowledge_api_id = str(external_knowledge_api_id)

        external_knowledge_api_is_using, count = ExternalDatasetService.external_knowledge_api_use_check(
            external_knowledge_api_id
        )
        return {"is_using": external_knowledge_api_is_using, "count": count}, 200


class ExternalDatasetCreateApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        # The role of the current user in the ta table must be admin, owner, or editor
        if not current_user.is_editor:
            raise Forbidden()

        parser = reqparse.RequestParser()
        parser.add_argument("external_knowledge_api_id", type=str, required=True, nullable=False, location="json")
        parser.add_argument("external_knowledge_id", type=str, required=True, nullable=False, location="json")
        parser.add_argument(
            "name",
            nullable=False,
            required=True,
            help="name is required. Name must be between 1 to 100 characters.",
            type=_validate_name,
        )
        parser.add_argument("description", type=str, required=False, nullable=True, location="json")
        parser.add_argument("external_retrieval_model", type=dict, required=False, location="json")

        args = parser.parse_args()

        # The role of the current user in the ta table must be admin, owner, or editor, or dataset_operator
        if not current_user.is_dataset_editor:
            raise Forbidden()

        try:
            dataset = ExternalDatasetService.create_external_dataset(
                tenant_id=current_user.current_tenant_id,
                user_id=current_user.id,
                args=args,
            )
        except services.errors.dataset.DatasetNameDuplicateError:
            raise DatasetNameDuplicateError()

        return marshal(dataset, dataset_detail_fields), 201


class ExternalKnowledgeHitTestingApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, dataset_id):
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")

        try:
            DatasetService.check_dataset_permission(dataset, current_user)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))

        parser = reqparse.RequestParser()
        parser.add_argument("query", type=str, location="json")
        parser.add_argument("external_retrieval_model", type=dict, required=False, location="json")
        args = parser.parse_args()

        HitTestingService.hit_testing_args_check(args)

        try:
            response = HitTestingService.external_retrieve(
                dataset=dataset,
                query=args["query"],
                account=current_user,
                external_retrieval_model=args["external_retrieval_model"],
            )

            return response
        except Exception as e:
            raise InternalServerError(str(e))


class BedrockRetrievalApi(Resource):
    # this api is only for internal testing
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument("retrieval_setting", nullable=False, required=True, type=dict, location="json")
        parser.add_argument(
            "query",
            nullable=False,
            required=True,
            type=str,
        )
        parser.add_argument("knowledge_id", nullable=False, required=True, type=str)
        args = parser.parse_args()

        # Call the knowledge retrieval service
        result = ExternalDatasetTestService.knowledge_retrieval(
            args["retrieval_setting"], args["query"], args["knowledge_id"]
        )
        return result, 200


api.add_resource(ExternalKnowledgeHitTestingApi, "/datasets/<uuid:dataset_id>/external-hit-testing")
api.add_resource(ExternalDatasetCreateApi, "/datasets/external")
api.add_resource(ExternalApiTemplateListApi, "/datasets/external-knowledge-api")
api.add_resource(ExternalApiTemplateApi, "/datasets/external-knowledge-api/<uuid:external_knowledge_api_id>")
api.add_resource(ExternalApiUseCheckApi, "/datasets/external-knowledge-api/<uuid:external_knowledge_api_id>/use-check")
# this api is only for internal test
api.add_resource(BedrockRetrievalApi, "/test/retrieval")
