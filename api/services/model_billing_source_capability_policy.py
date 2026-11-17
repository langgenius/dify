"""Operator-reviewed negative source capability evidence, never a model route.

An immutable source package can lack a model even when the global hosting list
contains it. Only exact, revision-bound evidence may remove that impossible
source from preparation. Version 2 can additionally attest a source runtime's
public SYSTEM endpoint restriction; it does not claim that its schema is absent.
Target completeness and retirement remain separate contracts. This pure owner
performs no I/O or error matching.
"""

import hashlib
import json
from dataclasses import dataclass
from operator import itemgetter
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, model_validator

from graphon.model_runtime.entities.model_entities import ModelType
from graphon.model_runtime.entities.provider_entities import ConfigurateMethod

type SourceIdentity = tuple[ModelType, str]
Digest = Annotated[str, Field(pattern=r"^sha256:[0-9a-f]{64}$")]


class UnavailableSourceEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    model_type: ModelType
    model: str = Field(min_length=1)
    reason: Literal["source_schema_unsupported", "source_runtime_unavailable"]
    proof_id: Digest
    # None is the original schema-only evidence, not a wildcard endpoint.
    system_endpoint: Literal["tongyi_international_without_custom_host"] | None = None

    @model_validator(mode="after")
    def validate_runtime_evidence(self) -> Self:
        if (self.reason == "source_runtime_unavailable") != (self.system_endpoint is not None):
            raise ValueError("Runtime source evidence requires an exact public endpoint predicate")
        return self

    def matches_system_endpoint(self, credentials: dict[str, object] | None) -> bool:
        """Read only public endpoint facts; never inspect or serialize API keys.

        The reviewed Tongyi runtime compares the string ``true`` and allows a
        custom host to select a different region. Requiring an absent host is
        deliberately narrower than its normalization of blank host strings.
        Unknown/malformed settings therefore retain strict discovery.
        """
        return bool(
            self.reason == "source_runtime_unavailable"
            and self.system_endpoint == "tongyi_international_without_custom_host"
            and credentials is not None
            and credentials.get("use_international_endpoint") == "true"
            and "api_host" not in credentials
        )


class SourceCapabilityDeclaration(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    schema_version: Literal[1, 2]
    mapping_revision: str = Field(min_length=1)
    provider_id: str = Field(pattern=r"^[a-z0-9_-]+/[a-z0-9_-]+/[a-z0-9_-]+$")
    plugin_unique_identifier: str = Field(pattern=r"^[a-z0-9_-]+/[a-z0-9_-]+:[^@\s]+@[0-9a-f]{64}$")
    catalog_digest: Digest
    original_configurate_methods: tuple[ConfigurateMethod, ...] = Field(min_length=1)
    supported_model_types: tuple[ModelType, ...] = Field(min_length=1)
    unavailable: tuple[UnavailableSourceEvidence, ...] = Field(min_length=1)
    # None preserves the original local-only policy and its frozen digest.
    # Serverless attestation is explicit, reviewed and revision-scoped in v2.
    allowed_runtime_types: tuple[Literal["local", "serverless"], ...] | None = Field(default=None, min_length=1)

    @model_validator(mode="after")
    def validate_evidence_identity(self) -> Self:
        if self.plugin_unique_identifier.split(":", 1)[0] != self.provider_id.rsplit("/", 1)[0]:
            raise ValueError("Source package/provider mismatch")
        if len(set(self.original_configurate_methods)) != len(self.original_configurate_methods):
            raise ValueError("Duplicate source configuration method")
        if len(set(self.supported_model_types)) != len(self.supported_model_types):
            raise ValueError("Duplicate source model type")
        identities = {(item.model_type, item.model) for item in self.unavailable}
        if len(identities) != len(self.unavailable):
            raise ValueError("Duplicate negative source identity")
        if any(item.model_type not in self.supported_model_types for item in self.unavailable):
            raise ValueError("Negative evidence has an unsupported model type")
        if self.allowed_runtime_types is not None:
            if self.schema_version != 2:
                raise ValueError("Runtime installation scope requires schema version 2")
            if len(set(self.allowed_runtime_types)) != len(self.allowed_runtime_types):
                raise ValueError("Duplicate source runtime type")
        runtime_evidence = [item for item in self.unavailable if item.reason == "source_runtime_unavailable"]
        if runtime_evidence and self.schema_version != 2:
            raise ValueError("Runtime source evidence requires schema version 2")
        if any(
            self.provider_id != "langgenius/tongyi/tongyi"
            or item.model_type != ModelType.LLM
            or not item.model.startswith("qwen-long")
            for item in runtime_evidence
        ):
            raise ValueError("Runtime endpoint evidence does not match the reviewed source guard")
        return self

    def allows_runtime(self, runtime_type: str) -> bool:
        """Only explicitly reviewed immutable execution kinds can attest absence."""
        return runtime_type in (self.allowed_runtime_types or ("local",))


def _digest(payload: object) -> str:
    return (
        "sha256:"
        + hashlib.sha256(
            json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
        ).hexdigest()
    )


@dataclass(frozen=True)
class ModelSourceCapabilityPolicy:
    mapping_revision: str
    declarations: tuple[SourceCapabilityDeclaration, ...]

    @property
    def digest(self) -> str:
        records = []
        for declaration in self.declarations:
            # Preserve the exact v1 digest: the new optional endpoint field is
            # not part of already-frozen schema-only evidence.
            record = declaration.model_dump(mode="json", exclude_none=True)
            record["original_configurate_methods"] = sorted(record["original_configurate_methods"])
            record["supported_model_types"] = sorted(record["supported_model_types"])
            if "allowed_runtime_types" in record:
                record["allowed_runtime_types"] = sorted(record["allowed_runtime_types"])
            record["unavailable"] = sorted(record["unavailable"], key=itemgetter("model_type", "model"))
            records.append(record)
        return _digest(sorted(records, key=itemgetter("provider_id", "plugin_unique_identifier")))

    def for_package(self, provider_id: str, plugin_unique_identifier: str | None) -> SourceCapabilityDeclaration | None:
        """None means no attestation; ordinary strict discovery must continue."""
        return next(
            (
                item
                for item in self.declarations
                if item.provider_id == provider_id and item.plugin_unique_identifier == plugin_unique_identifier
            ),
            None,
        )

    def inventory_payload(self, previous_payload: object, unavailable_sources: object) -> object:
        if not self.declarations:
            return previous_payload
        return {
            "source_inventory": previous_payload,
            "source_capability_policy_digest": self.digest,
            "unavailable_sources": unavailable_sources,
        }


def resolve_source_capability_policy(raw_policy: str, mapping_revision: str) -> ModelSourceCapabilityPolicy:
    """Validate every record; select only the requested immutable revision."""
    if not mapping_revision:
        raise ValueError("Missing mapping revision")
    records = TypeAdapter(list[SourceCapabilityDeclaration]).validate_json(raw_policy)
    identities = [(item.mapping_revision, item.provider_id, item.plugin_unique_identifier) for item in records]
    if len(set(identities)) != len(identities):
        raise ValueError("Duplicate package evidence within revision")
    return ModelSourceCapabilityPolicy(
        mapping_revision, tuple(item for item in records if item.mapping_revision == mapping_revision)
    )
