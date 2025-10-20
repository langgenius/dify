from typing import Any, Literal, cast

from flask import request
from flask_restx import marshal, reqparse
from werkzeug.exceptions import Forbidden, NotFound

import services
from controllers.service_api import service_api_ns
from controllers.service_api.dataset.error import DatasetInUseError, DatasetNameDuplicateError, InvalidActionError
from controllers.service_api.wraps import (
    DatasetApiResource,
    cloud_edition_billing_rate_limit_check,
    validate_dataset_token,
)
from core.model_runtime.entities.model_entities import ModelType
from core.provider_manager import ProviderManager
from fields.dataset_fields import dataset_detail_fields
from fields.tag_fields import build_dataset_tag_fields
from libs.login import current_user
from libs.validators import validate_description_length
from models.account import Account
from models.dataset import Dataset, DatasetPermissionEnum
from models.provider_ids import ModelProviderID
from services.dataset_service import DatasetPermissionService, DatasetService, DocumentService
from services.entities.knowledge_entities.knowledge_entities import RetrievalModel
from services.tag_service import TagService


def _validate_name(name):
    if not name or len(name) < 1 or len(name) > 40:
        raise ValueError("Name must be between 1 to 40 characters.")
    return name


# Define parsers for dataset operations
dataset_create_parser = (
    reqparse.RequestParser()
    .add_argument(
        "name",
        nullable=False,
        required=True,
        help="type is required. Name must be between 1 to 40 characters.",
        type=_validate_name,
    )
    .add_argument(
        "description",
        type=validate_description_length,
        nullable=True,
        required=False,
        default="",
    )
    .add_argument(
        "indexing_technique",
        type=str,
        location="json",
        choices=Dataset.INDEXING_TECHNIQUE_LIST,
        help="Invalid indexing technique.",
    )
    .add_argument(
        "permission",
        type=str,
        location="json",
        choices=(DatasetPermissionEnum.ONLY_ME, DatasetPermissionEnum.ALL_TEAM, DatasetPermissionEnum.PARTIAL_TEAM),
        help="Invalid permission.",
        required=False,
        nullable=False,
    )
    .add_argument(
        "external_knowledge_api_id",
        type=str,
        nullable=True,
        required=False,
        default="_validate_name",
    )
    .add_argument(
        "provider",
        type=str,
        nullable=True,
        required=False,
        default="vendor",
    )
    .add_argument(
        "external_knowledge_id",
        type=str,
        nullable=True,
        required=False,
    )
    .add_argument("retrieval_model", type=dict, required=False, nullable=True, location="json")
    .add_argument("embedding_model", type=str, required=False, nullable=True, location="json")
    .add_argument("embedding_model_provider", type=str, required=False, nullable=True, location="json")
)

dataset_update_parser = (
    reqparse.RequestParser()
    .add_argument(
        "name",
        nullable=False,
        help="type is required. Name must be between 1 to 40 characters.",
        type=_validate_name,
    )
    .add_argument("description", location="json", store_missing=False, type=validate_description_length)
    .add_argument(
        "indexing_technique",
        type=str,
        location="json",
        choices=Dataset.INDEXING_TECHNIQUE_LIST,
        nullable=True,
        help="Invalid indexing technique.",
    )
    .add_argument(
        "permission",
        type=str,
        location="json",
        choices=(DatasetPermissionEnum.ONLY_ME, DatasetPermissionEnum.ALL_TEAM, DatasetPermissionEnum.PARTIAL_TEAM),
        help="Invalid permission.",
    )
    .add_argument("embedding_model", type=str, location="json", help="Invalid embedding model.")
    .add_argument("embedding_model_provider", type=str, location="json", help="Invalid embedding model provider.")
    .add_argument("retrieval_model", type=dict, location="json", help="Invalid retrieval model.")
    .add_argument("partial_member_list", type=list, location="json", help="Invalid parent user list.")
    .add_argument(
        "external_retrieval_model",
        type=dict,
        required=False,
        nullable=True,
        location="json",
        help="Invalid external retrieval model.",
    )
    .add_argument(
        "external_knowledge_id",
        type=str,
        required=False,
        nullable=True,
        location="json",
        help="Invalid external knowledge id.",
    )
    .add_argument(
        "external_knowledge_api_id",
        type=str,
        required=False,
        nullable=True,
        location="json",
        help="Invalid external knowledge api id.",
    )
)

tag_create_parser = reqparse.RequestParser().add_argument(
    "name",
    nullable=False,
    required=True,
    help="Name must be between 1 to 50 characters.",
    type=lambda x: x
    if x and 1 <= len(x) <= 50
    else (_ for _ in ()).throw(ValueError("Name must be between 1 to 50 characters.")),
)

