"""Pure exact-source042 dual-protocol guards for the NEW gpt-5.5 family.

This module is not a replacement for the original mini Chat adapter. Reviewed
profile constants/factories are added only from real source/target differential
rules. Protocol/settings guards alone never authorize a marker or model route.
"""

import hmac
from dataclasses import dataclass
from typing import Literal

from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelPropertyKey, ModelType
from services.entities.model_billing_mapping import SourceParameterContract, model_schema_digest

OPENAI_PROVIDER042_SOURCE_ADAPTER_ID = "openai_provider042_source_v1"
OPENAI_PROVIDER042_SOURCE_ADAPTER_REVISION = "1"
OPENAI_PROVIDER042_SOURCE_PROVIDER = "langgenius/openai/openai"
OPENAI_PROVIDER042_SOURCE_UID = (
    "langgenius/openai:0.4.2@21195ee1321849e0a7d4b3f6b2fd8c2be23ea6c7182e1b444ecc4c1711b52468"
)


class OpenAIProvider042SourceAdapterError(ValueError):
    """Unreviewed source facts; never disclose source settings or payloads."""


@dataclass(frozen=True, slots=True)
class OpenAI042SourceSettings:
    """The unchanged V2 fact fields, explicitly supplied rather than inferred.

    This new initial profile family is bounded to the V2 metadata-OFF scope.
    That is not a claim that source042 has the source110 telemetry behavior.
    Actual True-base routing additionally requires the private official-root
    classification from an available original SYSTEM dictionary.
    """

    protocol_selector: Literal["absent", "chat", "responses"]
    source_base_is_set: bool
    request_metadata_enabled: bool


@dataclass(frozen=True, slots=True)
class OpenAIProvider042SourceContract(SourceParameterContract):
    """Exact source042 gpt55 profile, not authority merely by its Python type."""


# Exact-source rules bind the source codec and managed transport differential.
# Admission still requires actual source installation/catalog/runtime evidence;
# these pure constants do not attest to a live source or target deployment.
_REVIEWED_CONTRACTS = (
    OpenAIProvider042SourceContract(
        profile_id="openai-042-chat-runtime-v1:gpt-5.5",
        source_plugin_unique_identifier=OPENAI_PROVIDER042_SOURCE_UID,
        source_model="gpt-5.5",
        source_schema_digest="sha256:ff2991e8c7fa82e2ce383a8f556d6f449a48e2c23604e1b30fe508729ac29ae6",
        source_runtime_schema_digest="sha256:b9d1e507d1fddfcda398ff3d120e3f46b278545a3ac45a7123982fee960c1159",
        target_model="gpt-5.5",
        rules_digest="sha256:070dc4cdccb78cce20476940cd62791525457354d5bcc6cb58f5a7e51d8ed138",
        adapter_id=OPENAI_PROVIDER042_SOURCE_ADAPTER_ID,
        algorithm_revision=OPENAI_PROVIDER042_SOURCE_ADAPTER_REVISION,
    ),
    OpenAIProvider042SourceContract(
        profile_id="openai-042-chat-official-root-runtime-v1:gpt-5.5",
        source_plugin_unique_identifier=OPENAI_PROVIDER042_SOURCE_UID,
        source_model="gpt-5.5",
        source_schema_digest="sha256:ff2991e8c7fa82e2ce383a8f556d6f449a48e2c23604e1b30fe508729ac29ae6",
        source_runtime_schema_digest="sha256:b9d1e507d1fddfcda398ff3d120e3f46b278545a3ac45a7123982fee960c1159",
        target_model="gpt-5.5",
        rules_digest="sha256:1164560533a6f2955661f55c9b00449f0264138f35dc05f871dc59c29a3d59bb",
        adapter_id=OPENAI_PROVIDER042_SOURCE_ADAPTER_ID,
        algorithm_revision=OPENAI_PROVIDER042_SOURCE_ADAPTER_REVISION,
    ),
    OpenAIProvider042SourceContract(
        profile_id="openai-042-responses-runtime-v1:gpt-5.5",
        source_plugin_unique_identifier=OPENAI_PROVIDER042_SOURCE_UID,
        source_model="gpt-5.5",
        source_schema_digest="sha256:ff2991e8c7fa82e2ce383a8f556d6f449a48e2c23604e1b30fe508729ac29ae6",
        source_runtime_schema_digest="sha256:b9d1e507d1fddfcda398ff3d120e3f46b278545a3ac45a7123982fee960c1159",
        target_model="gpt-5.5",
        rules_digest="sha256:54c602a4d8bcbb46c9a77286596e30a29237c9f7533898493776b71e723a33ba",
        adapter_id=OPENAI_PROVIDER042_SOURCE_ADAPTER_ID,
        algorithm_revision=OPENAI_PROVIDER042_SOURCE_ADAPTER_REVISION,
    ),
    OpenAIProvider042SourceContract(
        profile_id="openai-042-responses-official-root-runtime-v1:gpt-5.5",
        source_plugin_unique_identifier=OPENAI_PROVIDER042_SOURCE_UID,
        source_model="gpt-5.5",
        source_schema_digest="sha256:ff2991e8c7fa82e2ce383a8f556d6f449a48e2c23604e1b30fe508729ac29ae6",
        source_runtime_schema_digest="sha256:b9d1e507d1fddfcda398ff3d120e3f46b278545a3ac45a7123982fee960c1159",
        target_model="gpt-5.5",
        rules_digest="sha256:b4c1c3639a871ce9044c6af966145f8f1a7548f93225a4d27b8783f99601a334",
        adapter_id=OPENAI_PROVIDER042_SOURCE_ADAPTER_ID,
        algorithm_revision=OPENAI_PROVIDER042_SOURCE_ADAPTER_REVISION,
    ),
)


