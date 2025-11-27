import json
from copy import deepcopy
from typing import Any, Union, cast
from urllib.parse import urlparse

import httpx
from sqlalchemy import select

from constants import HIDDEN_VALUE
from core.helper import ssrf_proxy
from core.rag.entities.metadata_entities import MetadataCondition
from core.workflow.nodes.http_request.exc import InvalidHttpMethodError
from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now
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
    def get_external_knowledge_apis(
        page, per_page, tenant_id, search=None
    ) -> tuple[list[ExternalKnowledgeApis], int | None]:
        query = (
            select(ExternalKnowledgeApis)
            .where(ExternalKnowledgeApis.tenant_id == tenant_id)
            .order_by(ExternalKnowledgeApis.created_at.desc())
        )
        if search:
            query = query.where(ExternalKnowledgeApis.name.ilike(f"%{search}%"))

        external_knowledge_apis = db.paginate(
            select=query, page=page, per_page=per_page, max_per_page=100, error_out=False
        )

        return external_knowledge_apis.items, external_knowledge_apis.total

    @classmethod
    def validate_api_list(cls, api_settings: dict):
        if not api_settings:
            raise ValueError("api list is empty")
        if not api_settings.get("endpoint"):
            raise ValueError("endpoint is required")
        if not api_settings.get("api_key"):
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
            name=str(args.get("name")),
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

        parsed_url = urlparse(endpoint)
        if not all([parsed_url.scheme, parsed_url.netloc]):
            if not endpoint.startswith("http://") and not endpoint.startswith("https://"):
                raise ValueError(f"invalid endpoint: {endpoint} must start with http:// or https://")
            else:
                raise ValueError(f"invalid endpoint: {endpoint}")
        try:
            response = ssrf_proxy.post(endpoint, headers={"Authorization": f"Bearer {api_key}"})
        except Exception as e:
            raise ValueError(f"failed to connect to the endpoint: {endpoint}") from e
        if response.status_code == 502:
            raise ValueError(f"Bad Gateway: failed to connect to the endpoint: {endpoint}")
        if response.status_code == 404:
            raise ValueError(f"Not Found: failed to connect to the endpoint: {endpoint}")
        if response.status_code == 403:
            raise ValueError(f"Forbidden: Authorization failed with api_key: {api_key}")

    @staticmethod
    def get_external_knowledge_api(external_knowledge_api_id: str) -> ExternalKnowledgeApis:
        external_knowledge_api: ExternalKnowledgeApis | None = (
            db.session.query(ExternalKnowledgeApis).filter_by(id=external_knowledge_api_id).first()
        )
        if external_knowledge_api is None:
            raise ValueError("api template not found")
        return external_knowledge_api

    @staticmethod
    def update_external_knowledge_api(tenant_id, user_id, external_knowledge_api_id, args) -> ExternalKnowledgeApis:
        external_knowledge_api: ExternalKnowledgeApis | None = (
            db.session.query(ExternalKnowledgeApis).filter_by(id=external_knowledge_api_id, tenant_id=tenant_id).first()
        )
        if external_knowledge_api is None:
            raise ValueError("api template not found")
        settings = args.get("settings")
        if settings and settings.get("api_key") == HIDDEN_VALUE and external_knowledge_api.settings_dict:
            settings["api_key"] = external_knowledge_api.settings_dict.get("api_key")

        external_knowledge_api.name = args.get("name")
        external_knowledge_api.description = args.get("description", "")
        external_knowledge_api.settings = json.dumps(args.get("settings"), ensure_ascii=False)
        external_knowledge_api.updated_by = user_id
        external_knowledge_api.updated_at = naive_utc_now()
        db.session.commit()

        return external_knowledge_api

    @staticmethod
    def delete_external_knowledge_api(tenant_id: str, external_knowledge_api_id: str):
        external_knowledge_api = (
            db.session.query(ExternalKnowledgeApis).filter_by(id=external_knowledge_api_id, tenant_id=tenant_id).first()
        )
        if external_knowledge_api is None:
            raise ValueError("api template not found")

        db.session.delete(external_knowledge_api)
        db.session.commit()

    @staticmethod
    def external_knowledge_api_use_check(external_knowledge_api_id: str) -> tuple[bool, int]:
        count = (
            db.session.query(ExternalKnowledgeBindings)
            .filter_by(external_knowledge_api_id=external_knowledge_api_id)
            .count()
        )
        if count > 0:
            return True, count
        return False, 0

    @staticmethod
    def get_external_knowledge_binding_with_dataset_id(tenant_id: str, dataset_id: str) -> ExternalKnowledgeBindings:
        external_knowledge_binding: ExternalKnowledgeBindings | None = (
            db.session.query(ExternalKnowledgeBindings).filter_by(dataset_id=dataset_id, tenant_id=tenant_id).first()
        )
        if not external_knowledge_binding:
            raise ValueError("external knowledge binding not found")
        return external_knowledge_binding

    @staticmethod
    def document_create_args_validate(tenant_id: str, external_knowledge_api_id: str, process_parameter: dict):
        external_knowledge_api = (
            db.session.query(ExternalKnowledgeApis).filter_by(id=external_knowledge_api_id, tenant_id=tenant_id).first()
        )
        if external_knowledge_api is None or external_knowledge_api.settings is None:
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

        kwargs: dict[str, Any] = {
            "url": settings.url,
            "headers": settings.headers,
            "follow_redirects": True,
        }

        _METHOD_MAP = {
            "get": ssrf_proxy.get,
            "head": ssrf_proxy.head,
            "post": ssrf_proxy.post,
            "put": ssrf_proxy.put,
            "delete": ssrf_proxy.delete,
            "patch": ssrf_proxy.patch,
        }
        method_lc = settings.request_method.lower()
        if method_lc not in _METHOD_MAP:
            raise InvalidHttpMethodError(f"Invalid http method {settings.request_method}")

        response: httpx.Response = _METHOD_MAP[method_lc](data=json.dumps(settings.params), files=files, **kwargs)
        return response

    @staticmethod
    def assembling_headers(authorization: Authorization, headers: dict | None = None) -> dict[str, Any]:
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
        return ExternalKnowledgeApiSetting.model_validate(settings)

    @staticmethod
    def create_external_dataset(tenant_id: str, user_id: str, args: dict) -> Dataset:
        # check if dataset name already exists
        if db.session.query(Dataset).filter_by(name=args.get("name"), tenant_id=tenant_id).first():
            raise DatasetNameDuplicateError(f"Dataset with name {args.get('name')} already exists.")
        external_knowledge_api = (
            db.session.query(ExternalKnowledgeApis)
            .filter_by(id=args.get("external_knowledge_api_id"), tenant_id=tenant_id)
            .first()
        )

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
        if args.get("external_knowledge_id") is None:
            raise ValueError("external_knowledge_id is required")
        if args.get("external_knowledge_api_id") is None:
            raise ValueError("external_knowledge_api_id is required")

        external_knowledge_binding = ExternalKnowledgeBindings(
            tenant_id=tenant_id,
            dataset_id=dataset.id,
            external_knowledge_api_id=args.get("external_knowledge_api_id") or "",
            external_knowledge_id=args.get("external_knowledge_id") or "",
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
        metadata_condition: MetadataCondition | None = None,
    ):
        """
        Fetch knowledge retrieval results from an external knowledge API.

        This method handles the communication with external knowledge bases (like RAGFlow)
        to retrieve relevant documents based on a query and optional metadata filtering.

        Fix for issue #21070: The metadata_condition parameter is now only included in the
        request when it's not None. This prevents external APIs from ignoring metadata
        filtering when None values are sent in the JSON request.

        Args:
            tenant_id: The tenant ID for the dataset
            dataset_id: The dataset ID to retrieve from
            query: The search query string
            external_retrieval_parameters: Dictionary containing retrieval parameters like
                top_k, score_threshold, etc.
            metadata_condition: Optional metadata filtering conditions. If None, no metadata
                filtering will be applied.

        Returns:
            list[Any]: List of retrieved document records from the external API

        Raises:
            ValueError: If external knowledge binding or API template is not found
        """
        # ========================================================================
        # STEP 1: Retrieve the external knowledge binding for this dataset
        # ========================================================================
        # The binding links the dataset to an external knowledge base
        external_knowledge_binding = (
            db.session.query(ExternalKnowledgeBindings).filter_by(dataset_id=dataset_id, tenant_id=tenant_id).first()
        )

        # Validate that the binding exists
        if not external_knowledge_binding:
            raise ValueError("external knowledge binding not found")

        # ========================================================================
        # STEP 2: Retrieve the external knowledge API configuration
        # ========================================================================
        # This contains the endpoint URL and API key for the external service
        external_knowledge_api = (
            db.session.query(ExternalKnowledgeApis)
            .filter_by(id=external_knowledge_binding.external_knowledge_api_id)
            .first()
        )

        # Validate that the API configuration exists and has settings
        if external_knowledge_api is None or external_knowledge_api.settings is None:
            raise ValueError("external api template not found")

        # Step 3: Parse the API settings from JSON
        # Settings typically include endpoint URL and API key
        settings = json.loads(external_knowledge_api.settings)

        # Step 4: Build HTTP headers for the request
        # Always include Content-Type, and add Authorization if API key is provided
        headers = {"Content-Type": "application/json"}

        # Add Bearer token authentication if API key is configured
        if settings.get("api_key"):
            headers["Authorization"] = f"Bearer {settings.get('api_key')}"

        # Step 5: Extract and process score threshold settings
        # Score threshold is used to filter out low-relevance results
        # Only apply threshold if it's explicitly enabled
        score_threshold_enabled = external_retrieval_parameters.get("score_threshold_enabled") or False
        score_threshold = external_retrieval_parameters.get("score_threshold", 0.0) if score_threshold_enabled else 0.0

        # Step 6: Build the base request parameters for the external knowledge API
        # These parameters are always included in the request
        request_params = {
            "retrieval_setting": {
                "top_k": external_retrieval_parameters.get("top_k"),
                "score_threshold": score_threshold,
            },
            "query": query,
            "knowledge_id": external_knowledge_binding.external_knowledge_id,
        }

        # Step 7: Fix for issue #21070 - Conditionally include metadata_condition
        # Only include metadata_condition if it's not None. This ensures that:
        # 1. None values are not sent in the JSON request (which could cause issues)
        # 2. External APIs receive the metadata filtering conditions correctly
        # 3. The external API can properly apply metadata filters when provided
        if metadata_condition:
            # Convert the MetadataCondition model to a dictionary for JSON serialization
            request_params["metadata_condition"] = metadata_condition.model_dump()

        # Step 8: Make the HTTP request to the external knowledge API
        # The process_external_api method handles the actual HTTP communication
        response = ExternalDatasetService.process_external_api(
            ExternalKnowledgeApiSetting(
                url=f"{settings.get('endpoint')}/retrieval",
                request_method="post",
                headers=headers,
                params=request_params,
            ),
            None,
        )

        # Step 9: Parse and return the response
        # Extract the "records" field from the JSON response, which contains the retrieved documents
        if response.status_code == 200:
            return cast(list[Any], response.json().get("records", []))

        # Return empty list if request was not successful
        return []
