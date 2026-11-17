"""Pure finite reference factory for three unreleased xAI credit source profiles.

No registry, credential or runtime I/O occurs here. A reviewed contract is not
routing authority. Callers must separately prove installed source/target, exact
public endpoint facts, immutable revision and current runtime readiness.
"""

from __future__ import annotations

import hmac
import re
from dataclasses import dataclass
from typing import Literal

from graphon.model_runtime.entities.model_entities import (
    AIModelEntity,
    ModelPropertyKey,
    ModelType,
)
from services.entities.model_billing_mapping import (
    SourceParameterContract,
    model_schema_digest,
)

XAI_CREDIT_SOURCE_ADAPTER_ID = "xai_credit_llm_source_v1"
XAI_CREDIT_SOURCE_ADAPTER_REVISION = "1"
XAI_CREDIT_SOURCE_PROVIDER = "langgenius/x/x"
XAI_CREDIT_SOURCE_UID = "langgenius/x:0.0.27@895dd0c90fd73ca6a668860a01e4629fbca15f880b1b38a73e36a1ac45a4b8eb"
XAI_CREDIT_SOURCE_MODELS = frozenset({"grok-4.3", "grok-4.5", "grok-4.6"})


class XAICreditSourceAdapterError(ValueError):
    """Secret-free denial of unsupported or mismatched exact-source facts."""


@dataclass(frozen=True, slots=True)
class XAICreditSourceSettings:
    """Positive public facts; absent protocol means no source protocol selector."""

    source_base_is_set: bool
    request_metadata_enabled: bool
    protocol_selector: None


@dataclass(frozen=True, slots=True)
class XAICreditSourceContract(SourceParameterContract):
    """An exact finite profile, not an extensible registration mechanism."""


_REVIEWED_CONTRACTS = (
    XAICreditSourceContract(
        profile_id="xai-credit-027-official-v1:grok-4.3",
        source_plugin_unique_identifier=XAI_CREDIT_SOURCE_UID,
        source_model="grok-4.3",
        source_schema_digest="sha256:25db634221f08955071e25fa66f32c02fd4c8649206cdd4109937ea270eb8098",
        source_runtime_schema_digest="sha256:67a8844ccd02db7cd38b7d1df855cb3b73ba364a6f56c1174f3519b47de5e71c",
        target_model="grok-4.3",
        rules_digest="sha256:6c58c7b37f2e07284098aee85b5647966148dff8f9a4e7c07367b87e5ccaab4c",
        adapter_id=XAI_CREDIT_SOURCE_ADAPTER_ID,
        algorithm_revision=XAI_CREDIT_SOURCE_ADAPTER_REVISION,
    ),
    XAICreditSourceContract(
        profile_id="xai-credit-027-official-v1:grok-4.5",
        source_plugin_unique_identifier=XAI_CREDIT_SOURCE_UID,
        source_model="grok-4.5",
        source_schema_digest="sha256:7db902951459153697d2f2cfaa8d0de025c0016ac0fc7fb39ac27674120d2724",
        source_runtime_schema_digest="sha256:adfe1b6b5a01f48e10479777d2ad8c3c8f74657b931561260b6adf1646430d83",
        target_model="grok-4.5",
        rules_digest="sha256:44c9b44b86cafcbf47743bfd403b6c4070393abf3e151e67119d5a27cbc9bac3",
        adapter_id=XAI_CREDIT_SOURCE_ADAPTER_ID,
        algorithm_revision=XAI_CREDIT_SOURCE_ADAPTER_REVISION,
    ),
    XAICreditSourceContract(
        profile_id="xai-credit-027-official-v1:grok-4.6",
        source_plugin_unique_identifier=XAI_CREDIT_SOURCE_UID,
        source_model="grok-4.6",
        source_schema_digest="sha256:34ed148143261f14b03577e0f86f986031f5358087dccf859112a5f09c2e5d4b",
        source_runtime_schema_digest="sha256:1dcd9da2d2ca2147d0c1be528f32a1e217446742b06ddc356cf1199a3a18e6f0",
        target_model="grok-4.6",
        rules_digest="sha256:f434b5dfc69cd27b7a6504e995781c9bf7f56718eb8ed6d5796f1f633e3fef7a",
        adapter_id=XAI_CREDIT_SOURCE_ADAPTER_ID,
        algorithm_revision=XAI_CREDIT_SOURCE_ADAPTER_REVISION,
    ),
)


def _digest_string(value: object) -> bool:
    return type(value) is str and re.fullmatch(r"sha256:[0-9a-f]{64}", value) is not None


def validate_xai_credit_source_settings(
    source_settings: XAICreditSourceSettings,
    source_endpoint_class: Literal["official_root"],
) -> None:
    if (
        type(source_settings) is not XAICreditSourceSettings
        or source_settings.source_base_is_set is not True
        or source_settings.request_metadata_enabled is not False
        or source_settings.protocol_selector is not None
        or type(source_endpoint_class) is not str
        or source_endpoint_class != "official_root"
    ):
        raise XAICreditSourceAdapterError("xAI credit source public settings are not reviewed")


def validate_xai_credit_source_identity(
    *,
    source_provider: str,
    source_model: str,
    source_plugin_unique_identifier: str,
    model_type: ModelType,
    target_model: str,
) -> None:
    if (
        type(source_provider) is not str
        or source_provider != XAI_CREDIT_SOURCE_PROVIDER
        or type(source_model) is not str
        or source_model not in XAI_CREDIT_SOURCE_MODELS
        or type(source_plugin_unique_identifier) is not str
        or source_plugin_unique_identifier != XAI_CREDIT_SOURCE_UID
        or model_type is not ModelType.LLM
        or type(target_model) is not str
        or target_model != source_model
    ):
        raise XAICreditSourceAdapterError("xAI credit source identity is not reviewed")


