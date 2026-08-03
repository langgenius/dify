import json
import logging
import os
import uuid
from collections.abc import Generator, Iterable, Sequence
from dataclasses import dataclass
from itertools import islice
from typing import TYPE_CHECKING, Any, override

import httpx
import qdrant_client

logger = logging.getLogger(__name__)
from flask import current_app
from httpx import DigestAuth
from pydantic import BaseModel
from qdrant_client.http import models as rest
from qdrant_client.http.models import (
    FilterSelector,
    HnswConfigDiff,
    PayloadSchemaType,
    TextIndexParams,
    TextIndexType,
    TokenizerType,
)
from qdrant_client.local.qdrant_local import QdrantLocal
from sqlalchemy import select

from configs import dify_config
from core.db.session_factory import session_factory
from core.rag.datasource.vdb.field import Field
from core.rag.datasource.vdb.vector_base import BaseVector, VectorIndexStructDict
from core.rag.datasource.vdb.vector_factory import AbstractVectorFactory
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.embedding.embedding_base import Embeddings
from core.rag.models.document import Document
from dify_vdb_tidb_on_qdrant.tidb_service import TidbService
from extensions.ext_redis import redis_client
from models.dataset import Dataset, TidbAuthBinding
from models.enums import TidbAuthBindingStatus

if TYPE_CHECKING:
    from qdrant_client import grpc  # noqa
    from qdrant_client.conversions import common_types

    type DictFilter = dict[str, str | int | bool | dict | list]
    type MetadataFilter = DictFilter | common_types.Filter


class TidbOnQdrantConfig(BaseModel):
    endpoint: str
    api_key: str | None = None
    timeout: float = 20
    root_path: str | None = None
    grpc_port: int = 6334
    prefer_grpc: bool = False
    replication_factor: int = 1

    def to_qdrant_params(self):
        if self.endpoint and self.endpoint.startswith("path:"):
            path = self.endpoint.replace("path:", "")
            if not os.path.isabs(path):
                if self.root_path:
                    path = os.path.join(self.root_path, path)
                else:
                    raise ValueError("root_path is required")

            return {"path": path}
        else:
            return {
                "url": self.endpoint,
                "api_key": self.api_key,
                "timeout": self.timeout,
                "verify": False,
                "grpc_port": self.grpc_port,
                "prefer_grpc": self.prefer_grpc,
            }


class TidbConfig(BaseModel):
    api_url: str
    public_key: str
    private_key: str


@dataclass(frozen=True)
class _TidbBindingConfig:
    cluster_id: str
    account: str
    password: str
    qdrant_endpoint: str | None


@dataclass(frozen=True)
class _ProvisionedTidbCluster:
    cluster_id: str
    cluster_name: str
    account: str
    password: str
    qdrant_endpoint: str | None


