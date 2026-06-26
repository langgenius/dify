from typing import Literal
from uuid import UUID

from flask_login import current_user
from werkzeug.exceptions import NotFound

from controllers.common.controller_schemas import MetadataUpdatePayload
from controllers.common.schema import register_response_schema_models, register_schema_model, register_schema_models
from controllers.service_api import service_api_ns
from controllers.service_api.wraps import DatasetApiResource, cloud_edition_billing_rate_limit_check
from extensions.ext_database import db
from fields.dataset_fields import (
    DatasetMetadataActionResponse,
    DatasetMetadataBuiltInFieldsResponse,
    DatasetMetadataListResponse,
    DatasetMetadataResponse,
)
from libs.helper import dump_response
from services.dataset_service import DatasetService
from services.entities.knowledge_entities.knowledge_entities import (
    DocumentMetadataOperation,
    MetadataArgs,
    MetadataDetail,
    MetadataOperationData,
)
from services.metadata_service import MetadataService

BUILT_IN_METADATA_ACTION_PARAM = {
    "description": "`enable` to activate built-in metadata fields, `disable` to deactivate them.",
    "enum": ["enable", "disable"],
    "type": "string",
}

register_schema_model(service_api_ns, MetadataUpdatePayload)
register_schema_models(
    service_api_ns,
    MetadataArgs,
    MetadataDetail,
    DocumentMetadataOperation,
    MetadataOperationData,
)
register_response_schema_models(
    service_api_ns,
    DatasetMetadataActionResponse,
    DatasetMetadataBuiltInFieldsResponse,
    DatasetMetadataListResponse,
    DatasetMetadataResponse,
)


@service_api_ns.route("/datasets/<uuid:dataset_id>/metadata")
class DatasetMetadataCreateServiceApi(DatasetApiResource):
    @service_api_ns.doc(
        summary="Create Metadata Field",
        description=(
            "Create a custom metadata field for the knowledge base. Metadata fields can be used to "
            "annotate documents with structured information."
        ),
        tags=["Metadata"],
        responses={
            201: "Metadata field created successfully.",
        },
    )
    @service_api_ns.expect(service_api_ns.models[MetadataArgs.__name__])
    @service_api_ns.doc("create_dataset_metadata")
    @service_api_ns.doc(description="Create metadata for a dataset")
    @service_api_ns.doc(params={"dataset_id": "Knowledge base ID."})
    @service_api_ns.doc(
        responses={
            201: "Metadata created successfully",
            401: "Unauthorized - invalid API token",
            404: "Dataset not found",
        }
    )
    @service_api_ns.response(
        201, "Metadata created successfully", service_api_ns.models[DatasetMetadataResponse.__name__]
    )
    @cloud_edition_billing_rate_limit_check("knowledge", "dataset")
    def post(self, tenant_id, dataset_id: UUID):
        """Create metadata for a dataset."""
        metadata_args = MetadataArgs.model_validate(service_api_ns.payload or {})

        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")
        DatasetService.check_dataset_permission(dataset, current_user, db.session)

        metadata = MetadataService.create_metadata(db.session(), dataset_id_str, metadata_args)
        return dump_response(DatasetMetadataResponse, metadata), 201

    @service_api_ns.doc(
        summary="List Metadata Fields",
        description=(
            "Returns the list of all metadata fields (both custom and built-in) for the knowledge base, "
            "along with the count of documents using each field."
        ),
        tags=["Metadata"],
        responses={
            200: "Metadata fields for the knowledge base.",
        },
    )
    @service_api_ns.doc("get_dataset_metadata")
    @service_api_ns.doc(description="Get all metadata for a dataset")
    @service_api_ns.doc(params={"dataset_id": "Knowledge base ID."})
    @service_api_ns.doc(
        responses={
            200: "Metadata retrieved successfully",
            401: "Unauthorized - invalid API token",
            404: "Dataset not found",
        }
    )
    @service_api_ns.response(
        200, "Metadata retrieved successfully", service_api_ns.models[DatasetMetadataListResponse.__name__]
    )
    def get(self, tenant_id, dataset_id: UUID):
        """Get all metadata for a dataset."""
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")
        metadata = MetadataService.get_dataset_metadatas(db.session(), dataset)
        return dump_response(DatasetMetadataListResponse, metadata), 200


