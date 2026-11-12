"""Pure finite source TTS/STT evidence policy; no I/O or credential access.

One reviewed profile per positive source/model pair permits both positive
endpoint classes. The unchanged six-field marker does NOT bind an endpoint.
The registry selection and private current source facts must independently
match the exact endpoint class, including the pre-reserve recheck. Never infer
that fact from a marker, missing settings, a model name or a native credential.
"""

from __future__ import annotations

import hmac
import re
from dataclasses import dataclass
from typing import Literal, TypeGuard

from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelType
from services.entities.model_billing_mapping import (
    SourceParameterContract,
    model_schema_digest,
)

OPENAI_TTS_SOURCE_ADAPTER_ID = "openai_tts_source_v1"
OPENAI_STT_SOURCE_ADAPTER_ID = "openai_stt_source_v1"
OPENAI_AUDIO_SOURCE_ADAPTER_REVISION = "1"
OPENAI_AUDIO_SOURCE_PROVIDER = "langgenius/openai/openai"
OPENAI_AUDIO_ARTIFACT_SOURCE_UID = (
    "langgenius/openai:1.1.0@1ded02acee56efd5788c86fd447d792e4923e959554a4942f440c7859d164340"
)
OPENAI_AUDIO_SOURCE_UIDS: dict[Literal["042", "110"], str] = {
    "042": "langgenius/openai:0.4.2@21195ee1321849e0a7d4b3f6b2fd8c2be23ea6c7182e1b444ecc4c1711b52468",
    "110": "langgenius/openai:1.1.0@95f7de6ee42124cb7649f20d3f175c5b0adb66ad92640a97e4027c15b266141c",
}
OPENAI_AUDIO_SOURCE_MODELS = frozenset(
    {
        "gpt-4o-mini-transcribe",
        "gpt-4o-mini-transcribe-2025-12-15",
        "gpt-4o-mini-tts-2025-12-15",
        "gpt-4o-transcribe",
        "gpt-4o-transcribe-diarize",
        "tts-1",
        "tts-1-hd",
        "whisper-1",
    }
)
_TTS_MODELS = frozenset({"gpt-4o-mini-tts-2025-12-15", "tts-1", "tts-1-hd"})
_NONE042 = frozenset(
    {
        "gpt-4o-mini-transcribe-2025-12-15",
        "gpt-4o-mini-tts-2025-12-15",
        "gpt-4o-transcribe-diarize",
    }
)


class OpenAIAudioSourceAdapterError(ValueError):
    """Secret-free denial of unreviewed/mismatched exact-source facts."""


@dataclass(frozen=True, slots=True)
class SourceAudioSettings:
    """Explicit positive facts; raw flags and nullable guesses do not belong here."""

    source_endpoint_class: Literal["unset", "official_root"]
    api_protocol_behavior: Literal["not_used"]
    request_metadata_behavior: Literal["not_used"]

    def __post_init__(self) -> None:
        validate_openai_audio_settings(self)


@dataclass(frozen=True, slots=True)
class OpenAIAudioSourceContract(SourceParameterContract):
    """Exact reviewed audio profile, not routing authority merely by its type."""


