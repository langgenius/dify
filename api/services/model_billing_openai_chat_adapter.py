"""Exact-source OpenAI Chat semantics for managed Tokener redirects only.

Only the reviewed immutable OpenAI0.4.2 gpt-4o-mini binding is admitted. The
source protocol is an explicit fact from fresh SYSTEM credentials: absence
means the source's default Chat behavior, while explicit Responses is never
overridden. A private marker is not routing authorization. Callers must still
prove SYSTEM settlement, actual installed source identity and frozen mapping.
This policy performs no I/O and never reads credentials/configuration itself.
"""

import hmac
from dataclasses import dataclass
from typing import Literal

from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelPropertyKey, ModelType
from services.entities.model_billing_mapping import SourceParameterContract, model_schema_digest

OPENAI_CHAT_SOURCE_ADAPTER_ID = "openai_chat_source_v1"
OPENAI_CHAT_SOURCE_ADAPTER_REVISION = "1"
OPENAI_CHAT_SOURCE_PROVIDER = "langgenius/openai/openai"


class OpenAIChatSourceAdapterError(ValueError):
    """Unreviewed or mismatched source evidence; never disclose payloads."""


@dataclass(frozen=True, slots=True)
class OpenAIChatSourceContract(SourceParameterContract):
    """Frozen reviewed Chat profile; protocol approval precedes construction."""


_REVIEWED_CONTRACT = OpenAIChatSourceContract(
    profile_id="openai-042-chat:gpt-4o-mini",
    source_plugin_unique_identifier="langgenius/openai:0.4.2@21195ee1321849e0a7d4b3f6b2fd8c2be23ea6c7182e1b444ecc4c1711b52468",
    source_model="gpt-4o-mini",
    source_schema_digest="sha256:e322eaf07a393f69b01a5911084192a5a6e9b790d4fbaebd30df5c30ae81ea33",
    target_model="gpt-4o-mini",
    rules_digest="sha256:81b8e1fa413088fa08c8f5114a9668fb0d9289fe6e60b07b16a805478ef912f2",
    adapter_id=OPENAI_CHAT_SOURCE_ADAPTER_ID,
    algorithm_revision=OPENAI_CHAT_SOURCE_ADAPTER_REVISION,
)

# Append-only: revision 1 above retains its original SDK-fixture boundary and
# digest. This separately reviewed profile binds the actual daemon management
# catalog and the actual immutable source model/schema RPC independently.
_RUNTIME_REVIEWED_CONTRACT = OpenAIChatSourceContract(
    profile_id="openai-042-chat-runtime-v2:gpt-4o-mini",
    source_plugin_unique_identifier="langgenius/openai:0.4.2@21195ee1321849e0a7d4b3f6b2fd8c2be23ea6c7182e1b444ecc4c1711b52468",
    source_model="gpt-4o-mini",
    source_schema_digest="sha256:a6252c47636c0aa0b3c66327d3a512711abcd61cca079ac53a51c435a2d65771",
    source_runtime_schema_digest="sha256:b068793d31c93e11b44e31374e24f62ce25b7c8744aae708213f7caa41be4783",
    target_model="gpt-4o-mini",
    rules_digest="sha256:e29241cc424a064f8d34a19f878a3bb71e853bd41c302037f400f11297c88835",
    adapter_id=OPENAI_CHAT_SOURCE_ADAPTER_ID,
    algorithm_revision="2",
)
_REVIEWED_CONTRACTS = (_REVIEWED_CONTRACT, _RUNTIME_REVIEWED_CONTRACT)

# Append-only: older profile IDs, rules, revisions and V1 factories retain
# their semantics. This profile explicitly requires the reviewed official root.
_OFFICIAL_ROOT_REVIEWED_CONTRACT = OpenAIChatSourceContract(
    profile_id="openai-042-chat-official-root-runtime-v1:gpt-4o-mini",
    source_plugin_unique_identifier="langgenius/openai:0.4.2@21195ee1321849e0a7d4b3f6b2fd8c2be23ea6c7182e1b444ecc4c1711b52468",
    source_model="gpt-4o-mini",
    source_schema_digest="sha256:a6252c47636c0aa0b3c66327d3a512711abcd61cca079ac53a51c435a2d65771",
    source_runtime_schema_digest="sha256:b068793d31c93e11b44e31374e24f62ce25b7c8744aae708213f7caa41be4783",
    target_model="gpt-4o-mini",
    rules_digest="sha256:24a22201b52da002bcbf882158ba90bbdfd9b9047a6904b9c8c1c8a2977ae3e3",
    adapter_id=OPENAI_CHAT_SOURCE_ADAPTER_ID,
    algorithm_revision="3",
)
_ALL_REVIEWED_CONTRACTS = (*_REVIEWED_CONTRACTS, _OFFICIAL_ROOT_REVIEWED_CONTRACT)


