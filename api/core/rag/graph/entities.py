"""Domain entities for knowledge-graph indexing and retrieval."""

import re
import unicodedata

from pydantic import BaseModel, Field, model_validator

DEFAULT_ENTITY_TYPES = [
    "PERSON",
    "ORGANIZATION",
    "LOCATION",
    "PRODUCT",
    "EVENT",
    "CONCEPT",
    "TECHNOLOGY",
    "METRIC",
    "DATE",
]

UNKNOWN_ENTITY_TYPE = "UNKNOWN"

_WHITESPACE_RE = re.compile(r"\s+")
# Trailing/leading punctuation the LLM commonly leaves attached to a name.
_EDGE_PUNCTUATION = " \t\r\n\"'`*_-–—.,;:!?()[]{}<>《》「」『』（）【】、"

# Names longer than this are almost always a sentence the model failed to
# condense; the column is String(255) so we also need a hard bound.
MAX_ENTITY_NAME_LENGTH = 255


def normalize_entity_name(name: str) -> str:
    """Return the canonical dedup key for an entity name.

    Unicode-normalized, punctuation-trimmed, whitespace-collapsed and
    case-folded, so ``"  Acme  Corp. "`` and ``"acme corp"`` merge into one node
    while the original spelling is kept separately as the display name.
    """
    normalized = unicodedata.normalize("NFKC", name)
    normalized = _WHITESPACE_RE.sub(" ", normalized).strip(_EDGE_PUNCTUATION)
    return normalized.casefold()[:MAX_ENTITY_NAME_LENGTH]


def normalize_display_name(name: str) -> str:
    """Return the human-facing spelling of an entity name."""
    normalized = unicodedata.normalize("NFKC", name)
    return _WHITESPACE_RE.sub(" ", normalized).strip(_EDGE_PUNCTUATION)[:MAX_ENTITY_NAME_LENGTH]


class GraphEntity(BaseModel):
    """An entity extracted from a single chunk."""

    name: str = Field(description="Canonical, normalized entity name used for deduplication.")
    display_name: str = Field(description="Entity name as written in the source text.")
    entity_type: str = Field(default=UNKNOWN_ENTITY_TYPE, description="Coarse entity category.")
    description: str = Field(default="", description="Short description of the entity in context.")


class GraphRelation(BaseModel):
    """A directed relation between two extracted entities."""

    source: str = Field(description="Normalized name of the source entity.")
    target: str = Field(description="Normalized name of the target entity.")
    predicate: str = Field(description="Relation label, e.g. `acquired` or `reports_to`.")
    description: str = Field(default="", description="Sentence describing the relation.")
    weight: float = Field(default=1.0, description="Confidence/strength of the relation.")


class GraphExtraction(BaseModel):
    """Entities and relations extracted from one chunk."""

    entities: list[GraphEntity] = Field(default_factory=list)
    relations: list[GraphRelation] = Field(default_factory=list)


class ChunkGraph(BaseModel):
    """A chunk's extraction together with the provenance needed for citations."""

    index_node_id: str = Field(description="DocumentSegment.index_node_id of the source chunk.")
    document_id: str = Field(description="Dify document id of the source chunk.")
    extraction: GraphExtraction = Field(default_factory=GraphExtraction)


class GraphIndexSetting(BaseModel):
    """Per-dataset knowledge-graph configuration, persisted on ``datasets.graph_index_setting``."""

    @model_validator(mode="before")
    @classmethod
    def _drop_explicit_nulls(cls, data: object) -> object:
        """Treat an explicit ``null`` the same as an absent key.

        The dataset-detail response serializes every graph-setting key, including
        ones the caller never set, as ``null``; that round-trips back through
        save and settles into storage verbatim. Pydantic only applies a field's
        default when the key is missing, not when it is present and ``None``, so
        without this a stored ``null`` fails validation for every non-optional
        field (entity_types, max_depth, ...) instead of falling back to its
        default.
        """
        if isinstance(data, dict):
            return {key: value for key, value in data.items() if value is not None}
        return data

    enabled: bool = Field(default=False, description="Whether graph indexing and retrieval are active.")
    model_provider_name: str | None = Field(default=None, description="Provider of the extraction LLM.")
    model_name: str | None = Field(default=None, description="Name of the extraction LLM.")
    entity_types: list[str] = Field(
        default_factory=lambda: list(DEFAULT_ENTITY_TYPES),
        description="Entity categories the extractor is asked to look for.",
    )
    max_entities_per_chunk: int = Field(default=16, ge=1, le=64)
    extract_prompt: str | None = Field(
        default=None,
        description="Overrides the built-in extraction prompt. Must instruct the model to answer with JSON.",
    )
    # retrieval-time knobs
    max_depth: int = Field(default=2, ge=1, le=4, description="Maximum number of hops walked from a seed entity.")
    max_seed_entities: int = Field(default=8, ge=1, le=32)
    max_neighbors_per_hop: int = Field(default=64, ge=1, le=512)
    hop_decay: float = Field(
        default=0.5,
        gt=0.0,
        le=1.0,
        description="Score multiplier applied per additional hop away from a seed entity.",
    )


class RetrievedGraphPath(BaseModel):
    """Explainability payload attached to a chunk retrieved through the graph."""

    seed_entity: str = Field(description="Display name of the entity matched in the query.")
    hop: int = Field(description="Number of hops between the seed entity and the matched fact.")
    entities: list[str] = Field(default_factory=list, description="Display names of entities on the path.")
    relations: list[str] = Field(default_factory=list, description="`source -[predicate]-> target` triples walked.")
