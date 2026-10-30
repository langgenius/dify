import pytest
from pydantic import ValidationError

from graphon.model_runtime.entities.model_entities import ModelType
from services.entities.model_billing_mapping import MappingSource, MappingTarget, ModelMapping, ParameterAdapter


@pytest.mark.parametrize(
    ("adapter", "revision", "source_type", "target_type", "accepted"),
    [
        ("tts_source_voice_v1", "1", ModelType.TTS, ModelType.TTS, True),
        ("tts_source_voice_v1", "2", ModelType.TTS, ModelType.TTS, False),
        ("tts_source_voice_v1", "1", ModelType.LLM, ModelType.TTS, False),
        ("tts_source_voice_v1", "1", ModelType.TTS, ModelType.LLM, False),
        ("identity_v1", "old", ModelType.TTS, ModelType.TTS, True),
        ("identity_v1", "old", ModelType.LLM, ModelType.LLM, True),
        ("not-reviewed", "1", ModelType.TTS, ModelType.TTS, False),
    ],
)
def test_voice_adapter_is_versioned_and_tts_only(
    adapter: str, revision: str, source_type: ModelType, target_type: ModelType, accepted: bool
) -> None:
    def parse() -> ModelMapping:
        return ModelMapping(
            schema_version=1,
            mapping_revision="new-immutable-revision",
            source=MappingSource(
                provider_id="langgenius/openai/openai", model_type=source_type, model="model", mode=source_type.value
            ),
            source_schema_digest="sha256:" + "a" * 64,
            settlement_owner="shared_credit_pool",
            pool_types=["paid"],
            target=MappingTarget(
                plugin_id="langgenius/tokener",
                provider="tokener",
                model_type=target_type,
                model="model",
                catalog_revision="catalog",
                minimum_plugin_version="0.4.3",
            ),
            parameter_adapter=ParameterAdapter.model_validate(
                {"id": adapter, "revision": revision, "rules_digest": "sha256:" + "b" * 64}
            ),
            operations=["tts/invoke"],
            conformance_fixture_ids=["reviewed-fixture"],
        )

    if accepted:
        assert parse().parameter_adapter.id == adapter
    else:
        with pytest.raises(ValidationError):
            parse()