class TidbOnQdrantVector(BaseVector):
    def __init__(self, collection_name: str, group_id: str, config: TidbOnQdrantConfig, distance_func: str = "Cosine"):
        super().__init__(collection_name)
        self._client_config = config
        self._client = qdrant_client.QdrantClient(**self._client_config.to_qdrant_params())
        self._distance_func = distance_func.upper()
        self._group_id = group_id

    @override
    def get_type(self) -> str:
        return VectorType.TIDB_ON_QDRANT

    def to_index_struct(self) -> VectorIndexStructDict:
        result: VectorIndexStructDict = {
            "type": self.get_type(),
            "vector_store": {"class_prefix": self._collection_name},
        }
        return result

    @override
    def create(self, texts: list[Document], embeddings: list[list[float]], **kwargs):
        if texts:
            # get embedding vector size
            vector_size = len(embeddings[0])
            # get collection name
            collection_name = self._collection_name
            # create collection
            self.create_collection(collection_name, vector_size)

            self.add_texts(texts, embeddings, **kwargs)

    def create_collection(self, collection_name: str, vector_size: int):
        lock_name = f"vector_indexing_lock_{collection_name}"
        with redis_client.lock(lock_name, timeout=20):
            collection_exist_cache_key = f"vector_indexing_{self._collection_name}"
            if redis_client.get(collection_exist_cache_key):
                return
            collection_name = collection_name or uuid.uuid4().hex
            all_collection_name = []
            collections_response = self._client.get_collections()
            collection_list = collections_response.collections
            for collection in collection_list:
                all_collection_name.append(collection.name)
            if collection_name not in all_collection_name:
                from qdrant_client.http import models as rest

                vectors_config = rest.VectorParams(
                    size=vector_size,
                    distance=rest.Distance[self._distance_func],
                )
                hnsw_config = HnswConfigDiff(
                    m=0,
                    payload_m=16,
                    ef_construct=100,
                    full_scan_threshold=10000,
                    max_indexing_threads=0,
                    on_disk=False,
                )
                self._client.create_collection(
                    collection_name=collection_name,
                    vectors_config=vectors_config,
                    hnsw_config=hnsw_config,
                    timeout=int(self._client_config.timeout),
                    replication_factor=self._client_config.replication_factor,
                )

                # create group_id payload index
                self._client.create_payload_index(
                    collection_name, Field.GROUP_KEY, field_schema=PayloadSchemaType.KEYWORD
                )
                # create doc_id payload index
                self._client.create_payload_index(collection_name, Field.DOC_ID, field_schema=PayloadSchemaType.KEYWORD)
                # create document_id payload index
                self._client.create_payload_index(
                    collection_name, Field.DOCUMENT_ID, field_schema=PayloadSchemaType.KEYWORD
                )
                # create full text index
                text_index_params = TextIndexParams(
                    type=TextIndexType.TEXT,
                    tokenizer=TokenizerType.MULTILINGUAL,
                    min_token_len=2,
                    max_token_len=20,
                    lowercase=True,
                )
                self._client.create_payload_index(collection_name, Field.CONTENT_KEY, field_schema=text_index_params)
            redis_client.set(collection_exist_cache_key, 1, ex=3600)

    @override
    def add_texts(self, documents: list[Document], embeddings: list[list[float]], **kwargs):
        uuids = self._get_uuids(documents)
        texts = [d.page_content for d in documents]
        metadatas = [d.metadata for d in documents if d.metadata is not None]

        added_ids = []
        for batch_ids, points in self._generate_rest_batches(texts, embeddings, metadatas, uuids, 64, self._group_id):
            self._client.upsert(collection_name=self._collection_name, points=points)
            added_ids.extend(batch_ids)

        return added_ids

    def _generate_rest_batches(
        self,
        texts: Iterable[str],
        embeddings: list[list[float]],
        metadatas: list[dict] | None = None,
        ids: Sequence[str] | None = None,
        batch_size: int = 64,
        group_id: str | None = None,
    ) -> Generator[tuple[list[str], list[rest.PointStruct]], None, None]:
        from qdrant_client.http import models as rest

        texts_iterator = iter(texts)
        embeddings_iterator = iter(embeddings)
        metadatas_iterator = iter(metadatas or [])
        ids_iterator = iter(ids or [uuid.uuid4().hex for _ in iter(texts)])
        while batch_texts := list(islice(texts_iterator, batch_size)):
            # Take the corresponding metadata and id for each text in a batch
            batch_metadatas = list(islice(metadatas_iterator, batch_size)) or None
            batch_ids = list(islice(ids_iterator, batch_size))

            # Generate the embeddings for all the texts in a batch
            batch_embeddings = list(islice(embeddings_iterator, batch_size))

            points = [
                rest.PointStruct(
                    id=point_id,
                    vector=vector,
                    payload=payload,
                )
                for point_id, vector, payload in zip(
                    batch_ids,
                    batch_embeddings,
                    self._build_payloads(
                        batch_texts,
                        batch_metadatas,
                        Field.CONTENT_KEY,
                        Field.METADATA_KEY,
                        group_id or "",
                        Field.GROUP_KEY,
                    ),
                )
            ]

            yield batch_ids, points

    @classmethod
    def _build_payloads(
        cls,
        texts: Iterable[str],
        metadatas: list[dict] | None,
        content_payload_key: str,
        metadata_payload_key: str,
        group_id: str,
        group_payload_key: str,
    ) -> list[dict]:
        payloads = []
        for i, text in enumerate(texts):
            if text is None:
                raise ValueError(
                    "At least one of the texts is None. Please remove it before "
                    "calling .from_texts or .add_texts on Qdrant instance."
                )
            metadata = metadatas[i] if metadatas is not None else None
            payloads.append({content_payload_key: text, metadata_payload_key: metadata, group_payload_key: group_id})

        return payloads

    @override
    def delete_by_metadata_field(self, key: str, value: str):
        from qdrant_client.http import models
        from qdrant_client.http.exceptions import UnexpectedResponse

        try:
            filter = models.Filter(
                must=[
                    models.FieldCondition(
                        key=f"metadata.{key}",
                        match=models.MatchValue(value=value),
                    ),
                ],
            )

            self._reload_if_needed()

            self._client.delete(
                collection_name=self._collection_name,
                points_selector=FilterSelector(filter=filter),
            )
        except UnexpectedResponse as e:
            # Collection does not exist, so return
            if e.status_code == 404:
                return
            # Some other error occurred, so re-raise the exception
            else:
                raise e

    @override
    def delete(self):
        from qdrant_client.http.exceptions import UnexpectedResponse

        try:
            self._client.delete_collection(collection_name=self._collection_name)
        except UnexpectedResponse as e:
            # Collection does not exist, so return
            if e.status_code == 404:
                return
            # Some other error occurred, so re-raise the exception
            else:
                raise e

    @override
    def delete_by_ids(self, ids: list[str]):
        from qdrant_client.http import models
        from qdrant_client.http.exceptions import UnexpectedResponse

        if not ids:
            return

        batch_size = 1000
        for i in range(0, len(ids), batch_size):
            batch = ids[i : i + batch_size]

            try:
                filter = models.Filter(
                    must=[
                        models.FieldCondition(
                            key="metadata.doc_id",
                            match=models.MatchAny(any=batch),
                        ),
                    ],
                )
                self._client.delete(
                    collection_name=self._collection_name,
                    points_selector=FilterSelector(filter=filter),
                )
            except UnexpectedResponse as e:
                # Collection does not exist, so return
                if e.status_code != 404:
                    raise e

    @override
    def text_exists(self, id: str) -> bool:
        all_collection_name = []
        collections_response = self._client.get_collections()
        collection_list = collections_response.collections
        for collection in collection_list:
            all_collection_name.append(collection.name)
        if self._collection_name not in all_collection_name:
            return False
        response = self._client.retrieve(collection_name=self._collection_name, ids=[id])

        return len(response) > 0

    @override
    def search_by_vector(self, query_vector: list[float], **kwargs: Any) -> list[Document]:
        from qdrant_client.http import models

        filter = None
        document_ids_filter = kwargs.get("document_ids_filter")
        if document_ids_filter:
            filter = models.Filter(
                must=[
                    models.FieldCondition(
                        key="metadata.document_id",
                        match=models.MatchAny(any=document_ids_filter),
                    )
                ],
            )
        results = self._client.search(
            collection_name=self._collection_name,
            query_vector=query_vector,
            query_filter=filter,
            limit=kwargs.get("top_k", 4),
            with_payload=True,
            with_vectors=False,
            score_threshold=kwargs.get("score_threshold", 0.0),
        )
        docs = []
        for result in results:
            if result.payload is None:
                continue
            metadata = result.payload.get(Field.METADATA_KEY) or {}
            # duplicate check score threshold
            score_threshold = kwargs.get("score_threshold") or 0.0
            if result.score >= score_threshold:
                metadata["score"] = result.score
                doc = Document(
                    page_content=result.payload.get(Field.CONTENT_KEY, ""),
                    metadata=metadata,
                )
                docs.append(doc)
        # Sort the documents by score in descending order
        docs = sorted(docs, key=lambda x: x.metadata["score"] if x.metadata is not None else 0, reverse=True)
        return docs

    @override
    def search_by_full_text(self, query: str, **kwargs: Any) -> list[Document]:
        """Return docs most similar by bm25.
        Returns:
            List of documents most similar to the query text and distance for each.
        """
        from qdrant_client.http import models

        scroll_filter = None
        document_ids_filter = kwargs.get("document_ids_filter")
        if document_ids_filter:
            scroll_filter = models.Filter(
                must=[
                    models.FieldCondition(
                        key="metadata.document_id",
                        match=models.MatchAny(any=document_ids_filter),
                    )
                ]
            )
        response = self._client.scroll(
            collection_name=self._collection_name,
            scroll_filter=scroll_filter,
            limit=kwargs.get("top_k", 2),
            with_payload=True,
            with_vectors=True,
        )
        results = response[0]
        documents = []
        for result in results:
            if result:
                document = self._document_from_scored_point(result, Field.CONTENT_KEY, Field.METADATA_KEY)
                documents.append(document)

        return documents

    def _reload_if_needed(self):
        if isinstance(self._client, QdrantLocal):
            self._client._load()

    @classmethod
    def _document_from_scored_point(
        cls,
        scored_point: Any,
        content_payload_key: str,
        metadata_payload_key: str,
    ) -> Document:
        return Document(
            page_content=scored_point.payload.get(content_payload_key),
            vector=scored_point.vector,
            metadata=scored_point.payload.get(metadata_payload_key) or {},
        )


