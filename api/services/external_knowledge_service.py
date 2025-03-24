import json
from copy import deepcopy
from datetime import UTC, datetime
from typing import Any, Optional, Union, cast

import httpx
import validators

from constants import HIDDEN_VALUE
from core.helper import ssrf_proxy
from core.rag.entities.metadata_entities import MetadataCondition
from extensions.ext_database import db
from models.dataset import (
    Dataset,
    ExternalKnowledgeApis,
    ExternalKnowledgeBindings,
)
from services.entities.external_knowledge_entities.external_knowledge_entities import (
    Authorization,
    ExternalKnowledgeApiSetting,
)
from services.errors.dataset import DatasetNameDuplicateError


class ExternalDatasetService:
    @staticmethod
    def get_external_knowledge_apis(page, per_page, tenant_id, search=None) -> tuple[list[ExternalKnowledgeApis], int]:
        query = ExternalKnowledgeApis.query.filter(ExternalKnowledgeApis.tenant_id == tenant_id).order_by(
            ExternalKnowledgeApis.created_at.desc()
        )
        if search:
            query = query.filter(ExternalKnowledgeApis.name.ilike(f"%{search}%"))

        external_knowledge_apis = query.paginate(page=page, per_page=per_page, max_per_page=100, error_out=False)

        return external_knowledge_apis.items, external_knowledge_apis.total

    @classmethod
    def validate_api_list(cls, api_settings: dict):
        if not api_settings:
            raise ValueError("api list is empty")
        if "endpoint" not in api_settings and not api_settings["endpoint"]:
            raise ValueError("endpoint is required")
        if "api_key" not in api_settings and not api_settings["api_key"]:
            raise ValueError("api_key is required")

    @staticmethod
    def create_external_knowledge_api(tenant_id: str, user_id: str, args: dict) -> ExternalKnowledgeApis:
        settings = args.get("settings")
        if settings is None:
            raise ValueError("settings is required")
        ExternalDatasetService.check_endpoint_and_api_key(settings)
        external_knowledge_api = ExternalKnowledgeApis(
            tenant_id=tenant_id,
            created_by=user_id,
            updated_by=user_id,
            name=args.get("name"),
            description=args.get("description", ""),
            settings=json.dumps(args.get("settings"), ensure_ascii=False),
        )

        db.session.add(external_knowledge_api)
        db.session.commit()
        return external_knowledge_api

    @staticmethod
    def check_endpoint_and_api_key(settings: dict):
        if "endpoint" not in settings or not settings["endpoint"]:
            raise ValueError("endpoint is required")
        if "api_key" not in settings or not settings["api_key"]:
            raise ValueError("api_key is required")

        endpoint = f"{settings['endpoint']}/retrieval"
        api_key = settings["api_key"]
        if not validators.url(endpoint, simple_host=True):
            if not endpoint.startswith("http://") and not endpoint.startswith("https://"):
                raise ValueError(f"invalid endpoint: {endpoint} must start with http:// or https://")
            else:
                raise ValueError(f"invalid endpoint: {endpoint}")
        try:
            response = httpx.post(endpoint, headers={"Authorization": f"Bearer {api_key}"})
        except Exception as e:
            raise ValueError(f"failed to connect to the endpoint: {endpoint}")
        if response.status_code == 502:
            raise ValueError(f"Bad Gateway: failed to connect to the endpoint: {endpoint}")
        if response.status_code == 404:
            raise ValueError(f"Not Found: failed to connect to the endpoint: {endpoint}")
        if response.status_code == 403:
            raise ValueError(f"Forbidden: Authorization failed with api_key: {api_key}")

    @staticmethod
    def get_external_knowledge_api(external_knowledge_api_id: str) -> ExternalKnowledgeApis:
        external_knowledge_api: Optional[ExternalKnowledgeApis] = ExternalKnowledgeApis.query.filter_by(
            id=external_knowledge_api_id
        ).first()
        if external_knowledge_api is None:
            raise ValueError("api template not found")
        return external_knowledge_api

    @staticmethod
    def update_external_knowledge_api(tenant_id, user_id, external_knowledge_api_id, args) -> ExternalKnowledgeApis:
        external_knowledge_api: Optional[ExternalKnowledgeApis] = ExternalKnowledgeApis.query.filter_by(
            id=external_knowledge_api_id, tenant_id=tenant_id
        ).first()
        if external_knowledge_api is None:
            raise ValueError("api template not found")
        if args.get("settings") and args.get("settings").get("api_key") == HIDDEN_VALUE:
            args.get("settings")["api_key"] = external_knowledge_api.settings_dict.get("api_key")

        external_knowledge_api.name = args.get("name")
        external_knowledge_api.description = args.get("description", "")
        external_knowledge_api.settings = json.dumps(args.get("settings"), ensure_ascii=False)
        external_knowledge_api.updated_by = user_id
        external_knowledge_api.updated_at = datetime.now(UTC).replace(tzinfo=None)
        db.session.commit()

        return external_knowledge_api

    @staticmethod
    def delete_external_knowledge_api(tenant_id: str, external_knowledge_api_id: str):
        external_knowledge_api = ExternalKnowledgeApis.query.filter_by(
            id=external_knowledge_api_id, tenant_id=tenant_id
        ).first()
        if external_knowledge_api is None:
            raise ValueError("api template not found")

        db.session.delete(external_knowledge_api)
        db.session.commit()

    @staticmethod
    def external_knowledge_api_use_check(external_knowledge_api_id: str) -> tuple[bool, int]:
        count = ExternalKnowledgeBindings.query.filter_by(external_knowledge_api_id=external_knowledge_api_id).count()
        if count > 0:
            return True, count
        return False, 0

    @staticmethod
    def get_external_knowledge_binding_with_dataset_id(tenant_id: str, dataset_id: str) -> ExternalKnowledgeBindings:
        external_knowledge_binding: Optional[ExternalKnowledgeBindings] = ExternalKnowledgeBindings.query.filter_by(
            dataset_id=dataset_id, tenant_id=tenant_id
        ).first()
        if not external_knowledge_binding:
            raise ValueError("external knowledge binding not found")
        return external_knowledge_binding

    @staticmethod
    def document_create_args_validate(tenant_id: str, external_knowledge_api_id: str, process_parameter: dict):
        external_knowledge_api = ExternalKnowledgeApis.query.filter_by(
            id=external_knowledge_api_id, tenant_id=tenant_id
        ).first()
        if external_knowledge_api is None:
            raise ValueError("api template not found")
        settings = json.loads(external_knowledge_api.settings)
        for setting in settings:
            custom_parameters = setting.get("document_process_setting")
            if custom_parameters:
                for parameter in custom_parameters:
                    if parameter.get("required", False) and not process_parameter.get(parameter.get("name")):
                        raise ValueError(f"{parameter.get('name')} is required")

    @staticmethod
    def process_external_api(
        settings: ExternalKnowledgeApiSetting, files: Union[None, dict[str, Any]]
    ) -> httpx.Response:
        """
        do http request depending on api bundle
        """

        kwargs = {
            "url": settings.url,
            "headers": settings.headers,
            "follow_redirects": True,
        }

        response: httpx.Response = getattr(ssrf_proxy, settings.request_method)(
            data=json.dumps(settings.params), files=files, **kwargs
        )
        return response

    @staticmethod
    def assembling_headers(authorization: Authorization, headers: Optional[dict] = None) -> dict[str, Any]:
        authorization = deepcopy(authorization)
        if headers:
            headers = deepcopy(headers)
        else:
            headers = {}
        if authorization.type == "api-key":
            if authorization.config is None:
                raise ValueError("authorization config is required")

            if authorization.config.api_key is None:
                raise ValueError("api_key is required")

            if not authorization.config.header:
                authorization.config.header = "Authorization"

            if authorization.config.type == "bearer":
                headers[authorization.config.header] = f"Bearer {authorization.config.api_key}"
            elif authorization.config.type == "basic":
                headers[authorization.config.header] = f"Basic {authorization.config.api_key}"
            elif authorization.config.type == "custom":
                headers[authorization.config.header] = authorization.config.api_key

        return headers

    @staticmethod
    def get_external_knowledge_api_settings(settings: dict) -> ExternalKnowledgeApiSetting:
        return ExternalKnowledgeApiSetting.parse_obj(settings)

    @staticmethod
    def create_external_dataset(tenant_id: str, user_id: str, args: dict) -> Dataset:
        # check if dataset name already exists
        if Dataset.query.filter_by(name=args.get("name"), tenant_id=tenant_id).first():
            raise DatasetNameDuplicateError(f"Dataset with name {args.get('name')} already exists.")
        external_knowledge_api = ExternalKnowledgeApis.query.filter_by(
            id=args.get("external_knowledge_api_id"), tenant_id=tenant_id
        ).first()

        if external_knowledge_api is None:
            raise ValueError("api template not found")

        dataset = Dataset(
            tenant_id=tenant_id,
            name=args.get("name"),
            description=args.get("description", ""),
            provider="external",
            retrieval_model=args.get("external_retrieval_model"),
            created_by=user_id,
        )

        db.session.add(dataset)
        db.session.flush()

        external_knowledge_binding = ExternalKnowledgeBindings(
            tenant_id=tenant_id,
            dataset_id=dataset.id,
            external_knowledge_api_id=args.get("external_knowledge_api_id"),
            external_knowledge_id=args.get("external_knowledge_id"),
            created_by=user_id,
        )
        db.session.add(external_knowledge_binding)

        db.session.commit()

        return dataset

    @staticmethod
    def fetch_external_knowledge_retrieval(
        tenant_id: str,
        dataset_id: str,
        query: str,
        external_retrieval_parameters: dict,
        metadata_condition: Optional[MetadataCondition] = None,
    ) -> list:
        external_knowledge_binding = ExternalKnowledgeBindings.query.filter_by(
            dataset_id=dataset_id, tenant_id=tenant_id
        ).first()
        if not external_knowledge_binding:
            raise ValueError("external knowledge binding not found")

        external_knowledge_api = ExternalKnowledgeApis.query.filter_by(
            id=external_knowledge_binding.external_knowledge_api_id
        ).first()
        if not external_knowledge_api:
            raise ValueError("external api template not found")

        settings = json.loads(external_knowledge_api.settings)
        headers = {"Content-Type": "application/json"}
        if settings.get("api_key"):
            headers["Authorization"] = f"Bearer {settings.get('api_key')}"
        score_threshold_enabled = external_retrieval_parameters.get("score_threshold_enabled") or False
        score_threshold = external_retrieval_parameters.get("score_threshold", 0.0) if score_threshold_enabled else 0.0
        request_params = {
            "retrieval_setting": {
                "top_k": external_retrieval_parameters.get("top_k"),
                "score_threshold": score_threshold,
            },
            "query": query,
            "knowledge_id": external_knowledge_binding.external_knowledge_id,
            "metadata_condition": metadata_condition.model_dump() if metadata_condition else None,
        }

        response = ExternalDatasetService.process_external_api(
            ExternalKnowledgeApiSetting(
                url=f"{settings.get('endpoint')}/retrieval",
                request_method="post",
                headers=headers,
                params=request_params,
            ),
            None,
        )
        if response.status_code == 200:
            return cast(list[Any], response.json().get("records", []))
        return []