# Exact canonical rules from the new thirteen-profile document. Neither a
# runtime document loader nor a caller registration can extend this table.
_PROFILE_DOCUMENT_RAW_SHA256 = "6ac3b8cda4e7b9d44d8218c1a1397d656aca0092836eed6bf39a60178f27c9d5"
_REVIEWED_CONTRACTS = (
    OpenAIAudioSourceContract(
        profile_id="openai-audio-042-stt-runtime-v1:gpt-4o-mini-transcribe",
        source_plugin_unique_identifier="langgenius/openai:0.4.2@21195ee1321849e0a7d4b3f6b2fd8c2be23ea6c7182e1b444ecc4c1711b52468",
        source_model="gpt-4o-mini-transcribe",
        source_schema_digest="sha256:d5068efeab303d9c9b3069c340399a2b073692a62165ab0e6d45171ac61540a3",
        source_runtime_schema_digest="sha256:d5068efeab303d9c9b3069c340399a2b073692a62165ab0e6d45171ac61540a3",
        target_model="gpt-4o-mini-transcribe",
        rules_digest="sha256:6d27c4fda3ca3b4df001c23671cb13afd8cb92212830017676ce7320cf4bd4f0",
        adapter_id="openai_stt_source_v1",
        algorithm_revision="1",
    ),
    OpenAIAudioSourceContract(
        profile_id="openai-audio-042-stt-runtime-v1:gpt-4o-transcribe",
        source_plugin_unique_identifier="langgenius/openai:0.4.2@21195ee1321849e0a7d4b3f6b2fd8c2be23ea6c7182e1b444ecc4c1711b52468",
        source_model="gpt-4o-transcribe",
        source_schema_digest="sha256:4954f8df114cf53b275da42a71f58a645ca702f5423c6cdde49c2bfab48c5c85",
        source_runtime_schema_digest="sha256:4954f8df114cf53b275da42a71f58a645ca702f5423c6cdde49c2bfab48c5c85",
        target_model="gpt-4o-transcribe",
        rules_digest="sha256:a8a96d76fbdaec5b3ea3ba0adf203670e1cc035062ac7cb3d9b6870ecc275979",
        adapter_id="openai_stt_source_v1",
        algorithm_revision="1",
    ),
    OpenAIAudioSourceContract(
        profile_id="openai-audio-042-tts-runtime-v1:tts-1",
        source_plugin_unique_identifier="langgenius/openai:0.4.2@21195ee1321849e0a7d4b3f6b2fd8c2be23ea6c7182e1b444ecc4c1711b52468",
        source_model="tts-1",
        source_schema_digest="sha256:034a3169762889667eb719bc4f34f7a626235fb2349e87dfe4afb7846d2f8f8f",
        source_runtime_schema_digest="sha256:034a3169762889667eb719bc4f34f7a626235fb2349e87dfe4afb7846d2f8f8f",
        target_model="tts-1",
        rules_digest="sha256:1163885fbd63e1f25b48be8cc4be6f1b73a61285c241342cbf48527ab4546859",
        adapter_id="openai_tts_source_v1",
        algorithm_revision="1",
    ),
    OpenAIAudioSourceContract(
        profile_id="openai-audio-042-tts-runtime-v1:tts-1-hd",
        source_plugin_unique_identifier="langgenius/openai:0.4.2@21195ee1321849e0a7d4b3f6b2fd8c2be23ea6c7182e1b444ecc4c1711b52468",
        source_model="tts-1-hd",
        source_schema_digest="sha256:5e9c1c3301d9f85230fe5d98319ac9c050f322686d9eb7eb962918213d393b85",
        source_runtime_schema_digest="sha256:5e9c1c3301d9f85230fe5d98319ac9c050f322686d9eb7eb962918213d393b85",
        target_model="tts-1-hd",
        rules_digest="sha256:a6c8b53b421c7539fd23301ff13bd1b9625e6a97eacdda09a057b58e3e0a880b",
        adapter_id="openai_tts_source_v1",
        algorithm_revision="1",
    ),
    OpenAIAudioSourceContract(
        profile_id="openai-audio-042-stt-runtime-v1:whisper-1",
        source_plugin_unique_identifier="langgenius/openai:0.4.2@21195ee1321849e0a7d4b3f6b2fd8c2be23ea6c7182e1b444ecc4c1711b52468",
        source_model="whisper-1",
        source_schema_digest="sha256:ff1b5d7a2a2a148d2a258f9616ec2b2b562a3eca8536e012e11741240d2baf96",
        source_runtime_schema_digest="sha256:ff1b5d7a2a2a148d2a258f9616ec2b2b562a3eca8536e012e11741240d2baf96",
        target_model="whisper-1",
        rules_digest="sha256:dbb778109473ece9b5b4cb1e022b58ba47eeeb9a9a167d9c8baa4729e12d0d17",
        adapter_id="openai_stt_source_v1",
        algorithm_revision="1",
    ),
    OpenAIAudioSourceContract(
        profile_id="openai-audio-110-stt-runtime-v1:gpt-4o-mini-transcribe",
        source_plugin_unique_identifier="langgenius/openai:1.1.0@95f7de6ee42124cb7649f20d3f175c5b0adb66ad92640a97e4027c15b266141c",
        source_model="gpt-4o-mini-transcribe",
        source_schema_digest="sha256:d5068efeab303d9c9b3069c340399a2b073692a62165ab0e6d45171ac61540a3",
        source_runtime_schema_digest="sha256:d5068efeab303d9c9b3069c340399a2b073692a62165ab0e6d45171ac61540a3",
        target_model="gpt-4o-mini-transcribe",
        rules_digest="sha256:72183fb8a3a9cfaa1da32cf0b9d4df61170cb98586d2ee630fd681aa10c0c10d",
        adapter_id="openai_stt_source_v1",
        algorithm_revision="1",
    ),
    OpenAIAudioSourceContract(
        profile_id="openai-audio-110-stt-runtime-v1:gpt-4o-mini-transcribe-2025-12-15",
        source_plugin_unique_identifier="langgenius/openai:1.1.0@95f7de6ee42124cb7649f20d3f175c5b0adb66ad92640a97e4027c15b266141c",
        source_model="gpt-4o-mini-transcribe-2025-12-15",
        source_schema_digest="sha256:5eb68970739004f64a281a8fd5c1087efe357e95ec185dcf3b88d6031000449f",
        source_runtime_schema_digest="sha256:5eb68970739004f64a281a8fd5c1087efe357e95ec185dcf3b88d6031000449f",
        target_model="gpt-4o-mini-transcribe-2025-12-15",
        rules_digest="sha256:585dfde093ff4f3df6c8f92ea1524459b607a32f0590bda2661564e63c2170ed",
        adapter_id="openai_stt_source_v1",
        algorithm_revision="1",
    ),
    OpenAIAudioSourceContract(
        profile_id="openai-audio-110-tts-runtime-v1:gpt-4o-mini-tts-2025-12-15",
        source_plugin_unique_identifier="langgenius/openai:1.1.0@95f7de6ee42124cb7649f20d3f175c5b0adb66ad92640a97e4027c15b266141c",
        source_model="gpt-4o-mini-tts-2025-12-15",
        source_schema_digest="sha256:c2655154bee21e8e1f1d926e742847f0a622676d222a45c560803e848e4a0928",
        source_runtime_schema_digest="sha256:c2655154bee21e8e1f1d926e742847f0a622676d222a45c560803e848e4a0928",
        target_model="gpt-4o-mini-tts-2025-12-15",
        rules_digest="sha256:9c4be556933f8e1a40926d1e522ab4deaf7e3f656a8321a8c30b18dc92bc2c15",
        adapter_id="openai_tts_source_v1",
        algorithm_revision="1",
    ),
    OpenAIAudioSourceContract(
        profile_id="openai-audio-110-stt-runtime-v1:gpt-4o-transcribe",
        source_plugin_unique_identifier="langgenius/openai:1.1.0@95f7de6ee42124cb7649f20d3f175c5b0adb66ad92640a97e4027c15b266141c",
        source_model="gpt-4o-transcribe",
        source_schema_digest="sha256:4954f8df114cf53b275da42a71f58a645ca702f5423c6cdde49c2bfab48c5c85",
        source_runtime_schema_digest="sha256:4954f8df114cf53b275da42a71f58a645ca702f5423c6cdde49c2bfab48c5c85",
        target_model="gpt-4o-transcribe",
        rules_digest="sha256:0078f630c41b6838b2a6a0779413a2de06177c1651d49222c7dea0d9eb4953fa",
        adapter_id="openai_stt_source_v1",
        algorithm_revision="1",
    ),
    OpenAIAudioSourceContract(
        profile_id="openai-audio-110-stt-runtime-v1:gpt-4o-transcribe-diarize",
        source_plugin_unique_identifier="langgenius/openai:1.1.0@95f7de6ee42124cb7649f20d3f175c5b0adb66ad92640a97e4027c15b266141c",
        source_model="gpt-4o-transcribe-diarize",
        source_schema_digest="sha256:f255fa546661d957977d13b09fe717a4166f4745f63d50b1c8b2b7813368294c",
        source_runtime_schema_digest="sha256:f255fa546661d957977d13b09fe717a4166f4745f63d50b1c8b2b7813368294c",
        target_model="gpt-4o-transcribe-diarize",
        rules_digest="sha256:559b1b06acabdf786f7258eb3563dae3bfaecf7f9cd375e94c5ff69541150d9d",
        adapter_id="openai_stt_source_v1",
        algorithm_revision="1",
    ),
    OpenAIAudioSourceContract(
        profile_id="openai-audio-110-tts-runtime-v1:tts-1",
        source_plugin_unique_identifier="langgenius/openai:1.1.0@95f7de6ee42124cb7649f20d3f175c5b0adb66ad92640a97e4027c15b266141c",
        source_model="tts-1",
        source_schema_digest="sha256:4368f72c4ff64235d8e2b8c18085eda762613270002428a7487af785353e1367",
        source_runtime_schema_digest="sha256:4368f72c4ff64235d8e2b8c18085eda762613270002428a7487af785353e1367",
        target_model="tts-1",
        rules_digest="sha256:49974bd6edffdbd641ecf02b84614626e77d420da6d3cb7b92637ff3e3cb7d7c",
        adapter_id="openai_tts_source_v1",
        algorithm_revision="1",
    ),
    OpenAIAudioSourceContract(
        profile_id="openai-audio-110-tts-runtime-v1:tts-1-hd",
        source_plugin_unique_identifier="langgenius/openai:1.1.0@95f7de6ee42124cb7649f20d3f175c5b0adb66ad92640a97e4027c15b266141c",
        source_model="tts-1-hd",
        source_schema_digest="sha256:449b7ee4c0fbbb61c8641c56d6092d1331a54595013a7102e22e85c5e88fb126",
        source_runtime_schema_digest="sha256:449b7ee4c0fbbb61c8641c56d6092d1331a54595013a7102e22e85c5e88fb126",
        target_model="tts-1-hd",
        rules_digest="sha256:2be5957f9e1a85415fdd6ad28b5fde17c8a7e4f522cb6df5c562bdd8833f6ac1",
        adapter_id="openai_tts_source_v1",
        algorithm_revision="1",
    ),
    OpenAIAudioSourceContract(
        profile_id="openai-audio-110-stt-runtime-v1:whisper-1",
        source_plugin_unique_identifier="langgenius/openai:1.1.0@95f7de6ee42124cb7649f20d3f175c5b0adb66ad92640a97e4027c15b266141c",
        source_model="whisper-1",
        source_schema_digest="sha256:ff1b5d7a2a2a148d2a258f9616ec2b2b562a3eca8536e012e11741240d2baf96",
        source_runtime_schema_digest="sha256:ff1b5d7a2a2a148d2a258f9616ec2b2b562a3eca8536e012e11741240d2baf96",
        target_model="whisper-1",
        rules_digest="sha256:804c25b03bd955bf54b273416c6d3097c7ad0b226bad475b5a5bf257b2686634",
        adapter_id="openai_stt_source_v1",
        algorithm_revision="1",
    ),
)