class TidbOnQdrantVectorFactory(AbstractVectorFactory):
    @staticmethod
    def _binding_config(binding: TidbAuthBinding) -> _TidbBindingConfig:
        return _TidbBindingConfig(
            cluster_id=binding.cluster_id,
            account=binding.account,
            password=binding.password,
            qdrant_endpoint=binding.qdrant_endpoint,
        )

    @classmethod
    def _load_tenant_binding(cls, tenant_id: str) -> _TidbBindingConfig | None:
        with session_factory.create_session() as session:
            binding = session.scalars(
                select(TidbAuthBinding).where(TidbAuthBinding.tenant_id == tenant_id)
            ).one_or_none()
            return cls._binding_config(binding) if binding is not None else None

    @staticmethod
    def _provisioned_cluster(response: object, tenant_id: str) -> _ProvisionedTidbCluster:
        if not isinstance(response, dict):
            raise RuntimeError(f"TiDB provisioning returned an invalid cluster response for tenant {tenant_id}")

        required_values: dict[str, str] = {}
        for field_name in ("cluster_id", "cluster_name", "account", "password"):
            field_value = response.get(field_name)
            if not isinstance(field_value, str) or not field_value:
                raise RuntimeError(f"TiDB provisioning returned an invalid cluster response for tenant {tenant_id}")
            required_values[field_name] = field_value

        qdrant_endpoint = response.get("qdrant_endpoint")
        if qdrant_endpoint is not None and not isinstance(qdrant_endpoint, str):
            raise RuntimeError(f"TiDB provisioning returned an invalid cluster response for tenant {tenant_id}")

        return _ProvisionedTidbCluster(
            cluster_id=required_values["cluster_id"],
            cluster_name=required_values["cluster_name"],
            account=required_values["account"],
            password=required_values["password"],
            qdrant_endpoint=qdrant_endpoint,
        )

    @override
    def init_vector(self, dataset: Dataset, attributes: list, embeddings: Embeddings) -> TidbOnQdrantVector:
        logger.info("init_vector: tenant_id=%s, dataset_id=%s", dataset.tenant_id, dataset.id)
        binding_config = self._load_tenant_binding(dataset.tenant_id)
        if binding_config is None:
            logger.info("No existing TidbAuthBinding for tenant %s, acquiring lock", dataset.tenant_id)
            with redis_client.lock("create_tidb_serverless_cluster_lock", timeout=900):
                binding_config = self._load_tenant_binding(dataset.tenant_id)
                if binding_config is not None:
                    logger.info("Found binding after lock: cluster_id=%s", binding_config.cluster_id)
                else:
                    with session_factory.create_session() as session:
                        idle_tidb_auth_binding = session.scalar(
                            select(TidbAuthBinding)
                            .where(TidbAuthBinding.active == False, TidbAuthBinding.status == "ACTIVE")
                            .limit(1)
                            .with_for_update()
                        )
                        if idle_tidb_auth_binding is not None:
                            logger.info(
                                "Assigning idle cluster %s to tenant %s",
                                idle_tidb_auth_binding.cluster_id,
                                dataset.tenant_id,
                            )
                            idle_tidb_auth_binding.active = True
                            idle_tidb_auth_binding.tenant_id = dataset.tenant_id
                            session.commit()
                            binding_config = self._binding_config(idle_tidb_auth_binding)

                    # Cluster provisioning is external I/O and must not retain
                    # either the request-scoped session or the short binding
                    # lookup transaction above.
                    if binding_config is None:
                        logger.info("No idle clusters available, creating new cluster for tenant %s", dataset.tenant_id)
                        new_cluster = TidbService.create_tidb_serverless_cluster(
                            dify_config.TIDB_PROJECT_ID or "",
                            dify_config.TIDB_API_URL or "",
                            dify_config.TIDB_IAM_API_URL or "",
                            dify_config.TIDB_PUBLIC_KEY or "",
                            dify_config.TIDB_PRIVATE_KEY or "",
                            dify_config.TIDB_REGION or "",
                        )
                        if new_cluster is None:
                            raise RuntimeError(
                                f"TiDB provisioning did not return an active cluster for tenant {dataset.tenant_id}"
                            )
                        provisioned_cluster = self._provisioned_cluster(new_cluster, dataset.tenant_id)
                        logger.info(
                            "New cluster created: cluster_id=%s, qdrant_endpoint=%s",
                            provisioned_cluster.cluster_id,
                            provisioned_cluster.qdrant_endpoint,
                        )
                        new_tidb_auth_binding = TidbAuthBinding(
                            cluster_id=provisioned_cluster.cluster_id,
                            cluster_name=provisioned_cluster.cluster_name,
                            account=provisioned_cluster.account,
                            password=provisioned_cluster.password,
                            qdrant_endpoint=provisioned_cluster.qdrant_endpoint,
                            tenant_id=dataset.tenant_id,
                            active=True,
                            status=TidbAuthBindingStatus.ACTIVE,
                        )
                        with session_factory.create_session() as session:
                            session.add(new_tidb_auth_binding)
                            session.commit()
                        binding_config = _TidbBindingConfig(
                            cluster_id=provisioned_cluster.cluster_id,
                            account=provisioned_cluster.account,
                            password=provisioned_cluster.password,
                            qdrant_endpoint=provisioned_cluster.qdrant_endpoint,
                        )
        else:
            logger.info("Existing binding found: cluster_id=%s", binding_config.cluster_id)

        if binding_config is None:
            raise RuntimeError(f"Failed to resolve TiDB binding for tenant {dataset.tenant_id}")
        tidb_on_qdrant_api_key = f"{binding_config.account}:{binding_config.password}"
        qdrant_url = binding_config.qdrant_endpoint or dify_config.TIDB_ON_QDRANT_URL or ""
        logger.info(
            "Using qdrant endpoint: %s (from_binding=%s, fallback_global=%s)",
            qdrant_url,
            binding_config.qdrant_endpoint,
            dify_config.TIDB_ON_QDRANT_URL,
        )

        if dataset.index_struct_dict:
            class_prefix: str = dataset.index_struct_dict["vector_store"]["class_prefix"]
            collection_name = class_prefix
        else:
            dataset_id = dataset.id
            collection_name = Dataset.gen_collection_name_by_id(dataset_id)
            dataset.index_struct = json.dumps(self.gen_index_struct_dict(VectorType.TIDB_ON_QDRANT, collection_name))

        config = current_app.config

        return TidbOnQdrantVector(
            collection_name=collection_name,
            group_id=dataset.id,
            config=TidbOnQdrantConfig(
                endpoint=qdrant_url,
                api_key=tidb_on_qdrant_api_key,
                root_path=str(config.root_path),
                timeout=dify_config.TIDB_ON_QDRANT_CLIENT_TIMEOUT,
                grpc_port=dify_config.TIDB_ON_QDRANT_GRPC_PORT,
                prefer_grpc=dify_config.TIDB_ON_QDRANT_GRPC_ENABLED,
                replication_factor=dify_config.QDRANT_REPLICATION_FACTOR,
            ),
        )

    def create_tidb_serverless_cluster(self, tidb_config: TidbConfig, display_name: str, region: str):
        """
        Creates a new TiDB Serverless cluster.
        :param tidb_config: The configuration for the TiDB Cloud API.
        :param display_name: The user-friendly display name of the cluster (required).
        :param region: The region where the cluster will be created (required).

        :return: The response from the API.
        """
        region_object = {
            "name": region,
        }

        labels = {
            "tidb.cloud/project": "1372813089454548012",
        }
        cluster_data = {"displayName": display_name, "region": region_object, "labels": labels}

        response = httpx.post(
            f"{tidb_config.api_url}/clusters",
            json=cluster_data,
            auth=DigestAuth(tidb_config.public_key, tidb_config.private_key),
        )

        if response.status_code == 200:
            return response.json()
        else:
            response.raise_for_status()

    def change_tidb_serverless_root_password(self, tidb_config: TidbConfig, cluster_id: str, new_password: str):
        """
        Changes the root password of a specific TiDB Serverless cluster.

        :param tidb_config: The configuration for the TiDB Cloud API.
        :param cluster_id: The ID of the cluster for which the password is to be changed (required).
        :param new_password: The new password for the root user (required).
        :return: The response from the API.
        """

        body = {"password": new_password}

        response = httpx.put(
            f"{tidb_config.api_url}/clusters/{cluster_id}/password",
            json=body,
            auth=DigestAuth(tidb_config.public_key, tidb_config.private_key),
        )

        if response.status_code == 200:
            return response.json()
        else:
            response.raise_for_status()
