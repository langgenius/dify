"""Real ProviderManager -> managed routing integration; no remote calls."""

import json
from collections.abc import Iterator
from copy import deepcopy
from dataclasses import FrozenInstanceError, replace
from types import SimpleNamespace

import pytest
from pytest_mock import MockerFixture

from core.entities.provider_configuration import ProviderConfiguration
from core.model_invocation_routing import (
    ModelRouteUnmapped,
    RoutedModelCredentials,
    redirect_payload,
    routed_credentials,
)
from graphon.model_runtime.entities.model_entities import ModelType
from models.provider import ProviderType
from services.entities.model_billing_mapping import model_schema_digest
from services.model_billing_openai_chat_adapter import (
    OpenAIChatSourceContract,
    build_openai_chat_source_contract,
    openai_chat_source_marker,
)
from tests.helpers.unit.config_override import config_overrides_context
from tests.unit_tests.core.test_provider_manager import (
    TENANT_ID,
    ProviderCase,
    provider_case,  # noqa: F401 - register shared pytest fixture
)
from tests.unit_tests.services.test_model_billing_mapping_service import mapping
from tests.unit_tests.services.test_model_billing_openai_chat_adapter import build_inputs


@pytest.fixture(params=[False, True], ids=["source-sdk-v1", "source-runtime-v2"])
def openai_case(request: pytest.FixtureRequest) -> Iterator[ProviderCase]:
    case: ProviderCase = request.getfixturevalue("provider_case")
    inputs = build_inputs(runtime=request.param)
    source = inputs["source_schema"]
    contract = build_openai_chat_source_contract(**inputs)
    case.provider.models = [source]
    case.provider.plugin_unique_identifier = contract.source_plugin_unique_identifier
    record = mapping(source, target=contract.target_model)
    record["parameter_adapter"] = {
        "id": contract.adapter_id,
        "revision": contract.algorithm_revision,
        "rules_digest": contract.rules_digest,
    }
    with config_overrides_context(TOKENER_LEGACY_MODEL_MAPPING_JSON=json.dumps([record])):
        yield case


def configuration(case: ProviderCase) -> ProviderConfiguration:
    result = case.manager.get_configurations(TENANT_ID).get(case.provider.provider)
    assert result is not None
    assert result.system_configuration.credentials is None
    return result


@pytest.mark.parametrize("protocol", ["missing", None, "chat"])
def test_real_manager_keeps_only_positive_public_protocol_fact_after_stripping_source_key(
    openai_case: ProviderCase, mocker: MockerFixture, protocol: str | None
) -> None:
    import core.model_invocation_routing as routing

    hosting = openai_case.hosting[openai_case.provider.provider]
    hosting.credentials = {"api_key": "HOSTED_SOURCE_SECRET", "organization": "SOURCE_ORG"}
    if protocol != "missing":
        hosting.credentials["api_protocol"] = protocol
    original_settings = dict(hosting.credentials)
    original_state = deepcopy(openai_case.state)
    factory = mocker.spy(routing, "build_source_adapter_contract")
    result = configuration(openai_case)
    fact = result.system_configuration._tokener_source_protocol_fact
    assert fact is not None
    source = openai_case.provider.models[0]
    assert fact.provider == openai_case.provider.provider
    assert fact.plugin_unique_identifier == openai_case.provider.plugin_unique_identifier
    assert fact.catalog_schema_digests == ((source.model_type, source.model, model_schema_digest(source)),)
    assert fact.selector == ("chat" if protocol == "chat" else "absent")
    assert "_tokener_source_protocol_fact" not in result.system_configuration.model_dump()
    assert "HOSTED_SOURCE_SECRET" not in repr(fact)
    assert "SOURCE_ORG" not in repr(fact)
    with pytest.raises(FrozenInstanceError):
        fact.selector = "responses"  # type: ignore[misc]

    # A request owns its frozen evidence, not a live reference to source keys.
    hosting.credentials["api_protocol"] = "responses"
    assert fact.selector == ("chat" if protocol == "chat" else "absent")
    credentials = result.get_current_credentials(ModelType.LLM, source.model)
    assert isinstance(credentials, RoutedModelCredentials)
    factory.assert_called_once()
    assert factory.call_args.kwargs["source_credentials"] == {"api_protocol": "chat" if protocol == "chat" else None}
    contract = credentials.plan.source_parameter_contract
    assert isinstance(contract, OpenAIChatSourceContract)
    mocker.patch.object(routing, "managed_credentials", return_value={"api_key": "MANAGED_TEST_SECRET"})
    payload = redirect_payload(
        credentials.plan, {"provider": "openai", "model": source.model, "model_type": ModelType.LLM.value}
    )
    assert payload["target"]["credentials"] == {
        "api_key": "MANAGED_TEST_SECRET",
        "_dify_source_contract": openai_chat_source_marker(
            contract,
            source_provider=fact.provider,
            source_model=source.model,
            model_type=ModelType.LLM,
            target_model=contract.target_model,
        ),
    }
    assert "HOSTED_SOURCE_SECRET" not in repr(payload)
    assert openai_case.state == original_state
    hosting.credentials = original_settings


