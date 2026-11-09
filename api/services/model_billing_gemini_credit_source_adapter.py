"""Pure exact Gemini0912 source factory, never runtime/release authority.

Pins come from the independently accepted nine-profile Source packet 674708df.
Catalog and runtime pins are actual ee396 -> Core hashes, not SDK raw hashes.
No registry, credential, configuration, network, money or storage I/O occurs.
"""

from __future__ import annotations

import hmac
import re
from dataclasses import dataclass
from typing import Never

from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelPropertyKey, ModelType
from services.entities.model_billing_gemini_mapping import (
    GEMINI_SOURCE_UID,
    GeminiSourceSettings,
    gemini_source_model_type,
)
from services.entities.model_billing_mapping import SourceParameterContract, model_schema_digest

GEMINI_CREDIT_SOURCE_ADAPTER_ID = "gemini_credit_source_v1"
GEMINI_CREDIT_SOURCE_ADAPTER_REVISION = "1"
GEMINI_CREDIT_SOURCE_PROVIDER = "langgenius/gemini/google"


class GeminiCreditSourceAdapterError(ValueError):
    """Fixed safe denial; unknown settings/schema never authorize a route."""


@dataclass(frozen=True, slots=True)
class GeminiCreditSourceContract(SourceParameterContract):
    """An exact immutable reviewed profile, not a routing authorization."""


