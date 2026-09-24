"""Native inverted indexes for Elasticsearch, Weaviate and Qdrant.

Elasticsearch/Weaviate rank with BM25. Qdrant 1.8 (Dify's bundled version)
uses sparse lexical cosine, without embedding inference or server-side IDF.
All receive the same versioned whitespace-tokenized text from KnowledgeFS.
"""

import hashlib
import math
from collections import Counter
from typing import TYPE_CHECKING, Any

from services.knowledge_fs.text_store import TextPayload, TextPoint
from services.knowledge_fs.vector_store import VectorMatch, VectorResult, VectorStoreUnavailableError

if TYPE_CHECKING:
    from elasticsearch import Elasticsearch
    from qdrant_client import QdrantClient
    from weaviate import WeaviateClient


def _missing(payload: TextPayload) -> VectorResult:
    if payload.operation == "search":
        raise VectorStoreUnavailableError("KnowledgeFS full-text index is missing")
    return {"points": [], "matches": []}


class ElasticsearchTextStore:
    def __init__(self, client: "Elasticsearch"):
        self.client = client

    def execute(self, payload: TextPayload) -> VectorResult:
        from elasticsearch import BadRequestError

        name = payload.scope.collection_name
        if not self.client.indices.exists(index=name):
            if payload.operation != "upsert":
                return _missing(payload)
            try:
                self.client.indices.create(
                    index=name,
                    mappings={
                        "dynamic": "strict",
                        "properties": {
                            "generation_id": {"type": "keyword"},
                            "content_hash": {"type": "keyword"},
                            "text": {"type": "text", "analyzer": "whitespace"},
                        },
                    },
                )
            except BadRequestError as error:
                if error.error != "resource_already_exists_exception":
                    raise
        properties = self.client.indices.get_mapping(index=name)[name]["mappings"].get("properties", {})
        if properties.get("text", {}).get("type") != "text" or properties["text"].get("analyzer") != "whitespace":
            raise VectorStoreUnavailableError("Incompatible full-text index schema")
        if payload.operation in {"upsert", "delete"}:
            operations: list[dict[str, Any]] = []
            if payload.operation == "upsert":
                for point in payload.points:
                    operations.extend([{"index": {"_index": name, "_id": point.id}}, point.model_dump(exclude={"id"})])
            else:
                operations = [{"delete": {"_index": name, "_id": point_id}} for point_id in payload.ids]
            result = self.client.bulk(operations=operations, refresh="wait_for")
            action = "index" if payload.operation == "upsert" else "delete"
            count = len(payload.points) if action == "index" else len(payload.ids)
            if len(result["items"]) != count or any(
                item.get(action, {}).get("status") not in ({200, 201} if action == "index" else {200, 202, 404})
                for item in result["items"]
            ):
                raise VectorStoreUnavailableError("Full-text batch was not acknowledged")
            if payload.operation == "delete" and self._get(name, payload.ids):
                raise VectorStoreUnavailableError("Full-text deletion is not visible")
        elif payload.operation == "get":
            return {"points": self._get(name, payload.ids), "matches": []}
        else:
            result = self.client.search(
                index=name,
                size=payload.limit,
                source=False,
                allow_partial_search_results=False,
                query={
                    "bool": {"must": [{"match": {"text": payload.query}}], "filter": [{"ids": {"values": payload.ids}}]}
                },
            )
            if result.get("timed_out") or result.get("_shards", {}).get("failed", 0):
                raise VectorStoreUnavailableError("Full-text search was incomplete")
            return {"points": [], "matches": [{"id": h["_id"], "score": h["_score"]} for h in result["hits"]["hits"]]}
        return {"points": [], "matches": []}

    def _get(self, name: str, ids: list[str]) -> list[dict[str, Any]]:
        docs = self.client.mget(index=name, ids=ids)["docs"]
        if len(docs) != len(ids) or any("error" in doc for doc in docs):
            raise VectorStoreUnavailableError("Full-text read was incomplete")
        return [TextPoint.model_validate({"id": d["_id"], **d["_source"]}).model_dump() for d in docs if d.get("found")]


