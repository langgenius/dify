"""Exact Source0913/0915 schemas/pins; no target installation or model call."""

from dataclasses import replace
from operator import itemgetter
from typing import cast

import pytest
from typing_extensions import TypedDict

from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelType
from services import model_billing_gemini_credit_source_v2_adapter as adapter
from services.entities.model_billing_gemini_mapping import GEMINI_SOURCE_UID, GeminiSourceSettings
from services.entities.model_billing_gemini_v8_mapping import GEMINI_0913_SOURCE_UID, GEMINI_0915_SOURCE_UID
from services.entities.model_billing_mapping import SourceParameterContract, model_schema_digest
from tests.helpers.unit.model_billing_gemini_profiles import GeminiProfile
from tests.helpers.unit.model_billing_gemini_v8_profiles import SOURCE_PROVIDER, profile_digest, profiles, schema

V2_PROFILES = [*profiles(GEMINI_0913_SOURCE_UID), *profiles(GEMINI_0915_SOURCE_UID)]


class BuildArguments(TypedDict, closed=True):
    adapter_id: str
    adapter_revision: str
    expected_rules_digest: str
    source_provider: str
    source_model: str
    source_plugin_unique_identifier: str
    source_schema: AIModelEntity
    expected_source_schema_digest: str
    expected_source_runtime_schema_digest: str
    target_model: str
    source_settings: GeminiSourceSettings
    source_runtime_schema: AIModelEntity | None


class MarkerArguments(TypedDict, closed=True):
    source_provider: str
    source_model: str
    model_type: ModelType
    target_model: str


def arguments(row: GeminiProfile) -> BuildArguments:
    return {
        "adapter_id": row["adapter_id"],
        "adapter_revision": row["adapter_revision"],
        "expected_rules_digest": profile_digest(row),
        "source_provider": SOURCE_PROVIDER,
        "source_model": row["source_model"],
        "source_plugin_unique_identifier": {
            "gemini0913-native-v1": GEMINI_0913_SOURCE_UID,
            "gemini0915-native-v1": GEMINI_0915_SOURCE_UID,
        }[row["profile_id"].split(":", 1)[0]],
        "source_schema": schema(row),
        "expected_source_schema_digest": row["source_schema_digest"],
        "expected_source_runtime_schema_digest": row["source_runtime_schema_digest"],
        "target_model": row["target_model"],
        "source_settings": GeminiSourceSettings(**row["source_settings"]),
        "source_runtime_schema": schema(row, runtime=True),
    }


@pytest.mark.parametrize("row", V2_PROFILES, ids=itemgetter("profile_id"))
def test_real_catalog_runtime_rules_marker_and_prospective_restore(row: GeminiProfile) -> None:
    args = arguments(row)
    contract = adapter.build_gemini_credit_source_contract(**args)
    assert type(contract) is adapter.GeminiCreditSourceV2Contract
    assert contract.profile_id == row["profile_id"]
    assert contract.adapter_id == "gemini_credit_source_v2"
    assert contract.rules_digest == profile_digest(row)
    assert model_schema_digest(args["source_schema"]) == contract.source_schema_digest
    runtime = args["source_runtime_schema"]
    assert runtime is not None
    assert model_schema_digest(runtime) == contract.source_runtime_schema_digest
    marker = adapter.gemini_credit_source_marker(
        contract,
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
    assert marker["source_plugin_uid"] == args["source_plugin_unique_identifier"]
    assert (
        adapter.restore_gemini_credit_source_contract(
            marker,
            source_provider=SOURCE_PROVIDER,
            source_model=row["source_model"],
            model_type=ModelType(row["model_type"]),
            target_model=row["target_model"],
            source_settings=args["source_settings"],
            expected_source_runtime_schema_digest=row["source_runtime_schema_digest"],
            source_runtime_schema=runtime,
        )
        == contract
    )
    # None means frozen/prospective, never a live observed source RPC.
    prospective = args.copy()
    prospective["source_runtime_schema"] = None
    assert adapter.build_gemini_credit_source_contract(**prospective) == contract


@pytest.mark.parametrize("row", V2_PROFILES, ids=itemgetter("profile_id"))
@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("adapter_id", "gemini_credit_source_v1"),
        ("adapter_revision", "2"),
        ("source_provider", "langgenius/openai/openai"),
        ("source_plugin_unique_identifier", GEMINI_SOURCE_UID),
        ("source_plugin_unique_identifier", GEMINI_0913_SOURCE_UID.replace("0.9.13", "0.9.14")),
        ("source_model", "unreviewed-model"),
        ("target_model", "unreviewed-target"),
        ("expected_rules_digest", "sha256:" + "a" * 64),
        ("expected_source_schema_digest", "sha256:" + "b" * 64),
        ("expected_source_runtime_schema_digest", "sha256:" + "c" * 64),
    ],
)
def test_each_independent_pin_and_identity_is_fail_closed(row: GeminiProfile, field: str, value: str) -> None:
    args = arguments(row)
    cast(dict[str, object], args)[field] = value
    with pytest.raises(adapter.GeminiCreditSourceV2AdapterError):
        adapter.build_gemini_credit_source_contract(**args)


