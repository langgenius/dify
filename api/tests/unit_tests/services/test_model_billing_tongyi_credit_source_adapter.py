"""Pure exact fourteen-model Tongyi factory using accepted parser/Core fixtures."""

from dataclasses import replace
from operator import itemgetter
from typing import cast

import pytest
from typing_extensions import TypedDict

from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelPropertyKey, ModelType
from services import model_billing_tongyi_credit_source_adapter as adapter
from services.entities.model_billing_mapping import model_schema_digest
from services.entities.model_billing_tongyi_mapping import TongyiSourceSettings
from tests.helpers.unit.model_billing_tongyi_profiles import (
    SOURCE_PROVIDER,
    SOURCE_UID,
    TongyiProfile,
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
    source_settings: TongyiSourceSettings


def arguments(row: TongyiProfile) -> BuildArguments:
    return {
        "adapter_id": row["adapter_id"],
        "adapter_revision": row["adapter_revision"],
        "expected_rules_digest": row["rules_digest"],
        "source_provider": SOURCE_PROVIDER,
        "source_model": row["source_model"],
        "source_plugin_unique_identifier": SOURCE_UID,
        "source_schema": schema(row),
        "source_runtime_schema": schema(row, runtime=True),
        "expected_source_schema_digest": row["source_schema_digest"],
        "expected_source_runtime_schema_digest": row["source_runtime_schema_digest"],
        "target_model": row["target_model"],
        "source_settings": TongyiSourceSettings(**row["source_settings"]),
    }


@pytest.mark.parametrize("row", profiles(), ids=itemgetter("source_model"))
def test_exact_fourteen_catalog_runtime_rules_and_six_field_marker_round_trip(row: TongyiProfile) -> None:
    args = arguments(row)
    assert model_schema_digest(args["source_schema"]) == row["source_schema_digest"]
    runtime_schema = args["source_runtime_schema"]
    assert runtime_schema is not None
    assert model_schema_digest(runtime_schema) == row["source_runtime_schema_digest"]
    built = adapter.build_tongyi_credit_source_contract(**args)
    record = variant_record(row)
    assert built.rules_digest == record["variants"][0]["parameter_adapter"]["rules_digest"]
    marker = adapter.tongyi_credit_source_marker(
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
    restored = adapter.restore_tongyi_credit_source_contract(
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
    assert adapter.build_tongyi_credit_source_contract(**prospective) == built


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
        ("source_plugin_unique_identifier", SOURCE_UID.replace("0.2.26", "0.2.27")),
        ("source_model", "qwen-long"),
        ("target_model", "unreviewed-alias"),
    ],
)
def test_identity_settings_and_independent_pins_cannot_be_widened(row: TongyiProfile, field: str, value: str) -> None:
    changed = dict(arguments(row))
    changed[field] = value
    with pytest.raises(adapter.TongyiCreditSourceAdapterError):
        adapter.build_tongyi_credit_source_contract(**cast(BuildArguments, changed))


@pytest.mark.parametrize("row", profiles(), ids=itemgetter("source_model"))
def test_full_schema_drift_marker_forgery_and_cross_type_reject(row: TongyiProfile) -> None:
    args = arguments(row)
    changed = schema(row, runtime=True).model_copy(update={"model_properties": {ModelPropertyKey.CONTEXT_SIZE: 1}})
    drifted = args.copy()
    drifted["source_runtime_schema"] = changed
    with pytest.raises(adapter.TongyiCreditSourceAdapterError):
        adapter.build_tongyi_credit_source_contract(**drifted)
    contract = adapter.build_tongyi_credit_source_contract(**args)
    with pytest.raises(adapter.TongyiCreditSourceAdapterError):
        adapter.tongyi_credit_source_marker(
            replace(contract, rules_digest="sha256:" + "0" * 64),
            source_provider=SOURCE_PROVIDER,
            source_model=row["source_model"],
            model_type=ModelType(row["model_type"]),
            target_model=row["target_model"],
        )
    other = ModelType.TEXT_EMBEDDING if row["model_type"] == "llm" else ModelType.LLM
    with pytest.raises(adapter.TongyiCreditSourceAdapterError):
        adapter.validate_tongyi_credit_source_identity(
            source_provider=SOURCE_PROVIDER,
            source_model=row["source_model"],
            source_plugin_unique_identifier=SOURCE_UID,
            model_type=other,
            target_model=row["target_model"],
        )
    marker = adapter.tongyi_credit_source_marker(
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
        with pytest.raises(adapter.TongyiCreditSourceAdapterError):
            adapter.restore_tongyi_credit_source_contract(
                bad,
                source_provider=SOURCE_PROVIDER,
                source_model=row["source_model"],
                model_type=ModelType(row["model_type"]),
                target_model=row["target_model"],
                source_settings=args["source_settings"],
                expected_source_runtime_schema_digest=row["source_runtime_schema_digest"],
            )


@pytest.mark.parametrize(
    ("row", "wrong_kind"),
    [
        (row, kind)
        for row in profiles()
        for kind in (ModelType.LLM, ModelType.TEXT_EMBEDDING, ModelType.RERANK)
        if kind is not ModelType(row["model_type"])
    ],
)
def test_each_reviewed_model_has_only_its_one_exact_type(row: TongyiProfile, wrong_kind: ModelType) -> None:
    from pydantic import ValidationError

    from services.entities.model_billing_tongyi_mapping import SourceTongyiVariantMapping

    for side in ("source", "target"):
        record = variant_record(row)
        if side == "source":
            record["source"]["model_type"] = wrong_kind.value
        else:
            record["variants"][0]["target"]["model_type"] = wrong_kind.value
        with pytest.raises(ValidationError):
            SourceTongyiVariantMapping.model_validate(record)


@pytest.mark.parametrize(
    "row", [row for row in profiles() if row["model_type"] == "llm"], ids=itemgetter("source_model")
)
def test_llm_nonchat_mode_is_never_accepted_by_factory(row: TongyiProfile) -> None:
    args = arguments(row)
    args["source_schema"] = schema(row).model_copy(update={"model_properties": {ModelPropertyKey.MODE: "completion"}})
    with pytest.raises(adapter.TongyiCreditSourceAdapterError):
        adapter.build_tongyi_credit_source_contract(**args)


@pytest.mark.parametrize("row", profiles(), ids=itemgetter("source_model"))
def test_previous_unreleased_rules_cannot_authorize_final_staging_candidate(row: TongyiProfile) -> None:
    args = arguments(row)
    assert row["release_status"] == "STAGING_PACKAGE_CANDIDATE"
    assert row["previous_unreleased_rules_digest"] != row["rules_digest"]
    args["expected_rules_digest"] = row["previous_unreleased_rules_digest"]
    with pytest.raises(adapter.TongyiCreditSourceAdapterError):
        adapter.build_tongyi_credit_source_contract(**args)