def _require_endpoint_policy(
    contract: OpenAIChatSourceContract, source_endpoint_class: Literal["unset", "official_root"] | None
) -> None:
    # None exists solely for unchanged V1 callers. New V2 True rows must name
    # the official profile. Actual URL authority is separately captured from
    # the request-local SYSTEM dictionary, never from this prospective policy.
    if source_endpoint_class not in (None, "unset", "official_root") or (
        contract == _OFFICIAL_ROOT_REVIEWED_CONTRACT
    ) != (source_endpoint_class == "official_root"):
        raise OpenAIChatSourceAdapterError("Source endpoint does not match the reviewed Chat profile")


def _require_chat_protocol(source_api_protocol: object) -> None:
    # None is meaningful: exact source runtime chooses Chat when the optional
    # api_protocol credential is absent. Do not coerce unknown or false values.
    if source_api_protocol is not None and source_api_protocol != "chat":
        raise OpenAIChatSourceAdapterError("Source is not a reviewed Chat protocol")


def openai_chat_source_marker(
    contract: OpenAIChatSourceContract,
    *,
    source_provider: str,
    source_model: str,
    model_type: ModelType,
    target_model: str,
) -> dict[str, object]:
    """Revalidate the frozen source binding, not caller-supplied model settings."""
    if (
        contract not in _ALL_REVIEWED_CONTRACTS
        or source_provider != OPENAI_CHAT_SOURCE_PROVIDER
        or source_model != contract.source_model
        or model_type != ModelType.LLM
        or target_model != contract.target_model
    ):
        raise OpenAIChatSourceAdapterError("Unreviewed frozen OpenAI Chat source contract")
    return {
        "schema_version": 1,
        "profile_id": contract.profile_id,
        "source_plugin_uid": contract.source_plugin_unique_identifier,
        "source_model": contract.source_model,
        "source_schema_digest": contract.source_schema_digest,
        "rules_digest": contract.rules_digest,
    }


def build_openai_chat_source_contract(
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
    source_api_protocol: object,
    source_endpoint_class: Literal["unset", "official_root"] | None = None,
) -> OpenAIChatSourceContract:
    """Require fresh installed schema/UID, mapping and SYSTEM protocol evidence."""
    _require_chat_protocol(source_api_protocol)
    actual_digest = model_schema_digest(source_schema)
    contract = next(
        (
            item
            for item in _ALL_REVIEWED_CONTRACTS
            if item.algorithm_revision == adapter_revision
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
        raise OpenAIChatSourceAdapterError("OpenAI Chat evidence does not match a reviewed profile")
    _require_endpoint_policy(contract, source_endpoint_class)
    openai_chat_source_marker(
        contract,
        source_provider=source_provider,
        source_model=source_model,
        model_type=source_schema.model_type,
        target_model=target_model,
    )
    return contract


def restore_openai_chat_source_contract(
    marker: object,
    *,
    source_provider: str,
    source_model: str,
    model_type: ModelType,
    target_model: str,
    source_api_protocol: object,
    source_endpoint_class: Literal["unset", "official_root"] | None = None,
) -> OpenAIChatSourceContract:
    """Restore only evidence from a fresh source inventory, never a public marker."""
    _require_chat_protocol(source_api_protocol)
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
        raise OpenAIChatSourceAdapterError("Invalid frozen OpenAI Chat source marker")
    contract = next((item for item in _ALL_REVIEWED_CONTRACTS if item.profile_id == marker["profile_id"]), None)
    if contract is None:
        raise OpenAIChatSourceAdapterError("Invalid frozen OpenAI Chat source marker")
    _require_endpoint_policy(contract, source_endpoint_class)
    expected = openai_chat_source_marker(
        contract,
        source_provider=source_provider,
        source_model=source_model,
        model_type=model_type,
        target_model=target_model,
    )
    if marker != expected:
        raise OpenAIChatSourceAdapterError("Invalid frozen OpenAI Chat source marker")
    return contract
