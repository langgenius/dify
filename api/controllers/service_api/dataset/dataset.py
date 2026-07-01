from typing import Annotated, Any, Literal, override
from uuid import UUID

from flask import request
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    GetJsonSchemaHandler,
    RootModel,
    WithJsonSchema,
    field_validator,
    model_validator,
)
from werkzeug.exceptions import Forbidden, NotFound

import services
from configs import dify_config
from controllers.common.fields import SimpleResultResponse
from controllers.common.schema import (
    query_params_from_model,
    register_enum_models,
    register_response_schema_models,
    register_schema_models,
)
from controllers.console.wraps import edit_permission_required
from controllers.service_api import service_api_ns
from controllers.service_api.dataset.error import DatasetInUseError, DatasetNameDuplicateError, InvalidActionError
from controllers.service_api.wraps import (
    DatasetApiResource,
    cloud_edition_billing_rate_limit_check,
)
from core.plugin.impl.model_runtime_factory import create_plugin_provider_manager
from core.rag.index_processor.constant.index_type import IndexTechniqueType
from extensions.ext_database import db
from fields.base import ResponseModel
from fields.dataset_fields import DatasetDetailResponse
from graphon.model_runtime.entities.model_entities import ModelType
from libs.helper import dump_response
from libs.login import current_user
from models.account import Account
from models.dataset import DatasetPermissionEnum
from models.enums import TagType
from models.provider_ids import ModelProviderID
from services.dataset_service import DatasetPermissionService, DatasetService, DocumentService
from services.entities.knowledge_entities.knowledge_entities import (
    ExternalRetrievalModel,
    KnowledgeProvider,
    RetrievalModel,
    SummaryIndexSetting,
)
from services.tag_service import (
    SaveTagPayload,
    TagBindingCreatePayload,
    TagBindingDeletePayload,
    TagService,
)
from services.tag_service import (
    UpdateTagPayload as UpdateTagServicePayload,
)

register_enum_models(service_api_ns, DatasetPermissionEnum)

PartialMemberList = Annotated[
    list[dict[str, str]] | None,
    WithJsonSchema(
        {
            "anyOf": [
                {
                    "items": {
                        "properties": {
                            "user_id": {
                                "description": "ID of the team member to grant access.",
                                "type": "string",
                            }
                        },
                        "type": "object",
                    },
                    "type": "array",
                },
                {"type": "null"},
            ]
        }
    ),
]


_SERVICE_DATASET_DETAIL_EXCLUDE = {"permission_keys"}
_SERVICE_DATASET_LIST_EXCLUDE = {"data": {"__all__": _SERVICE_DATASET_DETAIL_EXCLUDE}}


def _dump_service_dataset_detail(dataset: Any) -> dict[str, Any]:
    return DatasetDetailResponse.model_validate(dataset, from_attributes=True).model_dump(
        mode="json",
        exclude=_SERVICE_DATASET_DETAIL_EXCLUDE,
    )


def _dump_service_dataset_list(response: dict[str, Any]) -> dict[str, Any]:
    return DatasetListResponse.model_validate(response).model_dump(
        mode="json",
        exclude=_SERVICE_DATASET_LIST_EXCLUDE,
    )


def _dump_service_dataset_with_partial_members(data: dict[str, Any]) -> dict[str, Any]:
    exclude: set[str] = set(_SERVICE_DATASET_DETAIL_EXCLUDE)
    if "partial_member_list" not in data:
        exclude.add("partial_member_list")

    return DatasetDetailWithPartialMembersResponse.model_validate(data).model_dump(mode="json", exclude=exclude)


