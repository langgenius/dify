"""Immutable KnowledgeFS vectors in a reserved Elasticsearch index per scope."""

from typing import TYPE_CHECKING, Any
from urllib.parse import urlparse

from services.knowledge_fs.vector_store import (
    VectorPoint,
    VectorRequest,
    VectorResult,
    VectorScope,
    VectorStoreUnavailableError,
)

if TYPE_CHECKING:
    from elasticsearch import Elasticsearch


class ElasticsearchVectorStore:
    def __init__(self, client: "Elasticsearch"):
        self.client = client

    @classmethod
    def from_config(cls) -> "ElasticsearchVectorStore":
        from elasticsearch import Elasticsearch

        from configs import dify_config as config

        options: dict[str, Any] = {
            # Dify's setting is in milliseconds. Keep each bridge call bounded.
            "request_timeout": max(1, min(config.ELASTICSEARCH_REQUEST_TIMEOUT / 1000, 60)),
            "retry_on_timeout": config.ELASTICSEARCH_RETRY_ON_TIMEOUT,
            "max_retries": min(config.ELASTICSEARCH_MAX_RETRIES, 2),
        }
        if config.ELASTICSEARCH_USE_CLOUD:
            endpoint = config.ELASTICSEARCH_CLOUD_URL
            options["api_key"] = config.ELASTICSEARCH_API_KEY
        else:
            host = config.ELASTICSEARCH_HOST or ""
            parsed = urlparse(host if "://" in host else f"http://{host}")
            if not parsed.hostname or parsed.scheme not in {"http", "https"}:
                raise VectorStoreUnavailableError("Elasticsearch endpoint is not configured")
            # Preserve an explicit port, including HTTPS and IPv6 endpoints.
            hostname = f"[{parsed.hostname}]" if ":" in parsed.hostname else parsed.hostname
            endpoint = (
                f"{parsed.scheme}://{hostname}:{parsed.port or config.ELASTICSEARCH_PORT}{parsed.path.rstrip('/')}"
            )
            options["basic_auth"] = (config.ELASTICSEARCH_USERNAME, config.ELASTICSEARCH_PASSWORD)
        if not endpoint:
            raise VectorStoreUnavailableError("Elasticsearch endpoint is not configured")
        if endpoint.startswith("https://"):
            options["verify_certs"] = config.ELASTICSEARCH_VERIFY_CERTS
            if config.ELASTICSEARCH_CA_CERTS:
                options["ca_certs"] = config.ELASTICSEARCH_CA_CERTS
        return cls(Elasticsearch(hosts=[endpoint], **options))

    def close(self) -> None:
        self.client.close()

    def _ensure_index(self, scope: VectorScope, operation: str, index: str) -> bool:
        from elasticsearch import BadRequestError, NotFoundError

        if scope.dimension > 4096:
            raise VectorStoreUnavailableError("Elasticsearch supports at most 4096 vector dimensions")
        try:
            info = self.client.indices.get_mapping(index=index)
        except NotFoundError:
            if operation != "upsert":
                return False
            try:
                self.client.indices.create(
                    index=index,
                    mappings={
                        "dynamic": "strict",
                        "properties": {
                            "generation_id": {"type": "keyword"},
                            "content_hash": {"type": "keyword"},
                            "vector": {
                                "type": "dense_vector",
                                "dims": scope.dimension,
                                "index": True,
                                "similarity": "cosine",
                                "index_options": {"type": "hnsw"},
                            },
                        },
                    },
                )
            except BadRequestError as error:
                if error.error != "resource_already_exists_exception":
                    raise
            info = self.client.indices.get_mapping(index=index)
        mapping = info[index]["mappings"]
        properties = mapping.get("properties", {})
        vector = properties.get("vector", {})
        if (
            vector.get("type") != "dense_vector"
            or vector.get("dims") != scope.dimension
            or vector.get("similarity") != "cosine"
            or vector.get("index") is not True
            or vector.get("element_type", "float") != "float"
            or properties.get("generation_id", {}).get("type") != "keyword"
            or properties.get("content_hash", {}).get("type") != "keyword"
            or mapping.get("_source", {}).get("enabled") is False
        ):
            raise VectorStoreUnavailableError("KnowledgeFS vector collection has incompatible schema")
        return True

    def _get(self, index: str, ids: list[str]) -> list[dict[str, Any]]:
        result = self.client.mget(index=index, ids=ids)
        if len(result["docs"]) != len(ids) or any("error" in doc for doc in result["docs"]):
            raise VectorStoreUnavailableError("Elasticsearch vector read was incomplete")
        return [
            VectorPoint.model_validate({"id": doc["_id"], **doc["_source"]}).model_dump()
            for doc in result["docs"]
            if doc.get("found")
        ]

    def _bulk(self, operations: list[dict[str, Any]], count: int, *, deleting: bool) -> None:
        # Refresh before SQL publication/deletion can advance, including retried writes.
        result = self.client.bulk(operations=operations, refresh="wait_for")
        items = result["items"]
        if len(items) != count or any(
            item.get("delete" if deleting else "index", {}).get("status")
            not in ({200, 202, 404} if deleting else {200, 201})
            for item in items
        ):
            raise VectorStoreUnavailableError("Elasticsearch vector batch was not fully acknowledged")

    def execute_collection(self, payload: VectorRequest, index: str) -> VectorResult | None:
        """Use a server-derived current/legacy name; None means the index is absent."""
        if not self._ensure_index(payload.scope, payload.operation, index):
            return None
        if payload.operation == "upsert":
            operations: list[dict[str, Any]] = []
            for point in payload.points:
                operations.extend(
                    [
                        {"index": {"_index": index, "_id": point.id}},
                        point.model_dump(exclude={"id"}),
                    ]
                )
            self._bulk(operations, len(payload.points), deleting=False)
        elif payload.operation == "get":
            return {"points": self._get(index, payload.ids), "matches": []}
        elif payload.operation == "search":
            result = self.client.search(
                index=index,
                knn={
                    "field": "vector",
                    "query_vector": payload.query_vector,
                    "k": payload.limit,
                    "num_candidates": max(100, payload.limit * 4),
                    "filter": {"ids": {"values": payload.ids}},
                },
                size=payload.limit,
                source=False,
                allow_partial_search_results=False,
            )
            if result.get("timed_out") or result.get("_shards", {}).get("failed", 0):
                raise VectorStoreUnavailableError("Elasticsearch vector search was incomplete")
            # ES cosine scores are (1 + cosine) / 2. The bridge returns cosine.
            return {
                "points": [],
                "matches": [{"id": hit["_id"], "score": 2 * hit["_score"] - 1} for hit in result["hits"]["hits"]],
            }
        else:
            self._bulk(
                [{"delete": {"_index": index, "_id": point_id}} for point_id in payload.ids],
                len(payload.ids),
                deleting=True,
            )
            if self._get(index, payload.ids):
                raise VectorStoreUnavailableError("KnowledgeFS vector deletion is not yet visible")
        return {"points": [], "matches": []}
