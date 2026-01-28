from typing import Any, Literal, cast

from flask import request
from flask_restx import marshal
from pydantic import BaseModel, Field, TypeAdapter, field_validator
from werkzeug.exceptions import Forbidden, NotFound

import services
from controllers.common.schema import register_schema_models
from controllers.console.wraps import edit_permission_required
from controllers.service_api import service_api_ns
from controllers.service_api.dataset.error import DatasetInUseError, DatasetNameDuplicateError, InvalidActionError
from controllers.service_api.wraps import (
    DatasetApiResource,
    cloud_edition_billing_rate_limit_check,
)
from core.model_runtime.entities.model_entities import ModelType
from core.provider_manager import ProviderManager
from fields.dataset_fields import dataset_detail_fields
from fields.tag_fields import build_dataset_tag_fields
from libs.login import current_user
from models.account import Account
from models.dataset import DatasetPermissionEnum
from models.provider_ids import ModelProviderID
from services.dataset_service import DatasetPermissionService, DatasetService, DocumentService
from services.entities.knowledge_entities.knowledge_entities import RetrievalModel
from services.tag_service import TagService

DEFAULT_REF_TEMPLATE_SWAGGER_2_0 = "#/definitions/{model}"


service_api_ns.schema_model(
    DatasetPermissionEnum.__name__,
    TypeAdapter(DatasetPermissionEnum).json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0),
)


class DatasetCreatePayload(BaseModel):
    name: str = Field(..., min_length=1, max_length=40)
    description: str = Field(default="", description="Dataset description (max 400 chars)", max_length=400)
    indexing_technique: Literal["high_quality", "economy"] | None = None
    permission: DatasetPermissionEnum | None = DatasetPermissionEnum.ONLY_ME
    external_knowledge_api_id: str | None = None
    provider: str = "vendor"
    external_knowledge_id: str | None = None
    retrieval_model: RetrievalModel | None = None
    embedding_model: str | None = None
    embedding_model_provider: str | None = None


class DatasetUpdatePayload(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=40)
    description: str | None = Field(default=None, description="Dataset description (max 400 chars)", max_length=400)
    indexing_technique: Literal["high_quality", "economy"] | None = None
    permission: DatasetPermissionEnum | None = None
    embedding_model: str | None = None
    embedding_model_provider: str | None = None
    retrieval_model: RetrievalModel | None = None
    partial_member_list: list[dict[str, str]] | None = None
    external_retrieval_model: dict[str, Any] | None = None
    external_knowledge_id: str | None = None
    external_knowledge_api_id: str | None = None


class TagNamePayload(BaseModel):
    name: str = Field(..., min_length=1, max_length=50)


class TagCreatePayload(TagNamePayload):
    pass


class TagUpdatePayload(TagNamePayload):
    tag_id: str


class TagDeletePayload(BaseModel):
    tag_id: str


class TagBindingPayload(BaseModel):
    tag_ids: list[str]
    target_id: str

    @field_validator("tag_ids")
    @classmethod
    def validate_tag_ids(cls, value: list[str]) -> list[str]:
        if not value:
            raise ValueError("Tag IDs is required.")
        return value


class TagUnbindingPayload(BaseModel):
    tag_id: str
    target_id: str


class DatasetListQuery(BaseModel):
    page: int = Field(default=1, description="Page number")
    limit: int = Field(default=20, description="Number of items per page")
    keyword: str | None = Field(default=None, description="Search keyword")
    include_all: bool = Field(default=False, description="Include all datasets")
    tag_ids: list[str] = Field(default_factory=list, description="Filter by tag IDs")


register_schema_models(
    service_api_ns,
    DatasetCreatePayload,
    DatasetUpdatePayload,
    TagCreatePayload,
    TagUpdatePayload,
    TagDeletePayload,
    TagBindingPayload,
    TagUnbindingPayload,
    DatasetListQuery,
)


@service_api_ns.route("/datasets")
class DatasetListApi(DatasetApiResource):
    """Resource for datasets."""

    @service_api_ns.doc("list_datasets")
    @service_api_ns.doc(description="List all datasets")
    @service_api_ns.doc(
        responses={
            200: "Datasets retrieved successfully",
            401: "Unauthorized - invalid API token",
        }
    )
    def get(self, tenant_id):
        """Resource for getting datasets."""
        query = DatasetListQuery.model_validate(request.args.to_dict())
        # provider = request.args.get("provider", default="vendor")

        datasets, total = DatasetService.get_datasets(
            query.page, query.limit, tenant_id, current_user, query.keyword, query.tag_ids, query.include_all
        )
        # check embedding setting
        provider_manager = ProviderManager()
        assert isinstance(current_user, Account)
        cid = current_user.current_tenant_id
        assert cid is not None
        configurations = provider_manager.get_configurations(tenant_id=cid)

        embedding_models = configurations.get_models(model_type=ModelType.TEXT_EMBEDDING, only_active=True)

        model_names = []
        for embedding_model in embedding_models:
            model_names.append(f"{embedding_model.model}:{embedding_model.provider.provider}")

        data = marshal(datasets, dataset_detail_fields)
        for item in data:
            if item["indexing_technique"] == "high_quality" and item["embedding_model_provider"]:
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
        return response, 200

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
            )
        except services.errors.dataset.DatasetNameDuplicateError:
            raise DatasetNameDuplicateError()

        return marshal(dataset, dataset_detail_fields), 200


