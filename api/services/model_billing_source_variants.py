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
from services.entities.model_billing_audio_mapping import (
    AudioSourceSettings,
    SelectedAudioSourceVariant,
    SourceAudioVariantMapping,
    SourceAudioVariantSelection,
)
from services.entities.model_billing_embedding_mapping import (
    EmbeddingSourceSettings,
    SelectedEmbeddingSourceVariant,
    SourceEmbeddingVariantMapping,
    SourceEmbeddingVariantSelection,
)
from services.entities.model_billing_gemini_mapping import (
    GeminiSourceSettings,
    SelectedGeminiSourceVariant,
    SourceGeminiVariantMapping,
    SourceGeminiVariantSelection,
)
from services.entities.model_billing_gemini_v8_mapping import (
    SelectedGeminiV8SourceVariant,
    SourceGeminiV8VariantMapping,
    SourceGeminiV8VariantSelection,
)
from services.entities.model_billing_mapping import (
    ModelMapping,
    SelectedSourceVariant,
    SourceVariantMapping,
    SourceVariantSelection,
    SourceVariantSettings,
    model_schema_digest,
)
from services.entities.model_billing_tongyi_mapping import (
    SelectedTongyiSourceVariant,
    SourceTongyiVariantMapping,
    SourceTongyiVariantSelection,
    TongyiSourceSettings,
)
from services.entities.model_billing_xai_mapping import (
    SelectedXAISourceVariant,
    SourceXAIVariantMapping,
    SourceXAIVariantSelection,
    XAISourceSettings,
)

type MappingIdentity = tuple[str, ModelType, str]
type MappingDeclaration = (
    ModelMapping
    | SourceVariantMapping
    | SourceEmbeddingVariantMapping
    | SourceAudioVariantMapping
    | SourceXAIVariantMapping
    | SourceGeminiVariantMapping
    | SourceGeminiV8VariantMapping
    | SourceTongyiVariantMapping
)
type SelectedSourceVariantMapping = (
    SelectedSourceVariant
    | SelectedEmbeddingSourceVariant
    | SelectedAudioSourceVariant
    | SelectedXAISourceVariant
    | SelectedGeminiSourceVariant
    | SelectedGeminiV8SourceVariant
    | SelectedTongyiSourceVariant
)
type SelectedModelMapping = ModelMapping | SelectedSourceVariantMapping
type SourceVariantSelectionPayload = (
    SourceVariantSelection
    | SourceEmbeddingVariantSelection
    | SourceAudioVariantSelection
    | SourceXAIVariantSelection
    | SourceGeminiVariantSelection
    | SourceGeminiV8VariantSelection
    | SourceTongyiVariantSelection
)

SOURCE_VARIANT_DECLARATION_TYPES = (
    SourceVariantMapping,
    SourceEmbeddingVariantMapping,
    SourceAudioVariantMapping,
    SourceXAIVariantMapping,
    SourceGeminiVariantMapping,
    SourceGeminiV8VariantMapping,
    SourceTongyiVariantMapping,
)
SELECTED_SOURCE_VARIANT_TYPES = (
    SelectedSourceVariant,
    SelectedEmbeddingSourceVariant,
    SelectedAudioSourceVariant,
    SelectedXAISourceVariant,
    SelectedGeminiSourceVariant,
    SelectedGeminiV8SourceVariant,
    SelectedTongyiSourceVariant,
)


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
            "langgenius/openai:1.1.0@1ded02acee56efd5788c86fd447d792e4923e959554a4942f440c7859d164340",
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
class AudioSourceVariantContext:
    source_plugin_uid: str
    settings: AudioSourceSettings


@dataclass(frozen=True, slots=True)
class XAISourceVariantContext:
    source_plugin_uid: str
    settings: XAISourceSettings
    source_endpoint_class: Literal["official_root"]


@dataclass(frozen=True, slots=True)
class GeminiSourceVariantContext:
    source_plugin_uid: str
    settings: GeminiSourceSettings


@dataclass(frozen=True, slots=True)
class GeminiV8SourceVariantContext:
    """Exact V8 facts; never accepted by the immutable V6 selector."""

    source_plugin_uid: str
    settings: GeminiSourceSettings


@dataclass(frozen=True, slots=True)
class TongyiSourceVariantContext:
    source_plugin_uid: str
    settings: TongyiSourceSettings


type SourceContext = (
    SourceVariantContext
    | EmbeddingSourceVariantContext
    | AudioSourceVariantContext
    | XAISourceVariantContext
    | GeminiSourceVariantContext
    | GeminiV8SourceVariantContext
    | TongyiSourceVariantContext
)


