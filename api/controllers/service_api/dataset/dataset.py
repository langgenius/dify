from collections.abc import Mapping
from http import HTTPStatus
from typing import Any, Literal, Never
from uuid import UUID

from flask import request

from controllers.common.errors import ForbiddenError, NotFoundError
from controllers.common.fields import SimpleResultResponse
from controllers.common.schema import (
    query_params_from_model,
    register_enum_models,
    register_response_schema_models,
    register_schema_models,
)
from controllers.console.wraps import model_validate
from controllers.service_api import service_api_ns
from controllers.service_api.dataset.error import (
    DatasetConcurrentUpdateError,
    DatasetInUseError,
    DatasetNameDuplicateError,
    InvalidActionError,
)
from controllers.service_api.flask_admission import DatasetApiResource, dataset_admission
from extensions.ext_application_services import application_services
from fields.service_api.dataset import (
    DatasetBoundTagListResponse,
    DatasetBoundTagResponse,
    DatasetCreatePayload,
    DatasetDetailResponse,
    DatasetDetailWithPartialMembersResponse,
    DatasetListQuery,
    DatasetListResponse,
    DatasetUpdatePayload,
    DocumentStatusPayload,
    KnowledgeTagListResponse,
    KnowledgeTagResponse,
    TagBindingPayload,
    TagCreatePayload,
    TagDeletePayload,
    TagUnbindingPayload,
    TagUpdatePayload,
)
from libs.external_api import error_responses
from libs.helper import dump_response
from machinery.context import RequestContext
from models.dataset import DatasetPermissionEnum
from services.errors.dataset import DatasetInUseError as DatasetInUseFailure
from services.errors.dataset import DatasetNameDuplicateError as DatasetNameDuplicateFailure
from services.knowledge.dataset_access import DatasetAccessDeniedError, DatasetNotFoundError
from services.knowledge.datasets.contracts import (
    DatasetConcurrentUpdateError as DatasetConcurrentUpdateFailure,
)
from services.knowledge.datasets.contracts import (
    DatasetDetailProjection,
    DatasetListFilter,
)
from services.knowledge.documents.application import DocumentIndexingStateError, DocumentInvalidActionError
from services.knowledge.entities.datasets import DatasetDetailRecord
from services.tag_application_service import (
    CreateTagInput,
    TagBindingInput,
    TagBindingTargetNotFoundError,
    TagNameConflictError,
    TagNotFoundError,
    UpdateTagInput,
)

register_enum_models(service_api_ns, DatasetPermissionEnum)


_SERVICE_DATASET_DETAIL_EXCLUDE = {"permission_keys", "keyword_number"}
_SERVICE_DATASET_LIST_EXCLUDE = {"data": {"__all__": _SERVICE_DATASET_DETAIL_EXCLUDE}}


def _raise_dataset_error(error: Exception) -> Never:
    if isinstance(error, DatasetNotFoundError):
        raise NotFoundError(description=str(error)) from error
    if isinstance(error, DatasetAccessDeniedError):
        raise ForbiddenError(description=str(error)) from error
    if isinstance(error, DatasetInUseFailure):
        raise DatasetInUseError() from error
    if isinstance(error, DatasetConcurrentUpdateFailure):
        raise DatasetConcurrentUpdateError() from error
    raise error


def _raise_dataset_create_error(error: Exception) -> Never:
    if isinstance(error, DatasetNameDuplicateFailure):
        raise DatasetNameDuplicateError() from error
    _raise_dataset_error(error)


def _raise_tag_error(error: Exception) -> Never:
    if isinstance(error, TagNameConflictError):
        raise ValueError(str(error)) from error
    if isinstance(error, (TagNotFoundError, TagBindingTargetNotFoundError)):
        raise NotFoundError(description=str(error)) from error
    raise error


def _dump_service_dataset_detail(detail: DatasetDetailRecord) -> dict[str, Any]:
    return DatasetDetailResponse.model_validate(detail).model_dump(
        mode="json",
        exclude=_SERVICE_DATASET_DETAIL_EXCLUDE,
    )


