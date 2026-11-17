"""Actual latest SDK/Go/Core metadata, not a live source/runtime claim."""

import json
from dataclasses import replace
from pathlib import Path

import pytest

from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelType
from services.entities.model_billing_mapping import model_schema_digest
from services.model_billing_anthropic_adapter import (
    AnthropicSourceAdapterError,
    anthropic_source_marker,
    build_anthropic_source_contract,
    restore_anthropic_source_contract,
)

DATA = json.loads((Path(__file__).with_name("fixtures") / "model_billing_anthropic0341_bindings.json").read_text())


def contract(row):
    """Bind only exact source metadata and already-canonical reviewed rules."""
    p = row["profile"]
    return build_anthropic_source_contract(
        adapter_id="anthropic_source_v1",
        adapter_revision="2",
        expected_rules_digest=row["rules_digest"],
        source_provider="langgenius/anthropic/anthropic",
        source_model=p["source_model"],
        source_plugin_unique_identifier=DATA["sourceUid"],
        source_schema=AIModelEntity.model_validate(row["catalog"]),
        expected_source_schema_digest=p["source_schema_digest"],
        target_model=p["target_model"],
    )


@pytest.mark.parametrize("row", DATA["profiles"], ids=lambda row: row["profile"]["source_model"])
def test_actual_new_source_roundtrips_without_changing_old_contracts(row):
    c = contract(row)
    assert c.profile_id.startswith("anthropic-0341-runtime-v2:")
    assert c.source_runtime_schema_digest == model_schema_digest(AIModelEntity.model_validate(row["runtime"]))
    arguments = {
        "source_provider": "langgenius/anthropic/anthropic",
        "source_model": c.source_model,
        "model_type": ModelType.LLM,
        "target_model": c.target_model,
    }
    marker = anthropic_source_marker(c, **arguments)
    assert len(marker) == 6
    assert restore_anthropic_source_contract(marker, **arguments) == c
    assert DATA["liveRuntimeRpcObserved"] is False


@pytest.mark.parametrize("row", DATA["profiles"], ids=lambda row: row["profile"]["source_model"])
def test_new_marker_is_not_a_source_uid_schema_or_transport_bypass(row):
    c = contract(row)
    arguments = {
        "source_provider": "langgenius/anthropic/anthropic",
        "source_model": c.source_model,
        "model_type": ModelType.LLM,
        "target_model": c.target_model,
    }
    marker = anthropic_source_marker(c, **arguments)
    for key, value in (
        ("source_plugin_uid", "langgenius/anthropic:0.3.40@" + "a" * 64),
        ("rules_digest", "sha256:" + "0" * 64),
        ("api_base", "https://untrusted.invalid"),
    ):
        altered = {**marker, key: value}
        with pytest.raises(AnthropicSourceAdapterError):
            restore_anthropic_source_contract(altered, **arguments)
    with pytest.raises(AnthropicSourceAdapterError):
        anthropic_source_marker(replace(c, source_plugin_unique_identifier="unreviewed"), **arguments)


def test_only_four_current_predefined_models_are_advertised():
    assert {r["profile"]["source_model"] for r in DATA["profiles"]} == {
        "claude-haiku-4-5-20251001",
        "claude-opus-4-6",
        "claude-opus-4-7",
        "claude-sonnet-4-6",
    }
    assert DATA["oldMetadataByteEquivalent"] is True
