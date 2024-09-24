from flask import request
from flask_login import current_user
from flask_restful import Resource, marshal, reqparse
from werkzeug.exceptions import Forbidden, NotFound, InternalServerError

import services
from controllers.console import api
from controllers.console.app.error import ProviderNotInitializeError
from controllers.console.datasets.error import DatasetNameDuplicateError
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required
from fields.dataset_fields import dataset_detail_fields
from libs.login import login_required
from services.dataset_service import DatasetService
from services.external_knowledge_service import ExternalDatasetService
from services.hit_testing_service import HitTestingService


def _validate_name(name):
    if not name or len(name) < 1 or len(name) > 100:
        raise ValueError("Name must be between 1 to 100 characters.")
    return name


def _validate_description_length(description):
    if len(description) > 400:
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

        api_templates, total = ExternalDatasetService.get_external_api_templates(
            page, limit, current_user.current_tenant_id, search
        )
        response = {
            "data": [item.to_dict() for item in api_templates],
            "has_more": len(api_templates) == limit,
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
            "description",
            nullable=False,
            required=True,
            help="Description is required. Description must be between 1 to 400 characters.",
            type=_validate_description_length,
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
            api_template = ExternalDatasetService.create_api_template(
                tenant_id=current_user.current_tenant_id, user_id=current_user.id, args=args
            )
        except services.errors.dataset.DatasetNameDuplicateError:
            raise DatasetNameDuplicateError()

        return api_template.to_dict(), 201


class ExternalApiTemplateApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, api_template_id):
        api_template_id = str(api_template_id)
        api_template = ExternalDatasetService.get_api_template(api_template_id)
        if api_template is None:
            raise NotFound("API template not found.")

        return api_template.to_dict(), 200

    @setup_required
    @login_required
    @account_initialization_required
    def patch(self, api_template_id):
        api_template_id = str(api_template_id)

        parser = reqparse.RequestParser()
        parser.add_argument(
            "name",
            nullable=False,
            required=True,
            help="type is required. Name must be between 1 to 100 characters.",
            type=_validate_name,
        )
        parser.add_argument(
            "description",
            nullable=False,
            required=True,
            help="description is required. Description must be between 1 to 400 characters.",
            type=_validate_description_length,
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

        api_template = ExternalDatasetService.update_api_template(
            tenant_id=current_user.current_tenant_id,
            user_id=current_user.id,
            api_template_id=api_template_id,
            args=args,
        )

        return api_template.to_dict(), 200

    @setup_required
    @login_required
    @account_initialization_required
    def delete(self, api_template_id):
        api_template_id = str(api_template_id)

        # The role of the current user in the ta table must be admin, owner, or editor
        if not current_user.is_editor or current_user.is_dataset_operator:
            raise Forbidden()

        ExternalDatasetService.delete_api_template(current_user.current_tenant_id, api_template_id)
        return {"result": "success"}, 204


class ExternalApiUseCheckApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, api_template_id):
        api_template_id = str(api_template_id)

        external_api_template_is_using = ExternalDatasetService.external_api_template_use_check(api_template_id)
        return {"is_using": external_api_template_is_using}, 200


class ExternalDatasetInitApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        # The role of the current user in the ta table must be admin, owner, or editor
        if not current_user.is_editor:
            raise Forbidden()

        parser = reqparse.RequestParser()
        parser.add_argument("api_template_id", type=str, required=True, nullable=True, location="json")
        # parser.add_argument('name', nullable=False, required=True,
        #                     help='name is required. Name must be between 1 to 100 characters.',
        #                     type=_validate_name)
        # parser.add_argument('description', type=str, required=True, nullable=True, location='json')
        parser.add_argument("data_source", type=dict, required=True, nullable=True, location="json")
        parser.add_argument("process_parameter", type=dict, required=True, nullable=True, location="json")

        args = parser.parse_args()

        # The role of the current user in the ta table must be admin, owner, or editor, or dataset_operator
        if not current_user.is_dataset_editor:
            raise Forbidden()

        # validate args
        ExternalDatasetService.document_create_args_validate(
            current_user.current_tenant_id, args["api_template_id"], args["process_parameter"]
        )

        try:
            dataset, documents, batch = ExternalDatasetService.init_external_dataset(
                tenant_id=current_user.current_tenant_id,
                user_id=current_user.id,
                args=args,
            )
        except Exception as ex:
            raise ProviderNotInitializeError(ex.description)
        response = {"dataset": dataset, "documents": documents, "batch": batch}

        return response


class ExternalDatasetCreateApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        # The role of the current user in the ta table must be admin, owner, or editor
        if not current_user.is_editor:
            raise Forbidden()

        parser = reqparse.RequestParser()
        parser.add_argument("external_api_template_id", type=str, required=True, nullable=False, location="json")
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


api.add_resource(ExternalKnowledgeHitTestingApi, "/datasets/<uuid:dataset_id>/external-hit-testing")
api.add_resource(ExternalDatasetCreateApi, "/datasets/external")
api.add_resource(ExternalApiTemplateListApi, "/datasets/external-api-template")
api.add_resource(ExternalApiTemplateApi, "/datasets/external-api-template/<uuid:api_template_id>")
api.add_resource(ExternalApiUseCheckApi, "/datasets/external-api-template/<uuid:api_template_id>/use-check")
