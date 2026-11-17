"""Pure exact-source OpenAI1.1.0 managed-routing evidence policy.

The source UID determines its default protocol: literal absent means Responses
for 1.1.0, not the older 0.4.2 Chat default. Settings must come from an available
SYSTEM credential dictionary before shared-pool credentials are cleared. This
module performs no I/O and a marker alone never authorizes SYSTEM routing.
"""

import hmac
from dataclasses import dataclass
from typing import Literal

from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelPropertyKey, ModelType
from services.entities.model_billing_mapping import SourceParameterContract, model_schema_digest

OPENAI_PROVIDER110_SOURCE_ADAPTER_ID = "openai_provider110_source_v1"
OPENAI_PROVIDER110_SOURCE_ADAPTER_REVISION = "1"
OPENAI_PROVIDER110_SOURCE_PROVIDER = "langgenius/openai/openai"
OPENAI_PROVIDER110_ARTIFACT_SOURCE_UID = (
    "langgenius/openai:1.1.0@1ded02acee56efd5788c86fd447d792e4923e959554a4942f440c7859d164340"
)


class OpenAIProvider110SourceAdapterError(ValueError):
    """Unknown or mismatched source facts; never disclose settings or payloads."""


@dataclass(frozen=True, slots=True)
class OpenAI110SourceSettings:
    """Explicit public facts, not a credential dictionary or a nullable default."""

    protocol_selector: Literal["absent", "chat", "responses"]
    source_base_is_set: bool
    request_metadata_enabled: bool


@dataclass(frozen=True, slots=True)
class OpenAIProvider110SourceContract(SourceParameterContract):
    """Exact reviewed profile; defaults/identity semantics are bound in its rules."""


# Exact-source drafts: admission additionally requires frozen registry mapping,
# SYSTEM facts, actual installed UID and runtime-schema handshake. No model
# name, default-protocol inference or native Tokener schema can substitute.
_REVIEWED_CONTRACTS = (
    OpenAIProvider110SourceContract(
        profile_id="openai-110-chat-runtime-v1:gpt-4o-mini",
        source_plugin_unique_identifier="langgenius/openai:1.1.0@95f7de6ee42124cb7649f20d3f175c5b0adb66ad92640a97e4027c15b266141c",
        source_model="gpt-4o-mini",
        source_schema_digest="sha256:ebda9a686193f5f2e19da7cf059d4357dacfb09e09c010480d2003792236d8a0",
        source_runtime_schema_digest="sha256:224a3127e23eb4d47ebe765dc5af81ba6b7c9510167d8dceedbe33c7c3ad3d2d",
        target_model="gpt-4o-mini",
        rules_digest="sha256:72e1111fabd44f62eb72ea61a19f6fb00939ed8d25c218eb0fbbde9b0f285efa",
        adapter_id="openai_provider110_source_v1",
        algorithm_revision="1",
    ),
    OpenAIProvider110SourceContract(
        profile_id="openai-110-responses-runtime-v1:gpt-4o-mini",
        source_plugin_unique_identifier="langgenius/openai:1.1.0@95f7de6ee42124cb7649f20d3f175c5b0adb66ad92640a97e4027c15b266141c",
        source_model="gpt-4o-mini",
        source_schema_digest="sha256:ebda9a686193f5f2e19da7cf059d4357dacfb09e09c010480d2003792236d8a0",
        source_runtime_schema_digest="sha256:224a3127e23eb4d47ebe765dc5af81ba6b7c9510167d8dceedbe33c7c3ad3d2d",
        target_model="gpt-4o-mini",
        rules_digest="sha256:cafcb63de94a46cd83761fbf0772ec635a79cb476bf584313341bf22f01d9a08",
        adapter_id="openai_provider110_source_v1",
        algorithm_revision="1",
    ),
)