class DatasetCreatePayload(BaseModel):
    name: str = Field(..., min_length=1, max_length=40, description="Name of the knowledge base.")
    description: str = Field(default="", description="Description of the knowledge base.", max_length=400)
    indexing_technique: Literal["high_quality", "economy"] | None = Field(
        default=None,
        description="`high_quality` uses embedding models for precise search; `economy` uses keyword-based indexing.",
    )
    permission: DatasetPermissionEnum | None = Field(
        default=DatasetPermissionEnum.ONLY_ME,
        description=(
            "Controls who can access this knowledge base. `only_me` restricts access to the creator, "
            "`all_team_members` grants workspace-wide access, and `partial_members` grants access to specified "
            "members."
        ),
    )
    external_knowledge_api_id: str | None = Field(default=None, description="ID of the external knowledge API.")
    provider: KnowledgeProvider = Field(
        default="vendor",
        description="Knowledge base provider: `vendor` for internal knowledge bases, `external` for external ones.",
    )
    external_knowledge_id: str | None = Field(default=None, description="ID of the external knowledge base.")
    retrieval_model: RetrievalModel | None = Field(
        default=None,
        description="Retrieval model configuration. Controls how chunks are searched and ranked.",
    )
    embedding_model: str | None = Field(
        default=None,
        description=(
            "Embedding model name. Use the `model` field from "
            "[Get Available Models](/api-reference/models/get-available-models) with `model_type=text-embedding`."
        ),
    )
    embedding_model_provider: str | None = Field(
        default=None,
        description=(
            "Embedding model provider. Use the `provider` field from "
            "[Get Available Models](/api-reference/models/get-available-models) with `model_type=text-embedding`."
        ),
    )
    summary_index_setting: SummaryIndexSetting = Field(
        default=None,
        description="Summary index configuration.",
    )


class DatasetUpdatePayload(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=40, description="Name of the knowledge base.")
    description: str | None = Field(default=None, description="Description of the knowledge base.", max_length=400)
    indexing_technique: Literal["high_quality", "economy"] | None = Field(
        default=None,
        description="`high_quality` uses embedding models for precise search; `economy` uses keyword-based indexing.",
    )
    permission: DatasetPermissionEnum | None = Field(
        default=None,
        description=(
            "Controls who can access this knowledge base. `only_me` restricts access to the creator, "
            "`all_team_members` grants workspace-wide access, and `partial_members` grants access to specified "
            "members."
        ),
    )
    embedding_model: str | None = Field(
        default=None,
        description=(
            "Embedding model name. Use the `model` field from "
            "[Get Available Models](/api-reference/models/get-available-models) with `model_type=text-embedding`."
        ),
    )
    embedding_model_provider: str | None = Field(
        default=None,
        description=(
            "Embedding model provider. Use the `provider` field from "
            "[Get Available Models](/api-reference/models/get-available-models) with `model_type=text-embedding`."
        ),
    )
    retrieval_model: RetrievalModel | None = Field(
        default=None,
        description="Retrieval model configuration. Controls how chunks are searched and ranked.",
    )
    partial_member_list: PartialMemberList = Field(
        default=None,
        description="List of team members with access when `permission` is `partial_members`.",
    )
    external_retrieval_model: ExternalRetrievalModel = Field(
        default=None,
        description="Retrieval settings for external knowledge bases.",
    )
    external_knowledge_id: str | None = Field(default=None, description="ID of the external knowledge base.")
    external_knowledge_api_id: str | None = Field(default=None, description="ID of the external knowledge API.")


class DocumentStatusPayload(BaseModel):
    document_ids: list[str] = Field(default_factory=list, description="List of document IDs to update.")


DOCUMENT_STATUS_ACTION_PARAM = {
    "description": "Action to perform: 'enable', 'disable', 'archive', or 'un_archive'",
    "enum": ["enable", "disable", "archive", "un_archive"],
    "type": "string",
}


class TagNamePayload(BaseModel):
    name: str = Field(..., min_length=1, max_length=50, description="Tag name.")


class TagCreatePayload(TagNamePayload):
    pass


class TagUpdatePayload(TagNamePayload):
    tag_id: str = Field(description="Tag ID to update.")


class TagDeletePayload(BaseModel):
    tag_id: str = Field(description="Tag ID to delete.")


