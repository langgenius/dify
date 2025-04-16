from datetime import UTC, datetime

from flask import request
from flask_restful import marshal, reqparse  # type: ignore
from werkzeug.exceptions import Forbidden, NotFound

import services.dataset_service
from controllers.service_api import api
from controllers.service_api.dataset.error import DatasetInUseError, DatasetNameDuplicateError, InvalidActionError
from controllers.service_api.wraps import DatasetApiResource
from core.model_runtime.entities.model_entities import ModelType
from core.plugin.entities.plugin import ModelProviderID
from core.provider_manager import ProviderManager
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from fields.dataset_fields import dataset_detail_fields
from libs.login import current_user
from models.dataset import Dataset, DatasetPermissionEnum
from services.dataset_service import DatasetPermissionService, DatasetService, DocumentService
from services.entities.knowledge_entities.knowledge_entities import RetrievalModel
from tasks.add_document_to_index_task import add_document_to_index_task
from tasks.remove_document_from_index_task import remove_document_from_index_task


def _validate_name(name):
    if not name or len(name) < 1 or len(name) > 40:
        raise ValueError("Name must be between 1 to 40 characters.")
    return name


def _validate_description_length(description):
    if len(description) > 400:
        raise ValueError("Description cannot exceed 400 characters.")
    return description


class DatasetListApi(DatasetApiResource):
    """Resource for datasets."""

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
        configurations = provider_manager.get_configurations(tenant_id=current_user.current_tenant_id)

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

    def post(self, tenant_id):
        """Resource for creating datasets."""
        parser = reqparse.RequestParser()
        parser.add_argument(
            "name",
            nullable=False,
            required=True,
            help="type is required. Name must be between 1 to 40 characters.",
            type=_validate_name,
        )
        parser.add_argument(
            "description",
            type=str,
            nullable=True,
            required=False,
            default="",
        )
        parser.add_argument(
            "indexing_technique",
            type=str,
            location="json",
            choices=Dataset.INDEXING_TECHNIQUE_LIST,
            help="Invalid indexing technique.",
        )
        parser.add_argument(
            "permission",
            type=str,
            location="json",
            choices=(DatasetPermissionEnum.ONLY_ME, DatasetPermissionEnum.ALL_TEAM, DatasetPermissionEnum.PARTIAL_TEAM),
            help="Invalid permission.",
            required=False,
            nullable=False,
        )
        parser.add_argument(
            "external_knowledge_api_id",
            type=str,
            nullable=True,
            required=False,
            default="_validate_name",
        )
        parser.add_argument(
            "provider",
            type=str,
            nullable=True,
            required=False,
            default="vendor",
        )
        parser.add_argument(
            "external_knowledge_id",
            type=str,
            nullable=True,
            required=False,
        )
        parser.add_argument("retrieval_model", type=dict, required=False, nullable=True, location="json")
        parser.add_argument("embedding_model", type=str, required=False, nullable=True, location="json")
        parser.add_argument("embedding_model_provider", type=str, required=False, nullable=True, location="json")

        args = parser.parse_args()
        try:
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
                retrieval_model=RetrievalModel(**args["retrieval_model"])
                if args["retrieval_model"] is not None
                else None,
            )
        except services.errors.dataset.DatasetNameDuplicateError:
            raise DatasetNameDuplicateError()

        return marshal(dataset, dataset_detail_fields), 200