# Separate exact signed artifact; historical tuples above remain immutable.
_ARTIFACT_REVIEWED_CONTRACTS = (
    OpenAIAudioSourceContract(
        profile_id="openai-audio-110-1ded-stt-runtime-v1:gpt-4o-mini-transcribe",
        source_plugin_unique_identifier="langgenius/openai:1.1.0@1ded02acee56efd5788c86fd447d792e4923e959554a4942f440c7859d164340",
        source_model="gpt-4o-mini-transcribe",
        source_schema_digest="sha256:d5068efeab303d9c9b3069c340399a2b073692a62165ab0e6d45171ac61540a3",
        source_runtime_schema_digest="sha256:d5068efeab303d9c9b3069c340399a2b073692a62165ab0e6d45171ac61540a3",
        target_model="gpt-4o-mini-transcribe",
        rules_digest="sha256:6bca34fb26ae0fde4ca728c243059687316cae47f1bb6380d84cfda90d253f39",
        adapter_id="openai_stt_source_v1",
        algorithm_revision="1",
    ),
    OpenAIAudioSourceContract(
        profile_id="openai-audio-110-1ded-stt-runtime-v1:gpt-4o-mini-transcribe-2025-12-15",
        source_plugin_unique_identifier="langgenius/openai:1.1.0@1ded02acee56efd5788c86fd447d792e4923e959554a4942f440c7859d164340",
        source_model="gpt-4o-mini-transcribe-2025-12-15",
        source_schema_digest="sha256:5eb68970739004f64a281a8fd5c1087efe357e95ec185dcf3b88d6031000449f",
        source_runtime_schema_digest="sha256:5eb68970739004f64a281a8fd5c1087efe357e95ec185dcf3b88d6031000449f",
        target_model="gpt-4o-mini-transcribe-2025-12-15",
        rules_digest="sha256:b4b3da5deec887b263f6655bc65f36be2180d40b499bf5c21e7e658f886f682c",
        adapter_id="openai_stt_source_v1",
        algorithm_revision="1",
    ),
    OpenAIAudioSourceContract(
        profile_id="openai-audio-110-1ded-tts-runtime-v1:gpt-4o-mini-tts-2025-12-15",
        source_plugin_unique_identifier="langgenius/openai:1.1.0@1ded02acee56efd5788c86fd447d792e4923e959554a4942f440c7859d164340",
        source_model="gpt-4o-mini-tts-2025-12-15",
        source_schema_digest="sha256:c2655154bee21e8e1f1d926e742847f0a622676d222a45c560803e848e4a0928",
        source_runtime_schema_digest="sha256:c2655154bee21e8e1f1d926e742847f0a622676d222a45c560803e848e4a0928",
        target_model="gpt-4o-mini-tts-2025-12-15",
        rules_digest="sha256:4a48dc36ce1f8a3b8067227d735e797d878b8b8d5f4c524ad868a033e0283c66",
        adapter_id="openai_tts_source_v1",
        algorithm_revision="1",
    ),
    OpenAIAudioSourceContract(
        profile_id="openai-audio-110-1ded-stt-runtime-v1:gpt-4o-transcribe",
        source_plugin_unique_identifier="langgenius/openai:1.1.0@1ded02acee56efd5788c86fd447d792e4923e959554a4942f440c7859d164340",
        source_model="gpt-4o-transcribe",
        source_schema_digest="sha256:4954f8df114cf53b275da42a71f58a645ca702f5423c6cdde49c2bfab48c5c85",
        source_runtime_schema_digest="sha256:4954f8df114cf53b275da42a71f58a645ca702f5423c6cdde49c2bfab48c5c85",
        target_model="gpt-4o-transcribe",
        rules_digest="sha256:d7cea996b55272c3f6be78c24ff03bec46c9dea51a5eb1365e199805b5656f0a",
        adapter_id="openai_stt_source_v1",
        algorithm_revision="1",
    ),
    OpenAIAudioSourceContract(
        profile_id="openai-audio-110-1ded-stt-runtime-v1:gpt-4o-transcribe-diarize",
        source_plugin_unique_identifier="langgenius/openai:1.1.0@1ded02acee56efd5788c86fd447d792e4923e959554a4942f440c7859d164340",
        source_model="gpt-4o-transcribe-diarize",
        source_schema_digest="sha256:f255fa546661d957977d13b09fe717a4166f4745f63d50b1c8b2b7813368294c",
        source_runtime_schema_digest="sha256:f255fa546661d957977d13b09fe717a4166f4745f63d50b1c8b2b7813368294c",
        target_model="gpt-4o-transcribe-diarize",
        rules_digest="sha256:3919b0b8ed5df6bfada310a857de4ad1a9b75f3c535852e73a8ac832266be7d3",
        adapter_id="openai_stt_source_v1",
        algorithm_revision="1",
    ),
    OpenAIAudioSourceContract(
        profile_id="openai-audio-110-1ded-tts-runtime-v1:tts-1",
        source_plugin_unique_identifier="langgenius/openai:1.1.0@1ded02acee56efd5788c86fd447d792e4923e959554a4942f440c7859d164340",
        source_model="tts-1",
        source_schema_digest="sha256:4368f72c4ff64235d8e2b8c18085eda762613270002428a7487af785353e1367",
        source_runtime_schema_digest="sha256:4368f72c4ff64235d8e2b8c18085eda762613270002428a7487af785353e1367",
        target_model="tts-1",
        rules_digest="sha256:6c07c99aadcb106700df530a5aa741ef07389e62a73431e26d3afe75e830c508",
        adapter_id="openai_tts_source_v1",
        algorithm_revision="1",
    ),
    OpenAIAudioSourceContract(
        profile_id="openai-audio-110-1ded-tts-runtime-v1:tts-1-hd",
        source_plugin_unique_identifier="langgenius/openai:1.1.0@1ded02acee56efd5788c86fd447d792e4923e959554a4942f440c7859d164340",
        source_model="tts-1-hd",
        source_schema_digest="sha256:449b7ee4c0fbbb61c8641c56d6092d1331a54595013a7102e22e85c5e88fb126",
        source_runtime_schema_digest="sha256:449b7ee4c0fbbb61c8641c56d6092d1331a54595013a7102e22e85c5e88fb126",
        target_model="tts-1-hd",
        rules_digest="sha256:060e34e3467f8b2ad3eed7b1503d8e7dc412d955b984da5a90b1422df69d986c",
        adapter_id="openai_tts_source_v1",
        algorithm_revision="1",
    ),
    OpenAIAudioSourceContract(
        profile_id="openai-audio-110-1ded-stt-runtime-v1:whisper-1",
        source_plugin_unique_identifier="langgenius/openai:1.1.0@1ded02acee56efd5788c86fd447d792e4923e959554a4942f440c7859d164340",
        source_model="whisper-1",
        source_schema_digest="sha256:ff1b5d7a2a2a148d2a258f9616ec2b2b562a3eca8536e012e11741240d2baf96",
        source_runtime_schema_digest="sha256:ff1b5d7a2a2a148d2a258f9616ec2b2b562a3eca8536e012e11741240d2baf96",
        target_model="whisper-1",
        rules_digest="sha256:5f822bb1653181ab4a0cf0fb4c92bc9158171c7889a574513bc304fee6b72822",
        adapter_id="openai_stt_source_v1",
        algorithm_revision="1",
    ),
)
_ALL_REVIEWED_CONTRACTS = (*_REVIEWED_CONTRACTS, *_ARTIFACT_REVIEWED_CONTRACTS)


