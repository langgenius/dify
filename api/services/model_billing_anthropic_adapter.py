"""Exact source Anthropic semantics for opt-in managed Tokener redirects.

Only sixteen reviewed immutable source bindings are supported. Schema validation
occurs before a plan is frozen; transport validates the frozen binding again
before adding its private marker to managed target credentials. No provider,
App, parameter dictionary or BYOK credential can opt itself into routing here.
This policy performs no I/O, credential lookup or parameter transformation.
"""

import hmac
from dataclasses import dataclass
from typing import Any

from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelPropertyKey, ModelType
from services.entities.model_billing_mapping import SourceParameterContract, model_schema_digest

ANTHROPIC_SOURCE_ADAPTER_ID = "anthropic_source_v1"
ANTHROPIC_SOURCE_ADAPTER_REVISION = "1"
ANTHROPIC_SOURCE_PROVIDER = "langgenius/anthropic/anthropic"
ANTHROPIC_SOURCE_CREDENTIAL_KEY = "_dify_source_contract"


class AnthropicSourceAdapterError(ValueError):
    """Unreviewed source profile; never include credentials or payloads."""


@dataclass(frozen=True, slots=True)
class AnthropicSourceContract(SourceParameterContract):
    adapter_id: str = ANTHROPIC_SOURCE_ADAPTER_ID
    algorithm_revision: str = ANTHROPIC_SOURCE_ADAPTER_REVISION


