"""Real ProviderManager -> frozen route -> admission for closed V4/V5 families."""

import json
from collections.abc import Generator, Iterator
from contextlib import contextmanager
from copy import deepcopy
from dataclasses import asdict, replace
from typing import cast

import pytest
from pytest_mock import MockerFixture

from core.entities.provider_configuration import ProviderConfiguration
from core.model_billing_migration_protocol import canonical_hash
from core.model_invocation_routing import (
    ModelInvocationReprepare,
    ModelRouteUnmapped,
    RoutedModelCredentials,
    redirect_payload,
    validate_invocation_admission,
)
from core.plugin.entities.plugin_daemon import PluginTTSResultResponse, PluginVoiceEntity, PluginVoicesResponse
from core.plugin.impl.model import PluginModelClient
from graphon.model_runtime.entities.model_entities import ModelType
from models.provider import ProviderType, TenantPreferredModelProvider
from models.provider_ids import ModelProviderID
from tests.helpers.unit.config_override import config_overrides_context
from tests.unit_tests.core.test_provider_manager import (
    TENANT_ID,
    ProviderCase,
)
from tests.unit_tests.core.test_provider_manager import (
    provider_case as source_provider_case,  # noqa: F401 - register shared fixture
)
from tests.unit_tests.services.model_billing_audio_xai_fixtures import (
    PROFILES_BY_ID,
    REVISION,
    SELECTOR_CASES,
    Endpoint,
    audio_xai_catalog,
    audio_xai_credentials,
    audio_xai_model_type,
    audio_xai_provider,
    audio_xai_records,
    audio_xai_registry,
)


@pytest.fixture(name="provider_case")
def family_case(request: pytest.FixtureRequest) -> ProviderCase:
    return cast(ProviderCase, request.getfixturevalue("source_provider_case"))


@contextmanager
def configured(case: ProviderCase, profile_id: str, endpoint: Endpoint) -> Generator[ProviderConfiguration]:
    profile = PROFILES_BY_ID[profile_id]
    hosting = case.hosting.pop(case.provider.provider)
    case.provider.provider = audio_xai_provider(profile_id)
    case.provider.plugin_unique_identifier = profile["source_plugin_uid"]
    case.provider.models = [audio_xai_catalog(profile_id)]
    case.provider.supported_model_types = [audio_xai_model_type(profile_id)]
    case.hosting[case.provider.provider] = hosting
    hosting.credentials = audio_xai_credentials(profile_id, endpoint)
    source_key = "api_key" if audio_xai_model_type(profile_id) is ModelType.LLM else "openai_api_key"
    hosting.credentials[source_key] = "NEVER_FORWARD_PLATFORM_SECRET"
    digest = audio_xai_registry().digest
    case.state["model_mapping_version"] = REVISION
    case.state["source_variant_registry_digest"] = digest
    preparation = case.state["preparation"]
    assert isinstance(preparation, dict)
    preparation["source_variant_registry_digest"] = digest
    with config_overrides_context(
        TOKENER_LEGACY_MODEL_MAPPING_JSON=json.dumps(audio_xai_records()),
        TOKENER_LEGACY_DEPENDENCY_INVENTORIES_JSON=json.dumps(
            [{"schema_version": 1, "mapping_revision": REVISION, "inventory_policy": "saved_system_dependencies_v2"}]
        ),
    ):
        case.manager.clear_configurations_cache(TENANT_ID)
        result = case.manager.get_configurations(TENANT_ID).get(case.provider.provider)
        assert result is not None
        try:
            yield result
        finally:
            case.manager.clear_configurations_cache(TENANT_ID)


def route(configuration: ProviderConfiguration, profile_id: str) -> RoutedModelCredentials:
    value = configuration.get_current_credentials(
        audio_xai_model_type(profile_id), PROFILES_BY_ID[profile_id]["source_model"]
    )
    assert isinstance(value, RoutedModelCredentials)
    return value


def admit(credentials: RoutedModelCredentials) -> None:
    plan = credentials.plan
    validate_invocation_admission(
        credentials,
        tenant_id=TENANT_ID,
        provider=plan.logical_provider,
        model_type=plan.model_type,
        model=plan.logical_model,
    )


