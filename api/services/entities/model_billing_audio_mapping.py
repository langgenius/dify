"""Closed audio V4 declarations, separate from immutable V1/LLM V2/embedding V3.

The six-field codec marker is not endpoint authority. Exact endpoint class is
part of this outer selection and must match private SYSTEM facts at admission.
Raw OpenAI protocol/metadata flags are not represented as invented False values.
"""

from dataclasses import dataclass
from typing import Literal, Self

from pydantic import ConfigDict, Field, model_validator

from graphon.model_runtime.entities.model_entities import ModelType
from services.entities.model_billing_mapping import MappingSource, MappingTarget, _StrictModel


class AudioSourceSettings(_StrictModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    source_endpoint_class: Literal["unset", "official_root"]
    api_protocol_behavior: Literal["not_used"]
    request_metadata_behavior: Literal["not_used"]


class AudioMappingSource(MappingSource):
    provider_id: Literal["langgenius/openai/openai"]
    model_type: Literal[ModelType.TTS, ModelType.SPEECH2TEXT]
    model: Literal[
        "gpt-4o-mini-transcribe",
        "gpt-4o-mini-transcribe-2025-12-15",
        "gpt-4o-transcribe",
        "gpt-4o-transcribe-diarize",
        "whisper-1",
        "tts-1",
        "tts-1-hd",
        "gpt-4o-mini-tts-2025-12-15",
    ]
    mode: Literal["tts", "speech2text"]


class AudioMappingTarget(MappingTarget):
    model_type: Literal[ModelType.TTS, ModelType.SPEECH2TEXT]
    model: Literal[
        "gpt-4o-mini-transcribe",
        "gpt-4o-mini-transcribe-2025-12-15",
        "gpt-4o-transcribe",
        "gpt-4o-transcribe-diarize",
        "whisper-1",
        "tts-1",
        "tts-1-hd",
        "gpt-4o-mini-tts-2025-12-15",
    ]


class AudioSourceAdapter(_StrictModel):
    id: Literal["openai_tts_source_v1", "openai_stt_source_v1"]
    revision: Literal["1"]
    rules_digest: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")


class AudioSourceVariant(_StrictModel):
    variant_id: str = Field(min_length=1)
    source_plugin_uid: Literal[
        "langgenius/openai:0.4.2@21195ee1321849e0a7d4b3f6b2fd8c2be23ea6c7182e1b444ecc4c1711b52468",
        "langgenius/openai:1.1.0@95f7de6ee42124cb7649f20d3f175c5b0adb66ad92640a97e4027c15b266141c",
        "langgenius/openai:1.1.0@1ded02acee56efd5788c86fd447d792e4923e959554a4942f440c7859d164340",
    ]
    source_settings: AudioSourceSettings
    source_schema_digest: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    source_runtime_schema_digest: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    source_profile_id: str = Field(min_length=1)
    parameter_adapter: AudioSourceAdapter
    target: AudioMappingTarget
    operations: list[str] = Field(min_length=2, max_length=3)
    conformance_fixture_ids: list[str] = Field(min_length=1)

    @model_validator(mode="after")
    def closed_audio_operations(self) -> Self:
        expected = (
            {"model/schema", "tts/invoke", "tts/model/voices"}
            if self.target.model_type is ModelType.TTS
            else {"model/schema", "speech2text/invoke"}
        )
        if (
            set(self.operations) != expected
            or len(self.operations) != len(expected)
            or len(set(self.conformance_fixture_ids)) != len(self.conformance_fixture_ids)
        ):
            raise ValueError("Invalid bounded audio operations")
        return self


class SourceAudioVariantMapping(_StrictModel):
    schema_version: Literal[4]
    mapping_revision: str = Field(min_length=1)
    source: AudioMappingSource
    settlement_owner: Literal["shared_credit_pool"]
    pool_types: list[Literal["paid", "trial"]] = Field(min_length=1)
    variants: list[AudioSourceVariant] = Field(min_length=1)

    @model_validator(mode="after")
    def finite_exact_audio_variants(self) -> Self:
        from services.model_billing_openai_audio_adapter import validate_openai_audio_identity

        if (
            self.source.mode != self.source.model_type.value
            or len(set(self.pool_types)) != len(self.pool_types)
            or len({row.variant_id for row in self.variants}) != len(self.variants)
        ):
            raise ValueError("Duplicate audio variants, pools or mismatched model type")
        selectors = {(row.source_plugin_uid, row.source_settings.model_dump_json()) for row in self.variants}
        if len(selectors) != len(self.variants):
            raise ValueError("Ambiguous audio source selector")
        for row in self.variants:
            validate_openai_audio_identity(
                adapter_id=row.parameter_adapter.id,
                source_provider=self.source.provider_id,
                source_model=self.source.model,
                source_plugin_unique_identifier=row.source_plugin_uid,
                model_type=self.source.model_type,
                target_model=row.target.model,
            )
            version = {
                "langgenius/openai:0.4.2@21195ee1321849e0a7d4b3f6b2fd8c2be23ea6c7182e1b444ecc4c1711b52468": "042",
                "langgenius/openai:1.1.0@95f7de6ee42124cb7649f20d3f175c5b0adb66ad92640a97e4027c15b266141c": "110",
                "langgenius/openai:1.1.0@1ded02acee56efd5788c86fd447d792e4923e959554a4942f440c7859d164340": "110-1ded",
            }[row.source_plugin_uid]
            slug = "tts" if self.source.model_type is ModelType.TTS else "stt"
            if (
                row.target.model_type is not self.source.model_type
                or row.source_profile_id != f"openai-audio-{version}-{slug}-runtime-v1:{self.source.model}"
            ):
                raise ValueError("Audio source profile identity changed")
        return self


class SourceAudioVariantSelection(_StrictModel):
    schema_version: Literal[4]
    variant_id: str = Field(min_length=1)
    source_plugin_uid: Literal[
        "langgenius/openai:0.4.2@21195ee1321849e0a7d4b3f6b2fd8c2be23ea6c7182e1b444ecc4c1711b52468",
        "langgenius/openai:1.1.0@95f7de6ee42124cb7649f20d3f175c5b0adb66ad92640a97e4027c15b266141c",
        "langgenius/openai:1.1.0@1ded02acee56efd5788c86fd447d792e4923e959554a4942f440c7859d164340",
    ]
    source_settings: AudioSourceSettings
    source_schema_digest: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    source_runtime_schema_digest: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    registry_digest: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")


@dataclass(frozen=True, slots=True)
class SelectedAudioSourceVariant:
    """Selected audio identity plus separately frozen endpoint classification."""

    envelope: SourceAudioVariantMapping
    variant: AudioSourceVariant
    registry_digest: str

    @property
    def mapping_revision(self) -> str:
        return self.envelope.mapping_revision

    @property
    def source(self) -> AudioMappingSource:
        return self.envelope.source

    @property
    def settlement_owner(self) -> Literal["shared_credit_pool"]:
        return self.envelope.settlement_owner

    @property
    def pool_types(self) -> list[Literal["paid", "trial"]]:
        return self.envelope.pool_types

    @property
    def source_schema_digest(self) -> str:
        return self.variant.source_schema_digest

    @property
    def parameter_adapter(self) -> AudioSourceAdapter:
        return self.variant.parameter_adapter

    @property
    def target(self) -> AudioMappingTarget:
        return self.variant.target

    @property
    def operations(self) -> list[str]:
        return self.variant.operations

    @property
    def conformance_fixture_ids(self) -> list[str]:
        return self.variant.conformance_fixture_ids