# Generated from the reviewed exact-package source SDK0.10.2 profiles. The
# rules digest covers the complete plugin-side parameter/transport contract,
# not only the schema. New source versions require a new reviewed binding.
_REVIEWED_CONTRACTS = (
    AnthropicSourceContract(
        "anthropic-0338:claude-sonnet-4-5",
        "langgenius/anthropic:0.3.38@fd7fad98a670b4c3c4af699da12bbfba143482519a97c438d6bdea4e247b83dd",
        "claude-sonnet-4-5",
        "sha256:a82c389002c5199fa70eb48898e5b3ab0278af4d5a9a9bb72c0c37c57dfff147",
        "claude-sonnet-4-5-20250929",
        "sha256:756c32402d6966b6ccd37e606ec63ba5da53fea2d79237e20752461e1973a10b",
    ),
    AnthropicSourceContract(
        "anthropic-0338:claude-sonnet-4-5-20250929",
        "langgenius/anthropic:0.3.38@fd7fad98a670b4c3c4af699da12bbfba143482519a97c438d6bdea4e247b83dd",
        "claude-sonnet-4-5-20250929",
        "sha256:ff24aa6c4cacc289a0cd1197b1c537aefcca44c21c8cb945045f4997c8d856a9",
        "claude-sonnet-4-5-20250929",
        "sha256:dc0fd1d158f6847bce92b3c2491d09a610ff424afdeb4b9f36dadf2771cb0d58",
    ),
    AnthropicSourceContract(
        "anthropic-0338:claude-opus-4-5",
        "langgenius/anthropic:0.3.38@fd7fad98a670b4c3c4af699da12bbfba143482519a97c438d6bdea4e247b83dd",
        "claude-opus-4-5",
        "sha256:8e176a84ae186de102bd68deded4d8fde09cce35d67ae1469b5cbd8ae5490e09",
        "claude-opus-4-5-20251101",
        "sha256:2f37ae72233892d9eedd2984b5755a1a8fbbf156c0f8744fa829360d58212a50",
    ),
    AnthropicSourceContract(
        "anthropic-0338:claude-opus-4-5-20251101",
        "langgenius/anthropic:0.3.38@fd7fad98a670b4c3c4af699da12bbfba143482519a97c438d6bdea4e247b83dd",
        "claude-opus-4-5-20251101",
        "sha256:f89c0708afb2d34c0b381b16e3778c3cbb752aaa6d4a25bfe63b77db6e9dd60b",
        "claude-opus-4-5-20251101",
        "sha256:b053f09c9cd1c4f0bc95be7808a59ae8e725d4fefc8a21504553b3a2f00c3778",
    ),
    AnthropicSourceContract(
        "anthropic-0338:claude-haiku-4-5-20251001",
        "langgenius/anthropic:0.3.38@fd7fad98a670b4c3c4af699da12bbfba143482519a97c438d6bdea4e247b83dd",
        "claude-haiku-4-5-20251001",
        "sha256:c7e5b0f9602431161db734959e149350afb0090ade9897c09528033aea7b5815",
        "claude-haiku-4-5-20251001",
        "sha256:c78dbf70bfdfcd6d753253ce5bfe61c3facd139e57aa3fff855d9e8f32d5efd0",
    ),
    AnthropicSourceContract(
        "anthropic-0338:claude-opus-4-6",
        "langgenius/anthropic:0.3.38@fd7fad98a670b4c3c4af699da12bbfba143482519a97c438d6bdea4e247b83dd",
        "claude-opus-4-6",
        "sha256:e2fda6b4a05d8df82fe295b51837ef605647e573c87d7a8e9f618fd7e1d41dd1",
        "claude-opus-4-6",
        "sha256:2446acf4f2fec87cf4921b63ed920926641ba57ec52098a5829ff43cac6ffdf4",
    ),
    AnthropicSourceContract(
        "anthropic-0338:claude-opus-4-7",
        "langgenius/anthropic:0.3.38@fd7fad98a670b4c3c4af699da12bbfba143482519a97c438d6bdea4e247b83dd",
        "claude-opus-4-7",
        "sha256:5a65c61e12cd10e7e834200930f46795f5b22bf2022f2927366b2b9c787bd1c5",
        "claude-opus-4-7",
        "sha256:a8ae968ad01095117fe4b2e54578a9ff5c132c23ca7b942591555df91f4f40aa",
    ),
    AnthropicSourceContract(
        "anthropic-0338:claude-sonnet-4-6",
        "langgenius/anthropic:0.3.38@fd7fad98a670b4c3c4af699da12bbfba143482519a97c438d6bdea4e247b83dd",
        "claude-sonnet-4-6",
        "sha256:36e251b82da35664ba5e90fbf9e4738f7a15a2dd1158a36bbfccc287d3167fd4",
        "claude-sonnet-4-6",
        "sha256:1382ec5c640ab3297cef22f28fc3ade3a3d63c7aa03b49ac619247b5619058ac",
    ),
    AnthropicSourceContract(
        "anthropic-0339:claude-sonnet-4-5",
        "langgenius/anthropic:0.3.39@a9b013a5d1617da8db039acc0e0e1fb491832cd050aaa7d6acadf4fc06fe4c58",
        "claude-sonnet-4-5",
        "sha256:a82c389002c5199fa70eb48898e5b3ab0278af4d5a9a9bb72c0c37c57dfff147",
        "claude-sonnet-4-5-20250929",
        "sha256:756c32402d6966b6ccd37e606ec63ba5da53fea2d79237e20752461e1973a10b",
    ),
    AnthropicSourceContract(
        "anthropic-0339:claude-sonnet-4-5-20250929",
        "langgenius/anthropic:0.3.39@a9b013a5d1617da8db039acc0e0e1fb491832cd050aaa7d6acadf4fc06fe4c58",
        "claude-sonnet-4-5-20250929",
        "sha256:ff24aa6c4cacc289a0cd1197b1c537aefcca44c21c8cb945045f4997c8d856a9",
        "claude-sonnet-4-5-20250929",
        "sha256:dc0fd1d158f6847bce92b3c2491d09a610ff424afdeb4b9f36dadf2771cb0d58",
    ),
    AnthropicSourceContract(
        "anthropic-0339:claude-opus-4-5",
        "langgenius/anthropic:0.3.39@a9b013a5d1617da8db039acc0e0e1fb491832cd050aaa7d6acadf4fc06fe4c58",
        "claude-opus-4-5",
        "sha256:8e176a84ae186de102bd68deded4d8fde09cce35d67ae1469b5cbd8ae5490e09",
        "claude-opus-4-5-20251101",
        "sha256:2f37ae72233892d9eedd2984b5755a1a8fbbf156c0f8744fa829360d58212a50",
    ),
    AnthropicSourceContract(
        "anthropic-0339:claude-opus-4-5-20251101",
        "langgenius/anthropic:0.3.39@a9b013a5d1617da8db039acc0e0e1fb491832cd050aaa7d6acadf4fc06fe4c58",
        "claude-opus-4-5-20251101",
        "sha256:f89c0708afb2d34c0b381b16e3778c3cbb752aaa6d4a25bfe63b77db6e9dd60b",
        "claude-opus-4-5-20251101",
        "sha256:b053f09c9cd1c4f0bc95be7808a59ae8e725d4fefc8a21504553b3a2f00c3778",
    ),
    AnthropicSourceContract(
        "anthropic-0339:claude-haiku-4-5-20251001",
        "langgenius/anthropic:0.3.39@a9b013a5d1617da8db039acc0e0e1fb491832cd050aaa7d6acadf4fc06fe4c58",
        "claude-haiku-4-5-20251001",
        "sha256:c7e5b0f9602431161db734959e149350afb0090ade9897c09528033aea7b5815",
        "claude-haiku-4-5-20251001",
        "sha256:c78dbf70bfdfcd6d753253ce5bfe61c3facd139e57aa3fff855d9e8f32d5efd0",
    ),
    AnthropicSourceContract(
        "anthropic-0339:claude-opus-4-6",
        "langgenius/anthropic:0.3.39@a9b013a5d1617da8db039acc0e0e1fb491832cd050aaa7d6acadf4fc06fe4c58",
        "claude-opus-4-6",
        "sha256:e2fda6b4a05d8df82fe295b51837ef605647e573c87d7a8e9f618fd7e1d41dd1",
        "claude-opus-4-6",
        "sha256:2446acf4f2fec87cf4921b63ed920926641ba57ec52098a5829ff43cac6ffdf4",
    ),
    AnthropicSourceContract(
        "anthropic-0339:claude-opus-4-7",
        "langgenius/anthropic:0.3.39@a9b013a5d1617da8db039acc0e0e1fb491832cd050aaa7d6acadf4fc06fe4c58",
        "claude-opus-4-7",
        "sha256:5a65c61e12cd10e7e834200930f46795f5b22bf2022f2927366b2b9c787bd1c5",
        "claude-opus-4-7",
        "sha256:a8ae968ad01095117fe4b2e54578a9ff5c132c23ca7b942591555df91f4f40aa",
    ),
    AnthropicSourceContract(
        "anthropic-0339:claude-sonnet-4-6",
        "langgenius/anthropic:0.3.39@a9b013a5d1617da8db039acc0e0e1fb491832cd050aaa7d6acadf4fc06fe4c58",
        "claude-sonnet-4-6",
        "sha256:36e251b82da35664ba5e90fbf9e4738f7a15a2dd1158a36bbfccc287d3167fd4",
        "claude-sonnet-4-6",
        "sha256:1382ec5c640ab3297cef22f28fc3ade3a3d63c7aa03b49ac619247b5619058ac",
    ),
)


