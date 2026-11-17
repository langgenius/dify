"""Pure exact-source policy for a NEW managed OpenAI embedding family.

Only immutable reviewed profile/rules bodies may enter the contract allowlist.
Actual SYSTEM facts and independent catalog/runtime-schema evidence are still
required by routing/readiness; a private marker never grants that authority.
The same embedding codec profile serves the two proved endpoint classes. This
module never reads raw credential flags, maps dimensions, or performs I/O.
Existing V1/V2 declarations, profiles and serialized plans are unchanged.
"""

import hmac
from dataclasses import dataclass
from typing import Literal

from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelType
from services.entities.model_billing_mapping import SourceParameterContract, model_schema_digest

OPENAI_EMBEDDING_SOURCE_ADAPTER_ID = "openai_embedding_source_v1"
OPENAI_EMBEDDING_SOURCE_ADAPTER_REVISION = "1"
OPENAI_EMBEDDING_SOURCE_PROVIDER = "langgenius/openai/openai"
OPENAI_EMBEDDING_SOURCE_MODELS = frozenset(
    {"text-embedding-3-small", "text-embedding-3-large", "text-embedding-ada-002"}
)
OPENAI_EMBEDDING_SOURCE_UIDS = frozenset(
    {
        "langgenius/openai:0.4.2@21195ee1321849e0a7d4b3f6b2fd8c2be23ea6c7182e1b444ecc4c1711b52468",
        "langgenius/openai:1.1.0@95f7de6ee42124cb7649f20d3f175c5b0adb66ad92640a97e4027c15b266141c",
    }
)
OPENAI_EMBEDDING_ARTIFACT_SOURCE_UID = (
    "langgenius/openai:1.1.0@1ded02acee56efd5788c86fd447d792e4923e959554a4942f440c7859d164340"
)
OPENAI_EMBEDDING_REVIEWED_SOURCE_UIDS = OPENAI_EMBEDDING_SOURCE_UIDS | {OPENAI_EMBEDDING_ARTIFACT_SOURCE_UID}
OPENAI_EMBEDDING_SOURCE_OPERATIONS = frozenset({"model/schema", "text_embedding/invoke", "text_embedding/num_tokens"})


class OpenAIEmbeddingSourceAdapterError(ValueError):
    """Unreviewed source facts; never disclose credentials, URLs or payloads."""


@dataclass(frozen=True, slots=True)
class OpenAIEmbeddingSourceSettings:
    """Positive public endpoint classification, not a caller-supplied URL.

    The exact source embedding implementation reads neither api_protocol nor
    enable_request_metadata. This behavior describes proved source semantics,
    not a fabricated False value for the original credential dictionary.
    """

    source_endpoint_class: Literal["unset", "official_root"]
    request_metadata_behavior: Literal["not_used"]


@dataclass(frozen=True, slots=True)
class OpenAIEmbeddingSourceContract(SourceParameterContract):
    """Exact immutable embedding profile, never authority merely by its type."""