class TagBindingPayload(BaseModel):
    tag_ids: list[str] = Field(description="Tag IDs to bind.")
    target_id: str = Field(description="Knowledge base ID to bind the tags to.")

    @field_validator("tag_ids")
    @classmethod
    def validate_tag_ids(cls, value: list[str]) -> list[str]:
        if not value:
            raise ValueError("Tag IDs is required.")
        return value


class TagUnbindingPayload(BaseModel):
    """Accept the legacy single-tag Service API payload while exposing a normalized tag_ids list internally."""

    tag_ids: list[str] = Field(default_factory=list)
    tag_id: str | None = None
    target_id: str = Field(description="Knowledge base ID.")

    @classmethod
    @override
    def __get_pydantic_json_schema__(cls, _core_schema: object, _handler: GetJsonSchemaHandler) -> dict[str, object]:
        tag_id_property = {
            "description": "Legacy single tag ID accepted by the Service API.",
            "type": "string",
        }
        tag_ids_property = {
            "description": "Tag IDs to unbind. Use this for new integrations.",
            "items": {"type": "string"},
            "minItems": 1,
            "type": "array",
        }
        target_id_property = {"description": "Knowledge base ID.", "title": "Target Id", "type": "string"}
        return {
            "anyOf": [
                {
                    "properties": {
                        "tag_id": tag_id_property,
                        "tag_ids": tag_ids_property,
                        "target_id": target_id_property,
                    },
                    "required": ["tag_id", "target_id"],
                    "type": "object",
                },
                {
                    "properties": {
                        "tag_id": {**tag_id_property, "nullable": True},
                        "tag_ids": tag_ids_property,
                        "target_id": target_id_property,
                    },
                    "required": ["tag_ids", "target_id"],
                    "type": "object",
                },
            ],
            "description": "Accepts either the legacy tag_id payload or the normalized tag_ids payload.",
            "title": cls.__name__,
        }

    @model_validator(mode="before")
    @classmethod
    def normalize_legacy_tag_id(cls, data: object) -> object:
        if not isinstance(data, dict):
            return data
        if not data.get("tag_ids") and data.get("tag_id"):
            return {**data, "tag_ids": [data["tag_id"]]}
        return data

    @model_validator(mode="after")
    def validate_tag_ids(self) -> "TagUnbindingPayload":
        if not self.tag_ids:
            raise ValueError("Tag IDs is required.")
        return self


class KnowledgeTagResponse(ResponseModel):
    model_config = ConfigDict(coerce_numbers_to_str=True)

    id: str
    name: str
    type: str
    # TODO: The public Service API docs expose binding_count as string|null.
    # Keep matching the old RESTX fields.String coercion until that contract is intentionally migrated.
    binding_count: str | None = None


class KnowledgeTagListResponse(RootModel[list[KnowledgeTagResponse]]):
    pass


class DatasetListQuery(BaseModel):
    page: int = Field(default=1, description="Page number to retrieve.")
    limit: int = Field(default=20, description="Number of items per page. Server caps at `100`.")
    keyword: str | None = Field(default=None, description="Search keyword to filter by name.")
    include_all: bool = Field(
        default=False,
        description="Whether to include all knowledge bases regardless of permissions.",
    )
    tag_ids: list[str] = Field(default_factory=list, description="Tag IDs to filter by.")


class DatasetDetailWithPartialMembersResponse(DatasetDetailResponse):
    partial_member_list: list[str] | None = None


# todo: duplicate code, but the partial_member_list has different nullability
class DatasetListResponse(ResponseModel):
    data: list[DatasetDetailResponse]
    has_more: bool
    limit: int
    total: int
    page: int


class DatasetBoundTagResponse(ResponseModel):
    id: str
    name: str


