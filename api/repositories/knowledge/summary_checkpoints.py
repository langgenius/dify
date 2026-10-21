"""Pure serialization helpers for durable per-segment summary checkpoints."""

from collections.abc import Mapping
from dataclasses import dataclass, replace
from hashlib import sha256

SUMMARY_GENERATED_CHECKPOINT_KEY = "summary_generated_segments"
SUMMARY_COMPLETED_CHECKPOINT_KEY = "summary_completed_segments"


@dataclass(frozen=True)
class SummaryCheckpointIdentity:
    """The resource generations and model configuration that produced one result."""

    document_id: str
    document_generation: str | None
    segment_generation: str | None
    indexing_technique: str
    embedding_model_provider: str | None
    embedding_model: str | None
    summary_index_setting: dict[str, object] | None
    summary_id: str | None = None
    summary_content_fingerprint: str | None = None
    vector_node_id: str | None = None
    vector_content_hash: str | None = None

    def matches_configuration(
        self,
        *,
        expected_indexing_technique: str,
        expected_embedding_model_provider: str | None,
        expected_embedding_model: str | None,
        expected_summary_index_setting: Mapping[str, object] | None,
    ) -> bool:
        normalized_setting = _normalize_setting(expected_summary_index_setting)
        return (
            self.indexing_technique == expected_indexing_technique
            and self.embedding_model_provider == expected_embedding_model_provider
            and self.embedding_model == expected_embedding_model
            and self.summary_index_setting == normalized_setting
        )

    def to_payload(self) -> dict[str, object]:
        return {
            "document_id": self.document_id,
            "document_generation": self.document_generation,
            "segment_generation": self.segment_generation,
            "indexing_technique": self.indexing_technique,
            "embedding_model_provider": self.embedding_model_provider,
            "embedding_model": self.embedding_model,
            "summary_index_setting": _normalize_setting(self.summary_index_setting),
            "summary_id": self.summary_id,
            "summary_content_fingerprint": self.summary_content_fingerprint,
            "vector_node_id": self.vector_node_id,
            "vector_content_hash": self.vector_content_hash,
        }

    def matches_materialization(
        self,
        current: "CurrentSummaryMaterialization | None",
        *,
        require_completed: bool,
    ) -> bool:
        if current is None:
            return False
        if (
            current.document_id != self.document_id
            or current.document_generation != self.document_generation
            or current.segment_generation != self.segment_generation
            or current.summary_id != self.summary_id
            or current.summary_content_fingerprint != self.summary_content_fingerprint
        ):
            return False
        if not require_completed:
            return True
        return (
            current.summary_status == "completed"
            and current.summary_enabled
            and self.vector_node_id is not None
            and current.vector_node_id == self.vector_node_id
            and self.vector_content_hash is not None
            and current.vector_content_hash == self.vector_content_hash
        )


@dataclass(frozen=True)
class CurrentSummaryMaterialization:
    """Current shared summary material protected by the resource row locks."""

    document_id: str
    document_generation: str | None
    segment_generation: str | None
    summary_id: str | None
    summary_content_fingerprint: str | None
    vector_node_id: str | None
    vector_content_hash: str | None
    summary_status: str | None
    summary_enabled: bool


def summary_content_fingerprint(content: str) -> str:
    return sha256(content.encode("utf-8")).hexdigest()


def _normalize_json_value(value: object) -> object:
    if isinstance(value, Mapping):
        return {
            str(key): _normalize_json_value(item) for key, item in sorted(value.items(), key=lambda pair: str(pair[0]))
        }
    if isinstance(value, (list, tuple)):
        return [_normalize_json_value(item) for item in value]
    return value


def _normalize_setting(value: Mapping[str, object] | None) -> dict[str, object] | None:
    if value is None:
        return None
    return {key: _normalize_json_value(item) for key, item in sorted(value.items())}


def _optional_string(value: object) -> str | None:
    if value is None or isinstance(value, str):
        return value
    raise ValueError("summary checkpoint field must be a string or null")