_REVIEWED_CONTRACTS = (
    GeminiCreditSourceContract(
        profile_id="gemini0912-native-v1:gemini-2.5-flash",
        source_plugin_unique_identifier="langgenius/gemini:0.9.12@9bb9eff3f9c99a8f1f87bdd5e0f178d5493918939dd0e02825ae8383bd0fd7ed",
        source_model="gemini-2.5-flash",
        source_schema_digest="sha256:a6f062c747095a53b7068f644498d44832d4eb86ffb2c0bec985c26649a2f4b9",
        source_runtime_schema_digest="sha256:e3a9e5a6146b14480e5f9948993afeab62e640b1559bd953fea98651ee1d5a21",
        target_model="gemini-2.5-flash",
        rules_digest="sha256:e931c546c3cdf4035f18b60f07391216bd18616d929185d69e3ac1014f861830",
        adapter_id="gemini_credit_source_v1",
        algorithm_revision="1",
    ),
    GeminiCreditSourceContract(
        profile_id="gemini0912-native-v1:gemini-3.1-flash-lite",
        source_plugin_unique_identifier="langgenius/gemini:0.9.12@9bb9eff3f9c99a8f1f87bdd5e0f178d5493918939dd0e02825ae8383bd0fd7ed",
        source_model="gemini-3.1-flash-lite",
        source_schema_digest="sha256:891d999bf70c48227a318118fe6624c5d1157c941f24d3dab33698afc354c3b3",
        source_runtime_schema_digest="sha256:0ee6cea0716356f3d3951066ec994ba34b50cf48fecf8d07c9e9611861e627a4",
        target_model="gemini-3.1-flash-lite",
        rules_digest="sha256:4854dff2e7b33d43d6b5d04391dad8fd104f2e93431536605809663065e736d5",
        adapter_id="gemini_credit_source_v1",
        algorithm_revision="1",
    ),
    GeminiCreditSourceContract(
        profile_id="gemini0912-native-v1:gemini-3.1-pro-preview",
        source_plugin_unique_identifier="langgenius/gemini:0.9.12@9bb9eff3f9c99a8f1f87bdd5e0f178d5493918939dd0e02825ae8383bd0fd7ed",
        source_model="gemini-3.1-pro-preview",
        source_schema_digest="sha256:bbecc5b91a6898098800d6fb4cfafc28581d2ee96c87f9dadbdeb4858f95e14a",
        source_runtime_schema_digest="sha256:3a2ce7dce3477bd042314941826492a5496aeb8bdb047285514a305d810e918e",
        target_model="gemini-3.1-pro-preview",
        rules_digest="sha256:e3435a474463a550462dba01902c67095016c151c20fb27f48b7853eb35de23f",
        adapter_id="gemini_credit_source_v1",
        algorithm_revision="1",
    ),
    GeminiCreditSourceContract(
        profile_id="gemini0912-native-v1:gemini-3.5-flash",
        source_plugin_unique_identifier="langgenius/gemini:0.9.12@9bb9eff3f9c99a8f1f87bdd5e0f178d5493918939dd0e02825ae8383bd0fd7ed",
        source_model="gemini-3.5-flash",
        source_schema_digest="sha256:00c3db1d48db893a80f32db232f40850bd5892efcdbfe2a807610f47a9368b11",
        source_runtime_schema_digest="sha256:54aefc309ce57ff15f93ee606bb0919f1eb9649d057957cb6ea1fb2b60a3ab44",
        target_model="gemini-3.5-flash",
        rules_digest="sha256:0b0ac5124887117aaa3e299714b25a76879688b1047872866dc4bd1939ac7820",
        adapter_id="gemini_credit_source_v1",
        algorithm_revision="1",
    ),
    GeminiCreditSourceContract(
        profile_id="gemini0912-native-v1:gemini-3.5-flash-lite",
        source_plugin_unique_identifier="langgenius/gemini:0.9.12@9bb9eff3f9c99a8f1f87bdd5e0f178d5493918939dd0e02825ae8383bd0fd7ed",
        source_model="gemini-3.5-flash-lite",
        source_schema_digest="sha256:b5488100a11d6727655551ce9a8ebdf5dfaab5a127b3791dc1d0fae0a61ed159",
        source_runtime_schema_digest="sha256:613acb7a29a51dffcf3ffd506f306ba6002599d5765a1baffb66d3ade9257355",
        target_model="gemini-3.5-flash-lite",
        rules_digest="sha256:3b9c6c06c34effee08c22a4cc95dd626ca8908332578b7896ee3f8e5699ba4fe",
        adapter_id="gemini_credit_source_v1",
        algorithm_revision="1",
    ),
    GeminiCreditSourceContract(
        profile_id="gemini0912-native-v1:gemini-3.7-flash",
        source_plugin_unique_identifier="langgenius/gemini:0.9.12@9bb9eff3f9c99a8f1f87bdd5e0f178d5493918939dd0e02825ae8383bd0fd7ed",
        source_model="gemini-3.7-flash",
        source_schema_digest="sha256:cb1cbd4074cd4d143d9809f11ff2576682dfc8ffbe59375a518100cf69ddd42b",
        source_runtime_schema_digest="sha256:7b1cd0a9ea9fbe14386d8458a6bec68833343cdbf4383c460bf0ac2a20f68189",
        target_model="gemini-3.7-flash",
        rules_digest="sha256:a8eb353d6a2b6607c731498d6e6e0497530645722ffc8c5ba7066619b7408506",
        adapter_id="gemini_credit_source_v1",
        algorithm_revision="1",
    ),
    GeminiCreditSourceContract(
        profile_id="gemini0912-native-v1:gemini-3-flash-preview",
        source_plugin_unique_identifier="langgenius/gemini:0.9.12@9bb9eff3f9c99a8f1f87bdd5e0f178d5493918939dd0e02825ae8383bd0fd7ed",
        source_model="gemini-3-flash-preview",
        source_schema_digest="sha256:31acc3f3622ad3f7c89a5e372e0a2abe51de6feb194c5ae805c6c9840ddbd4c9",
        source_runtime_schema_digest="sha256:ccaa15b0d9e20840ab62d077c5c0a62fd9f5339d04f4d4ab0a978962ac83dab1",
        target_model="gemini-3-flash-preview",
        rules_digest="sha256:361add12b00d44c368b97580016731ca92c04d9d21005bdbbd5e70978017bad3",
        adapter_id="gemini_credit_source_v1",
        algorithm_revision="1",
    ),
    GeminiCreditSourceContract(
        profile_id="gemini0912-native-v1:gemini-embedding-001",
        source_plugin_unique_identifier="langgenius/gemini:0.9.12@9bb9eff3f9c99a8f1f87bdd5e0f178d5493918939dd0e02825ae8383bd0fd7ed",
        source_model="gemini-embedding-001",
        source_schema_digest="sha256:470e3397c5097df3b54673901fc321ce298e6081369bc731432e042daa04fb5d",
        source_runtime_schema_digest="sha256:470e3397c5097df3b54673901fc321ce298e6081369bc731432e042daa04fb5d",
        target_model="gemini-embedding-001",
        rules_digest="sha256:ea14b27ecbf54ec7aa6044cbc18b0c50103a37a4d89feaba22e2d83352d0f814",
        adapter_id="gemini_credit_source_v1",
        algorithm_revision="1",
    ),
    GeminiCreditSourceContract(
        profile_id="gemini0912-native-v1:gemini-embedding-2-preview",
        source_plugin_unique_identifier="langgenius/gemini:0.9.12@9bb9eff3f9c99a8f1f87bdd5e0f178d5493918939dd0e02825ae8383bd0fd7ed",
        source_model="gemini-embedding-2-preview",
        source_schema_digest="sha256:b16129e398a864dd0baee0c957c4c42573ef888b785c6aaec9d78ac2785e063b",
        source_runtime_schema_digest="sha256:b16129e398a864dd0baee0c957c4c42573ef888b785c6aaec9d78ac2785e063b",
        target_model="gemini-embedding-2-preview",
        rules_digest="sha256:9db2b9ac43187e909cddb6ac5b195f7a76915edd3bab692303ff4b23a93f9c82",
        adapter_id="gemini_credit_source_v1",
        algorithm_revision="1",
    ),
)
_MARKER_FIELDS = frozenset(
    {
        "schema_version",
        "profile_id",
        "source_plugin_uid",
        "source_model",
        "source_schema_digest",
        "rules_digest",
    }
)


def _deny() -> Never:
    raise GeminiCreditSourceAdapterError("Gemini source evidence is not reviewed")


def _digest(value: object) -> bool:
    return type(value) is str and re.fullmatch(r"sha256:[0-9a-f]{64}", value) is not None