def _schema_digest(schema: AIModelEntity, model: str) -> str:
    if (
        not isinstance(schema, AIModelEntity)
        or type(schema.model) is not str
        or schema.model != model
        or schema.model_type is not ModelType.LLM
        or not isinstance(schema.model_properties, dict)
        or schema.model_properties.get(ModelPropertyKey.MODE) != "chat"
    ):
        raise XAICreditSourceAdapterError("xAI credit source schema identity is not reviewed")
    try:
        return model_schema_digest(schema)
    except (AttributeError, TypeError, ValueError):
        raise XAICreditSourceAdapterError("xAI credit source schema is not reviewed") from None


def _runtime_pin(
    contract: XAICreditSourceContract,
    expected: str,
    observed: AIModelEntity | None,
) -> None:
    if (
        not _digest_string(expected)
        or not _digest_string(contract.source_runtime_schema_digest)
        or not hmac.compare_digest(expected, contract.source_runtime_schema_digest or "")
    ):
        raise XAICreditSourceAdapterError("xAI credit source runtime pin does not match")
    # None is prospective/frozen restoration without a runtime read. It never
    # counts as observed runtime evidence; the independent expected pin remains
    # mandatory, and an actual supplied runtime must match in its entirety.
    if observed is not None and not hmac.compare_digest(_schema_digest(observed, contract.source_model), expected):
        raise XAICreditSourceAdapterError("xAI credit source runtime schema does not match")


def xai_credit_source_marker(
    contract: XAICreditSourceContract,
    *,
    source_provider: str,
    source_model: str,
    model_type: ModelType,
    target_model: str,
) -> dict[str, object]:
    if type(contract) is not XAICreditSourceContract or contract not in _REVIEWED_CONTRACTS:
        raise XAICreditSourceAdapterError("Unreviewed frozen xAI credit source contract")
    validate_xai_credit_source_identity(
        source_provider=source_provider,
        source_model=source_model,
        source_plugin_unique_identifier=contract.source_plugin_unique_identifier,
        model_type=model_type,
        target_model=target_model,
    )
    if source_model != contract.source_model or target_model != contract.target_model:
        raise XAICreditSourceAdapterError("xAI credit source contract identity does not match")
    return {
        "schema_version": 1,
        "profile_id": contract.profile_id,
        "source_plugin_uid": contract.source_plugin_unique_identifier,
        "source_model": contract.source_model,
        "source_schema_digest": contract.source_schema_digest,
        "rules_digest": contract.rules_digest,
    }


def build_xai_credit_source_contract(
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
    source_settings: XAICreditSourceSettings,
    source_endpoint_class: Literal["official_root"],
    source_runtime_schema: AIModelEntity | None = None,
) -> XAICreditSourceContract:
    validate_xai_credit_source_settings(source_settings, source_endpoint_class)
    actual = _schema_digest(source_schema, source_model)
    validate_xai_credit_source_identity(
        source_provider=source_provider,
        source_model=source_model,
        source_plugin_unique_identifier=source_plugin_unique_identifier,
        model_type=source_schema.model_type,
        target_model=target_model,
    )
    contract = next(
        (item for item in _REVIEWED_CONTRACTS if item.source_model == source_model),
        None,
    )
    if (
        contract is None
        or type(adapter_id) is not str
        or adapter_id != XAI_CREDIT_SOURCE_ADAPTER_ID
        or type(adapter_revision) is not str
        or adapter_revision != XAI_CREDIT_SOURCE_ADAPTER_REVISION
        or not _digest_string(expected_rules_digest)
        or not _digest_string(expected_source_schema_digest)
        or not hmac.compare_digest(expected_rules_digest, contract.rules_digest)
        or not hmac.compare_digest(expected_source_schema_digest, actual)
        or not hmac.compare_digest(actual, contract.source_schema_digest)
    ):
        raise XAICreditSourceAdapterError("xAI credit source evidence does not match")
    _runtime_pin(contract, expected_source_runtime_schema_digest, source_runtime_schema)
    return contract


def restore_xai_credit_source_contract(
    marker: object,
    *,
    source_provider: str,
    source_model: str,
    model_type: ModelType,
    target_model: str,
    source_settings: XAICreditSourceSettings,
    source_endpoint_class: Literal["official_root"],
    expected_source_runtime_schema_digest: str,
    source_runtime_schema: AIModelEntity | None = None,
) -> XAICreditSourceContract:
    validate_xai_credit_source_settings(source_settings, source_endpoint_class)
    fields = {
        "schema_version",
        "profile_id",
        "source_plugin_uid",
        "source_model",
        "source_schema_digest",
        "rules_digest",
    }
    if (
        type(marker) is not dict
        or set(marker) != fields
        or type(marker.get("schema_version")) is not int
        or marker.get("schema_version") != 1
        or any(type(value) is not str for key, value in marker.items() if key != "schema_version")
    ):
        raise XAICreditSourceAdapterError("Invalid frozen xAI credit source marker")
    contract = next(
        (item for item in _REVIEWED_CONTRACTS if item.profile_id == marker["profile_id"]),
        None,
    )
    if contract is None:
        raise XAICreditSourceAdapterError("Invalid frozen xAI credit source marker")
    expected = xai_credit_source_marker(
        contract,
        source_provider=source_provider,
        source_model=source_model,
        model_type=model_type,
        target_model=target_model,
    )
    if marker != expected:
        raise XAICreditSourceAdapterError("Invalid frozen xAI credit source marker")
    _runtime_pin(contract, expected_source_runtime_schema_digest, source_runtime_schema)
    return contract
