from typing import Literal

from flask_login import current_user
from flask_restx import marshal, reqparse
from werkzeug.exceptions import NotFound

from controllers.service_api import service_api_ns
from controllers.service_api.wraps import DatasetApiResource, cloud_edition_billing_rate_limit_check
from fields.dataset_fields import dataset_metadata_fields
from services.dataset_service import DatasetService
from services.entities.knowledge_entities.knowledge_entities import (
    MetadataArgs,
    MetadataOperationData,
)
from services.metadata_service import MetadataService

# Define parsers for metadata APIs
metadata_create_parser = (
    reqparse.RequestParser()
    .add_argument("type", type=str, required=True, nullable=False, location="json", help="Metadata type")
    .add_argument("name", type=str, required=True, nullable=False, location="json", help="Metadata name")
)

metadata_update_parser = reqparse.RequestParser().add_argument(
    "name", type=str, required=True, nullable=False, location="json", help="New metadata name"
)

document_metadata_parser = reqparse.RequestParser().add_argument(
    "operation_data", type=list, required=True, nullable=False, location="json", help="Metadata operation data"
)


@service_api_ns.route("/datasets/<uuid:dataset_id>/metadata")
class DatasetMetadataCreateServiceApi(DatasetApiResource):
    @service_api_ns.expect(metadata_create_parser)
    @service_api_ns.doc("create_dataset_metadata")
    @service_api_ns.doc(description="Create metadata for a dataset")
    @service_api_ns.doc(params={"dataset_id": "Dataset ID"})
    @service_api_ns.doc(
        responses={
            201: "Metadata created successfully",
            401: "Unauthorized - invalid API token",
            404: "Dataset not found",
        }
    )
    @cloud_edition_billing_rate_limit_check("knowledge", "dataset")
    def post(self, tenant_id, dataset_id):
        """Create metadata for a dataset."""
        args = metadata_create_parser.parse_args()
        metadata_args = MetadataArgs.model_validate(args)

        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")
        DatasetService.check_dataset_permission(dataset, current_user)

        metadata = MetadataService.create_metadata(dataset_id_str, metadata_args)
        return marshal(metadata, dataset_metadata_fields), 201

    @service_api_ns.doc("get_dataset_metadata")
    @service_api_ns.doc(description="Get all metadata for a dataset")
    @service_api_ns.doc(params={"dataset_id": "Dataset ID"})
    @service_api_ns.doc(
        responses={
            200: "Metadata retrieved successfully",
            401: "Unauthorized - invalid API token",
            404: "Dataset not found",
        }
    )
    def get(self, tenant_id, dataset_id):
        """Get all metadata for a dataset."""
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")
        return MetadataService.get_dataset_metadatas(dataset), 200


@service_api_ns.route("/datasets/<uuid:dataset_id>/metadata/<uuid:metadata_id>")
class DatasetMetadataServiceApi(DatasetApiResource):
    @service_api_ns.expect(metadata_update_parser)
    @service_api_ns.doc("update_dataset_metadata")
    @service_api_ns.doc(description="Update metadata name")
    @service_api_ns.doc(params={"dataset_id": "Dataset ID", "metadata_id": "Metadata ID"})
    @service_api_ns.doc(
        responses={
            200: "Metadata updated successfully",
            401: "Unauthorized - invalid API token",
            404: "Dataset or metadata not found",
        }
    )
    @cloud_edition_billing_rate_limit_check("knowledge", "dataset")
    def patch(self, tenant_id, dataset_id, metadata_id):
        """Update metadata name."""
        args = metadata_update_parser.parse_args()

        dataset_id_str = str(dataset_id)
        metadata_id_str = str(metadata_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")
        DatasetService.check_dataset_permission(dataset, current_user)

        metadata = MetadataService.update_metadata_name(dataset_id_str, metadata_id_str, args["name"])
        return marshal(metadata, dataset_metadata_fields), 200

    @service_api_ns.doc("delete_dataset_metadata")
    @service_api_ns.doc(description="Delete metadata")
    @service_api_ns.doc(params={"dataset_id": "Dataset ID", "metadata_id": "Metadata ID"})
    @service_api_ns.doc(
        responses={
            204: "Metadata deleted successfully",
            401: "Unauthorized - invalid API token",
            404: "Dataset or metadata not found",
        }
    )
    @cloud_edition_billing_rate_limit_check("knowledge", "dataset")
    def delete(self, tenant_id, dataset_id, metadata_id):
        """Delete metadata."""
        dataset_id_str = str(dataset_id)
        metadata_id_str = str(metadata_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")
        DatasetService.check_dataset_permission(dataset, current_user)

        MetadataService.delete_metadata(dataset_id_str, metadata_id_str)
        return 204


@service_api_ns.route("/datasets/<uuid:dataset_id>/metadata/built-in")
class DatasetMetadataBuiltInFieldServiceApi(DatasetApiResource):
    @service_api_ns.doc("get_built_in_fields")
    @service_api_ns.doc(description="Get all built-in metadata fields")
    @service_api_ns.doc(
        responses={
            200: "Built-in fields retrieved successfully",
            401: "Unauthorized - invalid API token",
        }
    )
    def get(self, tenant_id, dataset_id):
        """Get all built-in metadata fields."""
        built_in_fields = MetadataService.get_built_in_fields()
        return {"fields": built_in_fields}, 200


@service_api_ns.route("/datasets/<uuid:dataset_id>/metadata/built-in/<string:action>")
class DatasetMetadataBuiltInFieldActionServiceApi(DatasetApiResource):
    @service_api_ns.doc("toggle_built_in_field")
    @service_api_ns.doc(description="Enable or disable built-in metadata field")
    @service_api_ns.doc(params={"dataset_id": "Dataset ID", "action": "Action to perform: 'enable' or 'disable'"})
    @service_api_ns.doc(
        responses={
            200: "Action completed successfully",
            401: "Unauthorized - invalid API token",
            404: "Dataset not found",
        }
    )
    @cloud_edition_billing_rate_limit_check("knowledge", "dataset")
    def post(self, tenant_id, dataset_id, action: Literal["enable", "disable"]):
        """Enable or disable built-in metadata field."""
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


@service_api_ns.route("/datasets/<uuid:dataset_id>/documents/metadata")
class DocumentMetadataEditServiceApi(DatasetApiResource):
    @service_api_ns.expect(document_metadata_parser)
    @service_api_ns.doc("update_documents_metadata")
    @service_api_ns.doc(description="Update metadata for multiple documents")
    @service_api_ns.doc(params={"dataset_id": "Dataset ID"})
    @service_api_ns.doc(
        responses={
            200: "Documents metadata updated successfully",
            401: "Unauthorized - invalid API token",
            404: "Dataset not found",
        }
    )
    @cloud_edition_billing_rate_limit_check("knowledge", "dataset")
    def post(self, tenant_id, dataset_id):
        """Update metadata for multiple documents."""
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")
        DatasetService.check_dataset_permission(dataset, current_user)

        args = document_metadata_parser.parse_args()
        metadata_args = MetadataOperationData.model_validate(args)

        MetadataService.update_documents_metadata(dataset, metadata_args)

        return {"result": "success"}, 200