class DatasetApi(DatasetApiResource):
    """Resource for dataset."""

    def get(self, _, dataset_id):
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")
        try:
            DatasetService.check_dataset_permission(dataset, current_user)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))
        data = marshal(dataset, dataset_detail_fields)
        if data.get("permission") == "partial_members":
            part_users_list = DatasetPermissionService.get_dataset_partial_member_list(dataset_id_str)
            data.update({"partial_member_list": part_users_list})

        # check embedding setting
        provider_manager = ProviderManager()
        configurations = provider_manager.get_configurations(tenant_id=current_user.current_tenant_id)

        embedding_models = configurations.get_models(model_type=ModelType.TEXT_EMBEDDING, only_active=True)

        model_names = []
        for embedding_model in embedding_models:
            model_names.append(f"{embedding_model.model}:{embedding_model.provider.provider}")

        if data["indexing_technique"] == "high_quality":
            item_model = f"{data['embedding_model']}:{data['embedding_model_provider']}"
            if item_model in model_names:
                data["embedding_available"] = True
            else:
                data["embedding_available"] = False
        else:
            data["embedding_available"] = True

        if data.get("permission") == "partial_members":
            part_users_list = DatasetPermissionService.get_dataset_partial_member_list(dataset_id_str)
            data.update({"partial_member_list": part_users_list})

        return data, 200

    def patch(self, _, dataset_id):
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")

        parser = reqparse.RequestParser()
        parser.add_argument(
            "name",
            nullable=False,
            help="type is required. Name must be between 1 to 40 characters.",
            type=_validate_name,
        )
        parser.add_argument("description", location="json", store_missing=False, type=_validate_description_length)
        parser.add_argument(
            "indexing_technique",
            type=str,
            location="json",
            choices=Dataset.INDEXING_TECHNIQUE_LIST,
            nullable=True,
            help="Invalid indexing technique.",
        )
        parser.add_argument(
            "permission",
            type=str,
            location="json",
            choices=(DatasetPermissionEnum.ONLY_ME, DatasetPermissionEnum.ALL_TEAM, DatasetPermissionEnum.PARTIAL_TEAM),
            help="Invalid permission.",
        )
        parser.add_argument("embedding_model", type=str, location="json", help="Invalid embedding model.")
        parser.add_argument(
            "embedding_model_provider", type=str, location="json", help="Invalid embedding model provider."
        )
        parser.add_argument("retrieval_model", type=dict, location="json", help="Invalid retrieval model.")
        parser.add_argument("partial_member_list", type=list, location="json", help="Invalid parent user list.")

        parser.add_argument(
            "external_retrieval_model",
            type=dict,
            required=False,
            nullable=True,
            location="json",
            help="Invalid external retrieval model.",
        )

        parser.add_argument(
            "external_knowledge_id",
            type=str,
            required=False,
            nullable=True,
            location="json",
            help="Invalid external knowledge id.",
        )

        parser.add_argument(
            "external_knowledge_api_id",
            type=str,
            required=False,
            nullable=True,
            location="json",
            help="Invalid external knowledge api id.",
        )
        args = parser.parse_args()
        data = request.get_json()

        # check embedding model setting
        if data.get("indexing_technique") == "high_quality":
            DatasetService.check_embedding_model_setting(
                dataset.tenant_id, data.get("embedding_model_provider"), data.get("embedding_model")
            )

        # The role of the current user in the ta table must be admin, owner, editor, or dataset_operator
        DatasetPermissionService.check_permission(
            current_user, dataset, data.get("permission"), data.get("partial_member_list")
        )

        dataset = DatasetService.update_dataset(dataset_id_str, args, current_user)

        if dataset is None:
            raise NotFound("Dataset not found.")

        result_data = marshal(dataset, dataset_detail_fields)
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
                return {"result": "success"}, 204
            else:
                raise NotFound("Dataset not found.")
        except services.errors.dataset.DatasetInUseError:
            raise DatasetInUseError()


class DocumentStatusApi(DatasetApiResource):
    """Resource for batch document status operations."""

    def patch(self, tenant_id, dataset_id, action):
        """
        Batch update document status.

        Args:
            tenant_id: tenant id
            dataset_id: dataset id
            action: action to perform (enable, disable, archive, un_archive)

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

        if not document_ids:
            return {"result": "success"}, 200

        for document_id in document_ids:
            document = DocumentService.get_document(dataset_id_str, document_id)

            if not document:
                continue

            indexing_cache_key = f"document_{document.id}_indexing"
            cache_result = redis_client.get(indexing_cache_key)
            if cache_result is not None:
                raise InvalidActionError(f"Document:{document.name} is being indexed, please try again later")

            if action == "enable":
                if document.enabled:
                    continue
                document.enabled = True
                document.disabled_at = None
                document.disabled_by = None
                document.updated_at = datetime.now(UTC).replace(tzinfo=None)
                db.session.commit()

                # Set cache to prevent indexing the same document multiple times
                redis_client.setex(indexing_cache_key, 600, 1)

                add_document_to_index_task.delay(document_id)

            elif action == "disable":
                if not document.completed_at or document.indexing_status != "completed":
                    raise InvalidActionError(f"Document: {document.name} is not completed.")
                if not document.enabled:
                    continue

                document.enabled = False
                document.disabled_at = datetime.now(UTC).replace(tzinfo=None)
                document.disabled_by = current_user.id
                document.updated_at = datetime.now(UTC).replace(tzinfo=None)
                db.session.commit()

                # Set cache to prevent indexing the same document multiple times
                redis_client.setex(indexing_cache_key, 600, 1)

                remove_document_from_index_task.delay(document_id)

            elif action == "archive":
                if document.archived:
                    continue

                document.archived = True
                document.archived_at = datetime.now(UTC).replace(tzinfo=None)
                document.archived_by = current_user.id
                document.updated_at = datetime.now(UTC).replace(tzinfo=None)
                db.session.commit()

                if document.enabled:
                    # Set cache to prevent indexing the same document multiple times
                    redis_client.setex(indexing_cache_key, 600, 1)

                    remove_document_from_index_task.delay(document_id)

            elif action == "un_archive":
                if not document.archived:
                    continue
                document.archived = False
                document.archived_at = None
                document.archived_by = None
                document.updated_at = datetime.now(UTC).replace(tzinfo=None)
                db.session.commit()

                # Set cache to prevent indexing the same document multiple times
                redis_client.setex(indexing_cache_key, 600, 1)

                add_document_to_index_task.delay(document_id)

            else:
                raise InvalidActionError()

        return {"result": "success"}, 200


api.add_resource(DatasetListApi, "/datasets")
api.add_resource(DatasetApi, "/datasets/<uuid:dataset_id>")
api.add_resource(DocumentStatusApi, "/datasets/<uuid:dataset_id>/documents/status/<string:action>")
