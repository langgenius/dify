from typing import Literal

from flask_restx import Resource, marshal_with, reqparse
from werkzeug.exceptions import NotFound

from controllers.console import console_ns
from controllers.console.wraps import account_initialization_required, enterprise_license_required, setup_required
from fields.dataset_fields import dataset_metadata_fields
from libs.login import current_account_with_tenant, login_required
from services.dataset_service import DatasetService
from services.entities.knowledge_entities.knowledge_entities import (
    MetadataArgs,
    MetadataOperationData,
)
from services.metadata_service import MetadataService


@console_ns.route("/datasets/<uuid:dataset_id>/metadata")
class DatasetMetadataCreateApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @enterprise_license_required
    @marshal_with(dataset_metadata_fields)
    def post(self, dataset_id):
        current_user, _ = current_account_with_tenant()
        parser = (
            reqparse.RequestParser()
            .add_argument("type", type=str, required=True, nullable=False, location="json")
            .add_argument("name", type=str, required=True, nullable=False, location="json")
        )
        args = parser.parse_args()
        metadata_args = MetadataArgs.model_validate(args)

        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")
        DatasetService.check_dataset_permission(dataset, current_user)

        metadata = MetadataService.create_metadata(dataset_id_str, metadata_args)
        return metadata, 201

    @setup_required
    @login_required
    @account_initialization_required
    @enterprise_license_required
    def get(self, dataset_id):
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")
        return MetadataService.get_dataset_metadatas(dataset), 200


@console_ns.route("/datasets/<uuid:dataset_id>/metadata/<uuid:metadata_id>")
class DatasetMetadataApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @enterprise_license_required
    @marshal_with(dataset_metadata_fields)
    def patch(self, dataset_id, metadata_id):
        current_user, _ = current_account_with_tenant()
        parser = reqparse.RequestParser().add_argument("name", type=str, required=True, nullable=False, location="json")
        args = parser.parse_args()
        name = args["name"]

        dataset_id_str = str(dataset_id)
        metadata_id_str = str(metadata_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")
        DatasetService.check_dataset_permission(dataset, current_user)

        metadata = MetadataService.update_metadata_name(dataset_id_str, metadata_id_str, name)
        return metadata, 200

    @setup_required
    @login_required
    @account_initialization_required
    @enterprise_license_required
    def delete(self, dataset_id, metadata_id):
        current_user, _ = current_account_with_tenant()
        dataset_id_str = str(dataset_id)
        metadata_id_str = str(metadata_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")
        DatasetService.check_dataset_permission(dataset, current_user)

        MetadataService.delete_metadata(dataset_id_str, metadata_id_str)
        return {"result": "success"}, 204


@console_ns.route("/datasets/metadata/built-in")
class DatasetMetadataBuiltInFieldApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @enterprise_license_required
    def get(self):
        built_in_fields = MetadataService.get_built_in_fields()
        return {"fields": built_in_fields}, 200


@console_ns.route("/datasets/<uuid:dataset_id>/metadata/built-in/<string:action>")
class DatasetMetadataBuiltInFieldActionApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @enterprise_license_required
    def post(self, dataset_id, action: Literal["enable", "disable"]):
        current_user, _ = current_account_with_tenant()
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")
        DatasetService.check_dataset_permission(dataset, current_user)

        if action == "enable":
            MetadataService.enable_built_in_field(dataset)
        elif action == "disable":
            MetadataService.disable_built_in_field(dataset)
        return {"result": "success"}, 200


@console_ns.route("/datasets/<uuid:dataset_id>/documents/metadata")
class DocumentMetadataEditApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @enterprise_license_required
    def post(self, dataset_id):
        current_user, _ = current_account_with_tenant()
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")
        DatasetService.check_dataset_permission(dataset, current_user)

        parser = reqparse.RequestParser().add_argument(
            "operation_data", type=list, required=True, nullable=False, location="json"
        )
        args = parser.parse_args()
        metadata_args = MetadataOperationData.model_validate(args)

        MetadataService.update_documents_metadata(dataset, metadata_args)

        return {"result": "success"}, 200
