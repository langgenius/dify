"""Pure exact nine-model Gemini factory using accepted parser/Core fixtures."""

from dataclasses import replace
from operator import itemgetter
from typing import cast

import pytest
from typing_extensions import TypedDict

from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelPropertyKey, ModelType
from services import model_billing_gemini_credit_source_adapter as adapter
from services.entities.model_billing_gemini_mapping import GeminiSourceSettings
from services.entities.model_billing_mapping import model_schema_digest
from tests.helpers.unit.model_billing_gemini_profiles import (
    SOURCE_PROVIDER,
    SOURCE_UID,
    GeminiProfile,
    profiles,
    schema,
    variant_record,
)


class BuildArguments(TypedDict, closed=True):
    adapter_id: str
    adapter_revision: str
    expected_rules_digest: str
    source_provider: str
    source_model: str
    source_plugin_unique_identifier: str
    source_schema: AIModelEntity
    source_runtime_schema: AIModelEntity | None
    expected_source_schema_digest: str
    expected_source_runtime_schema_digest: str
    target_model: str
    source_settings: GeminiSourceSettings


def arguments(row: GeminiProfile) -> BuildArguments:
    contract = next(item for item in adapter._REVIEWED_CONTRACTS if item.source_model == row["source_model"])
    return {
        "adapter_id": row["adapter_id"],
        "adapter_revision": row["adapter_revision"],
        "expected_rules_digest": contract.rules_digest,
        "source_provider": SOURCE_PROVIDER,
        "source_model": row["source_model"],
        "source_plugin_unique_identifier": SOURCE_UID,
        "source_schema": schema(row),
        "source_runtime_schema": schema(row, runtime=True),
        "expected_source_schema_digest": row["source_schema_digest"],
        "expected_source_runtime_schema_digest": row["source_runtime_schema_digest"],
        "target_model": row["target_model"],
        "source_settings": GeminiSourceSettings(**row["source_settings"]),
    }


@pytest.mark.parametrize("row", profiles(), ids=itemgetter("source_model"))
def test_exact_nine_catalog_runtime_rules_and_six_field_marker_round_trip(row: GeminiProfile) -> None:
    args = arguments(row)
    assert model_schema_digest(args["source_schema"]) == row["source_schema_digest"]
    runtime_schema = args["source_runtime_schema"]
    assert runtime_schema is not None
    assert model_schema_digest(runtime_schema) == row["source_runtime_schema_digest"]
    built = adapter.build_gemini_credit_source_contract(**args)
    record = variant_record(row)
    assert built.rules_digest == record["variants"][0]["parameter_adapter"]["rules_digest"]
    marker = adapter.gemini_credit_source_marker(
        built,
        source_provider=SOURCE_PROVIDER,
        source_model=row["source_model"],
        model_type=ModelType(row["model_type"]),
        target_model=row["target_model"],
    )
    assert set(marker) == {
        "schema_version",
        "profile_id",
        "source_plugin_uid",
        "source_model",
        "source_schema_digest",
        "rules_digest",
    }
    assert marker["schema_version"] == 1
    restored = adapter.restore_gemini_credit_source_contract(
        marker,
        source_provider=SOURCE_PROVIDER,
        source_model=row["source_model"],
        model_type=ModelType(row["model_type"]),
        target_model=row["target_model"],
        source_settings=args["source_settings"],
        expected_source_runtime_schema_digest=row["source_runtime_schema_digest"],
        source_runtime_schema=schema(row, runtime=True),
    )
    assert restored == built
    # An absent runtime is only prospective/frozen restore, not a live RPC.
    prospective = args.copy()
    prospective["source_runtime_schema"] = None
    assert adapter.build_gemini_credit_source_contract(**prospective) == built


@pytest.mark.parametrize("row", profiles(), ids=itemgetter("source_model"))
@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("adapter_id", "identity_v1"),
        ("adapter_revision", "2"),
        ("expected_rules_digest", "sha256:" + "0" * 64),
        ("expected_source_schema_digest", "sha256:" + "0" * 64),
        ("expected_source_runtime_schema_digest", "sha256:" + "0" * 64),
        ("source_provider", "langgenius/openai/openai"),
        ("source_plugin_unique_identifier", SOURCE_UID.replace("0.9.12", "0.9.13")),
        ("source_model", "gemini-3.1-flash-lite-preview"),
        ("target_model", "unreviewed-alias"),
    ],
)
def test_identity_settings_and_independent_pins_cannot_be_widened(row: GeminiProfile, field: str, value: str) -> None:
    changed = dict(arguments(row))
    changed[field] = value
    with pytest.raises(adapter.GeminiCreditSourceAdapterError):
        adapter.build_gemini_credit_source_contract(**cast(BuildArguments, changed))


@pytest.mark.parametrize("row", profiles(), ids=itemgetter("source_model"))
def test_full_schema_drift_marker_forgery_and_cross_type_reject(row: GeminiProfile) -> None:
    args = arguments(row)
    changed = schema(row, runtime=True).model_copy(update={"model_properties": {ModelPropertyKey.CONTEXT_SIZE: 1}})
    drifted = args.copy()
    drifted["source_runtime_schema"] = changed
    with pytest.raises(adapter.GeminiCreditSourceAdapterError):
        adapter.build_gemini_credit_source_contract(**drifted)
    contract = adapter.build_gemini_credit_source_contract(**args)
    with pytest.raises(adapter.GeminiCreditSourceAdapterError):
        adapter.gemini_credit_source_marker(
            replace(contract, rules_digest="sha256:" + "0" * 64),
            source_provider=SOURCE_PROVIDER,
            source_model=row["source_model"],
            model_type=ModelType(row["model_type"]),
            target_model=row["target_model"],
        )
    other = ModelType.TEXT_EMBEDDING if row["model_type"] == "llm" else ModelType.LLM
    with pytest.raises(adapter.GeminiCreditSourceAdapterError):
        adapter.validate_gemini_credit_source_identity(
            source_provider=SOURCE_PROVIDER,
            source_model=row["source_model"],
            source_plugin_unique_identifier=SOURCE_UID,
            model_type=other,
            target_model=row["target_model"],
        )
    marker = adapter.gemini_credit_source_marker(
        contract,
        source_provider=SOURCE_PROVIDER,
        source_model=row["source_model"],
        model_type=ModelType(row["model_type"]),
        target_model=row["target_model"],
    )
    for bad in (
        {**marker, "schema_version": True},
        {**marker, "extra": "field"},
        {**marker, "profile_id": "unreviewed"},
    ):
        with pytest.raises(adapter.GeminiCreditSourceAdapterError):
            adapter.restore_gemini_credit_source_contract(
                bad,
                source_provider=SOURCE_PROVIDER,
                source_model=row["source_model"],
                model_type=ModelType(row["model_type"]),
                target_model=row["target_model"],
                source_settings=args["source_settings"],
                expected_source_runtime_schema_digest=row["source_runtime_schema_digest"],
            )