@pytest.mark.parametrize("change", ["missing", "provider", "uid", "catalog", "duplicate", "source_mutated"])
def test_missing_or_wrong_positive_source_fact_never_defaults_to_chat(
    openai_case: ProviderCase, mocker: MockerFixture, change: str
) -> None:
    import core.model_invocation_routing as routing

    result = configuration(openai_case)
    source = openai_case.provider.models[0]
    fact = result.system_configuration._tokener_source_protocol_fact
    assert fact is not None
    if change == "missing":
        fact = None
    elif change == "provider":
        fact = replace(fact, provider="langgenius/anthropic/anthropic")
    elif change == "uid":
        fact = replace(fact, plugin_unique_identifier=fact.plugin_unique_identifier + "changed")
    elif change == "catalog":
        fact = replace(fact, catalog_schema_digests=((ModelType.LLM, source.model, "sha256:" + "f" * 64),))
    elif change == "duplicate":
        fact = replace(fact, catalog_schema_digests=fact.catalog_schema_digests * 2)
    else:
        source.parameter_rules[0].max = 0
    result.system_configuration._tokener_source_protocol_fact = fact
    factory = mocker.spy(routing, "build_source_adapter_contract")
    with pytest.raises(ModelRouteUnmapped):
        routed_credentials(result, ModelType.LLM, source.model)
    factory.assert_not_called()
    assert result.system_configuration.credentials is None


@pytest.mark.parametrize("protocol", ["responses", "", False, True, {}, []])
def test_actual_non_chat_or_invalid_source_protocol_is_not_guessed_after_key_strip(
    openai_case: ProviderCase, protocol: object
) -> None:
    hosting = openai_case.hosting[openai_case.provider.provider]
    hosting.credentials = {"api_key": "HOSTED_SOURCE_SECRET", "api_protocol": protocol}
    result = configuration(openai_case)
    fact = result.system_configuration._tokener_source_protocol_fact
    if protocol == "responses":
        assert fact is not None
        assert fact.selector == "responses"
    else:
        assert fact is None
    with pytest.raises(ModelRouteUnmapped):
        routed_credentials(result, ModelType.LLM, openai_case.provider.models[0].model)


def test_missing_actual_source_credentials_cannot_create_positive_absent_fact(openai_case: ProviderCase) -> None:
    openai_case.hosting[openai_case.provider.provider].credentials = None
    result = configuration(openai_case)
    assert result.system_configuration._tokener_source_protocol_fact is None
    with pytest.raises(ModelRouteUnmapped):
        routed_credentials(result, ModelType.LLM, openai_case.provider.models[0].model)


@pytest.mark.parametrize("credentials", ["malformed-settings", [], True, False])
@pytest.mark.parametrize("byok", [False, True], ids=["shared-system", "explicit-byok"])
def test_malformed_whole_source_settings_create_no_fact_without_breaking_manager_or_byok(
    openai_case: ProviderCase, credentials: object, byok: bool
) -> None:
    provider = openai_case.provider.provider
    # Hosting configuration can be mutated without assignment validation. Such
    # a malformed whole value is not proof of an absent protocol credential.
    openai_case.hosting[provider] = openai_case.hosting[provider].model_copy(update={"credentials": credentials})
    if byok:
        openai_case.preferences[provider] = SimpleNamespace(preferred_provider_type=ProviderType.CUSTOM)
    result = configuration(openai_case)
    assert result.system_configuration._tokener_source_protocol_fact is None
    source = openai_case.provider.models[0]
    if byok:
        assert result.using_provider_type == ProviderType.CUSTOM
        assert result.get_current_credentials(ModelType.LLM, source.model) == {"api_key": "USER_SECRET"}
    else:
        assert result.using_provider_type == ProviderType.SYSTEM
        with pytest.raises(ModelRouteUnmapped):
            routed_credentials(result, ModelType.LLM, source.model)


def test_byok_returns_before_source_fact_or_adapter_is_inspected(
    openai_case: ProviderCase, mocker: MockerFixture
) -> None:
    import core.model_invocation_routing as routing

    result = configuration(openai_case)
    result.using_provider_type = ProviderType.CUSTOM
    result.preferred_provider_type = ProviderType.CUSTOM
    result.system_configuration._tokener_source_protocol_fact = None
    factory = mocker.spy(routing, "build_source_adapter_contract")
    assert routed_credentials(result, ModelType.LLM, openai_case.provider.models[0].model) is None
    assert result.get_current_credentials(ModelType.LLM, openai_case.provider.models[0].model) == {
        "api_key": "USER_SECRET"
    }
    factory.assert_not_called()