@pytest.mark.parametrize("row", V2_PROFILES, ids=itemgetter("profile_id"))
@pytest.mark.parametrize("runtime", [False, True])
def test_real_entity_full_metadata_drift_is_not_erased(row: GeminiProfile, runtime: bool) -> None:
    args = arguments(row)
    key = "source_runtime_schema" if runtime else "source_schema"
    observed = args[key]
    assert isinstance(observed, AIModelEntity)
    changed = observed.model_dump(mode="json")
    changed["label"] = {"en_US": "changed actual Source metadata"}
    cast(dict[str, object], args)[key] = AIModelEntity.model_validate(changed)
    with pytest.raises(adapter.GeminiCreditSourceV2AdapterError):
        adapter.build_gemini_credit_source_contract(**args)


@pytest.mark.parametrize("row", V2_PROFILES, ids=itemgetter("profile_id"))
def test_marker_requires_exact_concrete_factory_and_never_adopts_other_family(row: GeminiProfile) -> None:
    args = arguments(row)
    contract = adapter.build_gemini_credit_source_contract(**args)
    kwargs: MarkerArguments = {
        "source_provider": SOURCE_PROVIDER,
        "source_model": row["source_model"],
        "model_type": ModelType(row["model_type"]),
        "target_model": row["target_model"],
    }
    generic = SourceParameterContract(
        profile_id=contract.profile_id,
        source_plugin_unique_identifier=contract.source_plugin_unique_identifier,
        source_model=contract.source_model,
        source_schema_digest=contract.source_schema_digest,
        target_model=contract.target_model,
        rules_digest=contract.rules_digest,
        adapter_id=contract.adapter_id,
        algorithm_revision=contract.algorithm_revision,
        source_runtime_schema_digest=contract.source_runtime_schema_digest,
    )
    for forged in (replace(contract, rules_digest="sha256:" + "0" * 64), generic):
        with pytest.raises(adapter.GeminiCreditSourceV2AdapterError):
            adapter.gemini_credit_source_marker(cast(adapter.GeminiCreditSourceV2Contract, forged), **kwargs)
    marker = adapter.gemini_credit_source_marker(contract, **kwargs)
    for changed in (
        {**marker, "schema_version": True},
        {**marker, "profile_id": "gemini0912-native-v1:" + row["source_model"]},
        {**marker, "source_plugin_uid": GEMINI_SOURCE_UID},
        {**marker, "extra": "not-authority"},
    ):
        with pytest.raises(adapter.GeminiCreditSourceV2AdapterError):
            adapter.restore_gemini_credit_source_contract(
                changed,
                **kwargs,
                source_settings=args["source_settings"],
                expected_source_runtime_schema_digest=row["source_runtime_schema_digest"],
            )


@pytest.mark.parametrize("row", V2_PROFILES, ids=itemgetter("profile_id"))
def test_shared_v2_algorithm_never_crosses_exact_uid_profile_or_rules(row: GeminiProfile) -> None:
    args = arguments(row)
    other_uid = (
        GEMINI_0913_SOURCE_UID
        if args["source_plugin_unique_identifier"] == GEMINI_0915_SOURCE_UID
        else GEMINI_0915_SOURCE_UID
    )
    other = next(item for item in profiles(other_uid) if item["source_model"] == row["source_model"])
    assert schema(row) == schema(other)
    assert schema(row, runtime=True) == schema(other, runtime=True)
    assert row["profile_id"] != other["profile_id"]
    assert profile_digest(row) != profile_digest(other)
    # A same-schema source is not the same immutable contract.
    args["source_plugin_unique_identifier"] = other_uid
    with pytest.raises(adapter.GeminiCreditSourceV2AdapterError):
        adapter.build_gemini_credit_source_contract(**args)


@pytest.mark.parametrize("row", V2_PROFILES, ids=itemgetter("profile_id"))
@pytest.mark.parametrize("field", ["source_base_policy", "request_metadata_policy", "file_url_policy"])
def test_wrong_settings_are_rejected_by_both_build_and_restore(row: GeminiProfile, field: str) -> None:
    args = arguments(row)
    contract = adapter.build_gemini_credit_source_contract(**args)
    values = args["source_settings"].model_dump()
    values[field] = "unset_or_exact_google_root" if values[field] == "not_used" else "not_used"
    args["source_settings"] = GeminiSourceSettings.model_construct(**values)
    with pytest.raises(adapter.GeminiCreditSourceV2AdapterError):
        adapter.build_gemini_credit_source_contract(**args)
    marker = adapter.gemini_credit_source_marker(
        contract,
        source_provider=SOURCE_PROVIDER,
        source_model=row["source_model"],
        model_type=ModelType(row["model_type"]),
        target_model=row["target_model"],
    )
    with pytest.raises(adapter.GeminiCreditSourceV2AdapterError):
        adapter.restore_gemini_credit_source_contract(
            marker,
            source_provider=SOURCE_PROVIDER,
            source_model=row["source_model"],
            model_type=ModelType(row["model_type"]),
            target_model=row["target_model"],
            source_settings=args["source_settings"],
            expected_source_runtime_schema_digest=row["source_runtime_schema_digest"],
        )


@pytest.mark.parametrize("row", profiles(GEMINI_0915_SOURCE_UID), ids=itemgetter("source_model"))
@pytest.mark.parametrize(
    "field",
    [
        "adapter_id",
        "adapter_revision",
        "expected_rules_digest",
        "source_schema",
        "source_settings",
        "source_plugin_unique_identifier",
    ],
)
def test_0915_factory_rejects_wrong_concrete_types(row: GeminiProfile, field: str) -> None:
    args = arguments(row)
    cast(dict[str, object], args)[field] = True
    with pytest.raises(adapter.GeminiCreditSourceV2AdapterError):
        adapter.build_gemini_credit_source_contract(**args)
