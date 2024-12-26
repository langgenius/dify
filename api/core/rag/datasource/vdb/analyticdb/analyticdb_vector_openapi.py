import json
from typing import Any, Optional

from pydantic import BaseModel, model_validator

_import_err_msg = (
    "`alibabacloud_gpdb20160503` and `alibabacloud_tea_openapi` packages not found, "
    "please run `pip install alibabacloud_gpdb20160503 alibabacloud_tea_openapi`"
)

from core.rag.models.document import Document
from extensions.ext_redis import redis_client


class AnalyticdbVectorOpenAPIConfig(BaseModel):
    access_key_id: str
    access_key_secret: str
    region_id: str
    instance_id: str
    account: str
    account_password: str
    namespace: str = "dify"
    namespace_password: Optional[str] = None
    metrics: str = "cosine"
    read_timeout: int = 60000

    @model_validator(mode="before")
    @classmethod
    def validate_config(cls, values: dict) -> dict:
        if not values["access_key_id"]:
            raise ValueError("config ANALYTICDB_KEY_ID is required")
        if not values["access_key_secret"]:
            raise ValueError("config ANALYTICDB_KEY_SECRET is required")
        if not values["region_id"]:
            raise ValueError("config ANALYTICDB_REGION_ID is required")
        if not values["instance_id"]:
            raise ValueError("config ANALYTICDB_INSTANCE_ID is required")
        if not values["account"]:
            raise ValueError("config ANALYTICDB_ACCOUNT is required")
        if not values["account_password"]:
            raise ValueError("config ANALYTICDB_PASSWORD is required")
        if not values["namespace_password"]:
            raise ValueError("config ANALYTICDB_NAMESPACE_PASSWORD is required")
        return values

    def to_analyticdb_client_params(self):
        return {
            "access_key_id": self.access_key_id,
            "access_key_secret": self.access_key_secret,
            "region_id": self.region_id,
            "read_timeout": self.read_timeout,
        }