def _dump_service_dataset_list(response: Mapping[str, Any]) -> dict[str, Any]:
    return DatasetListResponse.model_validate(response).model_dump(
        mode="json",
        exclude=_SERVICE_DATASET_LIST_EXCLUDE,
    )


def _dump_service_dataset_with_partial_members(data: Mapping[str, Any]) -> dict[str, Any]:
    exclude: set[str] = set(_SERVICE_DATASET_DETAIL_EXCLUDE)
    if "partial_member_list" not in data:
        exclude.add("partial_member_list")

    return DatasetDetailWithPartialMembersResponse.model_validate(data).model_dump(mode="json", exclude=exclude)


DOCUMENT_STATUS_ACTION_PARAM = {
    "description": "Action to perform: 'enable', 'disable', 'archive', or 'un_archive'",
    "enum": ["enable", "disable", "archive", "un_archive"],
    "type": "string",
}


register_schema_models(
    service_api_ns,
    DatasetCreatePayload,
    DatasetUpdatePayload,
    DocumentStatusPayload,
    TagCreatePayload,
    TagUpdatePayload,
    TagDeletePayload,
    TagBindingPayload,
    TagUnbindingPayload,
    DatasetListQuery,
)
register_response_schema_models(
    service_api_ns,
    SimpleResultResponse,
    KnowledgeTagResponse,
    KnowledgeTagListResponse,
    DatasetDetailResponse,
    DatasetDetailWithPartialMembersResponse,
    DatasetListResponse,
    DatasetBoundTagListResponse,
)


@service_api_ns.route("/datasets")
class DatasetListApi(DatasetApiResource):
    """Resource for datasets."""

    @service_api_ns.doc(
        summary="List Knowledge Bases",
        description="Returns a paginated list of knowledge bases. Supports filtering by keyword and tags.",
        tags=["Knowledge Bases"],
        responses={
            HTTPStatus.OK: "List of knowledge bases.",
        },
    )
    @service_api_ns.doc("list_datasets")
    @service_api_ns.doc(description="List all datasets")
    @service_api_ns.doc(
        responses={
            HTTPStatus.OK: "Datasets retrieved successfully",
            HTTPStatus.UNAUTHORIZED: "Unauthorized - invalid API token",
        }
    )
    @service_api_ns.doc(params=query_params_from_model(DatasetListQuery))
    @service_api_ns.response(
        HTTPStatus.OK,
        "Datasets retrieved successfully",
        service_api_ns.models[DatasetListResponse.__name__],
    )
    def get(self, request_context: RequestContext):
        """Resource for getting datasets."""
        query_params: dict[str, str | list[str]] = dict(request.args.to_dict())
        if "tag_ids" in request.args:
            query_params["tag_ids"] = request.args.getlist("tag_ids")
        query = DatasetListQuery.model_validate(query_params)
        result = application_services().knowledge.datasets.list_workspace_datasets(
            request_context,
            DatasetListFilter(**query.model_dump()),
        )
        return _dump_service_dataset_list(result), HTTPStatus.OK

    @error_responses(DatasetNameDuplicateError)
    @service_api_ns.doc(
        summary="Create an Empty Knowledge Base",
        description=(
            "Create a new empty knowledge base. After creation, use [Create Document by "
            "Text](/api-reference/documents/create-document-by-text) or [Create Document by "
            "File](/api-reference/documents/create-document-by-file) to add documents."
        ),
        tags=["Knowledge Bases"],
        responses={
            200: "Knowledge base created successfully.",
            409: "`dataset_name_duplicate` : The dataset name already exists. Please modify your dataset name.",
        },
    )
    @service_api_ns.expect(service_api_ns.models[DatasetCreatePayload.__name__])
    @service_api_ns.doc("create_dataset")
    @service_api_ns.doc(description="Create a new dataset")
    @service_api_ns.doc(
        responses={
            200: "Dataset created successfully",
            401: "Unauthorized - invalid API token",
            400: "Bad request - invalid parameters",
        }
    )
    @service_api_ns.response(
        200,
        "Dataset created successfully",
        service_api_ns.models[DatasetDetailResponse.__name__],
    )
    @dataset_admission(rate_limit=True)
    @model_validate(DatasetCreatePayload)
    def post(self, payload: DatasetCreatePayload, request_context: RequestContext):
        """Resource for creating datasets."""
        try:
            values = payload.model_dump()
            values["permission"] = str(payload.permission) if payload.permission else None
            values["retrieval_model"] = payload.retrieval_model
            result = application_services().knowledge.datasets.create_dataset_with_requested_permission(
                request_context,
                values=values,
                projection=DatasetDetailProjection.CORE,
            )
        except Exception as error:
            _raise_dataset_create_error(error)
        return _dump_service_dataset_detail(result), 200