@dataclass(frozen=True, slots=True)
class ModelMappingRevision:
    revision: str
    declarations: Mapping[MappingIdentity, MappingDeclaration]

    @property
    def has_variants(self) -> bool:
        return any(isinstance(item, SOURCE_VARIANT_DECLARATION_TYPES) for item in self.declarations.values())

    @property
    def digest(self) -> str:
        # Reuse the existing variant pin algorithm; never replace a V1 hash.
        records = []
        for key in sorted(self.declarations):
            declaration = self.declarations[key]
            record = declaration.model_dump(mode="json")
            if isinstance(declaration, SOURCE_VARIANT_DECLARATION_TYPES):
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
        context: SourceContext | None,
        schema: AIModelEntity | None = None,
    ) -> SelectedModelMapping:
        declaration = self.declarations.get(identity)
        if declaration is None:
            raise ValueError("Unmapped source identity")
        if isinstance(declaration, ModelMapping):
            return declaration
        if context is None:
            raise ValueError("Positive source variant facts required")
        selected: SelectedSourceVariantMapping
        if isinstance(declaration, SourceTongyiVariantMapping):
            if type(context) is not TongyiSourceVariantContext:
                raise ValueError("Source Tongyi fact family changed")
            tongyi_matches = [
                item
                for item in declaration.variants
                if item.source_plugin_uid == context.source_plugin_uid and item.source_settings == context.settings
            ]
            if len(tongyi_matches) != 1:
                raise ValueError("Unknown or ambiguous Tongyi source variant")
            selected = SelectedTongyiSourceVariant(declaration, tongyi_matches[0], self.digest)
        elif isinstance(declaration, SourceGeminiV8VariantMapping):
            if type(context) is not GeminiV8SourceVariantContext:
                raise ValueError("Source V8 Gemini fact family changed")
            gemini_v8_matches = [
                item
                for item in declaration.variants
                if item.source_plugin_uid == context.source_plugin_uid and item.source_settings == context.settings
            ]
            if len(gemini_v8_matches) != 1:
                raise ValueError("Unknown or ambiguous V8 Gemini source variant")
            selected = SelectedGeminiV8SourceVariant(declaration, gemini_v8_matches[0], self.digest)
        elif isinstance(declaration, SourceGeminiVariantMapping):
            if type(context) is not GeminiSourceVariantContext:
                raise ValueError("Source Gemini fact family changed")
            gemini_matches = [
                item
                for item in declaration.variants
                if item.source_plugin_uid == context.source_plugin_uid and item.source_settings == context.settings
            ]
            if len(gemini_matches) != 1:
                raise ValueError("Unknown or ambiguous Gemini source variant")
            selected = SelectedGeminiSourceVariant(declaration, gemini_matches[0], self.digest)
        elif isinstance(declaration, SourceAudioVariantMapping):
            if not isinstance(context, AudioSourceVariantContext):
                raise ValueError("Source audio fact family changed")
            audio_matches = [
                item
                for item in declaration.variants
                if item.source_plugin_uid == context.source_plugin_uid and item.source_settings == context.settings
            ]
            if len(audio_matches) != 1:
                raise ValueError("Unknown or ambiguous audio source variant")
            selected = SelectedAudioSourceVariant(declaration, audio_matches[0], self.digest)
        elif isinstance(declaration, SourceXAIVariantMapping):
            if not isinstance(context, XAISourceVariantContext):
                raise ValueError("Source xAI fact family changed")
            xai_matches = [
                item
                for item in declaration.variants
                if item.source_plugin_uid == context.source_plugin_uid
                and item.source_settings == context.settings
                and item.source_endpoint_class == context.source_endpoint_class
            ]
            if len(xai_matches) != 1:
                raise ValueError("Unknown or ambiguous xAI source variant")
            selected = SelectedXAISourceVariant(declaration, xai_matches[0], self.digest)
        elif isinstance(declaration, SourceEmbeddingVariantMapping):
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

    def selected_prospective(self) -> tuple[SelectedSourceVariantMapping, ...]:
        result: list[SelectedSourceVariantMapping] = []
        for _, declaration in sorted(self.declarations.items()):
            if isinstance(declaration, SourceTongyiVariantMapping):
                result.extend(
                    SelectedTongyiSourceVariant(declaration, variant, self.digest)
                    for variant in sorted(declaration.variants, key=lambda item: item.variant_id)
                )
            elif isinstance(declaration, SourceGeminiV8VariantMapping):
                result.extend(
                    SelectedGeminiV8SourceVariant(declaration, variant, self.digest)
                    for variant in sorted(declaration.variants, key=lambda item: item.variant_id)
                )
            elif isinstance(declaration, SourceGeminiVariantMapping):
                result.extend(
                    SelectedGeminiSourceVariant(declaration, variant, self.digest)
                    for variant in sorted(declaration.variants, key=lambda item: item.variant_id)
                )
            elif isinstance(declaration, SourceAudioVariantMapping):
                result.extend(
                    SelectedAudioSourceVariant(declaration, variant, self.digest)
                    for variant in sorted(declaration.variants, key=lambda item: item.variant_id)
                )
            elif isinstance(declaration, SourceXAIVariantMapping):
                result.extend(
                    SelectedXAISourceVariant(declaration, variant, self.digest)
                    for variant in sorted(declaration.variants, key=lambda item: item.variant_id)
                )
            elif isinstance(declaration, SourceEmbeddingVariantMapping):
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
        record: SourceVariantSelectionPayload
        if isinstance(declaration, SourceTongyiVariantMapping):
            record = SourceTongyiVariantSelection.model_validate(payload)
            selected = self.resolve(
                identity, context=TongyiSourceVariantContext(record.source_plugin_uid, record.source_settings)
            )
        elif isinstance(declaration, SourceGeminiV8VariantMapping):
            record = SourceGeminiV8VariantSelection.model_validate(payload)
            selected = self.resolve(
                identity, context=GeminiV8SourceVariantContext(record.source_plugin_uid, record.source_settings)
            )
        elif isinstance(declaration, SourceGeminiVariantMapping):
            record = SourceGeminiVariantSelection.model_validate(payload)
            selected = self.resolve(
                identity, context=GeminiSourceVariantContext(record.source_plugin_uid, record.source_settings)
            )
        elif isinstance(declaration, SourceAudioVariantMapping):
            record = SourceAudioVariantSelection.model_validate(payload)
            selected = self.resolve(
                identity, context=AudioSourceVariantContext(record.source_plugin_uid, record.source_settings)
            )
        elif isinstance(declaration, SourceXAIVariantMapping):
            record = SourceXAIVariantSelection.model_validate(payload)
            selected = self.resolve(
                identity,
                context=XAISourceVariantContext(
                    record.source_plugin_uid, record.source_settings, record.source_endpoint_class
                ),
            )
        elif isinstance(declaration, SourceEmbeddingVariantMapping):
            record = SourceEmbeddingVariantSelection.model_validate(payload)
            selected = self.resolve(
                identity, context=EmbeddingSourceVariantContext(record.source_plugin_uid, record.source_settings)
            )
        else:
            record = SourceVariantSelection.model_validate(payload)
            selected = self.resolve(
                identity, context=SourceVariantContext(record.source_plugin_uid, record.source_settings)
            )
        if not isinstance(selected, SELECTED_SOURCE_VARIANT_TYPES) or selection_payload(selected) != record:
            raise ValueError("Frozen source variant changed")
        return selected