_OFFICIAL_ROOT_REVIEWED_CONTRACTS = (
    OpenAIProvider110SourceContract(
        profile_id="openai-110-chat-official-root-runtime-v1:gpt-4o-mini",
        source_plugin_unique_identifier="langgenius/openai:1.1.0@95f7de6ee42124cb7649f20d3f175c5b0adb66ad92640a97e4027c15b266141c",
        source_model="gpt-4o-mini",
        source_schema_digest="sha256:ebda9a686193f5f2e19da7cf059d4357dacfb09e09c010480d2003792236d8a0",
        source_runtime_schema_digest="sha256:224a3127e23eb4d47ebe765dc5af81ba6b7c9510167d8dceedbe33c7c3ad3d2d",
        target_model="gpt-4o-mini",
        rules_digest="sha256:b2ab77722d6f3b40442e92c751722fa614959001b4b7da4bf5a13592abe98ec3",
        adapter_id="openai_provider110_source_v1",
        algorithm_revision="2",
    ),
    OpenAIProvider110SourceContract(
        profile_id="openai-110-responses-official-root-runtime-v1:gpt-4o-mini",
        source_plugin_unique_identifier="langgenius/openai:1.1.0@95f7de6ee42124cb7649f20d3f175c5b0adb66ad92640a97e4027c15b266141c",
        source_model="gpt-4o-mini",
        source_schema_digest="sha256:ebda9a686193f5f2e19da7cf059d4357dacfb09e09c010480d2003792236d8a0",
        source_runtime_schema_digest="sha256:224a3127e23eb4d47ebe765dc5af81ba6b7c9510167d8dceedbe33c7c3ad3d2d",
        target_model="gpt-4o-mini",
        rules_digest="sha256:16e05389cc3735a9332be93b7396df0ed89d3e0175f07fb0755fe1b2ffd8a200",
        adapter_id="openai_provider110_source_v1",
        algorithm_revision="2",
    ),
)
# Separate exact signed artifact; historical tuples above remain immutable.
_ARTIFACT_REVIEWED_CONTRACTS = (
    OpenAIProvider110SourceContract(
        profile_id="openai-110-1ded-chat-runtime-v1:gpt-4o-mini",
        source_plugin_unique_identifier="langgenius/openai:1.1.0@1ded02acee56efd5788c86fd447d792e4923e959554a4942f440c7859d164340",
        source_model="gpt-4o-mini",
        source_schema_digest="sha256:ebda9a686193f5f2e19da7cf059d4357dacfb09e09c010480d2003792236d8a0",
        source_runtime_schema_digest="sha256:224a3127e23eb4d47ebe765dc5af81ba6b7c9510167d8dceedbe33c7c3ad3d2d",
        target_model="gpt-4o-mini",
        rules_digest="sha256:e60f57b1ab8cbae8e6f726b08c9fa8cff5f7654324d14b1fac8b1f9fba608ece",
        adapter_id="openai_provider110_source_v1",
        algorithm_revision="1",
    ),
    OpenAIProvider110SourceContract(
        profile_id="openai-110-1ded-responses-runtime-v1:gpt-4o-mini",
        source_plugin_unique_identifier="langgenius/openai:1.1.0@1ded02acee56efd5788c86fd447d792e4923e959554a4942f440c7859d164340",
        source_model="gpt-4o-mini",
        source_schema_digest="sha256:ebda9a686193f5f2e19da7cf059d4357dacfb09e09c010480d2003792236d8a0",
        source_runtime_schema_digest="sha256:224a3127e23eb4d47ebe765dc5af81ba6b7c9510167d8dceedbe33c7c3ad3d2d",
        target_model="gpt-4o-mini",
        rules_digest="sha256:652c763f7d49f008babfc6f33cb2cea754e2befb00e2ed18de22b507b2ee24d4",
        adapter_id="openai_provider110_source_v1",
        algorithm_revision="1",
    ),
    OpenAIProvider110SourceContract(
        profile_id="openai-110-1ded-chat-official-root-runtime-v1:gpt-4o-mini",
        source_plugin_unique_identifier="langgenius/openai:1.1.0@1ded02acee56efd5788c86fd447d792e4923e959554a4942f440c7859d164340",
        source_model="gpt-4o-mini",
        source_schema_digest="sha256:ebda9a686193f5f2e19da7cf059d4357dacfb09e09c010480d2003792236d8a0",
        source_runtime_schema_digest="sha256:224a3127e23eb4d47ebe765dc5af81ba6b7c9510167d8dceedbe33c7c3ad3d2d",
        target_model="gpt-4o-mini",
        rules_digest="sha256:5700b48cf440d6c0a1f7ed860d282f590476ca0543e5fd8841202fd27fcd24e5",
        adapter_id="openai_provider110_source_v1",
        algorithm_revision="2",
    ),
    OpenAIProvider110SourceContract(
        profile_id="openai-110-1ded-responses-official-root-runtime-v1:gpt-4o-mini",
        source_plugin_unique_identifier="langgenius/openai:1.1.0@1ded02acee56efd5788c86fd447d792e4923e959554a4942f440c7859d164340",
        source_model="gpt-4o-mini",
        source_schema_digest="sha256:ebda9a686193f5f2e19da7cf059d4357dacfb09e09c010480d2003792236d8a0",
        source_runtime_schema_digest="sha256:224a3127e23eb4d47ebe765dc5af81ba6b7c9510167d8dceedbe33c7c3ad3d2d",
        target_model="gpt-4o-mini",
        rules_digest="sha256:b0f101c4beb17bd0a4ddf20b01a3c459fad919a4a8c6b900e34c537559df3a2d",
        adapter_id="openai_provider110_source_v1",
        algorithm_revision="2",
    ),
)
_ALL_REVIEWED_CONTRACTS = (*_REVIEWED_CONTRACTS, *_OFFICIAL_ROOT_REVIEWED_CONTRACTS, *_ARTIFACT_REVIEWED_CONTRACTS)


