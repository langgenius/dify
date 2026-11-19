from collections.abc import Callable
from functools import wraps
from uuid import UUID

from controllers.common.controller_schemas import MetadataUpdatePayload
from controllers.common.errors import ForbiddenError, InvalidArgumentError, NotFoundError
from controllers.common.schema import register_response_schema_models, register_schema_model, register_schema_models
from controllers.console.wraps import model_validate
from controllers.service_api import service_api_ns
from controllers.service_api.flask_admission import DatasetApiResource, dataset_admission
from extensions.ext_application_services import application_services
from fields.dataset_fields import (
    DatasetMetadataActionResponse,
    DatasetMetadataBuiltInFieldsResponse,
    DatasetMetadataListResponse,
    DatasetMetadataResponse,
)
from libs.helper import dump_response
from machinery.context import RequestContext
from services.errors.metadata import MetadataResourceNotFoundError
from services.knowledge.dataset_access import DatasetAccessDeniedError, DatasetNotFoundError
from services.knowledge.entities.knowledge_entities import (
    DocumentMetadataOperation,
    MetadataArgs,
    MetadataDetail,
    MetadataOperationData,
)
from services.knowledge.metadata.application import MetadataInvalidActionError


def metadata_errors[**P, T](method: Callable[P, T]) -> Callable[P, T]:
    """Translate metadata domain failures at the HTTP adapter boundary."""

    @wraps(method)
    def wrapped(*args: P.args, **kwargs: P.kwargs) -> T:
        try:
            return method(*args, **kwargs)
        except (DatasetNotFoundError, MetadataResourceNotFoundError) as error:
            raise NotFoundError(str(error)) from error
        except DatasetAccessDeniedError as error:
            raise ForbiddenError(str(error)) from error
        except MetadataInvalidActionError as error:
            raise InvalidArgumentError(str(error)) from error

    return wrapped


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
            400: "Bad request - invalid or duplicate metadata name",
            401: "Unauthorized - invalid API token",
            404: "Dataset not found",
        }
    )
    @service_api_ns.response(
        201, "Metadata created successfully", service_api_ns.models[DatasetMetadataResponse.__name__]
    )
    @dataset_admission(rate_limit=True)
    @metadata_errors
    @model_validate(MetadataArgs)
    def post(self, metadata_args: MetadataArgs, request_context: RequestContext, dataset_id: UUID):
        """Create metadata for a dataset."""
        metadata = application_services().knowledge.metadata.create_dataset_metadata(
            request_context, str(dataset_id), metadata_args
        )
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
    @dataset_admission()
    @metadata_errors
    def get(self, request_context: RequestContext, dataset_id: UUID):
        """Get all metadata for a dataset."""
        metadata = application_services().knowledge.metadata.list_dataset_metadata(request_context, str(dataset_id))
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
            400: "Bad request - invalid or duplicate metadata name",
            401: "Unauthorized - invalid API token",
            404: "Dataset or metadata not found",
        }
    )
    @service_api_ns.response(
        200, "Metadata updated successfully", service_api_ns.models[DatasetMetadataResponse.__name__]
    )
    @dataset_admission(rate_limit=True)
    @metadata_errors
    @model_validate(MetadataUpdatePayload)
    def patch(
        self,
        payload: MetadataUpdatePayload,
        request_context: RequestContext,
        dataset_id: UUID,
        metadata_id: UUID,
    ):
        """Update metadata name."""
        metadata = application_services().knowledge.metadata.rename_dataset_metadata(
            request_context,
            str(dataset_id),
            str(metadata_id),
            name=payload.name,
        )
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
    @dataset_admission(rate_limit=True)
    @metadata_errors
    def delete(self, request_context: RequestContext, dataset_id: UUID, metadata_id: UUID):
        """Delete metadata."""
        application_services().knowledge.metadata.delete_dataset_metadata(
            request_context, str(dataset_id), str(metadata_id)
        )
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
            404: "`not_found` : Knowledge base not found.",
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
    @dataset_admission()
    @metadata_errors
    def get(self, request_context: RequestContext, dataset_id: UUID):
        """Get all built-in metadata fields."""
        built_in_fields = application_services().knowledge.metadata.list_dataset_built_in_fields(
            request_context, str(dataset_id)
        )
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
    @dataset_admission(rate_limit=True)
    @metadata_errors
    def post(
        self,
        request_context: RequestContext,
        dataset_id: UUID,
        action: str,
    ):
        """Enable or disable built-in metadata field."""
        application_services().knowledge.metadata.apply_dataset_built_in_field_action(
            request_context,
            str(dataset_id),
            action=action,
        )
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
            400: "Bad request - invalid or conflicting document metadata operation",
            401: "Unauthorized - invalid API token",
            404: "Dataset, document, or metadata not found",
        }
    )
    @service_api_ns.response(
        200,
        "Documents metadata updated successfully",
        service_api_ns.models[DatasetMetadataActionResponse.__name__],
    )
    @dataset_admission(rate_limit=True)
    @metadata_errors
    @model_validate(MetadataOperationData)
    def post(self, metadata_args: MetadataOperationData, request_context: RequestContext, dataset_id: UUID):
        """Update metadata for multiple documents."""
        application_services().knowledge.metadata.update_dataset_documents_metadata(
            request_context, str(dataset_id), metadata_args
        )
        return dump_response(DatasetMetadataActionResponse, {"result": "success"}), 200