class WeaviateTextStore:
    def __init__(self, client: "WeaviateClient"):
        self.client = client

    def execute(self, payload: TextPayload) -> VectorResult:
        from weaviate.classes.config import (
            Configure,
            ConsistencyLevel,
            DataType,
            Property,
            StopwordsPreset,
            Tokenization,
        )
        from weaviate.classes.data import DataObject
        from weaviate.classes.query import Filter, MetadataQuery

        name = payload.scope.collection_name.capitalize()
        description = "KnowledgeFS full-text v1; whitespace tokens; BM25"
        if not self.client.collections.exists(name):
            if payload.operation != "upsert":
                return _missing(payload)
            try:
                self.client.collections.create(
                    name=name,
                    description=description,
                    vectorizer_config=Configure.Vectorizer.none(),
                    vector_index_config=Configure.VectorIndex.none(),
                    inverted_index_config=Configure.inverted_index(stopwords_preset=StopwordsPreset.NONE),
                    properties=[
                        Property(name="text", data_type=DataType.TEXT, tokenization=Tokenization.WHITESPACE),
                        *[
                            Property(
                                name=key,
                                data_type=DataType.TEXT,
                                tokenization=Tokenization.FIELD,
                                index_searchable=False,
                            )
                            for key in ("generation_id", "content_hash")
                        ],
                    ],
                )
            except Exception:
                if not self.client.collections.exists(name):
                    raise
        collection = self.client.collections.use(name).with_consistency_level(ConsistencyLevel.ALL)
        config = collection.config.get()
        properties = {p.name: p for p in config.properties}
        if (
            config.description != description
            or config.multi_tenancy_config.enabled
            or "text" not in properties
            or properties["text"].tokenization != Tokenization.WHITESPACE
        ):
            raise VectorStoreUnavailableError("Incompatible full-text index schema")
        if payload.operation == "upsert":
            result = collection.data.insert_many(
                [DataObject(uuid=p.id, properties=p.model_dump(exclude={"id"})) for p in payload.points]
            )
            if result.has_errors or len(result.uuids) != len(payload.points):
                raise VectorStoreUnavailableError("Full-text batch was not acknowledged")
        elif payload.operation == "get":
            objects = collection.query.fetch_objects(
                filters=Filter.by_id().contains_any(payload.ids), limit=len(payload.ids)
            ).objects
            return {
                "points": [TextPoint.model_validate({"id": str(o.uuid), **o.properties}).model_dump() for o in objects],
                "matches": [],
            }
        elif payload.operation == "search":
            objects = collection.query.bm25(
                query=payload.query,
                query_properties=["text"],
                filters=Filter.by_id().contains_any(payload.ids),
                limit=payload.limit,
                return_metadata=MetadataQuery(score=True),
                return_properties=False,
            ).objects
            matches: list[VectorMatch] = []
            for obj in objects:
                if obj.metadata.score is None:
                    raise VectorStoreUnavailableError("Full-text search omitted score")
                matches.append({"id": str(obj.uuid), "score": obj.metadata.score})
            return {"points": [], "matches": matches}
        else:
            where = Filter.by_id().contains_any(payload.ids)
            deleted = collection.data.delete_many(where=where)
            if deleted.failed or collection.query.fetch_objects(filters=where, limit=1).objects:
                raise VectorStoreUnavailableError("Full-text deletion is not visible")
        return {"points": [], "matches": []}


def lexical_sparse_vector(text: str) -> tuple[list[int], list[float]]:
    """Log-TF cosine; deterministic vocabulary hashing, no learned embedding calls.

    A separate exact-token payload filter prevents hash collisions from producing
    matches for documents that contain none of the actual query terms.
    """
    counts: Counter[int] = Counter()
    for token, count in Counter(text.split()).items():
        index = int.from_bytes(hashlib.sha256(token.encode()).digest()[:4], "big")
        counts[index] += count
    indices = sorted(counts)
    values = [1 + math.log(counts[index]) for index in indices]
    norm = math.hypot(*values)
    return indices, [v / norm for v in values]


class QdrantTextStore:
    def __init__(self, client: "QdrantClient"):
        self.client = client

    def execute(self, payload: TextPayload) -> VectorResult:
        from qdrant_client.http import models as m
        from qdrant_client.http.exceptions import UnexpectedResponse

        name = payload.scope.collection_name
        try:
            info = self.client.get_collection(name)
        except UnexpectedResponse as error:
            if error.status_code != 404:
                raise
            if payload.operation != "upsert":
                return _missing(payload)
            try:
                self.client.create_collection(
                    name, vectors_config={}, sparse_vectors_config={"lexical": m.SparseVectorParams()}
                )
            except UnexpectedResponse as create_error:
                if create_error.status_code != 409:
                    raise
            self.client.create_payload_index(name, "terms", m.PayloadSchemaType.KEYWORD, wait=True)
            info = self.client.get_collection(name)
        if "lexical" not in (info.config.params.sparse_vectors or {}):
            raise VectorStoreUnavailableError("Incompatible full-text index schema")
        if payload.operation == "upsert":
            points = []
            for point in payload.points:
                indices, values = lexical_sparse_vector(point.text)
                points.append(
                    m.PointStruct(
                        id=point.id,
                        vector={"lexical": m.SparseVector(indices=indices, values=values)},
                        payload={**point.model_dump(exclude={"id"}), "terms": sorted(set(point.text.split()))},
                    )
                )
            result = self.client.upsert(name, points, wait=True)
            if result.status != m.UpdateStatus.COMPLETED:
                raise VectorStoreUnavailableError("Full-text batch was not acknowledged")
        elif payload.operation == "get":
            records = self.client.retrieve(name, payload.ids, with_payload=True, with_vectors=False)
            return {
                "points": [
                    TextPoint.model_validate(
                        {"id": str(p.id), **{k: v for k, v in (p.payload or {}).items() if k != "terms"}}
                    ).model_dump()
                    for p in records
                ],
                "matches": [],
            }
        elif payload.operation == "search":
            indices, values = lexical_sparse_vector(payload.query)
            scored = self.client.search(
                name,
                query_vector=m.NamedSparseVector(name="lexical", vector=m.SparseVector(indices=indices, values=values)),
                query_filter=m.Filter(
                    must=[
                        m.HasIdCondition(has_id=list(payload.ids)),
                        m.FieldCondition(key="terms", match=m.MatchAny(any=sorted(set(payload.query.split())))),
                    ]
                ),
                limit=payload.limit,
                with_payload=False,
                with_vectors=False,
            )
            return {"points": [], "matches": [{"id": str(p.id), "score": p.score} for p in scored]}
        else:
            result = self.client.delete(name, m.PointIdsList(points=list(payload.ids)), wait=True)
            if result.status != m.UpdateStatus.COMPLETED or self.client.retrieve(
                name, payload.ids, with_payload=False, with_vectors=False
            ):
                raise VectorStoreUnavailableError("Full-text deletion is not visible")
        return {"points": [], "matches": []}
