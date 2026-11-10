"""Pure exact Gemini0913 source factory, separate from immutable0912/V6.

Pins bind the frozen v2 packet fd9d7680 / raw8c32f42e to the actual Source
catalog/runtime Core entities. They prove no installed target, current SDK,
network, credential, migration, billing or release authority. None runtime
schema remains frozen/prospective restoration, never observed RPC evidence.
"""

from __future__ import annotations

import hmac
import re
from dataclasses import dataclass
from typing import Never

from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelPropertyKey, ModelType
from services.entities.model_billing_gemini_mapping import (
    GeminiSourceSettings,
    gemini_source_model_type,
)
from services.entities.model_billing_gemini_v8_mapping import GEMINI_0913_SOURCE_UID
from services.entities.model_billing_mapping import SourceParameterContract, model_schema_digest

GEMINI_CREDIT_SOURCE_ADAPTER_ID = "gemini_credit_source_v2"
GEMINI_CREDIT_SOURCE_ADAPTER_REVISION = "1"
GEMINI_CREDIT_SOURCE_PROVIDER = "langgenius/gemini/google"


class GeminiCreditSourceV2AdapterError(ValueError):
    """Fixed safe denial; unknown settings/schema never authorize a route."""


@dataclass(frozen=True, slots=True)
class GeminiCreditSourceV2Contract(SourceParameterContract):
    """An exact immutable reviewed profile, not a routing authorization."""