def validate_openai_audio_settings(settings: SourceAudioSettings) -> None:
    endpoint = getattr(settings, "source_endpoint_class", None)
    protocol = getattr(settings, "api_protocol_behavior", None)
    metadata = getattr(settings, "request_metadata_behavior", None)
    if (
        type(settings) is not SourceAudioSettings
        or type(endpoint) is not str
        or endpoint not in {"unset", "official_root"}
        or type(protocol) is not str
        or protocol != "not_used"
        or type(metadata) is not str
        or metadata != "not_used"
    ):
        raise OpenAIAudioSourceAdapterError("OpenAI audio source settings are not reviewed")


def _version(uid: str) -> Literal["042", "110"]:
    if type(uid) is str:
        if uid == OPENAI_AUDIO_ARTIFACT_SOURCE_UID:
            return "110"
        for version, expected in OPENAI_AUDIO_SOURCE_UIDS.items():
            if uid == expected:
                return version
    raise OpenAIAudioSourceAdapterError("OpenAI audio source UID is not reviewed")


def _kind(adapter_id: str) -> ModelType:
    if type(adapter_id) is str:
        if adapter_id == OPENAI_TTS_SOURCE_ADAPTER_ID:
            return ModelType.TTS
        if adapter_id == OPENAI_STT_SOURCE_ADAPTER_ID:
            return ModelType.SPEECH2TEXT
    raise OpenAIAudioSourceAdapterError("OpenAI audio adapter family is not reviewed")


