"""Immutable external full-text indexes, routed exclusively by Dify VECTOR_STORE.

SQL in KnowledgeFS supplies the exact authorized published IDs. This bridge
owns indexing/ranking only; no provider may broaden that supplied scope.
"""

import hashlib
import json
from contextlib import contextmanager
from typing import TYPE_CHECKING, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from services.knowledge_fs.vector_store import Identifier, VectorResult, VectorStoreUnavailableError

if TYPE_CHECKING:
    from collections.abc import Generator
    from typing import Protocol

    class TextClient(Protocol):
        def execute(self, payload: "TextPayload") -> VectorResult: ...


class TextScope(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    tenant_id: Identifier
    knowledge_space_id: Identifier
    index_version: str = Field(min_length=1, max_length=256)

    @property
    def collection_name(self) -> str:
        identity = json.dumps(self.model_dump(), sort_keys=True, separators=(",", ":"))
        return "knowledgefs_v1_fts_" + hashlib.sha256(identity.encode()).hexdigest()[:32]


class TextPoint(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: Identifier
    generation_id: Identifier
    content_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    text: str = Field(min_length=1, max_length=1024 * 1024)

    @model_validator(mode="after")
    def validate_content(self) -> "TextPoint":
        if not self.text.strip() or len(self.text.encode()) > 1024 * 1024:
            raise ValueError("Invalid full-text content")
        if hashlib.sha256(self.text.encode()).hexdigest() != self.content_hash:
            raise ValueError("Full-text checksum mismatch")
        return self


class TextPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    operation: Literal["upsert", "get", "search", "delete"]
    scope: TextScope
    points: list[TextPoint] = Field(default_factory=list, max_length=64)
    ids: list[Identifier] = Field(default_factory=list, max_length=2048)
    query: str = Field(default="", max_length=8192)
    limit: int = Field(default=10, ge=1, le=256)

    @model_validator(mode="after")
    def validate_operation(self) -> "TextPayload":
        if self.operation == "upsert":
            if not self.points or self.ids or self.query or len({p.id for p in self.points}) != len(self.points):
                raise ValueError("Upsert requires unique text points only")
        else:
            if not self.ids or self.points or len(set(self.ids)) != len(self.ids):
                raise ValueError("A bounded set of unique authorized IDs is required")
            if self.operation == "search":
                if not self.query.strip():
                    raise ValueError("A search query is required")
            elif self.query or (self.operation == "get" and len(self.ids) > 64):
                raise ValueError("Invalid full-text read or delete")
        return self


class TextIndexPendingError(Exception):
    """The native index is being initialized; a bounded retry is safe."""


@contextmanager
def configured_text_client(tenant_id: str, *, allow_create: bool = False) -> "Generator[TextClient, None, None]":

    from configs import dify_config
    from services.knowledge_fs.text_store_native import ElasticsearchTextStore, QdrantTextStore, WeaviateTextStore
    from services.knowledge_fs.vector_store import configured_vector_client
    from services.knowledge_fs.vector_store_elasticsearch import ElasticsearchVectorStore
    from services.knowledge_fs.vector_store_weaviate import WeaviateVectorStore

    if dify_config.VECTOR_STORE == "tidb_on_qdrant":
        from services.knowledge_fs.text_store_tidb import TidbTextStore

        store = TidbTextStore.from_tenant(tenant_id, allow_create=allow_create)
        try:
            yield store
        finally:
            store.close()
        return
    with configured_vector_client(tenant_id, allow_create=allow_create) as native:
        if isinstance(native, ElasticsearchVectorStore):
            yield ElasticsearchTextStore(native.client)
        elif isinstance(native, WeaviateVectorStore):
            yield WeaviateTextStore(native.client)
        elif dify_config.VECTOR_STORE == "qdrant":
            from qdrant_client import QdrantClient

            if not isinstance(native, QdrantClient):
                raise VectorStoreUnavailableError("Invalid configured full-text backend")
            yield QdrantTextStore(native)
        else:
            raise VectorStoreUnavailableError("Configured backend does not support full-text indexes")


def execute_text_request(client: "TextClient", payload: TextPayload) -> VectorResult:
    result = client.execute(payload)
    # Validate backend results at the trust boundary, including readback checksums.
    if payload.operation == "get":
        ids: set[str] = set()
        for point in result["points"]:
            parsed = TextPoint.model_validate(point)
            if parsed.id not in payload.ids or parsed.id in ids:
                raise VectorStoreUnavailableError("Unexpected full-text readback")
            ids.add(parsed.id)
    if payload.operation == "search":
        import math

        if len(result["matches"]) > payload.limit:
            raise VectorStoreUnavailableError("Unexpected full-text result count")
        seen: set[str] = set()
        for match in result["matches"]:
            if match["id"] not in payload.ids or match["id"] in seen or not math.isfinite(match["score"]):
                raise VectorStoreUnavailableError("Unexpected full-text match")
            seen.add(match["id"])
    return result
