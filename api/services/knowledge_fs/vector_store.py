"""Vector I/O for KnowledgeFS; Dify owns credentials and tenant backend routing.

Only immutable vector points live here. SQL in KnowledgeFS authorizes the exact
point IDs for each search. Neither document text nor permission data is copied.
"""

import hashlib
import json
from contextlib import contextmanager
from typing import TYPE_CHECKING, Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, FiniteFloat, model_validator

if TYPE_CHECKING:
    from collections.abc import Generator

    from qdrant_client import QdrantClient

    from services.knowledge_fs.vector_store_elasticsearch import ElasticsearchVectorStore
    from services.knowledge_fs.vector_store_weaviate import WeaviateVectorStore

Identifier = Annotated[
    str,
    Field(pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"),
    AfterValidator(str.lower),
]


class VectorScope(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    tenant_id: Identifier
    knowledge_space_id: Identifier
    vector_space_id: str = Field(min_length=1, max_length=256)
    kind: Literal["dense", "visual", "graph-entity", "graph-relation"]
    dimension: int = Field(ge=1, le=16384)

    @property
    def collection_name(self) -> str:
        identity = json.dumps(self.model_dump(), sort_keys=True, separators=(",", ":"))
        # Stay below SQL-backed providers' identifier bounds as well as Qdrant's.
        return "knowledgefs_v1_" + hashlib.sha256(identity.encode()).hexdigest()[:40]


class VectorPoint(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: Identifier
    generation_id: Identifier
    content_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    vector: list[FiniteFloat] = Field(min_length=1, max_length=16384)


class VectorRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    operation: Literal["upsert", "get", "search", "delete"]
    scope: VectorScope
    points: list[VectorPoint] = Field(default_factory=list, max_length=64)
    ids: list[Identifier] = Field(default_factory=list, max_length=2048)
    query_vector: list[FiniteFloat] = Field(default_factory=list, max_length=16384)
    limit: int = Field(default=10, ge=1, le=256)

    @model_validator(mode="after")
    def validate_operation(self) -> "VectorRequest":
        if self.operation == "upsert":
            if not self.points or self.ids or self.query_vector:
                raise ValueError("Upsert requires only points")
            if len({point.id for point in self.points}) != len(self.points):
                raise ValueError("Duplicate point IDs")
            for point in self.points:
                self._validate_vector(point.vector)
        else:
            if not self.ids or self.points or len(set(self.ids)) != len(self.ids):
                raise ValueError("A bounded set of unique point IDs is required")
            if self.operation == "search":
                self._validate_vector(self.query_vector)
            elif self.query_vector or (self.operation == "get" and len(self.ids) > 64):
                raise ValueError("Invalid vector read or delete")
        return self

    def _validate_vector(self, vector: list[float]) -> None:
        if len(vector) != self.scope.dimension or not any(vector) or max(map(abs, vector)) > 1e10:
            raise ValueError("Invalid vector dimension or magnitude")


class VectorStoreUnavailableError(Exception):
    """Safe error; must not include native exceptions containing backend secrets."""


@contextmanager
def configured_vector_client(
    tenant_id: str,
    *,
    allow_create: bool = False,
) -> "Generator[QdrantClient | ElasticsearchVectorStore | WeaviateVectorStore, None, None]":
    # Lazy dependency: installations using other backends can still boot Dify.
    from configs import dify_config

    if dify_config.VECTOR_STORE == "elasticsearch":
        from services.knowledge_fs.vector_store_elasticsearch import ElasticsearchVectorStore

        store = ElasticsearchVectorStore.from_config()
        try:
            yield store
        finally:
            store.close()
        return
    if dify_config.VECTOR_STORE == "weaviate":
        from services.knowledge_fs.vector_store_weaviate import WeaviateVectorStore

        weaviate_store = WeaviateVectorStore.from_config()
        try:
            yield weaviate_store
        finally:
            weaviate_store.close()
        return

    from qdrant_client import QdrantClient

    backend = dify_config.VECTOR_STORE
    url: str | None
    api_key: str | None
    if backend == "tidb_on_qdrant":
        from services.tidb_binding_service import resolve_tidb_auth_binding

        binding = resolve_tidb_auth_binding(tenant_id, allow_create=allow_create)
        url = binding.qdrant_endpoint or dify_config.TIDB_ON_QDRANT_URL
        api_key = f"{binding.account}:{binding.password}"
        timeout = dify_config.TIDB_ON_QDRANT_CLIENT_TIMEOUT
        prefer_grpc = dify_config.TIDB_ON_QDRANT_GRPC_ENABLED
        grpc_port = dify_config.TIDB_ON_QDRANT_GRPC_PORT
    elif backend == "qdrant":
        url, api_key = dify_config.QDRANT_URL, dify_config.QDRANT_API_KEY
        timeout = dify_config.QDRANT_CLIENT_TIMEOUT
        prefer_grpc, grpc_port = dify_config.QDRANT_GRPC_ENABLED, dify_config.QDRANT_GRPC_PORT
    else:
        raise VectorStoreUnavailableError("KnowledgeFS vector bridge does not support the configured backend")
    if not url:
        raise VectorStoreUnavailableError("Dify vector backend endpoint is not configured")
    client = QdrantClient(
        url=url, api_key=api_key, timeout=min(timeout or 20, 60), prefer_grpc=prefer_grpc, grpc_port=grpc_port
    )
    try:
        yield client
    finally:
        client.close()


def admit_vector_request(payload: VectorRequest) -> None:
    """Check quota before a write can allocate infrastructure or store points."""
    if payload.operation == "upsert":
        from services.vector_space_admission_service import VectorSpaceAdmissionService

        batch_id = hashlib.sha256(json.dumps(sorted(point.id for point in payload.points)).encode()).hexdigest()
        VectorSpaceAdmissionService().ensure_external_points_can_be_indexed(
            tenant_id=payload.scope.tenant_id,
            batch_id=batch_id,
            point_count=len(payload.points),
            dimension=payload.scope.dimension,
        )


def execute_vector_request(
    client: "QdrantClient | ElasticsearchVectorStore | WeaviateVectorStore",
    payload: VectorRequest,
    *,
    check_admission: bool = True,
) -> dict[str, object]:
    from services.knowledge_fs.vector_store_elasticsearch import ElasticsearchVectorStore
    from services.knowledge_fs.vector_store_weaviate import WeaviateVectorStore

    scope = payload.scope
    point_ids: list[int | str] = list(payload.ids)
    collection = scope.collection_name
    if check_admission:
        admit_vector_request(payload)
    if isinstance(client, (ElasticsearchVectorStore, WeaviateVectorStore)):
        return client.execute(payload)

    from qdrant_client.http import models
    from qdrant_client.http.exceptions import UnexpectedResponse

    try:
        info = client.get_collection(collection)
    except UnexpectedResponse as error:
        if error.status_code != 404:
            raise
        if payload.operation == "search":
            raise VectorStoreUnavailableError("KnowledgeFS vector collection is missing") from None
        if payload.operation != "upsert":
            # Missing vectors are detected by callers' receipt verification.
            return {"points": [], "matches": []}
        try:
            client.create_collection(
                collection_name=collection,
                vectors_config=models.VectorParams(size=scope.dimension, distance=models.Distance.COSINE),
            )
        except Exception:
            # Concurrent first writers can race. Accept only a compatible existing
            # collection; never recreate or clear another writer's collection.
            info = client.get_collection(collection)
        else:
            info = client.get_collection(collection)
    vectors = info.config.params.vectors
    if (
        not isinstance(vectors, models.VectorParams)
        or vectors.size != scope.dimension
        or vectors.distance != models.Distance.COSINE
    ):
        raise VectorStoreUnavailableError("KnowledgeFS vector collection has incompatible dimensions or distance")

    if payload.operation == "upsert":
        client.upsert(
            collection_name=collection,
            wait=True,
            points=[
                models.PointStruct(
                    id=point.id,
                    vector=point.vector,
                    payload={"generation_id": point.generation_id, "content_hash": point.content_hash},
                )
                for point in payload.points
            ],
        )
    elif payload.operation == "get":
        points = client.retrieve(collection_name=collection, ids=point_ids, with_payload=True, with_vectors=True)
        return {
            "points": [
                VectorPoint.model_validate(
                    {
                        "id": str(point.id),
                        "generation_id": (point.payload or {})["generation_id"],
                        "content_hash": (point.payload or {})["content_hash"],
                        "vector": point.vector,
                    }
                ).model_dump()
                for point in points
            ],
            "matches": [],
        }
    elif payload.operation == "search":
        matches = client.search(
            collection_name=collection,
            query_vector=payload.query_vector,
            query_filter=models.Filter(must=[models.HasIdCondition(has_id=point_ids)]),
            limit=payload.limit,
            with_payload=False,
            with_vectors=False,
        )
        return {"points": [], "matches": [{"id": str(point.id), "score": point.score} for point in matches]}
    else:
        client.delete(collection_name=collection, points_selector=models.PointIdsList(points=point_ids), wait=True)
        # An uncertain acknowledgement must leave SQL cleanup eligible for retry.
        if client.retrieve(collection_name=collection, ids=point_ids, with_payload=False, with_vectors=False):
            raise VectorStoreUnavailableError("KnowledgeFS vector deletion is not yet visible")
    return {"points": [], "matches": []}