def validate_openai_audio_identity(
    *,
    adapter_id: str,
    source_provider: str,
    source_model: str,
    source_plugin_unique_identifier: str,
    model_type: ModelType,
    target_model: str,
) -> None:
    version = _version(source_plugin_unique_identifier)
    expected_type = _kind(adapter_id)
    if (
        type(source_provider) is not str
        or source_provider != OPENAI_AUDIO_SOURCE_PROVIDER
        or type(source_model) is not str
        or source_model not in OPENAI_AUDIO_SOURCE_MODELS
        or version == "042"
        and source_model in _NONE042
        or model_type is not expected_type
        or (source_model in _TTS_MODELS) != (expected_type is ModelType.TTS)
        or type(target_model) is not str
        or target_model != source_model
    ):
        raise OpenAIAudioSourceAdapterError("OpenAI audio source identity is not reviewed")


def _digest_string(value: object) -> TypeGuard[str]:
    return type(value) is str and re.fullmatch(r"sha256:[0-9a-f]{64}", value) is not None


def _schema_digest(schema: AIModelEntity, source_model: str, model_type: ModelType) -> str:
    if (
        not isinstance(schema, AIModelEntity)
        or type(schema.model) is not str
        or schema.model != source_model
        or schema.model_type is not model_type
    ):
        raise OpenAIAudioSourceAdapterError("OpenAI audio schema identity does not match")
    # TTS/STT schemas do not acquire an artificial LLM chat-mode requirement.
    try:
        return model_schema_digest(schema)
    except (AttributeError, TypeError, ValueError):
        raise OpenAIAudioSourceAdapterError("OpenAI audio schema is not reviewed") from None