@service_api_ns.route("/datasets/<uuid:dataset_id>")
class DatasetApi(DatasetApiResource):
    """Resource for dataset."""

    @service_api_ns.doc(
        summary="Get Knowledge Base",
        description=(
            "Retrieve detailed information about a specific knowledge base, including its embedding "
            "model, retrieval configuration, and document statistics."
        ),
        tags=["Knowledge Bases"],
        responses={
            200: "Knowledge base details.",
            403: "`forbidden` : Insufficient permissions to access this knowledge base.",
            404: "`not_found` : Dataset not found.",
        },
    )
    @service_api_ns.doc("get_dataset")
    @service_api_ns.doc(description="Get a specific dataset by ID")
    @service_api_ns.doc(params={"dataset_id": "Knowledge base ID."})
    @service_api_ns.doc(
        responses={
            200: "Dataset retrieved successfully",
            401: "Unauthorized - invalid API token",
            403: "Forbidden - insufficient permissions",
            404: "Dataset not found",
        }
    )
    @service_api_ns.response(
        200,
        "Dataset retrieved successfully",
        service_api_ns.models[DatasetDetailWithPartialMembersResponse.__name__],
    )
    def get(self, request_context: RequestContext, dataset_id: UUID):
        try:
            result = application_services().knowledge.datasets.get_dataset(
                request_context,
                dataset_id=str(dataset_id),
                projection=DatasetDetailProjection.CORE,
            )
        except Exception as error:
            _raise_dataset_error(error)
        return _dump_service_dataset_with_partial_members(result), 200

    @service_api_ns.doc(
        summary="Update Knowledge Base",
        description=(
            "Update the name, description, permissions, or retrieval settings of an existing knowledge "
            "base. Only the fields provided in the request body are updated."
        ),
        tags=["Knowledge Bases"],
        responses={
            200: "Knowledge base updated successfully.",
            403: "`forbidden` : Insufficient permissions to access this knowledge base.",
            404: "`not_found` : Dataset not found.",
        },
    )
    @service_api_ns.expect(service_api_ns.models[DatasetUpdatePayload.__name__])
    @service_api_ns.doc("update_dataset")
    @service_api_ns.doc(description="Update an existing dataset")
    @service_api_ns.doc(params={"dataset_id": "Knowledge base ID."})
    @service_api_ns.doc(
        responses={
            200: "Dataset updated successfully",
            400: "Bad request - invalid embedding or reranking model configuration",
            401: "Unauthorized - invalid API token",
            403: "Forbidden - insufficient permissions",
            404: "Dataset not found",
            409: "Conflict - dataset changed during the update",
        }
    )
    @service_api_ns.response(
        200,
        "Dataset updated successfully",
        service_api_ns.models[DatasetDetailWithPartialMembersResponse.__name__],
    )
    @error_responses(DatasetConcurrentUpdateError)
    @dataset_admission(rate_limit=True)
    @model_validate(DatasetUpdatePayload)
    def patch(self, payload: DatasetUpdatePayload, request_context: RequestContext, dataset_id: UUID):
        update_data = payload.model_dump(exclude_unset=True)
        if payload.permission is not None:
            update_data["permission"] = str(payload.permission)
        if payload.retrieval_model is not None:
            update_data["retrieval_model"] = payload.retrieval_model.model_dump()
        if payload.permission == DatasetPermissionEnum.PARTIAL_TEAM and not payload.partial_member_list:
            update_data.pop("partial_member_list", None)
        try:
            result = application_services().knowledge.datasets.update_dataset(
                request_context,
                dataset_id=str(dataset_id),
                values=update_data,
                projection=DatasetDetailProjection.CORE,
            )
        except Exception as error:
            _raise_dataset_error(error)
        return _dump_service_dataset_with_partial_members(result), 200

    @service_api_ns.doc(
        summary="Delete Knowledge Base",
        description="Permanently delete a knowledge base and all its documents.",
        tags=["Knowledge Bases"],
        responses={
            204: "Success.",
            404: "`not_found` : Dataset not found.",
        },
    )
    @service_api_ns.doc("delete_dataset")
    @service_api_ns.doc(description="Delete a dataset")
    @service_api_ns.doc(params={"dataset_id": "Knowledge base ID."})
    @service_api_ns.doc(
        responses={
            204: "Dataset deleted successfully",
            401: "Unauthorized - invalid API token",
            404: "Dataset not found",
        }
    )
    @dataset_admission(rate_limit=True)
    def delete(self, request_context: RequestContext, dataset_id: UUID):
        try:
            application_services().knowledge.datasets.delete_dataset(
                request_context,
                dataset_id=str(dataset_id),
            )
        except Exception as error:
            _raise_dataset_error(error)
        return "", 204


