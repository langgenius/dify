"""Actual source context/routing/admission cannot substitute old V1 for V2."""

import json
from collections.abc import Generator
from contextlib import contextmanager
from copy import deepcopy
from dataclasses import replace
from typing import cast

import pytest
from pytest_mock import MockerFixture

from core.entities.provider_configuration import ProviderConfiguration
from core.model_billing_migration_protocol import canonical_hash
from core.model_invocation_routing import (
    ModelInvocationReprepare,
    RoutedModelCredentials,
    redirect_payload,
    validate_invocation_admission,
)
from graphon.model_runtime.entities.model_entities import ModelType
from services.model_billing_openai_credit_llm_adapter import _REVIEWED_CONTRACTS as OLD_V1
from services.model_billing_openai_credit_llm_v2_adapter import OpenAICreditLLMSourceV2Contract
from tests.helpers.unit.config_override import config_overrides_context
from tests.unit_tests.core.test_provider_manager import TENANT_ID, ProviderCase
from tests.unit_tests.core.test_provider_manager import provider_case as source_provider_case  # noqa: F401
from tests.unit_tests.services.model_billing_credit_llm_v2_fixtures import (
    PROFILES_BY_ID,
    REVISION,
    SELECTOR_CASES,
    ProtocolSelector,
    credit_llm_v2_catalog,
    credit_llm_v2_credentials,
    credit_llm_v2_records,
    credit_llm_v2_registry,
)


@pytest.fixture(name="provider_case")
def family_case(request: pytest.FixtureRequest) -> ProviderCase:
    return cast(ProviderCase, request.getfixturevalue("source_provider_case"))


@contextmanager
def configured(case: ProviderCase, profile_id: str, selector: ProtocolSelector) -> Generator[ProviderConfiguration]:
    profile = PROFILES_BY_ID[profile_id]
    case.provider.plugin_unique_identifier = profile["source_plugin_uid"]
    case.provider.models = [credit_llm_v2_catalog(profile_id)]
    hosting = case.hosting[case.provider.provider]
    hosting.credentials = credit_llm_v2_credentials(profile_id, selector)
    hosting.credentials["openai_api_key"] = "NEVER_FORWARD_PLATFORM_KEY"
    digest = credit_llm_v2_registry().digest
    case.state["model_mapping_version"] = REVISION
    case.state["source_variant_registry_digest"] = digest
    preparation = case.state["preparation"]
    assert isinstance(preparation, dict)
    preparation["source_variant_registry_digest"] = digest
    with config_overrides_context(
        TOKENER_LEGACY_MODEL_MAPPING_JSON=json.dumps(credit_llm_v2_records()),
        TOKENER_LEGACY_DEPENDENCY_INVENTORIES_JSON=json.dumps(
            [{"schema_version": 1, "mapping_revision": REVISION, "inventory_policy": "saved_system_dependencies_v2"}]
        ),
    ):
        case.manager.clear_configurations_cache(TENANT_ID)
        configuration = case.manager.get_configurations(TENANT_ID).get(case.provider.provider)
        assert configuration is not None
        try:
            yield configuration
        finally:
            case.manager.clear_configurations_cache(TENANT_ID)


def admit(credentials: RoutedModelCredentials) -> None:
    validate_invocation_admission(
        credentials,
        tenant_id=TENANT_ID,
        provider=credentials.plan.logical_provider,
        model_type=ModelType.LLM,
        model=credentials.plan.logical_model,
    )


@pytest.mark.parametrize(("profile_id", "selector"), SELECTOR_CASES)
def test_all_192_actual_system_selectors_freeze_v2_and_never_reuse_old_v1_authority(
    profile_id: str, selector: ProtocolSelector, provider_case: ProviderCase, mocker: MockerFixture
) -> None:
    with configured(provider_case, profile_id, selector) as configuration:
        profile = PROFILES_BY_ID[profile_id]
        state = deepcopy(provider_case.state)
        value = configuration.get_current_credentials(ModelType.LLM, profile["source_model"])
        assert isinstance(value, RoutedModelCredentials)
        plan = value.plan
        contract = plan.source_parameter_contract
        assert type(contract) is OpenAICreditLLMSourceV2Contract
        assert contract.profile_id == profile_id
        assert contract.adapter_id == "openai_credit_llm_source_v2"
        assert plan.target_model == profile["target_model"]
        assert plan.source_variant_binding is not None
        assert dict(value) == {}
        admit(value)
        old = next(
            item for item in OLD_V1 if item.profile_id == profile_id.replace("openai-credit-v2-", "openai-credit-", 1)
        )
        for invalid_plan in (
            replace(plan, source_parameter_contract=old),
            replace(plan, source_variant_binding=None),
            replace(plan, source_parameter_contract=replace(contract, rules_digest=old.rules_digest)),
            replace(
                plan, source_parameter_contract=replace(contract, source_runtime_schema_digest="sha256:" + "0" * 64)
            ),
        ):
            assert invalid_plan.cache_identity != plan.cache_identity
            with pytest.raises(ModelInvocationReprepare):
                admit(RoutedModelCredentials(invalid_plan))
        assert plan.source_variant_binding.source_settings_digest.startswith("sha256:")
        fact = configuration.system_configuration._tokener_source_variant_fact
        assert fact is not None
        assert canonical_hash({"frozen_settings": fact.selector})
        mocker.patch(
            "core.model_invocation_routing.managed_credentials", return_value={"api_key": "CURRENT_MANAGED_KEY"}
        )
        payload = redirect_payload(plan, {"provider": "openai", "model_type": "llm", "model": plan.logical_model})
        marker = payload["target"]["credentials"]["_dify_source_contract"]
        assert marker["profile_id"] == profile_id
        assert marker["rules_digest"] == contract.rules_digest
        assert payload["target"]["model"] == profile["target_model"]
        assert "NEVER_FORWARD_PLATFORM_KEY" not in json.dumps(payload)
        assert "https://api.openai.com" not in json.dumps(payload)
        hosting = provider_case.hosting[provider_case.provider.provider]
        assert hosting.credentials is not None
        original = deepcopy(hosting.credentials)
        for field, wrong in (
            ("openai_api_base", "https://custom.invalid"),
            ("enable_request_metadata", "enabled"),
            ("api_protocol", False),
        ):
            hosting.credentials[field] = wrong
            with pytest.raises(ModelInvocationReprepare):
                admit(value)
            hosting.credentials = deepcopy(original)
        admit(value)
        assert provider_case.state == state