def _profile_id(source_model: str, uid: str, adapter_id: str) -> str:
    version = _version(uid)
    kind = "tts" if _kind(adapter_id) is ModelType.TTS else "stt"
    artifact = "-1ded" if uid == OPENAI_AUDIO_ARTIFACT_SOURCE_UID else ""
    return f"openai-audio-{version}{artifact}-{kind}-runtime-v1:{source_model}"


def _runtime_pin(
    contract: OpenAIAudioSourceContract,
    *,
    expected_source_runtime_schema_digest: str,
    source_runtime_schema: AIModelEntity | None,
) -> None:
    if (
        not _digest_string(expected_source_runtime_schema_digest)
        or not _digest_string(contract.source_runtime_schema_digest)
        or not hmac.compare_digest(expected_source_runtime_schema_digest, contract.source_runtime_schema_digest)
    ):
        raise OpenAIAudioSourceAdapterError("OpenAI audio runtime pin does not match")
    # None means prospective construction only, never an observed runtime RPC.
    if source_runtime_schema is not None and not hmac.compare_digest(
        _schema_digest(source_runtime_schema, contract.source_model, _kind(contract.adapter_id)),
        expected_source_runtime_schema_digest,
    ):
        raise OpenAIAudioSourceAdapterError("OpenAI audio runtime schema does not match")