@service_api_ns.route("/datasets/<uuid:dataset_id>")
class DatasetApi(DatasetApiResource):
    """Resource for dataset."""

    @service_api_ns.doc("get_dataset")
    @service_api_ns.doc(description="Get a specific dataset by ID")
    @service_api_ns.doc(params={"dataset_id": "Dataset ID"})
    @service_api_ns.doc(
        responses={
            200: "Dataset retrieved successfully",
            401: "Unauthorized - invalid API token",
            403: "Forbidden - insufficient permissions",
            404: "Dataset not found",
        }
    )
    def get(self, _, dataset_id):
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")
        try:
            DatasetService.check_dataset_permission(dataset, current_user)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))
        data = cast(dict[str, Any], marshal(dataset, dataset_detail_fields))
        # check embedding setting
        provider_manager = ProviderManager()
        assert isinstance(current_user, Account)
        cid = current_user.current_tenant_id
        assert cid is not None
        configurations = provider_manager.get_configurations(tenant_id=cid)

        embedding_models = configurations.get_models(model_type=ModelType.TEXT_EMBEDDING, only_active=True)

        model_names = []
        for embedding_model in embedding_models:
            model_names.append(f"{embedding_model.model}:{embedding_model.provider.provider}")

        if data.get("indexing_technique") == "high_quality":
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
            part_users_list = DatasetPermissionService.get_dataset_partial_member_list(dataset_id_str)
            data.update({"partial_member_list": part_users_list})

        return data, 200

    @service_api_ns.expect(service_api_ns.models[DatasetUpdatePayload.__name__])
    @service_api_ns.doc("update_dataset")
    @service_api_ns.doc(description="Update an existing dataset")
    @service_api_ns.doc(params={"dataset_id": "Dataset ID"})
    @service_api_ns.doc(
        responses={
            200: "Dataset updated successfully",
            401: "Unauthorized - invalid API token",
            403: "Forbidden - insufficient permissions",
            404: "Dataset not found",
        }
    )
    @cloud_edition_billing_rate_limit_check("knowledge", "dataset")
    def patch(self, _, dataset_id):
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
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
        if payload.indexing_technique == "high_quality" or embedding_model_provider:
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

        # The role of the current user in the ta table must be admin, owner, editor, or dataset_operator
        DatasetPermissionService.check_permission(
            current_user,
            dataset,
            str(payload.permission) if payload.permission else None,
            payload.partial_member_list,
        )

        dataset = DatasetService.update_dataset(dataset_id_str, update_data, current_user)

        if dataset is None:
            raise NotFound("Dataset not found.")

        result_data = cast(dict[str, Any], marshal(dataset, dataset_detail_fields))
        assert isinstance(current_user, Account)
        tenant_id = current_user.current_tenant_id

        if payload.partial_member_list and payload.permission == DatasetPermissionEnum.PARTIAL_TEAM:
            DatasetPermissionService.update_partial_member_list(tenant_id, dataset_id_str, payload.partial_member_list)
        # clear partial member list when permission is only_me or all_team_members
        elif payload.permission in {DatasetPermissionEnum.ONLY_ME, DatasetPermissionEnum.ALL_TEAM}:
            DatasetPermissionService.clear_partial_member_list(dataset_id_str)

        partial_member_list = DatasetPermissionService.get_dataset_partial_member_list(dataset_id_str)
        result_data.update({"partial_member_list": partial_member_list})

        return result_data, 200

    @service_api_ns.doc("delete_dataset")
    @service_api_ns.doc(description="Delete a dataset")
    @service_api_ns.doc(params={"dataset_id": "Dataset ID"})
    @service_api_ns.doc(
        responses={
            204: "Dataset deleted successfully",
            401: "Unauthorized - invalid API token",
            404: "Dataset not found",
            409: "Conflict - dataset is in use",
        }
    )
    @cloud_edition_billing_rate_limit_check("knowledge", "dataset")
    def delete(self, _, dataset_id):
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
            if DatasetService.delete_dataset(dataset_id_str, current_user):
                DatasetPermissionService.clear_partial_member_list(dataset_id_str)
                return 204
            else:
                raise NotFound("Dataset not found.")
        except services.errors.dataset.DatasetInUseError:
            raise DatasetInUseError()