@service_api_ns.route("/datasets/<uuid:dataset_id>/metadata/<uuid:metadata_id>")
class DatasetMetadataServiceApi(DatasetApiResource):
    @service_api_ns.doc(
        summary="Update Metadata Field",
        description="Rename a custom metadata field.",
        tags=["Metadata"],
        responses={
            200: "Metadata field updated successfully.",
        },
    )
    @service_api_ns.expect(service_api_ns.models[MetadataUpdatePayload.__name__])
    @service_api_ns.doc("update_dataset_metadata")
    @service_api_ns.doc(description="Update metadata name")
    @service_api_ns.doc(params={"dataset_id": "Knowledge base ID.", "metadata_id": "Metadata field ID."})
    @service_api_ns.doc(
        responses={
            200: "Metadata updated successfully",
            401: "Unauthorized - invalid API token",
            404: "Dataset or metadata not found",
        }
    )
    @service_api_ns.response(
        200, "Metadata updated successfully", service_api_ns.models[DatasetMetadataResponse.__name__]
    )
    @cloud_edition_billing_rate_limit_check("knowledge", "dataset")
    def patch(self, tenant_id, dataset_id: UUID, metadata_id: UUID):
        """Update metadata name."""
        payload = MetadataUpdatePayload.model_validate(service_api_ns.payload or {})

        dataset_id_str = str(dataset_id)
        metadata_id_str = str(metadata_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")
        DatasetService.check_dataset_permission(dataset, current_user, db.session)

        metadata = MetadataService.update_metadata_name(db.session(), dataset_id_str, metadata_id_str, payload.name)
        return dump_response(DatasetMetadataResponse, metadata), 200

    @service_api_ns.doc(
        summary="Delete Metadata Field",
        description=(
            "Permanently delete a custom metadata field. Documents using this field will lose their "
            "metadata values for it."
        ),
        tags=["Metadata"],
        responses={
            204: "Success.",
        },
    )
    @service_api_ns.doc("delete_dataset_metadata")
    @service_api_ns.doc(description="Delete metadata")
    @service_api_ns.doc(params={"dataset_id": "Knowledge base ID.", "metadata_id": "Metadata field ID."})
    @service_api_ns.doc(
        responses={
            204: "Metadata deleted successfully",
            401: "Unauthorized - invalid API token",
            404: "Dataset or metadata not found",
        }
    )
    @service_api_ns.response(204, "Metadata deleted successfully")
    @cloud_edition_billing_rate_limit_check("knowledge", "dataset")
    def delete(self, tenant_id, dataset_id: UUID, metadata_id: UUID):
        """Delete metadata."""
        dataset_id_str = str(dataset_id)
        metadata_id_str = str(metadata_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")
        DatasetService.check_dataset_permission(dataset, current_user, db.session)

        MetadataService.delete_metadata(db.session(), dataset_id_str, metadata_id_str)
        return "", 204


@service_api_ns.route("/datasets/<uuid:dataset_id>/metadata/built-in")
class DatasetMetadataBuiltInFieldServiceApi(DatasetApiResource):
    @service_api_ns.doc(
        summary="Get Built-in Metadata Fields",
        description=(
            "Returns the list of built-in metadata fields provided by the system (e.g., document type, source URL)."
        ),
        tags=["Metadata"],
        responses={
            200: "Built-in metadata fields.",
        },
    )
    @service_api_ns.doc("get_built_in_fields")
    @service_api_ns.doc(description="Get all built-in metadata fields")
    @service_api_ns.doc(params={"dataset_id": "Knowledge base ID."})
    @service_api_ns.doc(
        responses={
            200: "Built-in fields retrieved successfully",
            401: "Unauthorized - invalid API token",
        }
    )
    @service_api_ns.response(
        200,
        "Built-in fields retrieved successfully",
        service_api_ns.models[DatasetMetadataBuiltInFieldsResponse.__name__],
    )
    def get(self, tenant_id, dataset_id: UUID):
        """Get all built-in metadata fields."""
        built_in_fields = MetadataService.get_built_in_fields()
        return dump_response(DatasetMetadataBuiltInFieldsResponse, {"fields": built_in_fields}), 200


@service_api_ns.route("/datasets/<uuid:dataset_id>/metadata/built-in/<string:action>")
class DatasetMetadataBuiltInFieldActionServiceApi(DatasetApiResource):
    @service_api_ns.doc(
        summary="Update Built-in Metadata Field",
        description="Enable or disable built-in metadata fields for the knowledge base.",
        tags=["Metadata"],
        responses={
            200: "Built-in metadata field toggled successfully.",
        },
    )
    @service_api_ns.doc("toggle_built_in_field")
    @service_api_ns.doc(description="Enable or disable built-in metadata field")
    @service_api_ns.doc(params={"dataset_id": "Knowledge base ID.", "action": BUILT_IN_METADATA_ACTION_PARAM})
    @service_api_ns.doc(
        responses={
            200: "Action completed successfully",
            401: "Unauthorized - invalid API token",
            404: "Dataset not found",
        }
    )
    @service_api_ns.response(
        200, "Action completed successfully", service_api_ns.models[DatasetMetadataActionResponse.__name__]
    )
    @cloud_edition_billing_rate_limit_check("knowledge", "dataset")
    def post(self, tenant_id, dataset_id: UUID, action: Literal["enable", "disable"]):
        """Enable or disable built-in metadata field."""
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")
        DatasetService.check_dataset_permission(dataset, current_user, db.session)

        match action:
            case "enable":
                MetadataService.enable_built_in_field(db.session(), dataset)
            case "disable":
                MetadataService.disable_built_in_field(db.session(), dataset)
        return dump_response(DatasetMetadataActionResponse, {"result": "success"}), 200


@service_api_ns.route("/datasets/<uuid:dataset_id>/documents/metadata")
class DocumentMetadataEditServiceApi(DatasetApiResource):
    @service_api_ns.doc(
        summary="Update Document Metadata in Batch",
        description=(
            "Update metadata values for multiple documents at once. Each document in the request "
            "receives the specified metadata key-value pairs."
        ),
        tags=["Metadata"],
        responses={
            200: "Document metadata updated successfully.",
        },
    )
    @service_api_ns.expect(service_api_ns.models[MetadataOperationData.__name__])
    @service_api_ns.doc("update_documents_metadata")
    @service_api_ns.doc(description="Update metadata for multiple documents")
    @service_api_ns.doc(params={"dataset_id": "Knowledge base ID."})
    @service_api_ns.doc(
        responses={
            200: "Documents metadata updated successfully",
            401: "Unauthorized - invalid API token",
            404: "Dataset not found",
        }
    )
    @service_api_ns.response(
        200,
        "Documents metadata updated successfully",
        service_api_ns.models[DatasetMetadataActionResponse.__name__],
    )
    @cloud_edition_billing_rate_limit_check("knowledge", "dataset")
    def post(self, tenant_id, dataset_id: UUID):
        """Update metadata for multiple documents."""
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")
        DatasetService.check_dataset_permission(dataset, current_user, db.session)

        metadata_args = MetadataOperationData.model_validate(service_api_ns.payload or {})

        MetadataService.update_documents_metadata(db.session(), dataset, metadata_args)

        return dump_response(DatasetMetadataActionResponse, {"result": "success"}), 200