# Exact source profiles: both admitted endpoint classes use the same proved
# codec, but each source package retains its own rules/empty/merge semantics.
# Catalog/runtime hashes are Core-projected schema boundaries, not raw SDK JSON.
# These constants attest neither a live installation nor a successful payment.
_REVIEWED_CONTRACTS = (
    OpenAIEmbeddingSourceContract(
        profile_id="openai-042-embedding-runtime-v1:text-embedding-3-large",
        source_plugin_unique_identifier="langgenius/openai:0.4.2@21195ee1321849e0a7d4b3f6b2fd8c2be23ea6c7182e1b444ecc4c1711b52468",
        source_model="text-embedding-3-large",
        source_schema_digest="sha256:aac5a07e511a6398575c855a61f572add58bdae23f28ad072a92bb7c58e47f5d",
        source_runtime_schema_digest="sha256:aac5a07e511a6398575c855a61f572add58bdae23f28ad072a92bb7c58e47f5d",
        target_model="text-embedding-3-large",
        rules_digest="sha256:1346f68dd18e99f4ea6bf997bd442dc58267a7ac4e695ad66b5a4e5bf9751ff9",
        adapter_id=OPENAI_EMBEDDING_SOURCE_ADAPTER_ID,
        algorithm_revision=OPENAI_EMBEDDING_SOURCE_ADAPTER_REVISION,
    ),
    OpenAIEmbeddingSourceContract(
        profile_id="openai-042-embedding-runtime-v1:text-embedding-3-small",
        source_plugin_unique_identifier="langgenius/openai:0.4.2@21195ee1321849e0a7d4b3f6b2fd8c2be23ea6c7182e1b444ecc4c1711b52468",
        source_model="text-embedding-3-small",
        source_schema_digest="sha256:ace3f43ba3540fd50fde03590705c8bedf4d8c12384ed286bb284762ba5aadb0",
        source_runtime_schema_digest="sha256:ace3f43ba3540fd50fde03590705c8bedf4d8c12384ed286bb284762ba5aadb0",
        target_model="text-embedding-3-small",
        rules_digest="sha256:ddaf2afd40095aa4e735ecaa4de5717a01acd8cc450bb8617f190a0c4654b3a8",
        adapter_id=OPENAI_EMBEDDING_SOURCE_ADAPTER_ID,
        algorithm_revision=OPENAI_EMBEDDING_SOURCE_ADAPTER_REVISION,
    ),
    OpenAIEmbeddingSourceContract(
        profile_id="openai-042-embedding-runtime-v1:text-embedding-ada-002",
        source_plugin_unique_identifier="langgenius/openai:0.4.2@21195ee1321849e0a7d4b3f6b2fd8c2be23ea6c7182e1b444ecc4c1711b52468",
        source_model="text-embedding-ada-002",
        source_schema_digest="sha256:973002e4e3f913dd5366a37e85a674df1d3f104a0930abad6639ee7715a7500c",
        source_runtime_schema_digest="sha256:973002e4e3f913dd5366a37e85a674df1d3f104a0930abad6639ee7715a7500c",
        target_model="text-embedding-ada-002",
        rules_digest="sha256:7ef50e55b521991926edcb1c93178bf4522b0acc591753f921478a650d1dffd0",
        adapter_id=OPENAI_EMBEDDING_SOURCE_ADAPTER_ID,
        algorithm_revision=OPENAI_EMBEDDING_SOURCE_ADAPTER_REVISION,
    ),
    OpenAIEmbeddingSourceContract(
        profile_id="openai-110-embedding-runtime-v1:text-embedding-3-large",
        source_plugin_unique_identifier="langgenius/openai:1.1.0@95f7de6ee42124cb7649f20d3f175c5b0adb66ad92640a97e4027c15b266141c",
        source_model="text-embedding-3-large",
        source_schema_digest="sha256:aac5a07e511a6398575c855a61f572add58bdae23f28ad072a92bb7c58e47f5d",
        source_runtime_schema_digest="sha256:aac5a07e511a6398575c855a61f572add58bdae23f28ad072a92bb7c58e47f5d",
        target_model="text-embedding-3-large",
        rules_digest="sha256:3856c11314d5a7556fd16fe212039fd90f845d7a8b2d686d078ad7669950b879",
        adapter_id=OPENAI_EMBEDDING_SOURCE_ADAPTER_ID,
        algorithm_revision=OPENAI_EMBEDDING_SOURCE_ADAPTER_REVISION,
    ),
    OpenAIEmbeddingSourceContract(
        profile_id="openai-110-embedding-runtime-v1:text-embedding-3-small",
        source_plugin_unique_identifier="langgenius/openai:1.1.0@95f7de6ee42124cb7649f20d3f175c5b0adb66ad92640a97e4027c15b266141c",
        source_model="text-embedding-3-small",
        source_schema_digest="sha256:ace3f43ba3540fd50fde03590705c8bedf4d8c12384ed286bb284762ba5aadb0",
        source_runtime_schema_digest="sha256:ace3f43ba3540fd50fde03590705c8bedf4d8c12384ed286bb284762ba5aadb0",
        target_model="text-embedding-3-small",
        rules_digest="sha256:9e56cdeeb346280f41859b01cd3e8ab7363bb25a1f840998c5caba963df9dedd",
        adapter_id=OPENAI_EMBEDDING_SOURCE_ADAPTER_ID,
        algorithm_revision=OPENAI_EMBEDDING_SOURCE_ADAPTER_REVISION,
    ),
    OpenAIEmbeddingSourceContract(
        profile_id="openai-110-embedding-runtime-v1:text-embedding-ada-002",
        source_plugin_unique_identifier="langgenius/openai:1.1.0@95f7de6ee42124cb7649f20d3f175c5b0adb66ad92640a97e4027c15b266141c",
        source_model="text-embedding-ada-002",
        source_schema_digest="sha256:973002e4e3f913dd5366a37e85a674df1d3f104a0930abad6639ee7715a7500c",
        source_runtime_schema_digest="sha256:973002e4e3f913dd5366a37e85a674df1d3f104a0930abad6639ee7715a7500c",
        target_model="text-embedding-ada-002",
        rules_digest="sha256:6f3118ba58cd7bc862adb6a7a44dfe6c2550caa7b950cd690cc957747d33311d",
        adapter_id=OPENAI_EMBEDDING_SOURCE_ADAPTER_ID,
        algorithm_revision=OPENAI_EMBEDDING_SOURCE_ADAPTER_REVISION,
    ),
)