def openai_provider042_protocol(settings: OpenAI042SourceSettings) -> Literal["chat", "responses"]:
    if (
        type(settings) is not OpenAI042SourceSettings
        or type(settings.protocol_selector) is not str
        or settings.protocol_selector not in {"absent", "chat", "responses"}
        or type(settings.source_base_is_set) is not bool
        or type(settings.request_metadata_enabled) is not bool
        or settings.request_metadata_enabled
    ):
        raise OpenAIProvider042SourceAdapterError("OpenAI0.4.2 source settings are not reviewed")
    # This default is source-version specific. Source110 absence selects
    # Responses; source042 absence must never inherit that newer behavior.
    return "responses" if settings.protocol_selector == "responses" else "chat"


def validate_openai_provider042_identity(
    *,
    source_provider: str,
    source_model: str,
    source_plugin_unique_identifier: str,
    model_type: ModelType,
    target_model: str,
) -> None:
    if (
        source_provider != OPENAI_PROVIDER042_SOURCE_PROVIDER
        or source_plugin_unique_identifier != OPENAI_PROVIDER042_SOURCE_UID
        or source_model != "gpt-5.5"
        or target_model != "gpt-5.5"
        or model_type is not ModelType.LLM
    ):
        raise OpenAIProvider042SourceAdapterError("OpenAI0.4.2 source identity is not reviewed")


def _matches_settings(contract: OpenAIProvider042SourceContract, settings: OpenAI042SourceSettings) -> bool:
    protocol = openai_provider042_protocol(settings)
    family = "official-root-runtime-v1" if settings.source_base_is_set else "runtime-v1"
    return contract.profile_id == f"openai-042-{protocol}-{family}:gpt-5.5"


def openai_provider042_source_marker(
    contract: OpenAIProvider042SourceContract,
    *,
    source_provider: str,
    source_model: str,
    model_type: ModelType,
    target_model: str,
) -> dict[str, object]:
    if contract not in _REVIEWED_CONTRACTS:
        raise OpenAIProvider042SourceAdapterError("Unreviewed frozen OpenAI0.4.2 source contract")
    validate_openai_provider042_identity(
        source_provider=source_provider,
        source_model=source_model,
        source_plugin_unique_identifier=contract.source_plugin_unique_identifier,
        model_type=model_type,
        target_model=target_model,
    )
    return {
        "schema_version": 1,
        "profile_id": contract.profile_id,
        "source_plugin_uid": contract.source_plugin_unique_identifier,
        "source_model": contract.source_model,
        "source_schema_digest": contract.source_schema_digest,
        "rules_digest": contract.rules_digest,
    }


def build_openai_provider042_source_contract(
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
    source_settings: OpenAI042SourceSettings,
) -> OpenAIProvider042SourceContract:
    openai_provider042_protocol(source_settings)
    if not isinstance(source_schema, AIModelEntity):
        raise OpenAIProvider042SourceAdapterError("OpenAI0.4.2 source schema is not reviewed")
    actual_digest = model_schema_digest(source_schema)
    contract = next(
        (
            item
            for item in _REVIEWED_CONTRACTS
            if _matches_settings(item, source_settings)
            and item.algorithm_revision == adapter_revision
            and item.source_schema_digest == expected_source_schema_digest
            and item.rules_digest == expected_rules_digest
        ),
        None,
    )
    if (
        contract is None
        or adapter_id != contract.adapter_id
        or source_plugin_unique_identifier != contract.source_plugin_unique_identifier
        or source_schema.model != source_model
        or source_schema.model_properties.get(ModelPropertyKey.MODE) != "chat"
        or not hmac.compare_digest(actual_digest, expected_source_schema_digest)
        or not hmac.compare_digest(actual_digest, contract.source_schema_digest)
        or not hmac.compare_digest(expected_rules_digest, contract.rules_digest)
    ):
        raise OpenAIProvider042SourceAdapterError("OpenAI0.4.2 source evidence does not match")
    openai_provider042_source_marker(
        contract,
        source_provider=source_provider,
        source_model=source_model,
        model_type=source_schema.model_type,
        target_model=target_model,
    )
    return contract


def restore_openai_provider042_source_contract(
    marker: object,
    *,
    source_provider: str,
    source_model: str,
    model_type: ModelType,
    target_model: str,
    source_settings: OpenAI042SourceSettings,
) -> OpenAIProvider042SourceContract:
    openai_provider042_protocol(source_settings)
    keys = {"schema_version", "profile_id", "source_plugin_uid", "source_model", "source_schema_digest", "rules_digest"}
    if (
        not isinstance(marker, dict)
        or set(marker) != keys
        or type(marker["schema_version"]) is not int
        or any(type(value) is not str for key, value in marker.items() if key != "schema_version")
    ):
        raise OpenAIProvider042SourceAdapterError("Invalid frozen OpenAI0.4.2 source marker")
    contract = next(
        (
            item
            for item in _REVIEWED_CONTRACTS
            if item.profile_id == marker["profile_id"] and _matches_settings(item, source_settings)
        ),
        None,
    )
    if contract is None:
        raise OpenAIProvider042SourceAdapterError("Invalid frozen OpenAI0.4.2 source marker")
    if marker != openai_provider042_source_marker(
        contract,
        source_provider=source_provider,
        source_model=source_model,
        model_type=model_type,
        target_model=target_model,
    ):
        raise OpenAIProvider042SourceAdapterError("Invalid frozen OpenAI0.4.2 source marker")
    return contract