@service_api_ns.route("/datasets/<uuid:dataset_id>/documents/status/<string:action>")
class DocumentStatusApi(DatasetApiResource):
    """Resource for batch document status operations."""

    @error_responses(InvalidActionError)
    @service_api_ns.doc(
        summary="Update Document Status in Batch",
        description="Enable, disable, archive, or unarchive multiple documents at once.",
        tags=["Documents"],
        responses={
            200: "Documents updated successfully.",
            400: "`invalid_action` : Invalid action.",
            403: "`forbidden` : Insufficient permissions.",
            404: "`not_found` : Knowledge base not found.",
        },
    )
    @service_api_ns.response(
        200,
        "Document status updated successfully",
        service_api_ns.models[SimpleResultResponse.__name__],
    )
    @service_api_ns.doc("update_document_status")
    @service_api_ns.doc(description="Batch update document status")
    @service_api_ns.doc(
        params={
            "dataset_id": "Knowledge base ID.",
            "action": DOCUMENT_STATUS_ACTION_PARAM,
        }
    )
    @service_api_ns.doc(
        responses={
            200: "Document status updated successfully",
            401: "Unauthorized - invalid API token",
            403: "Forbidden - insufficient permissions",
            404: "Dataset not found",
            400: "Bad request - invalid action",
        }
    )
    @service_api_ns.expect(service_api_ns.models[DocumentStatusPayload.__name__])
    @model_validate(DocumentStatusPayload)
    def patch(
        self,
        payload: DocumentStatusPayload,
        request_context: RequestContext,
        dataset_id: UUID,
        action: Literal["enable", "disable", "archive", "un_archive"],
    ):
        try:
            application_services().knowledge.documents.change_status(
                request_context,
                dataset_id=str(dataset_id),
                document_ids=payload.document_ids,
                action=action,
            )
        except (DocumentIndexingStateError, DocumentInvalidActionError) as error:
            raise InvalidActionError(str(error)) from error
        except Exception as error:
            _raise_dataset_error(error)

        return SimpleResultResponse(result="success").model_dump(mode="json"), 200


