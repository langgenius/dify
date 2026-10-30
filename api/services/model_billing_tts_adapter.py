"""Opt-in source TTS voice semantics, independent of transport and funding.

Only the reviewed immutable OpenAI1.0.8 dated mini-TTS source is supported.
The caller obtains a fresh UID-bound source schema and supplies its registry
digest; this policy does no I/O and never asks the routed target for defaults.
Identity mappings retain their original behavior. Target/native voice metadata
is neither changed nor inferred from these source rules.
"""

import hashlib
import hmac
import json
from dataclasses import dataclass

from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelPropertyKey, ModelType
from services.entities.model_billing_mapping import model_schema_digest

TTS_SOURCE_VOICE_ADAPTER_ID = "tts_source_voice_v1"
TTS_SOURCE_VOICE_ADAPTER_REVISION = "1"
REVIEWED_SOURCE_PROVIDER = "langgenius/openai/openai"
REVIEWED_SOURCE_MODEL = "gpt-4o-mini-tts-2025-12-15"
REVIEWED_SOURCE_PLUGIN_UID = "langgenius/openai:1.0.8@5676d8eb5d7df5784610e656f49f5fbdc48b81d106a17d8946d9966c1fe73f1b"


class TTSVoiceAdapterError(ValueError):
    """Unverified or inconsistent source voice contract; never include payloads."""


@dataclass(frozen=True, slots=True)
class TTSVoiceContract:
    """Immutable source evidence copied into one prepared invocation.

    default_voice is the reviewed source's resolved fallback (declared default,
    otherwise first voice). It is not the target provider's native default.
    """

    adapter_id: str
    algorithm_revision: str
    source_provider: str
    source_model: str
    source_plugin_unique_identifier: str
    source_schema_digest: str
    rules_digest: str
    voices: tuple[str, ...]
    default_voice: str


def _rules_digest(
    *,
    source_provider: str,
    source_model: str,
    source_plugin_unique_identifier: str,
    source_schema_digest: str,
    voices: tuple[str, ...],
    default_voice: str,
) -> str:
    payload = {
        "adapter_id": TTS_SOURCE_VOICE_ADAPTER_ID,
        "algorithm_revision": TTS_SOURCE_VOICE_ADAPTER_REVISION,
        "algorithm": "valid_voice_unchanged_else_source_default_or_first",
        "source_provider": source_provider,
        "source_model": source_model,
        "source_plugin_unique_identifier": source_plugin_unique_identifier,
        "source_schema_digest": source_schema_digest,
        "voices": list(voices),
        "default_voice": default_voice,
    }
    return (
        "sha256:"
        + hashlib.sha256(
            json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
        ).hexdigest()
    )


def _reviewed_contract(
    *,
    adapter_id: str,
    adapter_revision: str,
    source_provider: str,
    source_model: str,
    source_plugin_unique_identifier: str,
    source_schema: AIModelEntity,
    expected_source_schema_digest: str,
) -> TTSVoiceContract:
    if (
        adapter_id != TTS_SOURCE_VOICE_ADAPTER_ID
        or adapter_revision != TTS_SOURCE_VOICE_ADAPTER_REVISION
        or source_provider != REVIEWED_SOURCE_PROVIDER
        or source_model != REVIEWED_SOURCE_MODEL
        or source_plugin_unique_identifier != REVIEWED_SOURCE_PLUGIN_UID
        or source_schema.model_type != ModelType.TTS
        or source_schema.model != source_model
    ):
        raise TTSVoiceAdapterError("Unreviewed source TTS adapter binding")
    actual_digest = model_schema_digest(source_schema)
    if not hmac.compare_digest(actual_digest, expected_source_schema_digest):
        raise TTSVoiceAdapterError("Source TTS schema digest mismatch")
    declared_voices = source_schema.model_properties.get(ModelPropertyKey.VOICES)
    if not isinstance(declared_voices, list) or not declared_voices:
        raise TTSVoiceAdapterError("Source TTS voice contract is unavailable")
    values: list[str] = []
    for item in declared_voices:
        value = item.get("mode") if isinstance(item, dict) else None
        if not isinstance(value, str) or not value:
            raise TTSVoiceAdapterError("Source TTS voice contract is invalid")
        values.append(value)
    if len(set(values)) != len(values):
        raise TTSVoiceAdapterError("Source TTS voice contract is ambiguous")
    declared_default = source_schema.model_properties.get(ModelPropertyKey.DEFAULT_VOICE)
    if declared_default is not None and not isinstance(declared_default, str):
        raise TTSVoiceAdapterError("Source TTS default voice is invalid")
    # Exact reviewed source uses `declared_default or voices[0]["value"]`.
    fallback = declared_default or values[0]
    if fallback not in values:
        raise TTSVoiceAdapterError("Source TTS default voice is not declared")
    voices = tuple(values)
    rules_digest = _rules_digest(
        source_provider=source_provider,
        source_model=source_model,
        source_plugin_unique_identifier=source_plugin_unique_identifier,
        source_schema_digest=actual_digest,
        voices=voices,
        default_voice=fallback,
    )
    return TTSVoiceContract(
        adapter_id=adapter_id,
        algorithm_revision=adapter_revision,
        source_provider=source_provider,
        source_model=source_model,
        source_plugin_unique_identifier=source_plugin_unique_identifier,
        source_schema_digest=actual_digest,
        rules_digest=rules_digest,
        voices=voices,
        default_voice=fallback,
    )


