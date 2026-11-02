"""Separate schema3 settings/shape guards; never broaden an old LLM contract."""

import pytest
from pydantic import ValidationError

from graphon.model_runtime.entities.model_entities import ModelType
from services.entities.model_billing_embedding_mapping import (
    EmbeddingMappingSource,
    EmbeddingSourceSettings,
    EmbeddingSourceVariantAdapter,
    SourceEmbeddingVariantMapping,
)
from services.entities.model_billing_mapping import ParameterAdapter, SourceVariantMapping


@pytest.mark.parametrize("endpoint", ["unset", "official_root"])
def test_new_settings_are_explicit_closed_and_not_old_llm_protocol_settings(endpoint: str) -> None:
    settings = EmbeddingSourceSettings.model_validate(
        {"source_endpoint_class": endpoint, "request_metadata_behavior": "not_used"}
    )
    assert settings.model_dump(mode="json") == {
        "source_endpoint_class": endpoint,
        "request_metadata_behavior": "not_used",
    }
    field = "request_metadata_behavior"
    with pytest.raises(ValidationError):
        setattr(settings, field, "enabled")


@pytest.mark.parametrize("metadata", [None, 0, 1, "disabled", "false", True])
def test_behavior_is_proved_not_used_not_a_raw_source_flag(metadata: object) -> None:
    with pytest.raises(ValidationError):
        EmbeddingSourceSettings.model_validate(
            {"source_endpoint_class": "unset", "request_metadata_behavior": metadata}
        )


@pytest.mark.parametrize("extra", ["api_key", "api_protocol", "openai_api_base", "source_base_is_set"])
def test_embedding_settings_do_not_accept_credentials_or_llm_selector_fields(extra: str) -> None:
    with pytest.raises(ValidationError):
        EmbeddingSourceSettings.model_validate(
            {"source_endpoint_class": "official_root", "request_metadata_behavior": "not_used", extra: "never-export"}
        )


@pytest.mark.parametrize("model", ["text-embedding-3-small", "text-embedding-3-large", "text-embedding-ada-002"])
def test_source_identity_uses_embedding_mode_not_llm_mode(model: str) -> None:
    source = EmbeddingMappingSource.model_validate(
        {
            "provider_id": "langgenius/openai/openai",
            "model_type": "text-embedding",
            "model": model,
            "mode": "text-embedding",
        }
    )
    assert source.model_type is ModelType.TEXT_EMBEDDING
    with pytest.raises(ValidationError):
        EmbeddingMappingSource.model_validate({**source.model_dump(mode="json"), "mode": "chat"})


def test_new_family_is_not_added_to_old_v1_or_llm_only_v2_schema() -> None:
    assert SourceEmbeddingVariantMapping.model_json_schema()["properties"]["schema_version"]["const"] == 3
    assert SourceVariantMapping.model_json_schema()["properties"]["schema_version"]["const"] == 2
    assert "openai_embedding_source_v1" not in ParameterAdapter.model_json_schema()["properties"]["id"]["enum"]
    assert (
        EmbeddingSourceVariantAdapter.model_json_schema()["properties"]["id"]["const"] == "openai_embedding_source_v1"
    )