def selection_payload(
    selected: SelectedSourceVariantMapping,
) -> SourceVariantSelectionPayload:
    if isinstance(selected, SelectedTongyiSourceVariant):
        return SourceTongyiVariantSelection(
            schema_version=7,
            variant_id=selected.variant.variant_id,
            source_plugin_uid=selected.variant.source_plugin_uid,
            source_settings=selected.variant.source_settings,
            source_schema_digest=selected.variant.source_schema_digest,
            source_runtime_schema_digest=selected.variant.source_runtime_schema_digest,
            registry_digest=selected.registry_digest,
        )
    if isinstance(selected, SelectedGeminiV8SourceVariant):
        return SourceGeminiV8VariantSelection(
            schema_version=8,
            variant_id=selected.variant.variant_id,
            source_plugin_uid=selected.variant.source_plugin_uid,
            source_settings=selected.variant.source_settings,
            source_schema_digest=selected.variant.source_schema_digest,
            source_runtime_schema_digest=selected.variant.source_runtime_schema_digest,
            registry_digest=selected.registry_digest,
        )
    if isinstance(selected, SelectedGeminiSourceVariant):
        return SourceGeminiVariantSelection(
            schema_version=6,
            variant_id=selected.variant.variant_id,
            source_plugin_uid=selected.variant.source_plugin_uid,
            source_settings=selected.variant.source_settings,
            source_schema_digest=selected.variant.source_schema_digest,
            source_runtime_schema_digest=selected.variant.source_runtime_schema_digest,
            registry_digest=selected.registry_digest,
        )
    if isinstance(selected, SelectedAudioSourceVariant):
        return SourceAudioVariantSelection(
            schema_version=4,
            variant_id=selected.variant.variant_id,
            source_plugin_uid=selected.variant.source_plugin_uid,
            source_settings=selected.variant.source_settings,
            source_schema_digest=selected.variant.source_schema_digest,
            source_runtime_schema_digest=selected.variant.source_runtime_schema_digest,
            registry_digest=selected.registry_digest,
        )
    if isinstance(selected, SelectedXAISourceVariant):
        return SourceXAIVariantSelection(
            schema_version=5,
            variant_id=selected.variant.variant_id,
            source_plugin_uid=selected.variant.source_plugin_uid,
            source_settings=selected.variant.source_settings,
            source_endpoint_class=selected.variant.source_endpoint_class,
            source_schema_digest=selected.variant.source_schema_digest,
            source_runtime_schema_digest=selected.variant.source_runtime_schema_digest,
            registry_digest=selected.registry_digest,
        )
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
                ModelMapping
                | SourceVariantMapping
                | SourceEmbeddingVariantMapping
                | SourceAudioVariantMapping
                | SourceXAIVariantMapping
                | SourceGeminiVariantMapping
                | SourceGeminiV8VariantMapping
                | SourceTongyiVariantMapping,
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