def tts_source_voice_rules_digest(
    *,
    adapter_id: str,
    adapter_revision: str,
    source_provider: str,
    source_model: str,
    source_plugin_unique_identifier: str,
    source_schema: AIModelEntity,
    expected_source_schema_digest: str,
) -> str:
    """Generate an exact rules digest for an operator-reviewed new revision."""
    return _reviewed_contract(
        adapter_id=adapter_id,
        adapter_revision=adapter_revision,
        source_provider=source_provider,
        source_model=source_model,
        source_plugin_unique_identifier=source_plugin_unique_identifier,
        source_schema=source_schema,
        expected_source_schema_digest=expected_source_schema_digest,
    ).rules_digest


def build_tts_voice_contract(
    *,
    adapter_id: str,
    adapter_revision: str,
    expected_rules_digest: str,
    source_provider: str,
    source_model: str,
    source_plugin_unique_identifier: str,
    source_schema: AIModelEntity,
    expected_source_schema_digest: str,
) -> TTSVoiceContract | None:
    """None means identity_v1: no normalization, including older TTS revisions."""
    if adapter_id == "identity_v1":
        return None
    contract = _reviewed_contract(
        adapter_id=adapter_id,
        adapter_revision=adapter_revision,
        source_provider=source_provider,
        source_model=source_model,
        source_plugin_unique_identifier=source_plugin_unique_identifier,
        source_schema=source_schema,
        expected_source_schema_digest=expected_source_schema_digest,
    )
    if not hmac.compare_digest(contract.rules_digest, expected_rules_digest):
        raise TTSVoiceAdapterError("Source TTS adapter rules digest mismatch")
    return contract


def normalize_tts_voice(contract: TTSVoiceContract, voice: str) -> str:
    """Normalize only with frozen reviewed source evidence; never mutate it."""
    if (
        contract.adapter_id != TTS_SOURCE_VOICE_ADAPTER_ID
        or contract.algorithm_revision != TTS_SOURCE_VOICE_ADAPTER_REVISION
        or contract.source_provider != REVIEWED_SOURCE_PROVIDER
        or contract.source_model != REVIEWED_SOURCE_MODEL
        or contract.source_plugin_unique_identifier != REVIEWED_SOURCE_PLUGIN_UID
        or not contract.voices
        or contract.default_voice not in contract.voices
        or not isinstance(voice, str)
    ):
        raise TTSVoiceAdapterError("Invalid prepared source TTS voice contract")
    expected = _rules_digest(
        source_provider=contract.source_provider,
        source_model=contract.source_model,
        source_plugin_unique_identifier=contract.source_plugin_unique_identifier,
        source_schema_digest=contract.source_schema_digest,
        voices=contract.voices,
        default_voice=contract.default_voice,
    )
    if not hmac.compare_digest(contract.rules_digest, expected):
        raise TTSVoiceAdapterError("Prepared source TTS voice rules changed")
    return voice if voice in contract.voices else contract.default_voice