@pytest.mark.parametrize(("profile_id", "endpoint"), SELECTOR_CASES)
def test_real_system_route_and_admission_preserve_family_source_identity(
    profile_id: str, endpoint: Endpoint, provider_case: ProviderCase
) -> None:
    with configured(provider_case, profile_id, endpoint) as configuration:
        state = deepcopy(provider_case.state)
        source = PROFILES_BY_ID[profile_id]
        assert configuration.using_provider_type is ProviderType.SYSTEM
        assert configuration.system_configuration.credentials is None
        credentials = route(configuration, profile_id)
        assert dict(credentials) == {}
        plan = credentials.plan
        contract = plan.source_parameter_contract
        assert contract is not None
        assert contract.profile_id == profile_id
        assert contract.source_plugin_unique_identifier == source["source_plugin_uid"]
        assert contract.source_runtime_schema_digest == source["source_runtime_schema_digest"]
        assert plan.logical_model == plan.target_model == source["source_model"]
        assert plan.model_type is audio_xai_model_type(profile_id)
        assert plan.tts_voice_contract is None
        assert plan.source_variant_binding is not None
        assert plan.source_variant_binding.variant_id == profile_id + ":" + endpoint
        assert plan.cache_identity != replace(plan, source_variant_binding=None).cache_identity
        admit(credentials)
        system = configuration.system_configuration
        fact = (
            system._tokener_xai_source_fact if plan.model_type is ModelType.LLM else system._tokener_audio_source_fact
        )
        assert fact is not None
        assert "NEVER_FORWARD_PLATFORM_SECRET" not in repr(fact)
        assert "https://" not in repr(fact)
        # New schema5 must not smuggle its factory-only None into financial
        # cache/frozen/current facts. The shared strict hash remains unchanged.
        assert canonical_hash(asdict(fact)) == canonical_hash(deepcopy(asdict(fact)))
        assert "_tokener_audio_source_fact" not in system.model_dump()
        assert "_tokener_xai_source_fact" not in system.model_dump()
        assert provider_case.state == state
        provider_case.init_records.assert_not_called()
        provider_case.get_pool.assert_not_called()


@pytest.mark.parametrize(("profile_id", "endpoint"), SELECTOR_CASES)
def test_native_byok_uses_original_credentials_not_a_managed_source_route(
    profile_id: str, endpoint: Endpoint, provider_case: ProviderCase, mocker: MockerFixture
) -> None:
    provider = audio_xai_provider(profile_id)
    preference = TenantPreferredModelProvider(
        tenant_id=TENANT_ID, provider_name=provider, preferred_provider_type=ProviderType.CUSTOM
    )
    mocker.patch.object(
        provider_case.manager, "_get_all_preferred_model_providers", return_value={provider: preference}
    )
    with configured(provider_case, profile_id, endpoint) as configuration:
        assert configuration.using_provider_type is ProviderType.CUSTOM
        actual = configuration.get_current_credentials(
            audio_xai_model_type(profile_id), PROFILES_BY_ID[profile_id]["source_model"]
        )
        assert not isinstance(actual, RoutedModelCredentials)
        assert actual == {"api_key": "USER_SECRET"}


@pytest.mark.parametrize(("profile_id", "endpoint"), SELECTOR_CASES)
def test_current_endpoint_registry_and_missing_private_fact_drift_fail_before_reservation(
    profile_id: str, endpoint: Endpoint, provider_case: ProviderCase
) -> None:
    with configured(provider_case, profile_id, endpoint) as configuration:
        credentials = route(configuration, profile_id)
        admit(credentials)
        hosting = provider_case.hosting[provider_case.provider.provider]
        assert hosting.credentials is not None
        key = "endpoint_url" if audio_xai_model_type(profile_id) is ModelType.LLM else "openai_api_base"
        previous = hosting.credentials.get(key)
        for invalid in ("https://unreviewed.invalid?secret=NEVER_LOG", "https://api.openai.com/v1", True):
            hosting.credentials[key] = invalid
            with pytest.raises(ModelInvocationReprepare) as error:
                admit(credentials)
            assert "NEVER_LOG" not in str(error.value)
        if previous is None:
            hosting.credentials.pop(key)
        else:
            hosting.credentials[key] = previous
        admit(credentials)
        for invalid_plan in (
            replace(credentials.plan, source_parameter_contract=None),
            replace(credentials.plan, source_variant_binding=None),
            replace(credentials.plan, mapping_revision_digest=None),
            replace(credentials.plan, operations=("model/schema",)),
            replace(credentials.plan, target_model="unreviewed-alias"),
        ):
            with pytest.raises(ModelInvocationReprepare):
                admit(RoutedModelCredentials(invalid_plan))
        system = configuration.system_configuration
        if audio_xai_model_type(profile_id) is ModelType.LLM:
            system._tokener_xai_source_fact = None
        else:
            system._tokener_audio_source_fact = None
        with pytest.raises(ModelRouteUnmapped):
            route(configuration, profile_id)


@pytest.mark.parametrize(("profile_id", "endpoint"), [case for case in SELECTOR_CASES if case[1] == "unset"])
def test_audio_exact_endpoint_change_selects_separate_cache_without_changing_codec(
    profile_id: str, endpoint: Endpoint, provider_case: ProviderCase
) -> None:
    with configured(provider_case, profile_id, endpoint) as configuration:
        original = route(configuration, profile_id)
        hosting = provider_case.hosting[provider_case.provider.provider]
        assert hosting.credentials is not None
        hosting.credentials["api_protocol"] = "unreviewed-but-audio-not-used"
        hosting.credentials["enable_request_metadata"] = True
        admit(original)  # These are proved unused, not guessed raw False flags.
        hosting.credentials["openai_api_base"] = "https://api.openai.com"
        with pytest.raises(ModelInvocationReprepare):
            admit(original)
        provider_case.manager.clear_configurations_cache(TENANT_ID)
        fresh = provider_case.manager.get_configurations(TENANT_ID).get(provider_case.provider.provider)
        assert fresh is not None
        current = route(fresh, profile_id)
        assert current.plan.source_parameter_contract == original.plan.source_parameter_contract
        assert current.plan.cache_identity != original.plan.cache_identity
        admit(current)


