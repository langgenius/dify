"""Pure, exact-revision source variants; no runtime or credential I/O.

Publish only under a NEW mapping revision with an explicit inventory policy::

    [{"schema_version": 1, "mapping_revision": "<new-immutable-revision>",
      "inventory_policy": "saved_system_dependencies_v2"}]

V1 declarations and their hashes are never rewritten. Prospective declarations
prove reviewed profile/target capability, not an installed source RPC. Actual
selected sources still require fresh immutable installation/catalog/runtime
proof at readiness. All Core mutation callers must be rolled out with the same
cohort boot freeze and registry snapshot, and old model installation tasks must
be drained before preparation. Active source replacement still requires the
separate explicit re-preparation workflow; this registry does not authorize it.
"""

import hashlib
import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Annotated, Literal

from pydantic import Field, TypeAdapter

from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelType
from services.entities.model_billing_embedding_mapping import (
    EmbeddingSourceSettings,
    SelectedEmbeddingSourceVariant,
    SourceEmbeddingVariantMapping,
    SourceEmbeddingVariantSelection,
)
from services.entities.model_billing_mapping import (
    ModelMapping,
    SelectedSourceVariant,
    SourceVariantMapping,
    SourceVariantSelection,
    SourceVariantSettings,
    model_schema_digest,
)

type MappingIdentity = tuple[str, ModelType, str]
type MappingDeclaration = ModelMapping | SourceVariantMapping | SourceEmbeddingVariantMapping
type SelectedModelMapping = ModelMapping | SelectedSourceVariant | SelectedEmbeddingSourceVariant


def source_endpoint_class(source_uid: str, source_base: object) -> Literal["unset", "official_root", "unreviewed"]:
    """Classify exact source settings without retaining or disclosing URLs.

    This is not URL normalization. In particular, 042 appends ``/v1`` even
    when one is already present, so an official-looking suffix is not an
    interchangeable source contract. Only these exact archives and the one
    reviewed literal are admitted; custom/malformed values prove nothing.
    """
    if source_base is None or type(source_base) is str and source_base == "":
        return "unset"
    if (
        type(source_base) is str
        and source_base == "https://api.openai.com"
        and source_uid
        in {
            "langgenius/openai:0.4.2@21195ee1321849e0a7d4b3f6b2fd8c2be23ea6c7182e1b444ecc4c1711b52468",
            "langgenius/openai:1.1.0@95f7de6ee42124cb7649f20d3f175c5b0adb66ad92640a97e4027c15b266141c",
        }
    ):
        return "official_root"
    return "unreviewed"


@dataclass(frozen=True, slots=True)
class SourceVariantContext:
    source_plugin_uid: str
    settings: SourceVariantSettings


@dataclass(frozen=True, slots=True)
class EmbeddingSourceVariantContext:
    source_plugin_uid: str
    settings: EmbeddingSourceSettings


