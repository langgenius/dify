from flask import request
from flask_restful import marshal, reqparse
from werkzeug.exceptions import Forbidden, NotFound

import services.dataset_service
from controllers.service_api import api
from controllers.service_api.dataset.error import DatasetInUseError, DatasetNameDuplicateError
from controllers.service_api.wraps import DatasetApiResource
from core.model_runtime.entities.model_entities import ModelType
from core.plugin.entities.plugin import ModelProviderID
from core.provider_manager import ProviderManager
from fields.dataset_fields import dataset_detail_fields
from libs.login import current_user
from models.dataset import Dataset, DatasetPermissionEnum
from services.dataset_service import DatasetPermissionService, DatasetService
from services.entities.knowledge_entities.knowledge_entities import RetrievalModel


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


api.add_resource(DatasetListApi, "/datasets")
api.add_resource(DatasetApi, "/datasets/<uuid:dataset_id>")
