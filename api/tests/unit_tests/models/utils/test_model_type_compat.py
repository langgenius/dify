from types import SimpleNamespace

from sqlalchemy.dialects import postgresql

from graphon.model_runtime.entities.model_entities import ModelType
from models.provider import ProviderModelCredential
from models.utils.model_type_compat import (
    PersistedModelTypeRecord,
    fetch_singleton_with_model_type_fallback,
    legacy_compatible_model_type_filter,
    prefer_canonical_model_type_records,
)


def test_legacy_compatible_model_type_filter_matches_canonical_and_legacy_values():
    expr = legacy_compatible_model_type_filter(ProviderModelCredential.model_type, ModelType.LLM)
    compiled = str(expr.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))

    assert "'llm'" in compiled
    assert "text-generation" in compiled
    # Ensure that the generated does not rely on SQL cast
    assert "cast" not in compiled


def test_fetch_singleton_with_model_type_fallback_prefers_canonical_before_legacy():
    calls = []

    def fetch_by_filter(model_type_filter):
        calls.append(model_type_filter)
        return "canonical"

    result = fetch_singleton_with_model_type_fallback(
        column=ProviderModelCredential.model_type,
        model_type=ModelType.LLM,
        fetch_by_filter=fetch_by_filter,
    )

    assert result == "canonical"
    assert len(calls) == 1


def test_fetch_singleton_with_model_type_fallback_uses_legacy_when_canonical_is_missing():
    calls = []

    def fetch_by_filter(model_type_filter):
        calls.append(model_type_filter)
        return None if len(calls) == 1 else "legacy"

    result = fetch_singleton_with_model_type_fallback(
        column=ProviderModelCredential.model_type,
        model_type=ModelType.LLM,
        fetch_by_filter=fetch_by_filter,
    )

    assert result == "legacy"
    assert len(calls) == 2


def test_prefer_canonical_model_type_records_prefers_canonical_per_scope():
    canonical = SimpleNamespace(
        id="canonical",
        provider_name="openai",
        model_name="gpt-4o",
        model_type=ModelType.LLM,
    )
    legacy = SimpleNamespace(
        id="legacy",
        provider_name="openai",
        model_name="gpt-4o",
        model_type=ModelType.LLM,
    )
    legacy_only = SimpleNamespace(
        id="legacy-only",
        provider_name="openai",
        model_name="text-embedding-3-large",
        model_type=ModelType.TEXT_EMBEDDING,
    )

    result = prefer_canonical_model_type_records(
        [
            PersistedModelTypeRecord(record=legacy, persisted_model_type="text-generation"),
            PersistedModelTypeRecord(record=canonical, persisted_model_type="llm"),
            PersistedModelTypeRecord(record=legacy_only, persisted_model_type="embeddings"),
        ],
        scope_key=lambda record: (record.provider_name, record.model_name, record.model_type),
        model_type_getter=lambda record: record.model_type,
    )

    assert [record.id for record in result] == ["canonical", "legacy-only"]