@service_api_ns.route("/datasets/<uuid:dataset_id>/documents/status/<string:action>")
class DocumentStatusApi(DatasetApiResource):
    """Resource for batch document status operations."""

    @service_api_ns.doc("update_document_status")
    @service_api_ns.doc(description="Batch update document status")
    @service_api_ns.doc(
        params={
            "dataset_id": "Dataset ID",
            "action": "Action to perform: 'enable', 'disable', 'archive', or 'un_archive'",
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
    def patch(self, tenant_id, dataset_id, action: Literal["enable", "disable", "archive", "un_archive"]):
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
        dataset = DatasetService.get_dataset(dataset_id_str)

        if dataset is None:
            raise NotFound("Dataset not found.")

        # Check user's permission
        try:
            DatasetService.check_dataset_permission(dataset, current_user)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))

        # Check dataset model setting
        DatasetService.check_dataset_model_setting(dataset)

        # Get document IDs from request body
        data = request.get_json()
        document_ids = data.get("document_ids", [])

        try:
            DocumentService.batch_update_document_status(dataset, document_ids, action, current_user)
        except services.errors.document.DocumentIndexingError as e:
            raise InvalidActionError(str(e))
        except ValueError as e:
            raise InvalidActionError(str(e))

        return {"result": "success"}, 200


@service_api_ns.route("/datasets/tags")
class DatasetTagsApi(DatasetApiResource):
    @service_api_ns.doc("list_dataset_tags")
    @service_api_ns.doc(description="Get all knowledge type tags")
    @service_api_ns.doc(
        responses={
            200: "Tags retrieved successfully",
            401: "Unauthorized - invalid API token",
        }
    )
    @service_api_ns.marshal_with(build_dataset_tag_fields(service_api_ns))
    def get(self, _):
        """Get all knowledge type tags."""
        assert isinstance(current_user, Account)
        cid = current_user.current_tenant_id
        assert cid is not None
        tags = TagService.get_tags("knowledge", cid)

        return tags, 200

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
    @service_api_ns.marshal_with(build_dataset_tag_fields(service_api_ns))
    def post(self, _):
        """Add a knowledge type tag."""
        assert isinstance(current_user, Account)
        if not (current_user.has_edit_permission or current_user.is_dataset_editor):
            raise Forbidden()

        payload = TagCreatePayload.model_validate(service_api_ns.payload or {})
        tag = TagService.save_tags({"name": payload.name, "type": "knowledge"})

        response = {"id": tag.id, "name": tag.name, "type": tag.type, "binding_count": 0}
        return response, 200

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
    @service_api_ns.marshal_with(build_dataset_tag_fields(service_api_ns))
    def patch(self, _):
        assert isinstance(current_user, Account)
        if not (current_user.has_edit_permission or current_user.is_dataset_editor):
            raise Forbidden()

        payload = TagUpdatePayload.model_validate(service_api_ns.payload or {})
        params = {"name": payload.name, "type": "knowledge"}
        tag_id = payload.tag_id
        tag = TagService.update_tags(params, tag_id)

        binding_count = TagService.get_tag_binding_count(tag_id)

        response = {"id": tag.id, "name": tag.name, "type": tag.type, "binding_count": binding_count}

        return response, 200

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
        TagService.delete_tag(payload.tag_id)

        return 204


@service_api_ns.route("/datasets/tags/binding")
class DatasetTagBindingApi(DatasetApiResource):
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
        TagService.save_tag_binding({"tag_ids": payload.tag_ids, "target_id": payload.target_id, "type": "knowledge"})

        return 204


@service_api_ns.route("/datasets/tags/unbinding")
class DatasetTagUnbindingApi(DatasetApiResource):
    @service_api_ns.expect(service_api_ns.models[TagUnbindingPayload.__name__])
    @service_api_ns.doc("unbind_dataset_tag")
    @service_api_ns.doc(description="Unbind a tag from a dataset")
    @service_api_ns.doc(
        responses={
            204: "Tag unbound successfully",
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
        TagService.delete_tag_binding({"tag_id": payload.tag_id, "target_id": payload.target_id, "type": "knowledge"})

        return 204


@service_api_ns.route("/datasets/<uuid:dataset_id>/tags")
class DatasetTagsBindingStatusApi(DatasetApiResource):
    @service_api_ns.doc("get_dataset_tags_binding_status")
    @service_api_ns.doc(description="Get tags bound to a specific dataset")
    @service_api_ns.doc(params={"dataset_id": "Dataset ID"})
    @service_api_ns.doc(
        responses={
            200: "Tags retrieved successfully",
            401: "Unauthorized - invalid API token",
        }
    )
    def get(self, _, *args, **kwargs):
        """Get all knowledge type tags."""
        dataset_id = kwargs.get("dataset_id")
        assert isinstance(current_user, Account)
        assert current_user.current_tenant_id is not None
        tags = TagService.get_tags_by_target_id("knowledge", current_user.current_tenant_id, str(dataset_id))
        tags_list = [{"id": tag.id, "name": tag.name} for tag in tags]
        response = {"data": tags_list, "total": len(tags)}
        return response, 200
