"""Actual latest Source metadata and preserved older contracts, no live proof."""

import json
from pathlib import Path

import pytest

from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelType
from services.entities.model_billing_tongyi_mapping import TongyiSourceSettings
from services.model_billing_mapping_service import hosted_tongyi_source_fact, tongyi_source_variant_context
from services.model_billing_tongyi_credit_source_adapter import (
    TongyiCreditSourceAdapterError,
    build_tongyi_credit_source_contract,
    restore_tongyi_credit_source_contract,
    tongyi_credit_source_marker,
)

DATA = json.loads((Path(__file__).with_name("fixtures") / "tongyi0227_source_profiles.json").read_text())
PROVIDER = "langgenius/tongyi/tongyi"


def settings(row):
    return TongyiSourceSettings(
        source_endpoint_policy="reviewed_shared_international_string_true",
        api_host_policy="actual_absent_or_blank",
        request_metadata_policy="actual_system_disabled" if row["profile"]["model_type"] == "llm" else "not_used",
    )


@pytest.mark.parametrize("row", DATA["profiles"], ids=lambda r: r["profile"]["source_model"])
def test_exact_new_source_roundtrips_through_existing_normal_factory(row):
    p = row["profile"]
    source = AIModelEntity.model_validate(row["catalog"])
    runtime = AIModelEntity.model_validate(row["runtime"])
    contract = build_tongyi_credit_source_contract(
        adapter_id="tongyi_credit_source_v1",
        adapter_revision="1",
        expected_rules_digest=row["rules_digest"],
        source_provider=PROVIDER,
        source_model=p["source_model"],
        source_plugin_unique_identifier=DATA["sourceUid"],
        source_schema=source,
        expected_source_schema_digest=p["source_schema_digest"],
        expected_source_runtime_schema_digest=p["source_runtime_schema_digest"],
        target_model=p["target_model"],
        source_settings=settings(row),
        source_runtime_schema=runtime,
    )
    marker_args = {
        "source_provider": PROVIDER,
        "source_model": p["source_model"],
        "model_type": ModelType(p["model_type"]),
        "target_model": p["target_model"],
    }
    marker = tongyi_credit_source_marker(contract, **marker_args)
    assert contract.profile_id == "tongyi0227-native-v1:" + p["source_model"]
    assert (
        restore_tongyi_credit_source_contract(
            marker,
            **marker_args,
            source_settings=settings(row),
            expected_source_runtime_schema_digest=p["source_runtime_schema_digest"],
            source_runtime_schema=runtime,
        )
        == contract
    )
    for altered in (
        {**marker, "source_plugin_uid": DATA["sourceUid"].replace("d9409", "00000")},
        {**marker, "api_base": "https://untrusted.invalid"},
    ):
        with pytest.raises(TongyiCreditSourceAdapterError):
            restore_tongyi_credit_source_contract(
                altered,
                **marker_args,
                source_settings=settings(row),
                expected_source_runtime_schema_digest=p["source_runtime_schema_digest"],
            )


@pytest.mark.parametrize("row", DATA["profiles"], ids=lambda r: r["profile"]["source_model"])
def test_new_actual_source_facts_preserve_endpoint_and_nonsecret_flag_boundary(row):
    schema = AIModelEntity.model_validate(row["catalog"])
    credentials = {"use_international_endpoint": "true", "enable_request_metadata": "disabled"}
    fact = hosted_tongyi_source_fact(
        provider=PROVIDER, source_uid=DATA["sourceUid"], models=[schema], credentials=credentials
    )
    arguments = {
        "provider": PROVIDER,
        "source_uid": DATA["sourceUid"],
        "model_type": schema.model_type,
        "schema": schema,
    }
    assert tongyi_source_variant_context(fact, **arguments) is not None
    for values in (
        None,
        {},
        {**credentials, "api_host": "untrusted.invalid"},
        {**credentials, "use_international_endpoint": True},
    ):
        observed = hosted_tongyi_source_fact(
            provider=PROVIDER, source_uid=DATA["sourceUid"], models=[schema], credentials=values
        )
        assert tongyi_source_variant_context(observed, **arguments) is None
    assert DATA["liveRuntimeRpcObserved"] is False
