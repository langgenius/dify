"""Pure, explicit retirement policy for new hosted-credit migration revisions.

Retirement only removes an exact identity from preparation's completeness gate.
It never supplies an alias, credential, route, fallback, or a runtime error.
The caller supplies configuration and source facts; this owner performs no I/O.
"""

import hashlib
import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

from graphon.model_runtime.entities.model_entities import ModelType

type RetirementIdentity = tuple[str, ModelType, str]


class RetiredModelDeclaration(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    schema_version: Literal[1]
    mapping_revision: str = Field(min_length=1)
    provider_id: str = Field(pattern=r"^[a-z0-9_-]+/[a-z0-9_-]+/[a-z0-9_-]+$")
    model_type: ModelType
    model: str = Field(min_length=1)


@dataclass(frozen=True)
class ModelRetirementPolicy:
    mapping_revision: str
    identities: frozenset[RetirementIdentity]

    def for_provider(self, provider_id: str) -> frozenset[tuple[ModelType, str]]:
        return frozenset((kind, model) for provider, kind, model in self.identities if provider == provider_id)

    @property
    def digest(self) -> str:
        payload = {
            "mapping_revision": self.mapping_revision,
            "retired_sources": [
                {"provider": provider, "model_type": kind.value, "model": model}
                for provider, kind, model in sorted(self.identities)
            ],
        }
        return (
            "sha256:"
            + hashlib.sha256(
                json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
            ).hexdigest()
        )

    def inventory_payload(
        self,
        active_models: Sequence[Mapping[str, str]],
        retired_models: Sequence[Mapping[str, object]],
    ) -> object:
        if not self.identities:
            # Preserve historical inventory hashes when their exact revision has
            # no retirement declarations, including the [] default.
            return active_models
        return {
            "models": active_models,
            "retired_sources": retired_models,
            "retirement_policy_digest": self.digest,
        }


def resolve_retirement_policy(raw_policy: str, mapping_revision: str) -> ModelRetirementPolicy:
    """Validate all declarations and select one exact immutable revision."""
    if not mapping_revision:
        raise ValueError("Missing mapping revision")
    declarations = TypeAdapter(list[RetiredModelDeclaration]).validate_json(raw_policy)
    revisions: dict[str, set[RetirementIdentity]] = {}
    for declaration in declarations:
        identities = revisions.setdefault(declaration.mapping_revision, set())
        identity = (declaration.provider_id, declaration.model_type, declaration.model)
        if identity in identities:
            raise ValueError("Duplicate retired source within a revision")
        identities.add(identity)
    return ModelRetirementPolicy(mapping_revision, frozenset(revisions.get(mapping_revision, set())))