@pytest.mark.parametrize(("profile_id", "endpoint"), SELECTOR_CASES)
def test_managed_redirect_only_contains_current_managed_key_and_validated_marker(
    profile_id: str, endpoint: Endpoint, provider_case: ProviderCase, mocker: MockerFixture
) -> None:
    with configured(provider_case, profile_id, endpoint) as configuration:
        credentials = route(configuration, profile_id)
        mocker.patch("core.model_invocation_routing.managed_credentials", return_value={"api_key": "MANAGED_ORG_KEY"})
        logical = {
            "provider": ModelProviderID(credentials.plan.logical_provider).provider_name,
            "model_type": credentials.plan.model_type.value,
            "model": credentials.plan.logical_model,
            "credentials": credentials,
            "voice": "echo",
        }
        payload = PluginModelClient._dispatch_payload(user_id=None, data=logical)
        assert payload["data"]["credentials"] == {}
        target = redirect_payload(credentials.plan, logical)["target"]
        assert target["credentials"]["api_key"] == "MANAGED_ORG_KEY"
        assert target["credentials"]["_dify_source_contract"]["profile_id"] == profile_id
        assert "NEVER_FORWARD_PLATFORM_SECRET" not in json.dumps(payload)
        assert "https://api.openai.com" not in json.dumps(payload)
        assert "https://api.x.ai" not in json.dumps(payload)
        assert payload["data"]["voice"] == "echo"  # No old TTS voice normalizer.
        if credentials.plan.model_type is ModelType.TTS:
            assert "tts/model/voices" in credentials.plan.operations
            assert "tts/voices" not in credentials.plan.operations


@pytest.mark.parametrize(
    ("profile_id", "endpoint"),
    [case for case in SELECTOR_CASES if audio_xai_model_type(case[0]) is ModelType.TTS],
)
def test_real_plugin_tts_and_voice_metadata_dispatch_keeps_original_voice_and_closed_paths(
    profile_id: str, endpoint: Endpoint, provider_case: ProviderCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    with configured(provider_case, profile_id, endpoint) as configuration:
        credentials = route(configuration, profile_id)
        monkeypatch.setattr("core.model_invocation_routing.managed_credentials", lambda _: {"api_key": "managed"})
        client = PluginModelClient()
        seen: list[tuple[str, dict[str, object]]] = []

        def stream(*args: object, **kwargs: object) -> Iterator[PluginTTSResultResponse | PluginVoicesResponse]:
            assert not args
            path, data = kwargs["path"], kwargs["data"]
            assert isinstance(path, str)
            assert isinstance(data, dict)
            seen.append((path, data))
            if path.endswith("/tts/invoke"):
                yield PluginTTSResultResponse(result="616263", mime_type=None)
            elif path.endswith("/tts/model/voices"):
                yield PluginVoicesResponse(voices=[PluginVoiceEntity(name="Echo", value="echo")])
            else:
                pytest.fail("Unexpected audio metadata operation")

        monkeypatch.setattr(client, "_request_with_plugin_daemon_response_stream", stream)
        identity = ModelProviderID(credentials.plan.logical_provider)
        chunks = list(
            client.invoke_tts(
                TENANT_ID,
                None,
                identity.plugin_id,
                identity.provider_name,
                credentials.plan.logical_model,
                credentials,
                "Original text",
                "echo",
                plugin_unique_identifier=PROFILES_BY_ID[profile_id]["source_plugin_uid"],
            )
        )
        assert chunks == [b"abc"]
        assert chunks[0].mime_type is None
        assert client.get_tts_model_voices(
            TENANT_ID,
            None,
            identity.plugin_id,
            identity.provider_name,
            credentials.plan.logical_model,
            credentials,
            "en-US",
            plugin_unique_identifier=PROFILES_BY_ID[profile_id]["source_plugin_uid"],
        ) == [{"name": "Echo", "value": "echo"}]
        assert len(seen) == 2
        assert seen[0][0].endswith("/tts/invoke")
        assert seen[1][0].endswith("/tts/model/voices")
        first_data = seen[0][1]["data"]
        second_data = seen[1][1]["data"]
        assert isinstance(first_data, dict)
        assert first_data["voice"] == "echo"
        assert isinstance(second_data, dict)
        assert second_data["language"] == "en-US"
        assert "NEVER_FORWARD_PLATFORM_SECRET" not in json.dumps(seen)