@dataclass(frozen=True, slots=True)
class ModelMappingRevision:
    revision: str
    declarations: Mapping[MappingIdentity, MappingDeclaration]

    @property
    def has_variants(self) -> bool:
        return any(
            isinstance(item, (SourceVariantMapping, SourceEmbeddingVariantMapping))
            for item in self.declarations.values()
        )

    @property
    def digest(self) -> str:
        # Reuse the existing variant pin algorithm; never replace a V1 hash.
        records = []
        for key in sorted(self.declarations):
            declaration = self.declarations[key]
            record = declaration.model_dump(mode="json")
            if isinstance(declaration, (SourceVariantMapping, SourceEmbeddingVariantMapping)):
                record["variants"] = [
                    item.model_dump(mode="json")
                    for item in sorted(declaration.variants, key=lambda item: item.variant_id)
                ]
            records.append(record)
        return (
            "sha256:"
            + hashlib.sha256(
                json.dumps(records, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
            ).hexdigest()
        )

    def resolve(
        self,
        identity: MappingIdentity,
        *,
        context: SourceVariantContext | EmbeddingSourceVariantContext | None,
        schema: AIModelEntity | None = None,
    ) -> SelectedModelMapping:
        declaration = self.declarations.get(identity)
        if declaration is None:
            raise ValueError("Unmapped source identity")
        if isinstance(declaration, ModelMapping):
            return declaration
        if context is None:
            raise ValueError("Positive source variant facts required")
        selected: SelectedSourceVariant | SelectedEmbeddingSourceVariant
        if isinstance(declaration, SourceEmbeddingVariantMapping):
            if not isinstance(context, EmbeddingSourceVariantContext):
                raise ValueError("Source variant fact family changed")
            embedding_matches = [
                item
                for item in declaration.variants
                if item.source_plugin_uid == context.source_plugin_uid and item.source_settings == context.settings
            ]
            if len(embedding_matches) != 1:
                raise ValueError("Unknown or ambiguous source variant")
            selected = SelectedEmbeddingSourceVariant(declaration, embedding_matches[0], self.digest)
        else:
            if not isinstance(context, SourceVariantContext):
                raise ValueError("Source variant fact family changed")
            matches = [
                item
                for item in declaration.variants
                if item.source_plugin_uid == context.source_plugin_uid and item.source_settings == context.settings
            ]
            if len(matches) != 1:
                raise ValueError("Unknown or ambiguous source variant")
            selected = SelectedSourceVariant(declaration, matches[0], self.digest)
        if schema is not None and (
            (schema.model_type, schema.model) != identity[1:]
            or model_schema_digest(schema) != selected.source_schema_digest
        ):
            raise ValueError("Source variant catalog changed")
        return selected

    def selected_prospective(self) -> tuple[SelectedSourceVariant | SelectedEmbeddingSourceVariant, ...]:
        result: list[SelectedSourceVariant | SelectedEmbeddingSourceVariant] = []
        for _, declaration in sorted(self.declarations.items()):
            if isinstance(declaration, SourceEmbeddingVariantMapping):
                result.extend(
                    SelectedEmbeddingSourceVariant(declaration, variant, self.digest)
                    for variant in sorted(declaration.variants, key=lambda item: item.variant_id)
                )
            elif isinstance(declaration, SourceVariantMapping):
                result.extend(
                    SelectedSourceVariant(declaration, variant, self.digest)
                    for variant in sorted(declaration.variants, key=lambda item: item.variant_id)
                )
        return tuple(result)

    def restore_selection(self, identity: MappingIdentity, payload: object) -> SelectedModelMapping:
        declaration = self.declarations.get(identity)
        if isinstance(declaration, ModelMapping):
            if payload is not None:
                raise ValueError("V1 mapping cannot carry a source variant")
            return declaration
        record: SourceVariantSelection | SourceEmbeddingVariantSelection
        if isinstance(declaration, SourceEmbeddingVariantMapping):
            record = SourceEmbeddingVariantSelection.model_validate(payload)
            selected = self.resolve(
                identity, context=EmbeddingSourceVariantContext(record.source_plugin_uid, record.source_settings)
            )
        else:
            record = SourceVariantSelection.model_validate(payload)
            selected = self.resolve(
                identity, context=SourceVariantContext(record.source_plugin_uid, record.source_settings)
            )
        if (
            not isinstance(selected, (SelectedSourceVariant, SelectedEmbeddingSourceVariant))
            or selection_payload(selected) != record
        ):
            raise ValueError("Frozen source variant changed")
        return selected


def selection_payload(
    selected: SelectedSourceVariant | SelectedEmbeddingSourceVariant,
) -> SourceVariantSelection | SourceEmbeddingVariantSelection:
    if isinstance(selected, SelectedEmbeddingSourceVariant):
        return SourceEmbeddingVariantSelection(
            schema_version=3,
            variant_id=selected.variant.variant_id,
            source_plugin_uid=selected.variant.source_plugin_uid,
            source_settings=selected.variant.source_settings,
            source_schema_digest=selected.variant.source_schema_digest,
            source_runtime_schema_digest=selected.variant.source_runtime_schema_digest,
            registry_digest=selected.registry_digest,
        )
    variant = selected.variant
    return SourceVariantSelection(
        variant_id=variant.variant_id,
        source_plugin_uid=variant.source_plugin_uid,
        source_settings=variant.source_settings,
        source_schema_digest=variant.source_schema_digest,
        source_runtime_schema_digest=variant.source_runtime_schema_digest,
        registry_digest=selected.registry_digest,
    )


def source_mapping_revision(
    raw_registry: str, revision: str, *, normalize_provider: Callable[[str], str]
) -> ModelMappingRevision:
    if not revision:
        raise ValueError("Missing mapping revision")
    records = TypeAdapter(
        list[
            Annotated[
                ModelMapping | SourceVariantMapping | SourceEmbeddingVariantMapping,
                Field(discriminator="schema_version"),
            ]
        ]
    ).validate_json(raw_registry)
    revisions: dict[str, dict[MappingIdentity, MappingDeclaration]] = {}
    for record in records:
        key = (normalize_provider(record.source.provider_id), record.source.model_type, record.source.model)
        selected = revisions.setdefault(record.mapping_revision, {})
        if key in selected or isinstance(record, ModelMapping) and record.target.model_type != record.source.model_type:
            raise ValueError("Duplicate source within revision or incompatible model type")
        selected[key] = record
    if revision not in revisions:
        raise ValueError("Unknown mapping revision")
    return ModelMappingRevision(revision, revisions[revision])