def openai_audio_source_marker(
    contract: OpenAIAudioSourceContract,
    *,
    source_provider: str,
    source_model: str,
    model_type: ModelType,
    target_model: str,
) -> dict[str, object]:
    if type(contract) is not OpenAIAudioSourceContract or contract not in _ALL_REVIEWED_CONTRACTS:
        raise OpenAIAudioSourceAdapterError("Unreviewed frozen OpenAI audio source contract")
    validate_openai_audio_identity(
        adapter_id=contract.adapter_id,
        source_provider=source_provider,
        source_model=source_model,
        source_plugin_unique_identifier=contract.source_plugin_unique_identifier,
        model_type=model_type,
        target_model=target_model,
    )
    if source_model != contract.source_model or target_model != contract.target_model:
        raise OpenAIAudioSourceAdapterError("OpenAI audio contract identity does not match")
    return {
        "schema_version": 1,
        "profile_id": contract.profile_id,
        "source_plugin_uid": contract.source_plugin_unique_identifier,
        "source_model": contract.source_model,
        "source_schema_digest": contract.source_schema_digest,
        "rules_digest": contract.rules_digest,
    }


def build_openai_audio_source_contract(
    *,
    adapter_id: str,
    adapter_revision: str,
    expected_rules_digest: str,
    source_provider: str,
    source_model: str,
    source_plugin_unique_identifier: str,
    source_schema: AIModelEntity,
    expected_source_schema_digest: str,
    expected_source_runtime_schema_digest: str,
    target_model: str,
    source_settings: SourceAudioSettings,
    source_runtime_schema: AIModelEntity | None = None,
) -> OpenAIAudioSourceContract:
    validate_openai_audio_settings(source_settings)
    kind = _kind(adapter_id)
    validate_openai_audio_identity(
        adapter_id=adapter_id,
        source_provider=source_provider,
        source_model=source_model,
        source_plugin_unique_identifier=source_plugin_unique_identifier,
        model_type=kind,
        target_model=target_model,
    )
    actual_catalog_digest = _schema_digest(source_schema, source_model, kind)
    profile = _profile_id(source_model, source_plugin_unique_identifier, adapter_id)
    contract = next(
        (
            c
            for c in _ALL_REVIEWED_CONTRACTS
            if c.profile_id == profile and c.source_plugin_unique_identifier == source_plugin_unique_identifier
        ),
        None,
    )
    if (
        contract is None
        or type(adapter_revision) is not str
        or adapter_revision != OPENAI_AUDIO_SOURCE_ADAPTER_REVISION
        or contract.algorithm_revision != adapter_revision
        or contract.adapter_id != adapter_id
        or contract.source_plugin_unique_identifier != source_plugin_unique_identifier
        or not _digest_string(expected_rules_digest)
        or not _digest_string(expected_source_schema_digest)
        or not hmac.compare_digest(expected_rules_digest, contract.rules_digest)
        or not hmac.compare_digest(actual_catalog_digest, expected_source_schema_digest)
        or not hmac.compare_digest(actual_catalog_digest, contract.source_schema_digest)
    ):
        raise OpenAIAudioSourceAdapterError("OpenAI audio source evidence does not match")
    _runtime_pin(
        contract,
        expected_source_runtime_schema_digest=expected_source_runtime_schema_digest,
        source_runtime_schema=source_runtime_schema,
    )
    openai_audio_source_marker(
        contract,
        source_provider=source_provider,
        source_model=source_model,
        model_type=kind,
        target_model=target_model,
    )
    return contract