# Separate exact signed artifact; historical tuples above remain immutable.
_ARTIFACT_REVIEWED_CONTRACTS = (
    OpenAIEmbeddingSourceContract(
        profile_id="openai-110-1ded-embedding-runtime-v1:text-embedding-3-large",
        source_plugin_unique_identifier="langgenius/openai:1.1.0@1ded02acee56efd5788c86fd447d792e4923e959554a4942f440c7859d164340",
        source_model="text-embedding-3-large",
        source_schema_digest="sha256:aac5a07e511a6398575c855a61f572add58bdae23f28ad072a92bb7c58e47f5d",
        source_runtime_schema_digest="sha256:aac5a07e511a6398575c855a61f572add58bdae23f28ad072a92bb7c58e47f5d",
        target_model="text-embedding-3-large",
        rules_digest="sha256:a6fd7fe4e6ef8b5cf0a5ae6c6bf3f3728a81693012be176f64931c7e9ead1c1a",
        adapter_id="openai_embedding_source_v1",
        algorithm_revision="1",
    ),
    OpenAIEmbeddingSourceContract(
        profile_id="openai-110-1ded-embedding-runtime-v1:text-embedding-3-small",
        source_plugin_unique_identifier="langgenius/openai:1.1.0@1ded02acee56efd5788c86fd447d792e4923e959554a4942f440c7859d164340",
        source_model="text-embedding-3-small",
        source_schema_digest="sha256:ace3f43ba3540fd50fde03590705c8bedf4d8c12384ed286bb284762ba5aadb0",
        source_runtime_schema_digest="sha256:ace3f43ba3540fd50fde03590705c8bedf4d8c12384ed286bb284762ba5aadb0",
        target_model="text-embedding-3-small",
        rules_digest="sha256:0612a87994d558fcd64690b89cb36d6469520da48bc7faa538d77806091f84a3",
        adapter_id="openai_embedding_source_v1",
        algorithm_revision="1",
    ),
    OpenAIEmbeddingSourceContract(
        profile_id="openai-110-1ded-embedding-runtime-v1:text-embedding-ada-002",
        source_plugin_unique_identifier="langgenius/openai:1.1.0@1ded02acee56efd5788c86fd447d792e4923e959554a4942f440c7859d164340",
        source_model="text-embedding-ada-002",
        source_schema_digest="sha256:973002e4e3f913dd5366a37e85a674df1d3f104a0930abad6639ee7715a7500c",
        source_runtime_schema_digest="sha256:973002e4e3f913dd5366a37e85a674df1d3f104a0930abad6639ee7715a7500c",
        target_model="text-embedding-ada-002",
        rules_digest="sha256:f3aa2113df6d61671d4948a6b641bab1dbf7048094eadbaf562e1487970a1e5f",
        adapter_id="openai_embedding_source_v1",
        algorithm_revision="1",
    ),
)
_ALL_REVIEWED_CONTRACTS = (*_REVIEWED_CONTRACTS, *_ARTIFACT_REVIEWED_CONTRACTS)