tag_update_parser = (
    reqparse.RequestParser()
    .add_argument(
        "name",
        nullable=False,
        required=True,
        help="Name must be between 1 to 50 characters.",
        type=lambda x: x
        if x and 1 <= len(x) <= 50
        else (_ for _ in ()).throw(ValueError("Name must be between 1 to 50 characters.")),
    )
    .add_argument("tag_id", nullable=False, required=True, help="Id of a tag.", type=str)
)

tag_delete_parser = reqparse.RequestParser().add_argument(
    "tag_id", nullable=False, required=True, help="Id of a tag.", type=str
)

tag_binding_parser = (
    reqparse.RequestParser()
    .add_argument("tag_ids", type=list, nullable=False, required=True, location="json", help="Tag IDs is required.")
    .add_argument(
        "target_id", type=str, nullable=False, required=True, location="json", help="Target Dataset ID is required."
    )
)

tag_unbinding_parser = (
    reqparse.RequestParser()
    .add_argument("tag_id", type=str, nullable=False, required=True, help="Tag ID is required.")
    .add_argument("target_id", type=str, nullable=False, required=True, help="Target ID is required.")
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
        page = request.args.get("page", default=1, type=int)
        limit = request.args.get("limit", default=20, type=int)
        # provider = request.args.get("provider", default="vendor")
        search = request.args.get("keyword", default=None, type=str)
        tag_ids = request.args.getlist("tag_ids")
        include_all = request.args.get("include_all", default="false").lower() == "true"

        datasets, total = DatasetService.get_datasets(
            page, limit, tenant_id, current_user, search, tag_ids, include_all
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
        response = {"data": data, "has_more": len(datasets) == limit, "limit": limit, "total": total, "page": page}
        return response, 200

    @service_api_ns.expect(dataset_create_parser)
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
        args = dataset_create_parser.parse_args()

        embedding_model_provider = args.get("embedding_model_provider")
        embedding_model = args.get("embedding_model")
        if embedding_model_provider and embedding_model:
            DatasetService.check_embedding_model_setting(tenant_id, embedding_model_provider, embedding_model)

        retrieval_model = args.get("retrieval_model")
        if (
            retrieval_model
            and retrieval_model.get("reranking_model")
            and retrieval_model.get("reranking_model").get("reranking_provider_name")
        ):
            DatasetService.check_reranking_model_setting(
                tenant_id,
                retrieval_model.get("reranking_model").get("reranking_provider_name"),
                retrieval_model.get("reranking_model").get("reranking_model_name"),
            )

        try:
            assert isinstance(current_user, Account)
            dataset = DatasetService.create_empty_dataset(
                tenant_id=tenant_id,
                name=args["name"],
                description=args["description"],
                indexing_technique=args["indexing_technique"],
                account=current_user,
                permission=args["permission"],
                provider=args["provider"],
                external_knowledge_api_id=args["external_knowledge_api_id"],
                external_knowledge_id=args["external_knowledge_id"],
                embedding_model_provider=args["embedding_model_provider"],
                embedding_model_name=args["embedding_model"],
                retrieval_model=RetrievalModel.model_validate(args["retrieval_model"])
                if args["retrieval_model"] is not None
                else None,
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

    @service_api_ns.expect(dataset_update_parser)
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

        args = dataset_update_parser.parse_args()
        data = request.get_json()

        # check embedding model setting
        embedding_model_provider = data.get("embedding_model_provider")
        embedding_model = data.get("embedding_model")
        if data.get("indexing_technique") == "high_quality" or embedding_model_provider:
            if embedding_model_provider and embedding_model:
                DatasetService.check_embedding_model_setting(
                    dataset.tenant_id, embedding_model_provider, embedding_model
                )

        retrieval_model = data.get("retrieval_model")
        if (
            retrieval_model
            and retrieval_model.get("reranking_model")
            and retrieval_model.get("reranking_model").get("reranking_provider_name")
        ):
            DatasetService.check_reranking_model_setting(
                dataset.tenant_id,
                retrieval_model.get("reranking_model").get("reranking_provider_name"),
                retrieval_model.get("reranking_model").get("reranking_model_name"),
            )

        # The role of the current user in the ta table must be admin, owner, editor, or dataset_operator
        DatasetPermissionService.check_permission(
            current_user, dataset, data.get("permission"), data.get("partial_member_list")
        )

        dataset = DatasetService.update_dataset(dataset_id_str, args, current_user)

        if dataset is None:
            raise NotFound("Dataset not found.")

        result_data = cast(dict[str, Any], marshal(dataset, dataset_detail_fields))
        assert isinstance(current_user, Account)
        tenant_id = current_user.current_tenant_id

        if data.get("partial_member_list") and data.get("permission") == "partial_members":
            DatasetPermissionService.update_partial_member_list(
                tenant_id, dataset_id_str, data.get("partial_member_list")
            )
        # clear partial member list when permission is only_me or all_team_members
        elif (
            data.get("permission") == DatasetPermissionEnum.ONLY_ME
            or data.get("permission") == DatasetPermissionEnum.ALL_TEAM
        ):
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
    @validate_dataset_token
    @service_api_ns.marshal_with(build_dataset_tag_fields(service_api_ns))
    def get(self, _, dataset_id):
        """Get all knowledge type tags."""
        assert isinstance(current_user, Account)
        cid = current_user.current_tenant_id
        assert cid is not None
        tags = TagService.get_tags("knowledge", cid)

        return tags, 200

    @service_api_ns.expect(tag_create_parser)
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
    @validate_dataset_token
    def post(self, _, dataset_id):
        """Add a knowledge type tag."""
        assert isinstance(current_user, Account)
        if not (current_user.has_edit_permission or current_user.is_dataset_editor):
            raise Forbidden()

        args = tag_create_parser.parse_args()
        args["type"] = "knowledge"
        tag = TagService.save_tags(args)

        response = {"id": tag.id, "name": tag.name, "type": tag.type, "binding_count": 0}
        return response, 200

    @service_api_ns.expect(tag_update_parser)
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
    @validate_dataset_token
    def patch(self, _, dataset_id):
        assert isinstance(current_user, Account)
        if not (current_user.has_edit_permission or current_user.is_dataset_editor):
            raise Forbidden()

        args = tag_update_parser.parse_args()
        args["type"] = "knowledge"
        tag_id = args["tag_id"]
        tag = TagService.update_tags(args, tag_id)

        binding_count = TagService.get_tag_binding_count(tag_id)

        response = {"id": tag.id, "name": tag.name, "type": tag.type, "binding_count": binding_count}

        return response, 200

    @service_api_ns.expect(tag_delete_parser)
    @service_api_ns.doc("delete_dataset_tag")
    @service_api_ns.doc(description="Delete a knowledge type tag")
    @service_api_ns.doc(
        responses={
            204: "Tag deleted successfully",
            401: "Unauthorized - invalid API token",
            403: "Forbidden - insufficient permissions",
        }
    )
    @validate_dataset_token
    def delete(self, _, dataset_id):
        """Delete a knowledge type tag."""
        assert isinstance(current_user, Account)
        if not current_user.has_edit_permission:
            raise Forbidden()
        args = tag_delete_parser.parse_args()
        TagService.delete_tag(args["tag_id"])

        return 204


@service_api_ns.route("/datasets/tags/binding")
class DatasetTagBindingApi(DatasetApiResource):
    @service_api_ns.expect(tag_binding_parser)
    @service_api_ns.doc("bind_dataset_tags")
    @service_api_ns.doc(description="Bind tags to a dataset")
    @service_api_ns.doc(
        responses={
            204: "Tags bound successfully",
            401: "Unauthorized - invalid API token",
            403: "Forbidden - insufficient permissions",
        }
    )
    @validate_dataset_token
    def post(self, _, dataset_id):
        # The role of the current user in the ta table must be admin, owner, editor, or dataset_operator
        assert isinstance(current_user, Account)
        if not (current_user.has_edit_permission or current_user.is_dataset_editor):
            raise Forbidden()

        args = tag_binding_parser.parse_args()
        args["type"] = "knowledge"
        TagService.save_tag_binding(args)

        return 204


@service_api_ns.route("/datasets/tags/unbinding")
class DatasetTagUnbindingApi(DatasetApiResource):
    @service_api_ns.expect(tag_unbinding_parser)
    @service_api_ns.doc("unbind_dataset_tag")
    @service_api_ns.doc(description="Unbind a tag from a dataset")
    @service_api_ns.doc(
        responses={
            204: "Tag unbound successfully",
            401: "Unauthorized - invalid API token",
            403: "Forbidden - insufficient permissions",
        }
    )
    @validate_dataset_token
    def post(self, _, dataset_id):
        # The role of the current user in the ta table must be admin, owner, editor, or dataset_operator
        assert isinstance(current_user, Account)
        if not (current_user.has_edit_permission or current_user.is_dataset_editor):
            raise Forbidden()

        args = tag_unbinding_parser.parse_args()
        args["type"] = "knowledge"
        TagService.delete_tag_binding(args)

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
    @validate_dataset_token
    def get(self, _, *args, **kwargs):
        """Get all knowledge type tags."""
        dataset_id = kwargs.get("dataset_id")
        assert isinstance(current_user, Account)
        assert current_user.current_tenant_id is not None
        tags = TagService.get_tags_by_target_id("knowledge", current_user.current_tenant_id, str(dataset_id))
        tags_list = [{"id": tag.id, "name": tag.name} for tag in tags]
        response = {"data": tags_list, "total": len(tags)}
        return response, 200
