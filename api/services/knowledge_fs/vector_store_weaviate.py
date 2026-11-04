"""KnowledgeFS vectors with explicit IDs, cosine distance and Weaviate readback."""

from typing import TYPE_CHECKING
from urllib.parse import urlparse

from services.knowledge_fs.vector_store import (
    VectorMatch,
    VectorPoint,
    VectorRequest,
    VectorResult,
    VectorScope,
    VectorStoreUnavailableError,
)

if TYPE_CHECKING:
    from weaviate import WeaviateClient
    from weaviate.collections.collection import Collection


class WeaviateVectorStore:
    def __init__(self, client: "WeaviateClient"):
        self.client = client

    @classmethod
    def from_config(cls) -> "WeaviateVectorStore":
        import weaviate
        from weaviate.classes.init import AdditionalConfig, Auth, Timeout

        from configs import dify_config as config

        endpoint = config.WEAVIATE_ENDPOINT or ""
        http = urlparse(endpoint if "://" in endpoint else f"http://{endpoint}")
        if not http.hostname or http.scheme not in {"http", "https"}:
            raise VectorStoreUnavailableError("Weaviate endpoint is not configured")
        secure = http.scheme == "https"
        grpc_endpoint = config.WEAVIATE_GRPC_ENDPOINT
        if grpc_endpoint:
            grpc = urlparse(grpc_endpoint if "://" in grpc_endpoint else f"grpc://{grpc_endpoint}")
            if not grpc.hostname or grpc.scheme not in {"grpc", "grpcs"}:
                raise VectorStoreUnavailableError("Weaviate gRPC endpoint is invalid")
            grpc_host, grpc_secure = grpc.hostname, grpc.scheme == "grpcs"
            grpc_port = grpc.port or (443 if grpc_secure else 50051)
        else:
            grpc_host, grpc_secure, grpc_port = http.hostname, secure, 443 if secure else 50051
        client = weaviate.connect_to_custom(
            http_host=http.hostname,
            http_port=http.port or (443 if secure else 80),
            http_secure=secure,
            grpc_host=grpc_host,
            grpc_port=grpc_port,
            grpc_secure=grpc_secure,
            auth_credentials=Auth.api_key(config.WEAVIATE_API_KEY) if config.WEAVIATE_API_KEY else None,
            additional_config=AdditionalConfig(timeout=Timeout(init=10, query=60, insert=60)),
            skip_init_checks=True,
        )
        return cls(client)

    def close(self) -> None:
        self.client.close()

    @staticmethod
    def collection_name(scope: VectorScope) -> str:
        """Expose the native name for operational cleanup and acceptance checks."""
        return scope.collection_name[0].upper() + scope.collection_name[1:]

    def _collection(self, scope: VectorScope, operation: str, name: str) -> "Collection | None":
        from weaviate.classes.config import (
            Configure,
            ConsistencyLevel,
            DataType,
            Property,
            Tokenization,
            VectorDistances,
        )

        description = f"KnowledgeFS v1; dimension={scope.dimension}; metric=cosine"
        if not self.client.collections.exists(name):
            if operation != "upsert":
                return None
            try:
                self.client.collections.create(
                    name=name,
                    description=description,
                    vectorizer_config=Configure.Vectorizer.none(),
                    vector_index_config=Configure.VectorIndex.hnsw(distance_metric=VectorDistances.COSINE),
                    properties=[
                        Property(name=key, data_type=DataType.TEXT, tokenization=Tokenization.FIELD)
                        for key in ("generation_id", "content_hash")
                    ],
                )
            except Exception:
                # A concurrent creator may have won; only accept its compatible schema.
                if not self.client.collections.exists(name):
                    raise
        collection = self.client.collections.use(name).with_consistency_level(ConsistencyLevel.ALL)
        config = collection.config.get()
        properties = {prop.name: prop for prop in config.properties}
        if (
            config.description != description
            or config.vectorizer != "none"
            or config.vector_config
            or config.vector_index_config is None
            or config.vector_index_config.distance_metric != VectorDistances.COSINE
            or config.multi_tenancy_config.enabled
            or any(
                key not in properties or properties[key].data_type != DataType.TEXT
                for key in ("generation_id", "content_hash")
            )
        ):
            raise VectorStoreUnavailableError("KnowledgeFS vector collection has incompatible schema")
        return collection

    def execute_collection(self, payload: VectorRequest, name: str) -> VectorResult | None:
        """Use a server-derived current/legacy name; None means the class is absent."""
        from weaviate.classes.data import DataObject
        from weaviate.classes.query import Filter, MetadataQuery

        # Weaviate class names start uppercase. All other scope identity is unchanged.
        collection = self._collection(payload.scope, payload.operation, name[0].upper() + name[1:])
        if collection is None:
            return None
        if payload.operation == "upsert":
            result = collection.data.insert_many(
                [
                    DataObject(
                        uuid=point.id,
                        properties={"generation_id": point.generation_id, "content_hash": point.content_hash},
                        vector=point.vector,
                    )
                    for point in payload.points
                ]
            )
            if result.has_errors or len(result.uuids) != len(payload.points):
                raise VectorStoreUnavailableError("Weaviate vector batch was not fully acknowledged")
        elif payload.operation == "get":
            objects = collection.query.fetch_objects(
                filters=Filter.by_id().contains_any(payload.ids), limit=len(payload.ids), include_vector=True
            ).objects
            return {
                "points": [
                    VectorPoint.model_validate(
                        {"id": str(obj.uuid), **obj.properties, "vector": obj.vector["default"]}
                    ).model_dump()
                    for obj in objects
                ],
                "matches": [],
            }
        elif payload.operation == "search":
            objects = collection.query.near_vector(
                near_vector=payload.query_vector,
                filters=Filter.by_id().contains_any(payload.ids),
                limit=payload.limit,
                return_metadata=MetadataQuery(distance=True),
                return_properties=False,
            ).objects
            matches: list[VectorMatch] = []
            for obj in objects:
                if obj.metadata.distance is None:
                    raise VectorStoreUnavailableError("Weaviate vector search omitted distance")
                matches.append({"id": str(obj.uuid), "score": 1 - obj.metadata.distance})
            return {"points": [], "matches": matches}
        else:
            where = Filter.by_id().contains_any(payload.ids)
            deleted = collection.data.delete_many(where=where)
            if deleted.failed or collection.query.fetch_objects(filters=where, limit=1).objects:
                raise VectorStoreUnavailableError("KnowledgeFS vector deletion is not yet visible")
        return {"points": [], "matches": []}