@service_api_ns.route("/datasets/tags")
class DatasetTagsApi(DatasetApiResource):
    @service_api_ns.doc(
        summary="List Knowledge Tags",
        description="Returns the list of all knowledge base tags in the workspace.",
        tags=["Tags"],
        responses={
            200: "List of tags.",
        },
    )
    @service_api_ns.doc("list_dataset_tags")
    @service_api_ns.doc(description="Get all knowledge type tags")
    @service_api_ns.doc(
        responses={
            200: "Tags retrieved successfully",
            401: "Unauthorized - invalid API token",
        }
    )
    @service_api_ns.response(
        200,
        "Tags retrieved successfully",
        service_api_ns.models[KnowledgeTagListResponse.__name__],
    )
    def get(self, request_context: RequestContext):
        """Get all knowledge type tags."""
        tags = application_services().tags.list_tags(request_context, "knowledge")
        return dump_response(KnowledgeTagListResponse, tags), 200

    @service_api_ns.doc(
        summary="Create Knowledge Tag",
        description="Create a new tag for organizing knowledge bases.",
        tags=["Tags"],
        responses={
            200: "Tag created successfully.",
        },
    )
    @service_api_ns.expect(service_api_ns.models[TagCreatePayload.__name__])
    @service_api_ns.doc("create_dataset_tag")
    @service_api_ns.doc(description="Add a knowledge type tag")
    @service_api_ns.doc(
        responses={
            200: "Tag created successfully",
            400: "Bad request - tag name already exists",
            401: "Unauthorized - invalid API token",
            403: "Forbidden - insufficient permissions",
        }
    )
    @service_api_ns.response(
        200,
        "Tag created successfully",
        service_api_ns.models[KnowledgeTagResponse.__name__],
    )
    @dataset_admission(require_edit_permission=True)
    @model_validate(TagCreatePayload)
    def post(self, payload: TagCreatePayload, request_context: RequestContext):
        """Add a knowledge type tag."""
        try:
            tag = application_services().tags.create_tag(
                request_context,
                CreateTagInput(name=payload.name, type="knowledge"),
            )
        except Exception as error:
            _raise_tag_error(error)
        return dump_response(KnowledgeTagResponse, tag), 200

    @service_api_ns.doc(
        summary="Update Knowledge Tag",
        description="Rename an existing knowledge base tag.",
        tags=["Tags"],
        responses={
            200: "Tag updated successfully.",
        },
    )
    @service_api_ns.expect(service_api_ns.models[TagUpdatePayload.__name__])
    @service_api_ns.doc("update_dataset_tag")
    @service_api_ns.doc(description="Update a knowledge type tag")
    @service_api_ns.doc(
        responses={
            200: "Tag updated successfully",
            400: "Bad request - tag name already exists",
            401: "Unauthorized - invalid API token",
            403: "Forbidden - insufficient permissions",
            404: "Tag not found",
        }
    )
    @service_api_ns.response(
        200,
        "Tag updated successfully",
        service_api_ns.models[KnowledgeTagResponse.__name__],
    )
    @dataset_admission(require_edit_permission=True)
    @model_validate(TagUpdatePayload)
    def patch(self, payload: TagUpdatePayload, request_context: RequestContext):
        try:
            tag = application_services().tags.update_tag(
                request_context,
                payload.tag_id,
                UpdateTagInput(name=payload.name),
                expected_type="knowledge",
            )
        except Exception as error:
            _raise_tag_error(error)
        return dump_response(KnowledgeTagResponse, tag), 200

    @service_api_ns.doc(
        summary="Delete Knowledge Tag",
        description="Permanently delete a knowledge base tag. Does not delete the knowledge bases that were tagged.",
        tags=["Tags"],
        responses={
            204: "Success.",
        },
    )
    @service_api_ns.expect(service_api_ns.models[TagDeletePayload.__name__])
    @service_api_ns.doc("delete_dataset_tag")
    @service_api_ns.doc(description="Delete a knowledge type tag")
    @service_api_ns.doc(
        responses={
            204: "Tag deleted successfully",
            401: "Unauthorized - invalid API token",
            403: "Forbidden - insufficient permissions",
            404: "Tag not found",
        }
    )
    @dataset_admission(require_edit_permission=True)
    @model_validate(TagDeletePayload)
    def delete(self, payload: TagDeletePayload, request_context: RequestContext):
        """Delete a knowledge type tag."""
        try:
            application_services().tags.delete_tag(
                request_context,
                payload.tag_id,
                expected_type="knowledge",
            )
        except Exception as error:
            _raise_tag_error(error)
        return "", 204