def anthropic_source_marker(
    contract: AnthropicSourceContract,
    *,
    source_provider: str,
    source_model: str,
    model_type: ModelType,
    target_model: str,
) -> dict[str, Any]:
    """Validate a frozen binding and emit only the six reviewed private fields."""
    if (
        contract not in _REVIEWED_CONTRACTS
        or source_provider != ANTHROPIC_SOURCE_PROVIDER
        or model_type != ModelType.LLM
        or source_model != contract.source_model
        or target_model != contract.target_model
    ):
        raise AnthropicSourceAdapterError("Unreviewed frozen Anthropic source contract")
    return {
        "schema_version": 1,
        "profile_id": contract.profile_id,
        "source_plugin_uid": contract.source_plugin_unique_identifier,
        "source_model": contract.source_model,
        "source_schema_digest": contract.source_schema_digest,
        "rules_digest": contract.rules_digest,
    }


def build_anthropic_source_contract(
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
) -> AnthropicSourceContract:
    """Bind actual source schema and mapping to one exact reviewed profile."""
    if (
        adapter_id != ANTHROPIC_SOURCE_ADAPTER_ID
        or adapter_revision != ANTHROPIC_SOURCE_ADAPTER_REVISION
        or source_schema.model_type != ModelType.LLM
        or source_schema.model != source_model
        or source_schema.model_properties.get(ModelPropertyKey.MODE) != "chat"
    ):
        raise AnthropicSourceAdapterError("Invalid Anthropic source adapter binding")
    actual_digest = model_schema_digest(source_schema)
    contract = next(
        (
            item
            for item in _REVIEWED_CONTRACTS
            if item.source_plugin_unique_identifier == source_plugin_unique_identifier
            and item.source_model == source_model
            and item.target_model == target_model
        ),
        None,
    )
    if (
        contract is None
        or not hmac.compare_digest(actual_digest, expected_source_schema_digest)
        or not hmac.compare_digest(actual_digest, contract.source_schema_digest)
        or not hmac.compare_digest(expected_rules_digest, contract.rules_digest)
    ):
        raise AnthropicSourceAdapterError("Anthropic source evidence does not match a reviewed profile")
    anthropic_source_marker(
        contract,
        source_provider=source_provider,
        source_model=source_model,
        model_type=source_schema.model_type,
        target_model=target_model,
    )
    return contract


def restore_anthropic_source_contract(
    marker: object, *, source_provider: str, source_model: str, model_type: ModelType, target_model: str
) -> AnthropicSourceContract:
    """Restore only freshly validated inventory evidence, not caller input.

    Used during readiness after inventory has just verified the actual source
    schema. Matching an allowlisted marker does not by itself authorize routing.
    """
    keys = {"schema_version", "profile_id", "source_plugin_uid", "source_model", "source_schema_digest", "rules_digest"}
    if (
        not isinstance(marker, dict)
        or set(marker) != keys
        or type(marker["schema_version"]) is not int
        or any(not isinstance(value, str) for key, value in marker.items() if key != "schema_version")
    ):
        raise AnthropicSourceAdapterError("Invalid frozen Anthropic source marker")
    for contract in _REVIEWED_CONTRACTS:
        expected = anthropic_source_marker(
            contract,
            source_provider=ANTHROPIC_SOURCE_PROVIDER,
            source_model=contract.source_model,
            model_type=ModelType.LLM,
            target_model=contract.target_model,
        )
        if marker == expected:
            anthropic_source_marker(
                contract,
                source_provider=source_provider,
                source_model=source_model,
                model_type=model_type,
                target_model=target_model,
            )
            return contract
    raise AnthropicSourceAdapterError("Invalid frozen Anthropic source marker")