class DatasetBoundTagListResponse(ResponseModel):
    data: list[DatasetBoundTagResponse]
    total: int


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
            200: "List of knowledge bases.",
        },
    )
    @service_api_ns.doc("list_datasets")
    @service_api_ns.doc(description="List all datasets")
    @service_api_ns.doc(
        responses={
            200: "Datasets retrieved successfully",
            401: "Unauthorized - invalid API token",
        }
    )
    @service_api_ns.doc(params=query_params_from_model(DatasetListQuery))
    @service_api_ns.response(
        200,
        "Datasets retrieved successfully",
        service_api_ns.models[DatasetListResponse.__name__],
    )
    def get(self, tenant_id):
        """Resource for getting datasets."""
        query_params: dict[str, str | list[str]] = dict(request.args.to_dict())
        if "tag_ids" in request.args:
            query_params["tag_ids"] = request.args.getlist("tag_ids")
        query = DatasetListQuery.model_validate(query_params)
        # provider = request.args.get("provider", default="vendor")

        datasets, total = DatasetService.get_datasets(
            query.page,
            query.limit,
            db.session,
            tenant_id,
            current_user,
            query.keyword,
            query.tag_ids,
            query.include_all,
        )
        # check embedding setting
        assert isinstance(current_user, Account)
        cid = current_user.current_tenant_id
        assert cid is not None
        provider_manager = create_plugin_provider_manager(tenant_id=cid)
        configurations = provider_manager.get_configurations(tenant_id=cid)

        embedding_models = configurations.get_models(model_type=ModelType.TEXT_EMBEDDING, only_active=True)

        model_names = []
        for embedding_model in embedding_models:
            model_names.append(f"{embedding_model.model}:{embedding_model.provider.provider}")

        data = [_dump_service_dataset_detail(dataset) for dataset in datasets]
        for item in data:
            if item["indexing_technique"] == IndexTechniqueType.HIGH_QUALITY and item["embedding_model_provider"]:
                item["embedding_model_provider"] = str(ModelProviderID(item["embedding_model_provider"]))
                item_model = f"{item['embedding_model']}:{item['embedding_model_provider']}"
                if item_model in model_names:
                    item["embedding_available"] = True
                else:
                    item["embedding_available"] = False
            else:
                item["embedding_available"] = True
        response = {
            "data": data,
            "has_more": len(datasets) == query.limit,
            "limit": query.limit,
            "total": total,
            "page": query.page,
        }
        return _dump_service_dataset_list(response), 200

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
    @cloud_edition_billing_rate_limit_check("knowledge", "dataset")
    def post(self, tenant_id):
        """Resource for creating datasets."""
        payload = DatasetCreatePayload.model_validate(service_api_ns.payload or {})

        embedding_model_provider = payload.embedding_model_provider
        embedding_model = payload.embedding_model
        if embedding_model_provider and embedding_model:
            DatasetService.check_embedding_model_setting(tenant_id, embedding_model_provider, embedding_model)

        retrieval_model = payload.retrieval_model
        if (
            retrieval_model
            and retrieval_model.reranking_model
            and retrieval_model.reranking_model.reranking_provider_name
            and retrieval_model.reranking_model.reranking_model_name
        ):
            DatasetService.check_reranking_model_setting(
                tenant_id,
                retrieval_model.reranking_model.reranking_provider_name,
                retrieval_model.reranking_model.reranking_model_name,
            )

        try:
            assert isinstance(current_user, Account)
            dataset = DatasetService.create_empty_dataset(
                tenant_id=tenant_id,
                name=payload.name,
                description=payload.description,
                indexing_technique=payload.indexing_technique,
                account=current_user,
                permission=str(payload.permission) if payload.permission else None,
                provider=payload.provider,
                external_knowledge_api_id=payload.external_knowledge_api_id,
                external_knowledge_id=payload.external_knowledge_id,
                embedding_model_provider=payload.embedding_model_provider,
                embedding_model_name=payload.embedding_model,
                retrieval_model=payload.retrieval_model,
                summary_index_setting=payload.summary_index_setting,
                session=db.session,
            )
        except services.errors.dataset.DatasetNameDuplicateError:
            raise DatasetNameDuplicateError()

        return _dump_service_dataset_detail(dataset), 200


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
    def get(self, _, dataset_id: UUID):
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str, db.session)
        if dataset is None:
            raise NotFound("Dataset not found.")
        try:
            DatasetService.check_dataset_permission(dataset, current_user, db.session)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))
        data = _dump_service_dataset_detail(dataset)
        # check embedding setting
        assert isinstance(current_user, Account)
        cid = current_user.current_tenant_id
        assert cid is not None
        provider_manager = create_plugin_provider_manager(tenant_id=cid)
        configurations = provider_manager.get_configurations(tenant_id=cid)

        embedding_models = configurations.get_models(model_type=ModelType.TEXT_EMBEDDING, only_active=True)

        model_names = []
        for embedding_model in embedding_models:
            model_names.append(f"{embedding_model.model}:{embedding_model.provider.provider}")

        if data.get("indexing_technique") == IndexTechniqueType.HIGH_QUALITY:
            item_model = f"{data.get('embedding_model')}:{data.get('embedding_model_provider')}"
            if item_model in model_names:
                data["embedding_available"] = True
            else:
                data["embedding_available"] = False
        else:
            data["embedding_available"] = True

            # force update search method to keyword_search if indexing_technique is economic
            retrieval_model_dict = data.get("retrieval_model_dict")
            if retrieval_model_dict:
                retrieval_model_dict["search_method"] = "keyword_search"

        if data.get("permission") == "partial_members":
            part_users_list = DatasetPermissionService.get_dataset_partial_member_list(dataset_id_str, db.session)
            data.update({"partial_member_list": part_users_list})

        return _dump_service_dataset_with_partial_members(data), 200

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
            401: "Unauthorized - invalid API token",
            403: "Forbidden - insufficient permissions",
            404: "Dataset not found",
        }
    )
    @service_api_ns.response(
        200,
        "Dataset updated successfully",
        service_api_ns.models[DatasetDetailWithPartialMembersResponse.__name__],
    )
    @cloud_edition_billing_rate_limit_check("knowledge", "dataset")
    def patch(self, _, dataset_id: UUID):
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str, db.session)
        if dataset is None:
            raise NotFound("Dataset not found.")

        payload_dict = service_api_ns.payload or {}
        payload = DatasetUpdatePayload.model_validate(payload_dict)
        update_data = payload.model_dump(exclude_unset=True)
        if payload.permission is not None:
            update_data["permission"] = str(payload.permission)
        if payload.retrieval_model is not None:
            update_data["retrieval_model"] = payload.retrieval_model.model_dump()

        # check embedding model setting
        embedding_model_provider = payload.embedding_model_provider
        embedding_model = payload.embedding_model
        if payload.indexing_technique == IndexTechniqueType.HIGH_QUALITY or embedding_model_provider:
            if embedding_model_provider and embedding_model:
                DatasetService.check_embedding_model_setting(
                    dataset.tenant_id, embedding_model_provider, embedding_model
                )

        retrieval_model = payload.retrieval_model
        if (
            retrieval_model
            and retrieval_model.reranking_model
            and retrieval_model.reranking_model.reranking_provider_name
            and retrieval_model.reranking_model.reranking_model_name
        ):
            DatasetService.check_reranking_model_setting(
                dataset.tenant_id,
                retrieval_model.reranking_model.reranking_provider_name,
                retrieval_model.reranking_model.reranking_model_name,
            )

        if not dify_config.RBAC_ENABLED:
            # The role of the current user in the ta table must be admin, owner, editor, or dataset_operator
            DatasetPermissionService.check_permission(
                current_user,
                dataset,
                str(payload.permission) if payload.permission else None,
                payload.partial_member_list,
                db.session,
            )

        dataset = DatasetService.update_dataset(dataset_id_str, update_data, current_user, db.session)

        if dataset is None:
            raise NotFound("Dataset not found.")

        result_data = _dump_service_dataset_detail(dataset)
        assert isinstance(current_user, Account)
        tenant_id = current_user.current_tenant_id

        if payload.partial_member_list and payload.permission == DatasetPermissionEnum.PARTIAL_TEAM:
            DatasetPermissionService.update_partial_member_list(
                tenant_id, dataset_id_str, payload.partial_member_list, db.session
            )
        # clear partial member list when permission is only_me or all_team_members
        elif payload.permission in {DatasetPermissionEnum.ONLY_ME, DatasetPermissionEnum.ALL_TEAM}:
            DatasetPermissionService.clear_partial_member_list(dataset_id_str, db.session)

        partial_member_list = DatasetPermissionService.get_dataset_partial_member_list(dataset_id_str, db.session)
        result_data.update({"partial_member_list": partial_member_list})

        return _dump_service_dataset_with_partial_members(result_data), 200

    @service_api_ns.doc(
        summary="Delete Knowledge Base",
        description=(
            "Permanently delete a knowledge base and all its documents. The knowledge base must not be "
            "in use by any application."
        ),
        tags=["Knowledge Bases"],
        responses={
            204: "Success.",
            404: "`not_found` : Dataset not found.",
            409: (
                "`dataset_in_use` : The knowledge base is being used by some apps. Please remove it from the "
                "apps before deleting."
            ),
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
            409: "Conflict - dataset is in use",
        }
    )
    @cloud_edition_billing_rate_limit_check("knowledge", "dataset")
    def delete(self, _, dataset_id: UUID):
        """
        Deletes a dataset given its ID.

        Args:
            _: ignore
            dataset_id (UUID): The ID of the dataset to be deleted.

        Returns:
            dict: A dictionary with a key 'result' and a value 'success'
                  if the dataset was successfully deleted. Omitted in HTTP response.
            int: HTTP status code 204 indicating that the operation was successful.

        Raises:
            NotFound: If the dataset with the given ID does not exist.
        """

        dataset_id_str = str(dataset_id)

        try:
            if DatasetService.delete_dataset(dataset_id_str, current_user, db.session):
                DatasetPermissionService.clear_partial_member_list(dataset_id_str, db.session)
                return "", 204
            else:
                raise NotFound("Dataset not found.")
        except services.errors.dataset.DatasetInUseError:
            raise DatasetInUseError()