_MARKER_FIELDS = frozenset(
    {"schema_version", "profile_id", "source_plugin_uid", "source_model", "source_schema_digest", "rules_digest"}
)


def validate_embedding_source_settings(settings: OpenAIEmbeddingSourceSettings) -> None:
    if (
        type(settings) is not OpenAIEmbeddingSourceSettings
        or type(settings.source_endpoint_class) is not str
        or settings.source_endpoint_class not in {"unset", "official_root"}
        or type(settings.request_metadata_behavior) is not str
        or settings.request_metadata_behavior != "not_used"
    ):
        raise OpenAIEmbeddingSourceAdapterError("OpenAI embedding source settings are not reviewed")


def validate_embedding_source_identity(
    *,
    source_provider: str,
    source_plugin_unique_identifier: str,
    source_model: str,
    model_type: ModelType,
    target_model: str,
    source_settings: OpenAIEmbeddingSourceSettings,
) -> None:
    """Bound the new family without accepting any marker or inventing a profile.

    Passing these guards still requires exact catalog/runtime/rules evidence,
    installed source proof and a frozen revision before any managed routing.
    """
    validate_embedding_source_settings(source_settings)
    _validate_embedding_identity(
        source_provider=source_provider,
        source_plugin_unique_identifier=source_plugin_unique_identifier,
        source_model=source_model,
        model_type=model_type,
        target_model=target_model,
    )


def _validate_embedding_identity(
    *,
    source_provider: str,
    source_plugin_unique_identifier: str,
    source_model: str,
    model_type: ModelType,
    target_model: str,
) -> None:
    if (
        type(source_provider) is not str
        or source_provider != OPENAI_EMBEDDING_SOURCE_PROVIDER
        or type(source_plugin_unique_identifier) is not str
        or source_plugin_unique_identifier not in OPENAI_EMBEDDING_REVIEWED_SOURCE_UIDS
        or type(source_model) is not str
        or source_model not in OPENAI_EMBEDDING_SOURCE_MODELS
        or model_type is not ModelType.TEXT_EMBEDDING
        or type(target_model) is not str
        or target_model != source_model
    ):
        raise OpenAIEmbeddingSourceAdapterError("OpenAI embedding source identity is not reviewed")


def validate_embedding_source_operations(operations: tuple[str, ...]) -> None:
    # ModelType is text-embedding, but the existing daemon operations use
    # underscores. Do not add an invented operation or broaden to other models.
    if (
        type(operations) is not tuple
        or len(operations) != 3
        or any(type(item) is not str for item in operations)
        or set(operations) != OPENAI_EMBEDDING_SOURCE_OPERATIONS
    ):
        raise OpenAIEmbeddingSourceAdapterError("OpenAI embedding operations are not reviewed")