def restore_openai_audio_source_contract(
    marker: object,
    *,
    source_provider: str,
    source_model: str,
    model_type: ModelType,
    target_model: str,
    source_settings: SourceAudioSettings,
    expected_source_runtime_schema_digest: str,
    source_runtime_schema: AIModelEntity | None = None,
) -> OpenAIAudioSourceContract:
    validate_openai_audio_settings(source_settings)
    keys = {
        "schema_version",
        "profile_id",
        "source_plugin_uid",
        "source_model",
        "source_schema_digest",
        "rules_digest",
    }
    if (
        type(marker) is not dict
        or set(marker) != keys
        or type(marker["schema_version"]) is not int
        or marker["schema_version"] != 1
        or any(type(v) is not str for k, v in marker.items() if k != "schema_version")
    ):
        raise OpenAIAudioSourceAdapterError("Invalid frozen OpenAI audio source marker")
    contract = next(
        (
            c
            for c in _ALL_REVIEWED_CONTRACTS
            if c.profile_id == marker["profile_id"] and c.source_plugin_unique_identifier == marker["source_plugin_uid"]
        ),
        None,
    )
    if contract is None:
        raise OpenAIAudioSourceAdapterError("Invalid frozen OpenAI audio source marker")
    expected = openai_audio_source_marker(
        contract,
        source_provider=source_provider,
        source_model=source_model,
        model_type=model_type,
        target_model=target_model,
    )
    if (
        not _digest_string(marker["rules_digest"])
        or not _digest_string(marker["source_schema_digest"])
        or not hmac.compare_digest(marker["rules_digest"], contract.rules_digest)
        or not hmac.compare_digest(marker["source_schema_digest"], contract.source_schema_digest)
        or any(marker[k] != expected[k] for k in keys - {"rules_digest", "source_schema_digest"})
    ):
        raise OpenAIAudioSourceAdapterError("Invalid frozen OpenAI audio source marker")
    _runtime_pin(
        contract,
        expected_source_runtime_schema_digest=expected_source_runtime_schema_digest,
        source_runtime_schema=source_runtime_schema,
    )
    return contract