@service_api_ns.route("/datasets/tags/binding")
class DatasetTagBindingApi(DatasetApiResource):
    @service_api_ns.doc(
        summary="Create Tag Binding",
        description="Bind one or more tags to a knowledge base. A knowledge base can have multiple tags.",
        tags=["Tags"],
        responses={
            204: "Success.",
        },
    )
    @service_api_ns.expect(service_api_ns.models[TagBindingPayload.__name__])
    @service_api_ns.doc("bind_dataset_tags")
    @service_api_ns.doc(description="Bind tags to a dataset")
    @service_api_ns.doc(
        responses={
            204: "Tags bound successfully",
            401: "Unauthorized - invalid API token",
            403: "Forbidden - insufficient permissions",
            404: "Dataset not found",
        }
    )
    @dataset_admission(require_edit_permission=True)
    @model_validate(TagBindingPayload)
    def post(self, payload: TagBindingPayload, request_context: RequestContext):
        try:
            application_services().tags.create_bindings(
                request_context,
                TagBindingInput(tag_ids=tuple(payload.tag_ids), target_id=payload.target_id, type="knowledge"),
            )
        except Exception as error:
            _raise_tag_error(error)
        return "", 204


@service_api_ns.route("/datasets/tags/unbinding")
class DatasetTagUnbindingApi(DatasetApiResource):
    @service_api_ns.doc(
        summary="Delete Tag Binding",
        description="Remove one or more tags from a knowledge base.",
        tags=["Tags"],
        responses={
            204: "Success.",
        },
    )
    @service_api_ns.expect(service_api_ns.models[TagUnbindingPayload.__name__])
    @service_api_ns.doc("unbind_dataset_tags")
    @service_api_ns.doc(description="Unbind tags from a dataset")
    @service_api_ns.doc(
        responses={
            204: "Tags unbound successfully",
            401: "Unauthorized - invalid API token",
            403: "Forbidden - insufficient permissions",
            404: "Dataset not found",
        }
    )
    @dataset_admission(require_edit_permission=True)
    @model_validate(TagUnbindingPayload)
    def post(self, payload: TagUnbindingPayload, request_context: RequestContext):
        try:
            application_services().tags.delete_bindings(
                request_context,
                TagBindingInput(tag_ids=tuple(payload.tag_ids), target_id=payload.target_id, type="knowledge"),
            )
        except Exception as error:
            _raise_tag_error(error)
        return "", 204


@service_api_ns.route("/datasets/<uuid:dataset_id>/tags")
class DatasetTagsBindingStatusApi(DatasetApiResource):
    @service_api_ns.doc(
        summary="Get Knowledge Base Tags",
        description="Returns the list of tags bound to a specific knowledge base.",
        tags=["Tags"],
        responses={
            200: "Tags bound to the knowledge base.",
            404: "`not_found` : Knowledge base not found.",
        },
    )
    @service_api_ns.doc("get_dataset_tags_binding_status")
    @service_api_ns.doc(description="Get tags bound to a specific dataset")
    @service_api_ns.doc(params={"dataset_id": "Knowledge base ID."})
    @service_api_ns.doc(
        responses={
            200: "Tags retrieved successfully",
            401: "Unauthorized - invalid API token",
        }
    )
    @service_api_ns.response(
        200,
        "Tags retrieved successfully",
        service_api_ns.models[DatasetBoundTagListResponse.__name__],
    )
    def get(self, request_context: RequestContext, dataset_id: UUID):
        """Get all knowledge type tags."""
        tags = application_services().tags.list_tags_by_target(request_context, str(dataset_id), "knowledge")
        response = DatasetBoundTagListResponse(
            data=[DatasetBoundTagResponse(id=tag.id, name=tag.name) for tag in tags],
            total=len(tags),
        )
        return response.model_dump(mode="json"), 200