def openai_embedding_source_marker(
    contract: OpenAIEmbeddingSourceContract,
    *,
    source_provider: str,
    source_model: str,
    model_type: ModelType,
    target_model: str,
) -> dict[str, object]:
    """Revalidate only an exact concrete profile before exposing six public fields.

    Endpoint/SYSTEM authority is checked before construction and at admission;
    the marker deliberately contains neither a raw endpoint nor credential flags.
    """
    if type(contract) is not OpenAIEmbeddingSourceContract or contract not in _ALL_REVIEWED_CONTRACTS:
        raise OpenAIEmbeddingSourceAdapterError("Unreviewed frozen OpenAI embedding source contract")
    _validate_embedding_identity(
        source_provider=source_provider,
        source_plugin_unique_identifier=contract.source_plugin_unique_identifier,
        source_model=source_model,
        model_type=model_type,
        target_model=target_model,
    )
    if source_model != contract.source_model or target_model != contract.target_model:
        raise OpenAIEmbeddingSourceAdapterError("OpenAI embedding source identity does not match the profile")
    return {
        "schema_version": 1,
        "profile_id": contract.profile_id,
        "source_plugin_uid": contract.source_plugin_unique_identifier,
        "source_model": contract.source_model,
        "source_schema_digest": contract.source_schema_digest,
        "rules_digest": contract.rules_digest,
    }


def build_openai_embedding_source_contract(
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
    source_settings: OpenAIEmbeddingSourceSettings,
) -> OpenAIEmbeddingSourceContract:
    """Require the exact catalog, package and rules without guessing an LLM mode.

    This factory checks the management/catalog boundary. Readiness separately
    verifies the contract's source_runtime_schema_digest against source and
    privately marked target schema RPCs; a matching dimension is not evidence.
    """
    validate_embedding_source_settings(source_settings)
    if not isinstance(source_schema, AIModelEntity):
        raise OpenAIEmbeddingSourceAdapterError("OpenAI embedding source schema is not reviewed")
    _validate_embedding_identity(
        source_provider=source_provider,
        source_plugin_unique_identifier=source_plugin_unique_identifier,
        source_model=source_model,
        model_type=source_schema.model_type,
        target_model=target_model,
    )
    contract = next(
        (
            item
            for item in _ALL_REVIEWED_CONTRACTS
            if item.source_plugin_unique_identifier == source_plugin_unique_identifier
            and item.source_model == source_model
            and item.adapter_id == adapter_id
            and item.algorithm_revision == adapter_revision
            and item.source_schema_digest == expected_source_schema_digest
            and item.rules_digest == expected_rules_digest
        ),
        None,
    )
    if (
        contract is None
        or source_schema.model != source_model
        or not hmac.compare_digest(model_schema_digest(source_schema), contract.source_schema_digest)
    ):
        raise OpenAIEmbeddingSourceAdapterError("OpenAI embedding source evidence does not match a reviewed profile")
    openai_embedding_source_marker(
        contract,
        source_provider=source_provider,
        source_model=source_model,
        model_type=source_schema.model_type,
        target_model=target_model,
    )
    return contract


def restore_openai_embedding_source_contract(
    marker: object,
    *,
    source_provider: str,
    source_model: str,
    model_type: ModelType,
    target_model: str,
    source_settings: OpenAIEmbeddingSourceSettings,
) -> OpenAIEmbeddingSourceContract:
    """Restore only exact six-field markers and already classified SYSTEM facts."""
    validate_embedding_source_settings(source_settings)
    if (
        not isinstance(marker, dict)
        or set(marker) != _MARKER_FIELDS
        or type(marker["schema_version"]) is not int
        or marker["schema_version"] != 1
        or any(type(value) is not str for key, value in marker.items() if key != "schema_version")
    ):
        raise OpenAIEmbeddingSourceAdapterError("Invalid frozen OpenAI embedding source marker")
    contract = next(
        (
            item
            for item in _ALL_REVIEWED_CONTRACTS
            if item.profile_id == marker["profile_id"]
            and item.source_plugin_unique_identifier == marker["source_plugin_uid"]
        ),
        None,
    )
    if contract is None or marker != openai_embedding_source_marker(
        contract,
        source_provider=source_provider,
        source_model=source_model,
        model_type=model_type,
        target_model=target_model,
    ):
        raise OpenAIEmbeddingSourceAdapterError("Invalid frozen OpenAI embedding source marker")
    return contract