_REVIEWED_CONTRACTS = (
    GeminiCreditSourceV2Contract(
        profile_id="gemini0913-native-v1:gemini-2.5-flash",
        source_plugin_unique_identifier="langgenius/gemini:0.9.13@4378187cfc50d4253573f4d96baa13228d8ed2eb746ac3bae492a8eaee2da458",
        source_model="gemini-2.5-flash",
        source_schema_digest="sha256:9dfef26ae8e27359f74312f87ca295e08ec59f187c889d4fc5eed747f22682ef",
        source_runtime_schema_digest="sha256:e3a9e5a6146b14480e5f9948993afeab62e640b1559bd953fea98651ee1d5a21",
        target_model="gemini-2.5-flash",
        rules_digest="sha256:13ca4eb8ba52db4537a9177114d1b41f5a468ee79ecbdbc65b6ad940979d79ce",
        adapter_id="gemini_credit_source_v2",
        algorithm_revision="1",
    ),
    GeminiCreditSourceV2Contract(
        profile_id="gemini0913-native-v1:gemini-3.1-flash-lite",
        source_plugin_unique_identifier="langgenius/gemini:0.9.13@4378187cfc50d4253573f4d96baa13228d8ed2eb746ac3bae492a8eaee2da458",
        source_model="gemini-3.1-flash-lite",
        source_schema_digest="sha256:26dc99d59bdab5b1ff139aad894dae0fc15c9baf06777af67b9462f113193504",
        source_runtime_schema_digest="sha256:0ee6cea0716356f3d3951066ec994ba34b50cf48fecf8d07c9e9611861e627a4",
        target_model="gemini-3.1-flash-lite",
        rules_digest="sha256:53574a2d8920b48b3152f97fccc70217e831dfba10d60c97690f9862ac2123ce",
        adapter_id="gemini_credit_source_v2",
        algorithm_revision="1",
    ),
    GeminiCreditSourceV2Contract(
        profile_id="gemini0913-native-v1:gemini-3.1-pro-preview",
        source_plugin_unique_identifier="langgenius/gemini:0.9.13@4378187cfc50d4253573f4d96baa13228d8ed2eb746ac3bae492a8eaee2da458",
        source_model="gemini-3.1-pro-preview",
        source_schema_digest="sha256:9aceca99ac88649944f9d78102241853c8144d1a11f4c086bb5f27bc38766e34",
        source_runtime_schema_digest="sha256:3a2ce7dce3477bd042314941826492a5496aeb8bdb047285514a305d810e918e",
        target_model="gemini-3.1-pro-preview",
        rules_digest="sha256:8fb951c69113cc92eedb5e564817c897804b151f089851e783b0fd2dcc68a3eb",
        adapter_id="gemini_credit_source_v2",
        algorithm_revision="1",
    ),
    GeminiCreditSourceV2Contract(
        profile_id="gemini0913-native-v1:gemini-3.5-flash",
        source_plugin_unique_identifier="langgenius/gemini:0.9.13@4378187cfc50d4253573f4d96baa13228d8ed2eb746ac3bae492a8eaee2da458",
        source_model="gemini-3.5-flash",
        source_schema_digest="sha256:fa5fbdb6fa5ef69496f62f6dc2f4ead6b34d82f26cb6fc793fabf25577b667aa",
        source_runtime_schema_digest="sha256:54aefc309ce57ff15f93ee606bb0919f1eb9649d057957cb6ea1fb2b60a3ab44",
        target_model="gemini-3.5-flash",
        rules_digest="sha256:cd75ed07076e1eebc099e93ada8110754bfd95767f05b1099b688f54db61b1b3",
        adapter_id="gemini_credit_source_v2",
        algorithm_revision="1",
    ),
    GeminiCreditSourceV2Contract(
        profile_id="gemini0913-native-v1:gemini-3.5-flash-lite",
        source_plugin_unique_identifier="langgenius/gemini:0.9.13@4378187cfc50d4253573f4d96baa13228d8ed2eb746ac3bae492a8eaee2da458",
        source_model="gemini-3.5-flash-lite",
        source_schema_digest="sha256:230f022992a7882a800fc31d4b754ca51032a2342a4644ce250f58abc4bf07c9",
        source_runtime_schema_digest="sha256:613acb7a29a51dffcf3ffd506f306ba6002599d5765a1baffb66d3ade9257355",
        target_model="gemini-3.5-flash-lite",
        rules_digest="sha256:601f024ab221e97fc8a80381e068ec3cd948704c57d88d722363ae59a22aad6f",
        adapter_id="gemini_credit_source_v2",
        algorithm_revision="1",
    ),
    GeminiCreditSourceV2Contract(
        profile_id="gemini0913-native-v1:gemini-3.7-flash",
        source_plugin_unique_identifier="langgenius/gemini:0.9.13@4378187cfc50d4253573f4d96baa13228d8ed2eb746ac3bae492a8eaee2da458",
        source_model="gemini-3.7-flash",
        source_schema_digest="sha256:c718fa257170b98e87fd7a0c00c56613cb611d4d18ad1256dd375c9eaf908676",
        source_runtime_schema_digest="sha256:7b1cd0a9ea9fbe14386d8458a6bec68833343cdbf4383c460bf0ac2a20f68189",
        target_model="gemini-3.7-flash",
        rules_digest="sha256:48ea4bb566bf12eb497eea6e23c8360c1fc3635b9ba9582a829a82c2ed5cfe70",
        adapter_id="gemini_credit_source_v2",
        algorithm_revision="1",
    ),
    GeminiCreditSourceV2Contract(
        profile_id="gemini0913-native-v1:gemini-3-flash-preview",
        source_plugin_unique_identifier="langgenius/gemini:0.9.13@4378187cfc50d4253573f4d96baa13228d8ed2eb746ac3bae492a8eaee2da458",
        source_model="gemini-3-flash-preview",
        source_schema_digest="sha256:7a0371459f73f0ba41d20f0ef274923e131032931fb55c9865c7478b42a10f2b",
        source_runtime_schema_digest="sha256:ccaa15b0d9e20840ab62d077c5c0a62fd9f5339d04f4d4ab0a978962ac83dab1",
        target_model="gemini-3-flash-preview",
        rules_digest="sha256:1d608a9072491a4e052a54b3447fce10cd0d6b1083a49fa70e37925736e20a28",
        adapter_id="gemini_credit_source_v2",
        algorithm_revision="1",
    ),
    GeminiCreditSourceV2Contract(
        profile_id="gemini0913-native-v1:gemini-embedding-001",
        source_plugin_unique_identifier="langgenius/gemini:0.9.13@4378187cfc50d4253573f4d96baa13228d8ed2eb746ac3bae492a8eaee2da458",
        source_model="gemini-embedding-001",
        source_schema_digest="sha256:470e3397c5097df3b54673901fc321ce298e6081369bc731432e042daa04fb5d",
        source_runtime_schema_digest="sha256:470e3397c5097df3b54673901fc321ce298e6081369bc731432e042daa04fb5d",
        target_model="gemini-embedding-001",
        rules_digest="sha256:c2d37d9c263af1eeedce8e2c94cb648f995bf1c0c83cd9c7d69baf70bab05d4e",
        adapter_id="gemini_credit_source_v2",
        algorithm_revision="1",
    ),
    GeminiCreditSourceV2Contract(
        profile_id="gemini0913-native-v1:gemini-embedding-2-preview",
        source_plugin_unique_identifier="langgenius/gemini:0.9.13@4378187cfc50d4253573f4d96baa13228d8ed2eb746ac3bae492a8eaee2da458",
        source_model="gemini-embedding-2-preview",
        source_schema_digest="sha256:b16129e398a864dd0baee0c957c4c42573ef888b785c6aaec9d78ac2785e063b",
        source_runtime_schema_digest="sha256:b16129e398a864dd0baee0c957c4c42573ef888b785c6aaec9d78ac2785e063b",
        target_model="gemini-embedding-2-preview",
        rules_digest="sha256:e13153f791fe3f15ea8cf2c7e71df72a76e2046e876d37c66e0e3fe2785a540a",
        adapter_id="gemini_credit_source_v2",
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
    raise GeminiCreditSourceV2AdapterError("Gemini source evidence is not reviewed")


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
        or source_plugin_unique_identifier != GEMINI_0913_SOURCE_UID
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


def _runtime_pin(contract: GeminiCreditSourceV2Contract, expected: str, observed: AIModelEntity | None) -> None:
    if not _digest(expected) or not hmac.compare_digest(expected, contract.source_runtime_schema_digest or ""):
        _deny()
    # None is frozen/prospective restoration, NEVER observed runtime evidence.
    if observed is not None and not hmac.compare_digest(_schema_digest(observed, contract.source_model), expected):
        _deny()


def gemini_credit_source_marker(
    contract: GeminiCreditSourceV2Contract,
    *,
    source_provider: str,
    source_model: str,
    model_type: ModelType,
    target_model: str,
) -> dict[str, object]:
    if type(contract) is not GeminiCreditSourceV2Contract or contract not in _REVIEWED_CONTRACTS:
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
) -> GeminiCreditSourceV2Contract:
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
) -> GeminiCreditSourceV2Contract:
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
