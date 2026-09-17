from collections.abc import Callable
from functools import wraps
from uuid import UUID

from flask_restx import Resource
from werkzeug.exceptions import Forbidden, NotFound

from controllers.common.controller_schemas import MetadataUpdatePayload
from controllers.common.rbac import DatasetId, RBACCheck
from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import model_validate
from core.rbac import RBACPermission
from extensions.ext_application_services import application_services
from fields.dataset_fields import (
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


def metadata_errors[**P, T](method: Callable[P, T]) -> Callable[P, T]:
    @wraps(method)
    def wrapped(*args: P.args, **kwargs: P.kwargs) -> T:
        try:
            return method(*args, **kwargs)
        except (DatasetNotFoundError, MetadataResourceNotFoundError) as error:
            raise NotFound(str(error)) from error
        except DatasetAccessDeniedError as error:
            raise Forbidden(str(error)) from error

    return wrapped


register_schema_models(
    console_ns, MetadataArgs, MetadataOperationData, MetadataUpdatePayload, DocumentMetadataOperation, MetadataDetail
)
register_response_schema_models(
    console_ns,
    DatasetMetadataBuiltInFieldsResponse,
    DatasetMetadataListResponse,
    DatasetMetadataResponse,
)


@console_ns.route("/datasets/<uuid:dataset_id>/metadata")
class DatasetMetadataCreateApi(Resource):
    @console_ns.response(201, "Metadata created successfully", console_ns.models[DatasetMetadataResponse.__name__])
    @console_ns.expect(console_ns.models[MetadataArgs.__name__])
    @console_account_admission(
        rbac_checks=(RBACCheck(RBACPermission.DATASET_EDIT, DatasetId()),),
    )
    @metadata_errors
    @model_validate(MetadataArgs)
    def post(self, req_data: MetadataArgs, request_context: RequestContext, dataset_id: UUID):
        service = application_services().knowledge.metadata
        ref = service.require_dataset(request_context, str(dataset_id))
        metadata = service.create_metadata(ref, req_data, actor_id=request_context.account_id)
        return dump_response(DatasetMetadataResponse, metadata), 201

    @console_ns.response(
        200, "Metadata retrieved successfully", console_ns.models[DatasetMetadataListResponse.__name__]
    )
    @console_account_admission(
        rbac_checks=(RBACCheck(RBACPermission.DATASET_CREATE_AND_MANAGEMENT, DatasetId()),),
    )
    @metadata_errors
    def get(self, request_context: RequestContext, dataset_id: UUID):
        service = application_services().knowledge.metadata
        ref = service.require_dataset(request_context, str(dataset_id))
        return dump_response(DatasetMetadataListResponse, service.get_dataset_metadatas(ref)), 200


@console_ns.route("/datasets/<uuid:dataset_id>/metadata/<uuid:metadata_id>")
class DatasetMetadataApi(Resource):
    @console_ns.response(200, "Metadata updated successfully", console_ns.models[DatasetMetadataResponse.__name__])
    @console_ns.expect(console_ns.models[MetadataUpdatePayload.__name__])
    @console_account_admission(
        rbac_checks=(RBACCheck(RBACPermission.DATASET_EDIT, DatasetId()),),
    )
    @metadata_errors
    @model_validate(MetadataUpdatePayload)
    def patch(
        self, req_data: MetadataUpdatePayload, request_context: RequestContext, dataset_id: UUID, metadata_id: UUID
    ):
        service = application_services().knowledge.metadata
        ref = service.require_dataset(request_context, str(dataset_id))
        metadata = service.update_metadata_name(
            ref, str(metadata_id), req_data.name, actor_id=request_context.account_id
        )
        return dump_response(DatasetMetadataResponse, metadata), 200

    @console_ns.response(204, "Metadata deleted successfully")
    @console_account_admission(
        rbac_checks=(RBACCheck(RBACPermission.DATASET_EDIT, DatasetId()),),
    )
    @metadata_errors
    def delete(self, request_context: RequestContext, dataset_id: UUID, metadata_id: UUID):
        service = application_services().knowledge.metadata
        ref = service.require_dataset(request_context, str(dataset_id))
        service.delete_metadata(ref, str(metadata_id))
        return "", 204


@console_ns.route("/datasets/metadata/built-in")
class DatasetMetadataBuiltInFieldApi(Resource):
    @console_ns.response(
        200,
        "Built-in fields retrieved successfully",
        console_ns.models[DatasetMetadataBuiltInFieldsResponse.__name__],
    )
    @console_account_admission()
    @metadata_errors
    def get(self, request_context: RequestContext):
        fields = application_services().knowledge.metadata.get_built_in_fields()
        return dump_response(DatasetMetadataBuiltInFieldsResponse, {"fields": fields}), 200


@console_ns.route("/datasets/<uuid:dataset_id>/metadata/built-in/<string:action>")
class DatasetMetadataBuiltInFieldActionApi(Resource):
    @console_ns.response(204, "Action completed successfully")
    @console_account_admission(
        rbac_checks=(RBACCheck(RBACPermission.DATASET_EDIT, DatasetId()),),
    )
    @metadata_errors
    def post(self, request_context: RequestContext, dataset_id: UUID, action: str):
        service = application_services().knowledge.metadata
        ref = service.require_dataset(request_context, str(dataset_id))
        if action == "enable":
            service.enable_built_in_field(ref)
        elif action == "disable":
            service.disable_built_in_field(ref)
        else:
            raise ValueError("Invalid action.")
        return "", 204


@console_ns.route("/datasets/<uuid:dataset_id>/documents/metadata")
class DocumentMetadataEditApi(Resource):
    @console_ns.expect(console_ns.models[MetadataOperationData.__name__])
    @console_ns.response(
        204,
        "Documents metadata updated successfully",
    )
    @console_ns.response(404, "Dataset, document, or metadata not found")
    @console_account_admission(
        rbac_checks=(RBACCheck(RBACPermission.DATASET_EDIT, DatasetId()),),
    )
    @metadata_errors
    @model_validate(MetadataOperationData)
    def post(self, req_data: MetadataOperationData, request_context: RequestContext, dataset_id: UUID):
        service = application_services().knowledge.metadata
        ref = service.require_dataset(request_context, str(dataset_id))
        service.update_documents_metadata(ref, req_data, actor_id=request_context.account_id)
        return "", 204
