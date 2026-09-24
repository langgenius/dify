"""Vector I/O for KnowledgeFS; Dify owns credentials and tenant backend routing.

Only immutable vector points live here. SQL in KnowledgeFS authorizes the exact
point IDs for each search. Neither document text nor permission data is copied.
"""

import hashlib
import json
import math
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from typing import TYPE_CHECKING, Annotated, Any, Literal, TypedDict

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, FiniteFloat, model_validator

if TYPE_CHECKING:
    from collections.abc import Generator

    from qdrant_client import QdrantClient
    from qdrant_client.http.models import Record

    from services.knowledge_fs.vector_store_elasticsearch import ElasticsearchVectorStore
    from services.knowledge_fs.vector_store_weaviate import WeaviateVectorStore

Identifier = Annotated[
    str,
    Field(pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"),
    AfterValidator(str.lower),
]

TIDB_POINT_ID_FIELD = "knowledgefs_point_id"


class VectorScope(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    tenant_id: Identifier
    knowledge_space_id: Identifier
    vector_space_id: str = Field(min_length=1, max_length=256)
    kind: Literal["dense", "visual", "graph-entity", "graph-relation"]
    dimension: int = Field(ge=1, le=16384)

    @property
    def collection_name(self) -> str:
        # The longest name (graph_relation) is 62 characters, within TiDB's
        # 64-character table identifier limit. Keep 128 bits of scope identity.
        return f"knowledgefs_v1_{self.kind.replace('-', '_')}_{self._identity_hash[:32]}"

    @property
    def legacy_collection_name(self) -> str:
        """Pre-type names remain readable/deletable until their data is retired."""
        return f"knowledgefs_v1_{self._identity_hash[:40]}"

    @property
    def _identity_hash(self) -> str:
        identity = json.dumps(self.model_dump(), sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(identity.encode()).hexdigest()


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


class VectorMatch(TypedDict):
    id: str
    score: float


class VectorResult(TypedDict):
    points: list[dict[str, Any]]
    matches: list[VectorMatch]


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
) -> VectorResult:
    """Write typed names; read and clean up both naming generations.

    A scope can contain old points and new points simultaneously. Falling back
    only when the new collection is absent would hide published old documents.
    Missing collections are distinct from backend errors: never turn a failed
    read or deletion in either namespace into a partial success.
    """
    from services.knowledge_fs.vector_store_elasticsearch import ElasticsearchVectorStore
    from services.knowledge_fs.vector_store_weaviate import WeaviateVectorStore

    if check_admission:
        admit_vector_request(payload)
    names = [payload.scope.collection_name]
    if payload.operation != "upsert":
        names.append(payload.scope.legacy_collection_name)

    found_collection = False
    points: dict[str, dict[str, Any]] = {}
    matches: dict[str, VectorMatch] = {}
    for name in names:
        result = (
            client.execute_collection(payload, name)
            if isinstance(client, (ElasticsearchVectorStore, WeaviateVectorStore))
            else _execute_qdrant_collection(client, payload, name)
        )
        if result is None:
            continue
        found_collection = True
        for point in result["points"]:
            points.setdefault(point["id"], point)
        for match in result["matches"]:
            previous = matches.get(match["id"])
            if previous is None or match["score"] > previous["score"]:
                matches[match["id"]] = match
    if payload.operation == "search" and not found_collection:
        raise VectorStoreUnavailableError("KnowledgeFS vector collection is missing")
    return {
        "points": list(points.values()),
        "matches": sorted(matches.values(), key=lambda match: (-match["score"], match["id"]))[: payload.limit],
    }


def _execute_qdrant_collection(client: "QdrantClient", payload: VectorRequest, collection: str) -> VectorResult | None:
    """Return None only for a missing collection; all uncertain I/O must fail."""

    from qdrant_client.http import models
    from qdrant_client.http.exceptions import UnexpectedResponse

    from configs import dify_config

    scope = payload.scope
    point_ids: list[int | str] = list(payload.ids)
    tidb = dify_config.VECTOR_STORE == "tidb_on_qdrant"
    try:
        info = client.get_collection(collection)
    except UnexpectedResponse as error:
        if error.status_code != 404:
            raise
        if payload.operation != "upsert":
            return None
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

    id_index = info.payload_schema.get(TIDB_POINT_ID_FIELD)
    if (
        tidb
        and payload.operation in {"upsert", "search"}
        and id_index is not None
        and id_index.data_type != models.PayloadSchemaType.KEYWORD
    ):
        raise VectorStoreUnavailableError("KnowledgeFS vector ID index has incompatible schema")

    if payload.operation == "upsert":
        if tidb and TIDB_POINT_ID_FIELD not in info.payload_schema and info.points_count == 0:
            # An index on an empty collection proves every subsequent point is
            # written with our ID payload. Do not mark old, unbackfilled data ready.
            try:
                client.create_payload_index(
                    collection_name=collection,
                    field_name=TIDB_POINT_ID_FIELD,
                    field_schema=models.PayloadSchemaType.KEYWORD,
                    wait=True,
                )
            except Exception:
                # Concurrent first writers can also race on the payload index.
                index = client.get_collection(collection).payload_schema.get(TIDB_POINT_ID_FIELD)
                if index is None or index.data_type != models.PayloadSchemaType.KEYWORD:
                    raise
        client.upsert(
            collection_name=collection,
            wait=True,
            points=[
                models.PointStruct(
                    id=point.id,
                    vector=point.vector,
                    payload={
                        "generation_id": point.generation_id,
                        "content_hash": point.content_hash,
                        **({TIDB_POINT_ID_FIELD: point.id} if tidb else {}),
                    },
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
        if tidb and TIDB_POINT_ID_FIELD not in info.payload_schema:
            return _search_unindexed_tidb_points(client, payload, collection)
        condition: models.HasIdCondition | models.FieldCondition = models.HasIdCondition(has_id=point_ids)
        if tidb:
            # TiDB-on-Qdrant accepts field conditions but rejects HasIdCondition.
            condition = models.FieldCondition(key=TIDB_POINT_ID_FIELD, match=models.MatchAny(any=payload.ids))
        matches = client.search(
            collection_name=collection,
            query_vector=payload.query_vector,
            query_filter=models.Filter(must=[condition]),
            limit=payload.limit,
            # Its filtered SQL also requires payload selection, even though the
            # bridge never returns that payload to the caller.
            with_payload=tidb,
            with_vectors=False,
        )
        if any(str(point.id) not in payload.ids for point in matches):
            raise VectorStoreUnavailableError("KnowledgeFS vector search returned an unauthorized point")
        return {"points": [], "matches": [{"id": str(point.id), "score": point.score} for point in matches]}
    else:
        client.delete(collection_name=collection, points_selector=models.PointIdsList(points=point_ids), wait=True)
        # An uncertain acknowledgement must leave SQL cleanup eligible for retry.
        if client.retrieve(collection_name=collection, ids=point_ids, with_payload=False, with_vectors=False):
            raise VectorStoreUnavailableError("KnowledgeFS vector deletion is not yet visible")
    return {"points": [], "matches": []}


def _search_unindexed_tidb_points(client: "QdrantClient", payload: VectorRequest, collection: str) -> VectorResult:
    """Keep pre-index collections usable without mutating them during a read.

    Read only SQL-authorized IDs (at most 2048), in batches of 64 and at most four
    concurrent requests, then rank exactly. New collections use indexed backend
    search; never fall back to an unfiltered nearest-neighbor query.
    """

    def read_batch(ids: list[int | str]) -> "list[Record]":
        return client.retrieve(collection_name=collection, ids=ids, with_payload=False, with_vectors=True)

    batches: list[list[int | str]] = [
        list(payload.ids[offset : offset + 64]) for offset in range(0, len(payload.ids), 64)
    ]
    allowed = set(payload.ids)
    query_norm = math.hypot(*payload.query_vector)
    matches: list[VectorMatch] = []
    with ThreadPoolExecutor(max_workers=min(4, len(batches))) as pool:
        for points in pool.map(read_batch, batches):
            for point in points:
                vector = point.vector
                if str(point.id) not in allowed:
                    raise VectorStoreUnavailableError("KnowledgeFS vector read returned an unauthorized point")
                if not isinstance(vector, list) or len(vector) != payload.scope.dimension:
                    raise VectorStoreUnavailableError("KnowledgeFS vector has incompatible dimensions")
                if any(not math.isfinite(value) or abs(value) > 1e10 for value in vector):
                    raise VectorStoreUnavailableError("KnowledgeFS vector cannot be scored")
                norm = math.hypot(*vector)
                if not norm or not math.isfinite(norm):
                    raise VectorStoreUnavailableError("KnowledgeFS vector cannot be scored")
                score = math.fsum(a * b for a, b in zip(payload.query_vector, vector, strict=True)) / query_norm / norm
                matches.append({"id": str(point.id), "score": max(-1.0, min(1.0, score))})
    return {"points": [], "matches": sorted(matches, key=lambda match: (-match["score"], match["id"]))[: payload.limit]}