def _protocol(settings: OpenAI110SourceSettings) -> Literal["chat", "responses"]:
    if (
        type(settings) is not OpenAI110SourceSettings
        or not isinstance(settings.protocol_selector, str)
        or settings.protocol_selector not in {"absent", "chat", "responses"}
        or type(settings.source_base_is_set) is not bool
        or type(settings.request_metadata_enabled) is not bool
        or settings.request_metadata_enabled
    ):
        raise OpenAIProvider110SourceAdapterError("OpenAI1.1.0 source settings are not reviewed")
    return "chat" if settings.protocol_selector == "chat" else "responses"


def _matches_settings(
    contract: OpenAIProvider110SourceContract, protocol: str, settings: OpenAI110SourceSettings
) -> bool:
    family = "official-root-runtime-v1" if settings.source_base_is_set else "runtime-v1"
    artifact = "-1ded" if contract.source_plugin_unique_identifier == OPENAI_PROVIDER110_ARTIFACT_SOURCE_UID else ""
    return contract.profile_id == f"openai-110{artifact}-{protocol}-{family}:gpt-4o-mini"


def openai_provider110_source_marker(
    contract: OpenAIProvider110SourceContract,
    *,
    source_provider: str,
    source_model: str,
    model_type: ModelType,
    target_model: str,
) -> dict[str, object]:
    if (
        contract not in _ALL_REVIEWED_CONTRACTS
        or source_provider != OPENAI_PROVIDER110_SOURCE_PROVIDER
        or source_model != contract.source_model
        or model_type != ModelType.LLM
        or target_model != contract.target_model
    ):
        raise OpenAIProvider110SourceAdapterError("Unreviewed frozen OpenAI1.1.0 source contract")
    return {
        "schema_version": 1,
        "profile_id": contract.profile_id,
        "source_plugin_uid": contract.source_plugin_unique_identifier,
        "source_model": contract.source_model,
        "source_schema_digest": contract.source_schema_digest,
        "rules_digest": contract.rules_digest,
    }


def build_openai_provider110_source_contract(
    *,
    adapter_id: str,
    adapter_revision: str,
    expected_rules_digest: str,
    source_provider: str,
    source_model: str,
    source_plugin_unique_identifier: str,
    source_schema: AIModelEntity,
    expected_source_schema_digest: str,
    target_model: str,
    source_settings: OpenAI110SourceSettings,
) -> OpenAIProvider110SourceContract:
    protocol = _protocol(source_settings)
    actual_digest = model_schema_digest(source_schema)
    contract = next(
        (
            item
            for item in _ALL_REVIEWED_CONTRACTS
            if item.source_plugin_unique_identifier == source_plugin_unique_identifier
            and _matches_settings(item, protocol, source_settings)
            and item.algorithm_revision == adapter_revision
            and item.source_schema_digest == expected_source_schema_digest
            and item.rules_digest == expected_rules_digest
        ),
        None,
    )
    if (
        contract is None
        or adapter_id != contract.adapter_id
        or adapter_revision != contract.algorithm_revision
        or source_plugin_unique_identifier != contract.source_plugin_unique_identifier
        or source_schema.model != source_model
        or source_schema.model_properties.get(ModelPropertyKey.MODE) != "chat"
        or not hmac.compare_digest(actual_digest, expected_source_schema_digest)
        or not hmac.compare_digest(actual_digest, contract.source_schema_digest)
        or not hmac.compare_digest(expected_rules_digest, contract.rules_digest)
    ):
        raise OpenAIProvider110SourceAdapterError("OpenAI1.1.0 source evidence does not match")
    openai_provider110_source_marker(
        contract,
        source_provider=source_provider,
        source_model=source_model,
        model_type=source_schema.model_type,
        target_model=target_model,
    )
    return contract


def restore_openai_provider110_source_contract(
    marker: object,
    *,
    source_provider: str,
    source_model: str,
    model_type: ModelType,
    target_model: str,
    source_settings: OpenAI110SourceSettings,
) -> OpenAIProvider110SourceContract:
    protocol = _protocol(source_settings)
    keys = {
        "schema_version",
        "profile_id",
        "source_plugin_uid",
        "source_model",
        "source_schema_digest",
        "rules_digest",
    }
    if (
        not isinstance(marker, dict)
        or set(marker) != keys
        or type(marker["schema_version"]) is not int
        or any(not isinstance(value, str) for key, value in marker.items() if key != "schema_version")
    ):
        raise OpenAIProvider110SourceAdapterError("Invalid frozen OpenAI1.1.0 source marker")
    contract = next(
        (
            item
            for item in _ALL_REVIEWED_CONTRACTS
            if item.profile_id == marker["profile_id"]
            and item.source_plugin_unique_identifier == marker["source_plugin_uid"]
            and _matches_settings(item, protocol, source_settings)
        ),
        None,
    )
    if contract is None:
        raise OpenAIProvider110SourceAdapterError("Invalid frozen OpenAI1.1.0 source marker")
    expected = openai_provider110_source_marker(
        contract,
        source_provider=source_provider,
        source_model=source_model,
        model_type=model_type,
        target_model=target_model,
    )
    if marker != expected:
        raise OpenAIProvider110SourceAdapterError("Invalid frozen OpenAI1.1.0 source marker")
    return contract