class AnalyticdbVectorOpenAPI:
    def __init__(self, collection_name: str, config: AnalyticdbVectorOpenAPIConfig):
        try:
            from alibabacloud_gpdb20160503.client import Client  # type: ignore
            from alibabacloud_tea_openapi import models as open_api_models  # type: ignore
        except:
            raise ImportError(_import_err_msg)
        self._collection_name = collection_name.lower()
        self.config = config
        self._client_config = open_api_models.Config(user_agent="dify", **config.to_analyticdb_client_params())
        self._client = Client(self._client_config)
        self._initialize()

    def _initialize(self) -> None:
        cache_key = f"vector_initialize_{self.config.instance_id}"
        lock_name = f"{cache_key}_lock"
        with redis_client.lock(lock_name, timeout=20):
            database_exist_cache_key = f"vector_initialize_{self.config.instance_id}"
            if redis_client.get(database_exist_cache_key):
                return
            self._initialize_vector_database()
            self._create_namespace_if_not_exists()
            redis_client.set(database_exist_cache_key, 1, ex=3600)

    def _initialize_vector_database(self) -> None:
        from alibabacloud_gpdb20160503 import models as gpdb_20160503_models  # type: ignore

        request = gpdb_20160503_models.InitVectorDatabaseRequest(
            dbinstance_id=self.config.instance_id,
            region_id=self.config.region_id,
            manager_account=self.config.account,
            manager_account_password=self.config.account_password,
        )
        self._client.init_vector_database(request)

    def _create_namespace_if_not_exists(self) -> None:
        from alibabacloud_gpdb20160503 import models as gpdb_20160503_models
        from Tea.exceptions import TeaException  # type: ignore

        try:
            request = gpdb_20160503_models.DescribeNamespaceRequest(
                dbinstance_id=self.config.instance_id,
                region_id=self.config.region_id,
                namespace=self.config.namespace,
                manager_account=self.config.account,
                manager_account_password=self.config.account_password,
            )
            self._client.describe_namespace(request)
        except TeaException as e:
            if e.statusCode == 404:
                request = gpdb_20160503_models.CreateNamespaceRequest(
                    dbinstance_id=self.config.instance_id,
                    region_id=self.config.region_id,
                    manager_account=self.config.account,
                    manager_account_password=self.config.account_password,
                    namespace=self.config.namespace,
                    namespace_password=self.config.namespace_password,
                )
                self._client.create_namespace(request)
            else:
                raise ValueError(f"failed to create namespace {self.config.namespace}: {e}")

    def _create_collection_if_not_exists(self, embedding_dimension: int):
        from alibabacloud_gpdb20160503 import models as gpdb_20160503_models
        from Tea.exceptions import TeaException

        cache_key = f"vector_indexing_{self._collection_name}"
        lock_name = f"{cache_key}_lock"
        with redis_client.lock(lock_name, timeout=20):
            collection_exist_cache_key = f"vector_indexing_{self._collection_name}"
            if redis_client.get(collection_exist_cache_key):
                return
            try:
                request = gpdb_20160503_models.DescribeCollectionRequest(
                    dbinstance_id=self.config.instance_id,
                    region_id=self.config.region_id,
                    namespace=self.config.namespace,
                    namespace_password=self.config.namespace_password,
                    collection=self._collection_name,
                )
                self._client.describe_collection(request)
            except TeaException as e:
                if e.statusCode == 404:
                    metadata = '{"ref_doc_id":"text","page_content":"text","metadata_":"jsonb"}'
                    full_text_retrieval_fields = "page_content"
                    request = gpdb_20160503_models.CreateCollectionRequest(
                        dbinstance_id=self.config.instance_id,
                        region_id=self.config.region_id,
                        manager_account=self.config.account,
                        manager_account_password=self.config.account_password,
                        namespace=self.config.namespace,
                        collection=self._collection_name,
                        dimension=embedding_dimension,
                        metrics=self.config.metrics,
                        metadata=metadata,
                        full_text_retrieval_fields=full_text_retrieval_fields,
                    )
                    self._client.create_collection(request)
                else:
                    raise ValueError(f"failed to create collection {self._collection_name}: {e}")
            redis_client.set(collection_exist_cache_key, 1, ex=3600)

    def add_texts(self, documents: list[Document], embeddings: list[list[float]], **kwargs):
        from alibabacloud_gpdb20160503 import models as gpdb_20160503_models

        rows: list[gpdb_20160503_models.UpsertCollectionDataRequestRows] = []
        for doc, embedding in zip(documents, embeddings, strict=True):
            if doc.metadata is not None:
                metadata = {
                    "ref_doc_id": doc.metadata["doc_id"],
                    "page_content": doc.page_content,
                    "metadata_": json.dumps(doc.metadata),
                }
                rows.append(
                    gpdb_20160503_models.UpsertCollectionDataRequestRows(
                        vector=embedding,
                        metadata=metadata,
                    )
                )
        request = gpdb_20160503_models.UpsertCollectionDataRequest(
            dbinstance_id=self.config.instance_id,
            region_id=self.config.region_id,
            namespace=self.config.namespace,
            namespace_password=self.config.namespace_password,
            collection=self._collection_name,
            rows=rows,
        )
        self._client.upsert_collection_data(request)

    def text_exists(self, id: str) -> bool:
        from alibabacloud_gpdb20160503 import models as gpdb_20160503_models

        request = gpdb_20160503_models.QueryCollectionDataRequest(
            dbinstance_id=self.config.instance_id,
            region_id=self.config.region_id,
            namespace=self.config.namespace,
            namespace_password=self.config.namespace_password,
            collection=self._collection_name,
            metrics=self.config.metrics,
            include_values=True,
            vector=None,
            content=None,
            top_k=1,
            filter=f"ref_doc_id='{id}'",
        )
        response = self._client.query_collection_data(request)
        return len(response.body.matches.match) > 0

    def delete_by_ids(self, ids: list[str]) -> None:
        from alibabacloud_gpdb20160503 import models as gpdb_20160503_models

        ids_str = ",".join(f"'{id}'" for id in ids)
        ids_str = f"({ids_str})"
        request = gpdb_20160503_models.DeleteCollectionDataRequest(
            dbinstance_id=self.config.instance_id,
            region_id=self.config.region_id,
            namespace=self.config.namespace,
            namespace_password=self.config.namespace_password,
            collection=self._collection_name,
            collection_data=None,
            collection_data_filter=f"ref_doc_id IN {ids_str}",
        )
        self._client.delete_collection_data(request)

    def delete_by_metadata_field(self, key: str, value: str) -> None:
        from alibabacloud_gpdb20160503 import models as gpdb_20160503_models

        request = gpdb_20160503_models.DeleteCollectionDataRequest(
            dbinstance_id=self.config.instance_id,
            region_id=self.config.region_id,
            namespace=self.config.namespace,
            namespace_password=self.config.namespace_password,
            collection=self._collection_name,
            collection_data=None,
            collection_data_filter=f"metadata_ ->> '{key}' = '{value}'",
        )
        self._client.delete_collection_data(request)

    def search_by_vector(self, query_vector: list[float], **kwargs: Any) -> list[Document]:
        from alibabacloud_gpdb20160503 import models as gpdb_20160503_models

        score_threshold = kwargs.get("score_threshold") or 0.0
        request = gpdb_20160503_models.QueryCollectionDataRequest(
            dbinstance_id=self.config.instance_id,
            region_id=self.config.region_id,
            namespace=self.config.namespace,
            namespace_password=self.config.namespace_password,
            collection=self._collection_name,
            include_values=kwargs.pop("include_values", True),
            metrics=self.config.metrics,
            vector=query_vector,
            content=None,
            top_k=kwargs.get("top_k", 4),
            filter=None,
        )
        response = self._client.query_collection_data(request)
        documents = []
        for match in response.body.matches.match:
            if match.score > score_threshold:
                metadata = json.loads(match.metadata.get("metadata_"))
                metadata["score"] = match.score
                doc = Document(
                    page_content=match.metadata.get("page_content"),
                    vector=match.values.value,
                    metadata=metadata,
                )
                documents.append(doc)
        documents = sorted(documents, key=lambda x: x.metadata["score"] if x.metadata else 0, reverse=True)
        return documents

    def search_by_full_text(self, query: str, **kwargs: Any) -> list[Document]:
        from alibabacloud_gpdb20160503 import models as gpdb_20160503_models

        score_threshold = float(kwargs.get("score_threshold") or 0.0)
        request = gpdb_20160503_models.QueryCollectionDataRequest(
            dbinstance_id=self.config.instance_id,
            region_id=self.config.region_id,
            namespace=self.config.namespace,
            namespace_password=self.config.namespace_password,
            collection=self._collection_name,
            include_values=kwargs.pop("include_values", True),
            metrics=self.config.metrics,
            vector=None,
            content=query,
            top_k=kwargs.get("top_k", 4),
            filter=None,
        )
        response = self._client.query_collection_data(request)
        documents = []
        for match in response.body.matches.match:
            if match.score > score_threshold:
                metadata = json.loads(match.metadata.get("metadata_"))
                metadata["score"] = match.score
                doc = Document(
                    page_content=match.metadata.get("page_content"),
                    vector=match.values.value,
                    metadata=metadata,
                )
                documents.append(doc)
        documents = sorted(documents, key=lambda x: x.metadata["score"] if x.metadata else 0, reverse=True)
        return documents

    def delete(self) -> None:
        try:
            from alibabacloud_gpdb20160503 import models as gpdb_20160503_models

            request = gpdb_20160503_models.DeleteCollectionRequest(
                collection=self._collection_name,
                dbinstance_id=self.config.instance_id,
                namespace=self.config.namespace,
                namespace_password=self.config.namespace_password,
                region_id=self.config.region_id,
            )
            self._client.delete_collection(request)
        except Exception as e:
            raise e