def validate_gemini_credit_source_identity(
    *,
    source_provider: str,
    source_model: str,
    source_plugin_unique_identifier: str,
    model_type: ModelType,
    target_model: str,
) -> None:
    if (
        type(source_provider) is not str
        or source_provider != GEMINI_CREDIT_SOURCE_PROVIDER
        or type(source_plugin_unique_identifier) is not str
        or source_plugin_unique_identifier != GEMINI_SOURCE_UID
        or type(source_model) is not str
        or type(target_model) is not str
        or source_model != target_model
    ):
        _deny()
    try:
        expected = gemini_source_model_type(source_model)
    except ValueError:
        _deny()
    else:
        if model_type is not expected:
            _deny()


def _settings(settings: GeminiSourceSettings, model: str) -> None:
    if type(settings) is not GeminiSourceSettings or not settings.matches_model_type(gemini_source_model_type(model)):
        _deny()


def _schema_digest(schema: AIModelEntity, model: str) -> str:
    if (
        not isinstance(schema, AIModelEntity)
        or schema.model != model
        or schema.model_type is not gemini_source_model_type(model)
        or schema.model_type is ModelType.LLM
        and schema.model_properties.get(ModelPropertyKey.MODE) != "chat"
    ):
        _deny()
    return model_schema_digest(schema)


def _runtime_pin(contract: GeminiCreditSourceContract, expected: str, observed: AIModelEntity | None) -> None:
    if not _digest(expected) or not hmac.compare_digest(expected, contract.source_runtime_schema_digest or ""):
        _deny()
    # None is frozen/prospective restoration, NEVER observed runtime evidence.
    if observed is not None and not hmac.compare_digest(_schema_digest(observed, contract.source_model), expected):
        _deny()


def gemini_credit_source_marker(
    contract: GeminiCreditSourceContract,
    *,
    source_provider: str,
    source_model: str,
    model_type: ModelType,
    target_model: str,
) -> dict[str, object]:
    if type(contract) is not GeminiCreditSourceContract or contract not in _REVIEWED_CONTRACTS:
        _deny()
    validate_gemini_credit_source_identity(
        source_provider=source_provider,
        source_model=source_model,
        source_plugin_unique_identifier=contract.source_plugin_unique_identifier,
        model_type=model_type,
        target_model=target_model,
    )
    if source_model != contract.source_model or target_model != contract.target_model:
        _deny()
    return {
        "schema_version": 1,
        "profile_id": contract.profile_id,
        "source_plugin_uid": contract.source_plugin_unique_identifier,
        "source_model": contract.source_model,
        "source_schema_digest": contract.source_schema_digest,
        "rules_digest": contract.rules_digest,
    }


def build_gemini_credit_source_contract(
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
    source_settings: GeminiSourceSettings,
    source_runtime_schema: AIModelEntity | None = None,
) -> GeminiCreditSourceContract:
    if not isinstance(source_schema, AIModelEntity):
        _deny()
    validate_gemini_credit_source_identity(
        source_provider=source_provider,
        source_model=source_model,
        source_plugin_unique_identifier=source_plugin_unique_identifier,
        model_type=source_schema.model_type,
        target_model=target_model,
    )
    _settings(source_settings, source_model)
    actual = _schema_digest(source_schema, source_model)
    contract = next((row for row in _REVIEWED_CONTRACTS if row.source_model == source_model), None)
    if (
        contract is None
        or type(adapter_id) is not str
        or adapter_id != GEMINI_CREDIT_SOURCE_ADAPTER_ID
        or type(adapter_revision) is not str
        or adapter_revision != GEMINI_CREDIT_SOURCE_ADAPTER_REVISION
        or not _digest(expected_rules_digest)
        or not _digest(expected_source_schema_digest)
        or not hmac.compare_digest(expected_rules_digest, contract.rules_digest)
        or not hmac.compare_digest(expected_source_schema_digest, actual)
        or not hmac.compare_digest(actual, contract.source_schema_digest)
    ):
        _deny()
    _runtime_pin(contract, expected_source_runtime_schema_digest, source_runtime_schema)
    return contract


def restore_gemini_credit_source_contract(
    marker: object,
    *,
    source_provider: str,
    source_model: str,
    model_type: ModelType,
    target_model: str,
    source_settings: GeminiSourceSettings,
    expected_source_runtime_schema_digest: str,
    source_runtime_schema: AIModelEntity | None = None,
) -> GeminiCreditSourceContract:
    if (
        type(marker) is not dict
        or set(marker) != _MARKER_FIELDS
        or type(marker.get("schema_version")) is not int
        or marker.get("schema_version") != 1
        or any(type(value) is not str for key, value in marker.items() if key != "schema_version")
    ):
        _deny()
    contract = next((row for row in _REVIEWED_CONTRACTS if row.profile_id == marker["profile_id"]), None)
    if contract is None:
        _deny()
    expected = gemini_credit_source_marker(
        contract,
        source_provider=source_provider,
        source_model=source_model,
        model_type=model_type,
        target_model=target_model,
    )
    if marker != expected:
        _deny()
    _settings(source_settings, source_model)
    _runtime_pin(contract, expected_source_runtime_schema_digest, source_runtime_schema)
    return contract