@service_api_ns.route("/datasets/<uuid:dataset_id>/documents/status/<string:action>")
class DocumentStatusApi(DatasetApiResource):
    """Resource for batch document status operations."""

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
    def patch(self, tenant_id, dataset_id: UUID, action: Literal["enable", "disable", "archive", "un_archive"]):
        """
        Batch update document status.

        Args:
            tenant_id: tenant id
            dataset_id: dataset id
            action: action to perform (Literal["enable", "disable", "archive", "un_archive"])

        Returns:
            dict: A dictionary with a key 'result' and a value 'success'
            int: HTTP status code 200 indicating that the operation was successful.

        Raises:
            NotFound: If the dataset with the given ID does not exist.
            Forbidden: If the user does not have permission.
            InvalidActionError: If the action is invalid or cannot be performed.
        """
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str, db.session)

        if dataset is None:
            raise NotFound("Dataset not found.")

        # Check user's permission
        try:
            DatasetService.check_dataset_permission(dataset, current_user, db.session)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))

        # Check dataset model setting
        DatasetService.check_dataset_model_setting(dataset)

        # Get document IDs from request body
        data = request.get_json()
        document_ids = data.get("document_ids", [])

        try:
            DocumentService.batch_update_document_status(dataset, document_ids, action, current_user, db.session)
        except services.errors.document.DocumentIndexingError as e:
            raise InvalidActionError(str(e))
        except ValueError as e:
            raise InvalidActionError(str(e))

        return dump_response(SimpleResultResponse, {"result": "success"}), 200


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
    def get(self, _):
        """Get all knowledge type tags."""
        assert isinstance(current_user, Account)
        cid = current_user.current_tenant_id
        assert cid is not None
        tags = TagService.get_tags(db.session(), "knowledge", cid)
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
            401: "Unauthorized - invalid API token",
            403: "Forbidden - insufficient permissions",
        }
    )
    @service_api_ns.response(
        200,
        "Tag created successfully",
        service_api_ns.models[KnowledgeTagResponse.__name__],
    )
    def post(self, _):
        """Add a knowledge type tag."""
        assert isinstance(current_user, Account)
        if not (current_user.has_edit_permission or current_user.is_dataset_editor):
            raise Forbidden()

        payload = TagCreatePayload.model_validate(service_api_ns.payload or {})
        tag = TagService.save_tags(SaveTagPayload(name=payload.name, type=TagType.KNOWLEDGE), db.session)

        response = dump_response(
            KnowledgeTagResponse,
            {"id": tag.id, "name": tag.name, "type": tag.type, "binding_count": 0},
        )
        return response, 200

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
            401: "Unauthorized - invalid API token",
            403: "Forbidden - insufficient permissions",
        }
    )
    @service_api_ns.response(
        200,
        "Tag updated successfully",
        service_api_ns.models[KnowledgeTagResponse.__name__],
    )
    def patch(self, _):
        assert isinstance(current_user, Account)
        if not (current_user.has_edit_permission or current_user.is_dataset_editor):
            raise Forbidden()

        payload = TagUpdatePayload.model_validate(service_api_ns.payload or {})
        tag_id = payload.tag_id
        tag = TagService.update_tags(
            UpdateTagServicePayload(name=payload.name), tag_id, db.session, tag_type=TagType.KNOWLEDGE
        )

        binding_count = TagService.get_tag_binding_count(tag_id, db.session, tag_type=TagType.KNOWLEDGE)

        response = dump_response(
            KnowledgeTagResponse,
            {"id": tag.id, "name": tag.name, "type": tag.type, "binding_count": binding_count},
        )
        return response, 200

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
        }
    )
    @edit_permission_required
    def delete(self, _):
        """Delete a knowledge type tag."""
        payload = TagDeletePayload.model_validate(service_api_ns.payload or {})
        TagService.delete_tag(payload.tag_id, db.session, tag_type=TagType.KNOWLEDGE)

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
        }
    )
    def post(self, _):
        # The role of the current user in the ta table must be admin, owner, editor, or dataset_operator
        assert isinstance(current_user, Account)
        if not (current_user.has_edit_permission or current_user.is_dataset_editor):
            raise Forbidden()

        payload = TagBindingPayload.model_validate(service_api_ns.payload or {})
        TagService.save_tag_binding(
            TagBindingCreatePayload(tag_ids=payload.tag_ids, target_id=payload.target_id, type=TagType.KNOWLEDGE),
            db.session,
        )

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
        }
    )
    def post(self, _):
        # The role of the current user in the ta table must be admin, owner, editor, or dataset_operator
        assert isinstance(current_user, Account)
        if not (current_user.has_edit_permission or current_user.is_dataset_editor):
            raise Forbidden()

        payload = TagUnbindingPayload.model_validate(service_api_ns.payload or {})
        TagService.delete_tag_binding(
            TagBindingDeletePayload(tag_ids=payload.tag_ids, target_id=payload.target_id, type=TagType.KNOWLEDGE),
            db.session,
        )

        return "", 204


@service_api_ns.route("/datasets/<uuid:dataset_id>/tags")
class DatasetTagsBindingStatusApi(DatasetApiResource):
    @service_api_ns.doc(
        summary="Get Knowledge Base Tags",
        description="Returns the list of tags bound to a specific knowledge base.",
        tags=["Tags"],
        responses={
            200: "Tags bound to the knowledge base.",
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
    def get(self, _, *args, **kwargs):
        """Get all knowledge type tags."""
        dataset_id = kwargs.get("dataset_id")
        assert isinstance(current_user, Account)
        assert current_user.current_tenant_id is not None
        tags = TagService.get_tags_by_target_id(
            "knowledge", current_user.current_tenant_id, str(dataset_id), db.session
        )
        tags_list = [{"id": tag.id, "name": tag.name} for tag in tags]
        return dump_response(DatasetBoundTagListResponse, {"data": tags_list, "total": len(tags)}), 200