def _parse_identity(value: object) -> SummaryCheckpointIdentity | None:
    if not isinstance(value, dict):
        return None
    required_keys = {
        "document_id",
        "document_generation",
        "segment_generation",
        "indexing_technique",
        "embedding_model_provider",
        "embedding_model",
        "summary_index_setting",
        "summary_id",
        "summary_content_fingerprint",
        "vector_node_id",
        "vector_content_hash",
    }
    if not required_keys.issubset(value):
        return None
    document_id = value["document_id"]
    indexing_technique = value["indexing_technique"]
    summary_index_setting = value["summary_index_setting"]
    if not isinstance(document_id, str) or not isinstance(indexing_technique, str):
        return None
    if summary_index_setting is not None and not isinstance(summary_index_setting, dict):
        return None
    try:
        return SummaryCheckpointIdentity(
            document_id=document_id,
            document_generation=_optional_string(value["document_generation"]),
            segment_generation=_optional_string(value["segment_generation"]),
            indexing_technique=indexing_technique,
            embedding_model_provider=_optional_string(value["embedding_model_provider"]),
            embedding_model=_optional_string(value["embedding_model"]),
            summary_index_setting=_normalize_setting(summary_index_setting),
            summary_id=_optional_string(value["summary_id"]),
            summary_content_fingerprint=_optional_string(value["summary_content_fingerprint"]),
            vector_node_id=_optional_string(value["vector_node_id"]),
            vector_content_hash=_optional_string(value["vector_content_hash"]),
        )
    except ValueError:
        return None


def parse_summary_checkpoints(value: object) -> dict[str, SummaryCheckpointIdentity]:
    if not isinstance(value, dict):
        return {}
    checkpoints: dict[str, SummaryCheckpointIdentity] = {}
    for segment_id, raw_identity in value.items():
        if not isinstance(segment_id, str):
            continue
        identity = _parse_identity(raw_identity)
        if identity is not None:
            checkpoints[segment_id] = identity
    return checkpoints


def serialize_summary_checkpoints(
    checkpoints: Mapping[str, SummaryCheckpointIdentity],
) -> dict[str, object]:
    return {segment_id: checkpoints[segment_id].to_payload() for segment_id in sorted(checkpoints)}


def summary_checkpoint_segment_ids(payload: Mapping[str, object]) -> tuple[str, ...]:
    """Return the stable union of segment ids referenced by valid checkpoints."""

    return tuple(
        sorted(
            {
                *parse_summary_checkpoints(payload.get(SUMMARY_GENERATED_CHECKPOINT_KEY)),
                *parse_summary_checkpoints(payload.get(SUMMARY_COMPLETED_CHECKPOINT_KEY)),
            }
        )
    )


def inherit_summary_checkpoints(
    source_payload: Mapping[str, object],
    *,
    expected_indexing_technique: str,
    expected_embedding_model_provider: str | None,
    expected_embedding_model: str | None,
    expected_summary_index_setting: Mapping[str, object] | None,
    document_generation_replacements: Mapping[str, tuple[str | None, str | None]],
    current_materializations: Mapping[str, CurrentSummaryMaterialization],
) -> dict[str, object]:
    """Copy only checkpoints owned by the successor's exact current configuration.

    A non-empty replacement map also scopes the result to those documents. An
    entry is remapped only when its source generation matches the map's old
    generation, so a successor cannot inherit material from another command.
    """

    inherited: dict[str, object] = {}
    for checkpoint_key in (SUMMARY_GENERATED_CHECKPOINT_KEY, SUMMARY_COMPLETED_CHECKPOINT_KEY):
        checkpoints = parse_summary_checkpoints(source_payload.get(checkpoint_key))
        selected: dict[str, SummaryCheckpointIdentity] = {}
        for segment_id, identity in checkpoints.items():
            if not identity.matches_configuration(
                expected_indexing_technique=expected_indexing_technique,
                expected_embedding_model_provider=expected_embedding_model_provider,
                expected_embedding_model=expected_embedding_model,
                expected_summary_index_setting=expected_summary_index_setting,
            ):
                continue
            if document_generation_replacements:
                replacement = document_generation_replacements.get(identity.document_id)
                if replacement is None or identity.document_generation != replacement[0]:
                    continue
                identity = replace(identity, document_generation=replacement[1])
            if not identity.matches_materialization(
                current_materializations.get(segment_id),
                require_completed=checkpoint_key == SUMMARY_COMPLETED_CHECKPOINT_KEY,
            ):
                continue
            selected[segment_id] = identity
        if selected:
            inherited[checkpoint_key] = serialize_summary_checkpoints(selected)
    return inherited
