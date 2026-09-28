import json
from contextlib import nullcontext
from copy import deepcopy
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from core.entities.provider_entities import ProviderQuotaType, QuotaConfiguration, QuotaUnit, SystemConfiguration
from core.model_invocation_routing import (
    FrozenModelInvocation,
    LegacyModelBinding,
    LegacyModelCredentials,
    ModelInvocationReprepare,
    ModelMigrationProcessing,
    ModelRouteUnavailable,
    ModelRouteUnmapped,
    RoutedModelCredentials,
    SettlementOwner,
    bind_legacy_credentials,
    compatibility_quota_type,
    embedding_dimensions_contract,
    has_compatibility_route,
    managed_credentials,
    redirect_payload,
    routed_credentials,
    settlement_owner,
    validate_invocation_admission,
)
from core.plugin.impl.model import PluginModelClient
from graphon.model_runtime.entities.model_entities import ModelType
from models.provider import ProviderType
from services.entities.model_billing_migration import canonical_hash

TEST_ENCRYPTED_CONFIG = '{"api_key":"encrypted","endpoint_url":"https://fixture.invalid"}'


def credential_pin():
    return {
        "tenant_id": plan().tenant_id,
        "provider_name": "langgenius/tokener/tokener",
        "provider_credential_id": plan().credential_id,
        "credential_fingerprint": plan().expected_credential_fingerprint,
    }


def plan(**overrides):
    return replace(
        FrozenModelInvocation(
            tenant_id="11111111-1111-4111-8111-111111111111",
            route_id="22222222-2222-4222-8222-222222222222",
            logical_provider="langgenius/openai/openai",
            logical_model="gpt-4o",
            model_type=ModelType.LLM,
            route_epoch=3,
            mapping_revision="fixture-v1",
            credential_id="33333333-3333-4333-8333-333333333333",
            expected_credential_fingerprint=canonical_hash({"encrypted_config": TEST_ENCRYPTED_CONFIG}),
            plugin_unique_identifier="langgenius/tokener:0.1.3@fixture",
            target_model="fixture-target",
            operations=("model/schema", "llm/invoke", "llm/num_tokens"),
        ),
        **overrides,
    )


def configuration(pool=ProviderQuotaType.PAID, unit=QuotaUnit.CREDITS, limit=100, provider_type=ProviderType.SYSTEM):
    return SimpleNamespace(
        tenant_id=plan().tenant_id,
        provider=SimpleNamespace(provider="langgenius/openai/openai"),
        using_provider_type=provider_type,
        system_configuration=SystemConfiguration(
            enabled=True,
            current_quota_type=pool,
            quota_configurations=[
                QuotaConfiguration(quota_type=pool, quota_unit=unit, quota_limit=limit, quota_used=100, is_valid=False)
            ],
        ),
    )


@pytest.mark.parametrize(
    ("pool", "unit", "limit", "provider_type", "expected"),
    [
        (ProviderQuotaType.PAID, QuotaUnit.CREDITS, 100, ProviderType.SYSTEM, SettlementOwner.SHARED_CREDIT_POOL),
        (ProviderQuotaType.TRIAL, QuotaUnit.TIMES, 100, ProviderType.SYSTEM, SettlementOwner.SHARED_CREDIT_POOL),
        (ProviderQuotaType.PAID, QuotaUnit.TIMES, 100, ProviderType.SYSTEM, SettlementOwner.SHARED_CREDIT_POOL),
        (ProviderQuotaType.FREE, QuotaUnit.TIMES, 100, ProviderType.SYSTEM, SettlementOwner.PROVIDER_FREE),
        (ProviderQuotaType.TRIAL, QuotaUnit.CREDITS, -1, ProviderType.SYSTEM, SettlementOwner.UNMETERED),
        (ProviderQuotaType.PAID, QuotaUnit.CREDITS, 100, ProviderType.CUSTOM, SettlementOwner.CUSTOM),
    ],
)
def test_owner_matches_real_reservation_policy(pool, unit, limit, provider_type, expected):
    config = configuration(pool, unit, limit, provider_type)
    assert settlement_owner(config.system_configuration, config.using_provider_type) == expected


@pytest.mark.parametrize("phase", ["claimed", "granting", "activating", "blocked"])
def test_cutover_blocks_before_any_key_lookup(mocker, phase):
    mocker.patch(
        "core.model_invocation_routing.migration_routing_state",
        return_value={"phase": phase, "blocked_from": "claimed"},
    )
    keys = mocker.patch("core.model_invocation_routing.managed_credentials")
    with pytest.raises(ModelMigrationProcessing):
        routed_credentials(configuration(), ModelType.LLM, "gpt-4o")
    keys.assert_not_called()


@pytest.mark.parametrize(
    "config",
    [
        configuration(provider_type=ProviderType.CUSTOM),
        configuration(pool=ProviderQuotaType.FREE),
        configuration(limit=-1),
    ],
)
def test_byok_free_unmetered_do_not_query_migration_or_redirect(mocker, config):
    state = mocker.patch("core.model_invocation_routing.migration_routing_state")
    assert routed_credentials(config, ModelType.LLM, "gpt-4o") is None
    state.assert_not_called()


def test_active_missing_mapping_fails_without_legacy_fallback(mocker):
    mocker.patch("core.model_invocation_routing.migration_routing_state", return_value={"phase": "active"})
    mocker.patch("core.model_invocation_routing.model_mappings", return_value={})
    with pytest.raises(ModelRouteUnmapped):
        routed_credentials(configuration(), ModelType.LLM, "gpt-4o")


def test_cancelled_after_claim_never_reopens_legacy():
    assert has_compatibility_route({"phase": "cancelled", "claimed_at": "2026-09-28T00:00:00Z"})
    assert not has_compatibility_route({"phase": "cancelled"})


def test_credential_capability_is_non_secret_and_survives_in_process_copy():
    credentials = RoutedModelCredentials(plan())
    assert credentials
    assert json.dumps(credentials) == "{}"
    assert "fixture-target" not in repr(credentials)
    assert deepcopy(credentials).plan == credentials.plan
    assert credentials.copy().plan == credentials.plan


def test_target_key_is_loaded_from_exact_tenant_and_managed_id(mocker):
    fake_session = Mock()
    fake_session.scalar.return_value = SimpleNamespace(encrypted_config=TEST_ENCRYPTED_CONFIG)
    mocker.patch("core.model_invocation_routing.session_factory.create_session", return_value=nullcontext(fake_session))
    policy = mocker.patch("core.helper.credential_utils.runtime_check_credential_policy_compliance")
    decrypt = mocker.patch("core.helper.encrypter.decrypt_token", return_value="TEST_TARGET_KEY")
    values = managed_credentials(plan())
    statement = fake_session.scalar.call_args.args[0].compile()
    assert set(statement.params.values()) == {plan().tenant_id, plan().credential_id, "langgenius/tokener/tokener"}
    decrypt.assert_called_once_with(tenant_id=plan().tenant_id, token="encrypted")
    assert policy.call_args.kwargs["credential_id"] == plan().credential_id
    assert values["api_key"] == "TEST_TARGET_KEY"


def test_missing_managed_id_does_not_use_active_byok(mocker):
    fake_session = Mock()
    fake_session.scalar.return_value = None
    mocker.patch("core.model_invocation_routing.session_factory.create_session", return_value=nullcontext(fake_session))
    with pytest.raises(ModelRouteUnavailable):
        managed_credentials(plan())


def test_wire_is_versioned_and_only_target_gets_key(mocker):
    mocker.patch("core.model_invocation_routing.managed_credentials", return_value={"api_key": "TEST_TARGET_KEY"})
    payload = PluginModelClient._dispatch_payload(
        user_id=None,
        data={
            "provider": "openai",
            "model": "gpt-4o",
            "model_type": "llm",
            "stream": True,
            "credentials": RoutedModelCredentials(plan()),
            "prompt_messages": [],
        },
    )
    assert payload["data"]["credentials"] == {}
    assert payload["redirect"]["target"]["credentials"] == {"api_key": "TEST_TARGET_KEY"}
    client = PluginModelClient()
    url, _, body, _, _ = client._prepare_request(
        f"plugin/{plan().tenant_id}/dispatch/llm/invoke",
        {"Content-Type": "application/json", "X-Plugin-ID": "langgenius/openai"},
        payload,
        None,
        None,
    )
    assert url.endswith(f"plugin/{plan().tenant_id}/dispatch/redirect/v1/llm/invoke")
    assert json.loads(body)["redirect"]["target"]["model"] == "fixture-target"
    assert "_route_context" not in json.loads(body)
    with pytest.raises(ValueError, match="binding mismatch"):
        client._prepare_request("plugin/other-tenant/dispatch/llm/invoke", {}, payload, None, None)
    with pytest.raises(ValueError, match="binding mismatch"):
        client._prepare_request(f"plugin/{plan().tenant_id}/dispatch/model/polling/start", {}, payload, None, None)


def test_ordinary_user_dict_cannot_forge_redirect():
    payload = PluginModelClient._dispatch_payload(
        user_id="user",
        data={
            "credentials": {"api_key": "BYOK", "redirect": {"target": "forged"}},
        },
    )
    assert "redirect" not in payload


def test_route_rejects_different_model_before_loading_key(mocker):
    load = mocker.patch("core.model_invocation_routing.managed_credentials")
    with pytest.raises(ModelRouteUnavailable):
        redirect_payload(plan(), {"model": "wrong", "model_type": "llm"})
    load.assert_not_called()


def test_schema_identity_changes_with_epoch_mapping_and_installed_package():
    baseline = plan().cache_identity
    assert replace(plan(), route_id="different-call").cache_identity == baseline
    assert replace(plan(), route_epoch=4).cache_identity != baseline
    assert replace(plan(), mapping_revision="v2").cache_identity != baseline
    assert replace(plan(), plugin_unique_identifier="other-package").cache_identity != baseline
    assert replace(plan(), expected_credential_fingerprint="sha256:" + "a" * 64).cache_identity != baseline


def test_tokener_quota_path_does_not_reserve_legacy(mocker):
    from core.app.llm.quota import reserve_model_quota_for_model

    reserve = mocker.patch("services.credit_pool_service.CreditPoolService.reserve_credits")
    reservation = reserve_model_quota_for_model(
        tenant_id=plan().tenant_id,
        provider="openai",
        model_type=ModelType.LLM,
        model="gpt-4o",
        provider_configuration=configuration(),
        invocation_credentials=RoutedModelCredentials(plan()),
    )
    reservation.commit()
    reservation.release()
    assert reservation.settlement_backend == "tokener"
    assert reservation.commit_before_delivery
    reserve.assert_not_called()


def legacy_credentials():
    return LegacyModelCredentials(
        {"api_key": "TEST_LEGACY_KEY"},
        LegacyModelBinding(
            tenant_id=plan().tenant_id,
            logical_provider=plan().logical_provider,
            logical_model=plan().logical_model,
            model_type=ModelType.LLM,
            route_epoch=0,
        ),
    )


@pytest.mark.parametrize("phase", ["claimed", "granting", "active"])
def test_legacy_schema_binding_cannot_cross_cutover_before_reservation(mocker, phase):
    credentials = legacy_credentials()
    mocker.patch(
        "core.model_invocation_routing.migration_routing_state", return_value={"phase": phase, "route_epoch": 1}
    )
    with pytest.raises(ModelInvocationReprepare):
        validate_invocation_admission(
            credentials, tenant_id=plan().tenant_id, provider="openai", model_type=ModelType.LLM, model="gpt-4o"
        )
    assert credentials["api_key"] == "TEST_LEGACY_KEY"


def test_prepared_tokener_epoch_change_requires_new_schema(mocker):
    credentials = RoutedModelCredentials(plan())
    mocker.patch(
        "core.model_invocation_routing.migration_routing_state",
        return_value={
            "phase": "active",
            "route_epoch": 4,
            "model_mapping_version": "fixture-v1",
        },
    )
    with pytest.raises(ModelInvocationReprepare):
        validate_invocation_admission(
            credentials, tenant_id=plan().tenant_id, provider="openai", model_type=ModelType.LLM, model="gpt-4o"
        )
    assert credentials.plan.route_epoch == 3


def test_legacy_binding_rechecks_race_when_constructing_credentials(mocker):
    mocker.patch(
        "core.model_invocation_routing.migration_routing_state", return_value={"phase": "claimed", "route_epoch": 1}
    )
    with pytest.raises(ModelInvocationReprepare):
        bind_legacy_credentials(configuration(), ModelType.LLM, "gpt-4o", {"api_key": "OLD"})


def test_original_unmetered_pool_is_not_replaced_by_another_finite_pool():
    quotas = [
        QuotaConfiguration(
            quota_type=ProviderQuotaType.PAID, quota_unit=QuotaUnit.CREDITS, quota_limit=0, quota_used=0, is_valid=False
        ),
        QuotaConfiguration(
            quota_type=ProviderQuotaType.TRIAL,
            quota_unit=QuotaUnit.CREDITS,
            quota_limit=100,
            quota_used=0,
            is_valid=True,
        ),
    ]
    selected = compatibility_quota_type(
        "openai",
        quotas,
        {
            "source_ownership": {
                "langgenius/openai/openai": {
                    "current_quota_type": "trial",
                    "quotas": {
                        "paid": {"unmetered": False},
                        "trial": {"unmetered": True},
                    },
                },
            }
        },
    )
    assert selected == ProviderQuotaType.TRIAL
    assert quotas[1].quota_limit == -1
    assert (
        settlement_owner(
            SystemConfiguration(enabled=True, current_quota_type=selected, quota_configurations=quotas),
            ProviderType.SYSTEM,
        )
        == SettlementOwner.UNMETERED
    )


def test_missing_source_ownership_never_guesses_pool():
    with pytest.raises(ModelRouteUnavailable):
        compatibility_quota_type("openai", configuration().system_configuration.quota_configurations, {})


def test_free_provider_ownership_survives_cutover():
    quota = configuration(pool=ProviderQuotaType.FREE).system_configuration.quota_configurations[0]
    quota.is_valid = True
    quota.quota_used = 5
    assert (
        compatibility_quota_type(
            "openai",
            [quota],
            {
                "source_ownership": {
                    "langgenius/openai/openai": {
                        "current_quota_type": "free",
                        "quotas": {"free": {"unmetered": False}},
                    },
                }
            },
        )
        == ProviderQuotaType.FREE
    )
    assert quota.quota_used == 5
    assert quota.quota_limit == 100


def test_plan_provider_is_bound_before_key_lookup(mocker):
    load = mocker.patch("core.model_invocation_routing.managed_credentials")
    with pytest.raises(ModelRouteUnavailable):
        redirect_payload(plan(), {"provider": "azure_openai", "model": "gpt-4o", "model_type": "llm"})
    load.assert_not_called()


def test_transport_rejects_another_plugin_with_same_provider_name(mocker):
    mocker.patch("core.model_invocation_routing.managed_credentials", return_value={"api_key": "TEST_TARGET_KEY"})
    payload = PluginModelClient._dispatch_payload(
        user_id="user",
        data={
            "provider": "openai",
            "model": "gpt-4o",
            "model_type": "llm",
            "credentials": RoutedModelCredentials(plan()),
        },
    )
    with pytest.raises(ValueError, match="provider binding"):
        PluginModelClient()._prepare_request(
            f"plugin/{plan().tenant_id}/dispatch/llm/invoke", {"X-Plugin-ID": "other/openai"}, payload, None, None
        )


@pytest.mark.parametrize("credentials", [legacy_credentials(), RoutedModelCredentials(plan())])
def test_pydantic_internal_model_config_preserves_only_trusted_binding(credentials):
    from core.app.entities.app_invoke_entities import ModelConfigWithCredentialsEntity

    calls = []

    def validate(value):
        calls.append(value)
        return dict(value)

    assert ModelConfigWithCredentialsEntity.preserve_trusted_invocation_binding(credentials, validate) is credentials
    assert not calls
    plain = {"api_key": "BYOK", "plan": "untrusted"}
    assert type(ModelConfigWithCredentialsEntity.preserve_trusted_invocation_binding(plain, validate)) is dict
    assert calls == [plain]


def test_direct_factory_uses_system_quota_admission(mocker):
    from core.model_manager import ModelInstance, QuotaManagedModelInstance, create_model_instance

    bundle = SimpleNamespace(
        configuration=configuration(), model_type_instance=SimpleNamespace(model_type=ModelType.LLM)
    )
    mocker.patch.object(ModelInstance, "_get_load_balancing_manager", return_value=None)
    instance = create_model_instance(bundle, "gpt-4o", credentials=legacy_credentials())
    assert isinstance(instance, QuotaManagedModelInstance)
    mocker.patch(
        "core.model_invocation_routing.migration_routing_state", return_value={"phase": "active", "route_epoch": 1}
    )
    reserve = mocker.patch("core.app.llm.quota.reserve_model_quota_for_model")
    with pytest.raises(ModelInvocationReprepare):
        instance.reserve_quota()
    reserve.assert_not_called()


def test_already_reserved_legacy_call_settles_original_backend_after_cutover(mocker):
    from core.app.llm.quota import ModelQuotaReservation

    reservation_owner = Mock()
    reservation = ModelQuotaReservation(
        tenant_id=plan().tenant_id,
        provider="openai",
        model_type=ModelType.LLM,
        model="gpt-4o",
        provider_configuration=configuration(),
        credit_pool_reservation=reservation_owner,
    )
    state = mocker.patch(
        "core.model_invocation_routing.migration_routing_state", return_value={"phase": "active", "route_epoch": 1}
    )
    reservation.commit()
    reservation.release()
    reservation_owner.commit.assert_called_once()
    reservation_owner.release.assert_not_called()
    state.assert_not_called()


def test_embedding_compatibility_uses_real_parameter_rules():
    rule = SimpleNamespace(
        name="dimensions", type=SimpleNamespace(value="int"), default=1536, min=1, max=1536, options=[]
    )
    digest = embedding_dimensions_contract(SimpleNamespace(parameter_rules=[rule]))
    assert digest.startswith("sha256:")
    rule.default = 3072
    assert embedding_dimensions_contract(SimpleNamespace(parameter_rules=[rule])) != digest
    assert embedding_dimensions_contract(SimpleNamespace(parameter_rules=[])) == "fixed_by_model_fixture"


def test_routed_schema_keeps_logical_model_identity(mocker):
    from core.plugin.impl.model_runtime import PluginModelRuntime

    client = Mock()
    schema = Mock()
    schema.model = "fixture-target"
    logical_schema = Mock()
    schema.model_copy.return_value = logical_schema
    client.get_model_schema.return_value = schema
    mocker.patch("core.plugin.impl.model_runtime.redis_client.get", return_value=None)
    mocker.patch("core.plugin.impl.model_runtime.redis_client.setex")
    runtime = PluginModelRuntime(plan().tenant_id, None, client, Mock())
    result = runtime.get_model_schema(
        provider=plan().logical_provider,
        model_type=ModelType.LLM,
        model="gpt-4o",
        credentials=RoutedModelCredentials(plan()),
    )
    assert result is logical_schema
    schema.model_copy.assert_called_once_with(update={"model": "gpt-4o"})
    assert schema.model == "fixture-target"


@pytest.mark.parametrize("pin_source", ["preparation", "provisioned_binding"])
@pytest.mark.parametrize("edited", [False, True])
def test_readiness_uses_redirect_and_pins_installed_version(mocker, pin_source, edited):
    from core.model_invocation_routing import validate_migration_readiness
    from graphon.model_runtime.entities.model_entities import ModelPropertyKey

    inventory = {
        "models": [{"provider": plan().logical_provider, "model_type": "llm", "model": "gpt-4o"}],
        "inventory_hash": "fixture",
        "source_ownership": {},
    }
    mocker.patch("core.model_invocation_routing.migration_inventory", return_value=inventory)
    rule = SimpleNamespace(
        operations=list(plan().operations),
        source=SimpleNamespace(mode="chat"),
        target=SimpleNamespace(minimum_plugin_version="0.1.0", model="fixture-target"),
    )
    mocker.patch(
        "core.model_invocation_routing.model_mappings",
        return_value={(plan().logical_provider, ModelType.LLM, "gpt-4o"): rule},
    )
    session = Mock()
    session.scalar.side_effect = [
        SimpleNamespace(
            provider_credential_id=plan().credential_id, plugin_unique_identifier=plan().plugin_unique_identifier
        ),
        SimpleNamespace(encrypted_config='{"api_key":"changed"}' if edited else TEST_ENCRYPTED_CONFIG),
    ]
    mocker.patch("core.model_invocation_routing.migration_routing_state", return_value={pin_source: credential_pin()})
    mocker.patch("core.model_invocation_routing.session_factory.create_session", return_value=nullcontext(session))
    client = Mock()
    client._request_with_plugin_daemon_response.return_value = {
        "protocols": ["model-redirect/v1"],
        "operations": list(plan().operations),
    }
    client.get_model_schema.return_value = SimpleNamespace(
        model_type=ModelType.LLM, model_properties={ModelPropertyKey.MODE: "chat"}
    )
    mocker.patch("core.plugin.impl.model.PluginModelClient", return_value=client)
    if edited:
        with pytest.raises(ModelRouteUnavailable):
            validate_migration_readiness(plan().tenant_id, "fixture-v1")
        client.get_model_schema.assert_not_called()
        return
    readiness = validate_migration_readiness(plan().tenant_id, "fixture-v1")
    assert readiness["credential_fingerprint"] == plan().expected_credential_fingerprint
    args = client.get_model_schema.call_args.args
    assert args[2:6] == ("langgenius/openai", "openai", "llm", "gpt-4o")
    assert isinstance(args[6], RoutedModelCredentials)
    assert args[6].plan.plugin_unique_identifier == plan().plugin_unique_identifier
    assert args[6].plan.expected_credential_fingerprint == plan().expected_credential_fingerprint


def test_workflow_credential_cache_reprepares_after_cutover(mocker):
    from core.app.llm.model_access import DifyCredentialsProvider

    provider = object.__new__(DifyCredentialsProvider)
    provider.tenant_id = plan().tenant_id
    provider.credentials_cache = {("openai", "gpt-4o"): legacy_credentials()}
    provider.provider_model_cache = {("openai", "gpt-4o"): Mock()}
    provider.provider_manager = Mock()
    configuration = Mock()
    configuration.get_current_credentials.return_value = RoutedModelCredentials(plan())
    provider.provider_manager.get_configurations.return_value.get.return_value = configuration
    mocker.patch(
        "core.model_invocation_routing.migration_routing_state",
        return_value={
            "phase": "active",
            "route_epoch": 3,
            "model_mapping_version": "fixture-v1",
        },
    )
    resolved = provider.fetch("openai", "gpt-4o")
    assert isinstance(resolved, RoutedModelCredentials)
    provider.provider_manager.clear_configurations_cache.assert_called_once_with(plan().tenant_id)
    assert resolved.plan.route_epoch == 3


def test_plain_dict_cannot_construct_trusted_route_capability():
    with pytest.raises(TypeError, match="trusted"):
        RoutedModelCredentials({"plan": "forged"})
    with pytest.raises(TypeError, match="trusted"):
        LegacyModelCredentials({"api_key": "key"}, {"route_epoch": 0})


def test_llm_inventory_is_real_strict_canonical_json_without_null_dimension(mocker):
    import hashlib

    from core.model_invocation_routing import migration_inventory
    from graphon.model_runtime.entities.common_entities import I18nObject
    from graphon.model_runtime.entities.model_entities import AIModelEntity, FetchFrom, ModelPropertyKey
    from services.entities.model_billing_migration import canonical_hash

    schema = AIModelEntity(
        model="gpt-4o",
        label=I18nObject(en_US="GPT-4o"),
        model_type=ModelType.LLM,
        fetch_from=FetchFrom.PREDEFINED_MODEL,
        model_properties={ModelPropertyKey.MODE: "chat"},
    )
    digest = (
        "sha256:"
        + hashlib.sha256(
            json.dumps(
                schema.model_dump(mode="json"), sort_keys=True, separators=(",", ":"), ensure_ascii=False
            ).encode()
        ).hexdigest()
    )
    record = SimpleNamespace(
        mapping_revision="fixture-v1",
        source_schema_digest=digest,
        operations=plan().operations,
        source=SimpleNamespace(mode="chat"),
        target=SimpleNamespace(model="fixture-target"),
    )
    mocker.patch(
        "core.model_invocation_routing.model_mappings",
        return_value={
            (plan().logical_provider, ModelType.LLM, "gpt-4o"): record,
        },
    )
    provider = configuration()
    provider.provider.models = [schema]
    manager = Mock()
    manager.get_configurations.return_value = [(plan().logical_provider, provider)]
    mocker.patch("core.plugin.impl.model_runtime_factory.create_plugin_provider_manager", return_value=manager)
    result = migration_inventory(plan().tenant_id, "fixture-v1")
    assert result["inventory_hash"] == canonical_hash(result["models"])
    assert "embedding_dimensions" not in result["models"][0]
    assert result["source_ownership"][plan().logical_provider]["quotas"]["paid"] == {"unmetered": False}


def test_migration_lookup_failure_is_sanitized_and_never_opens_legacy(mocker):
    from core.model_invocation_routing import migration_routing_state

    mocker.patch(
        "core.model_invocation_routing.get_routing_state",
        side_effect=RuntimeError("SQL connection TEST_SECRET"),
    )
    with pytest.raises(ModelRouteUnavailable) as caught:
        migration_routing_state(plan().tenant_id)
    assert "TEST_SECRET" not in str(caught.value)


@pytest.mark.parametrize("ever_activated", [False, True])
def test_cancelled_route_requires_explicit_activation(mocker, ever_activated):
    from core.model_invocation_routing import migration_display_status

    state = {
        "phase": "cancelled",
        "claimed_at": "2026-09-28T00:00:00Z",
        "ever_activated": ever_activated,
        "route_epoch": 3,
        "model_mapping_version": "fixture-v1",
        "preparation": credential_pin(),
    }
    mocker.patch("core.model_invocation_routing.migration_routing_state", return_value=state)
    assert has_compatibility_route(state)
    assert migration_display_status(plan().tenant_id) == ("active" if ever_activated else "processing")
    mocker.patch(
        "core.model_invocation_routing.model_mappings",
        return_value={
            (plan().logical_provider, ModelType.LLM, "gpt-4o"): SimpleNamespace(
                pool_types=["paid"],
                mapping_revision="fixture-v1",
                operations=list(plan().operations),
                target=SimpleNamespace(model="fixture-target"),
            ),
        },
    )
    session = Mock()
    session.scalar.return_value = SimpleNamespace(
        status="ready",
        provider_credential_id=plan().credential_id,
        plugin_unique_identifier=plan().plugin_unique_identifier,
    )
    mocker.patch("core.model_invocation_routing.session_factory.create_session", return_value=nullcontext(session))
    if ever_activated:
        credentials = routed_credentials(configuration(), ModelType.LLM, "gpt-4o")
        assert isinstance(credentials, RoutedModelCredentials)
        validate_invocation_admission(
            credentials, tenant_id=plan().tenant_id, provider="openai", model_type=ModelType.LLM, model="gpt-4o"
        )
    else:
        with pytest.raises(ModelMigrationProcessing):
            routed_credentials(configuration(), ModelType.LLM, "gpt-4o")
        with pytest.raises(ModelInvocationReprepare):
            validate_invocation_admission(
                RoutedModelCredentials(plan()),
                tenant_id=plan().tenant_id,
                provider="openai",
                model_type=ModelType.LLM,
                model="gpt-4o",
            )
        session.scalar.assert_not_called()


@pytest.mark.parametrize(
    "edited_config",
    [
        '{"api_key":"BYOK_CIPHERTEXT","endpoint_url":"https://fixture.invalid"}',
        '{"api_key":"encrypted","endpoint_url":"https://other-fixture.invalid"}',
    ],
)
def test_mutated_managed_row_fails_before_decrypt_and_plugin_dispatch(mocker, edited_config):
    session = Mock()
    session.scalar.return_value = SimpleNamespace(encrypted_config=edited_config)
    mocker.patch("core.model_invocation_routing.session_factory.create_session", return_value=nullcontext(session))
    decrypt = mocker.patch("core.helper.encrypter.decrypt_token")
    policy = mocker.patch("core.helper.credential_utils.runtime_check_credential_policy_compliance")
    client = PluginModelClient()
    send = mocker.patch.object(client, "_request_with_plugin_daemon_response_stream")
    with pytest.raises(ModelRouteUnavailable) as caught:
        list(
            client.invoke_llm(
                tenant_id=plan().tenant_id,
                user_id=None,
                plugin_id="langgenius/openai",
                provider="openai",
                model="gpt-4o",
                credentials=RoutedModelCredentials(plan()),
                prompt_messages=[],
                stream=True,
            )
        )
    assert caught.value.code == 503
    decrypt.assert_not_called()
    policy.assert_not_called()
    send.assert_not_called()


def test_fingerprint_plan_never_contains_key_or_ciphertext():
    from dataclasses import asdict

    data = asdict(plan())
    assert "encrypted_config" not in data
    assert "api_key" not in data
    assert "encrypted" not in json.dumps(data)
    assert data["expected_credential_fingerprint"] == canonical_hash({"encrypted_config": TEST_ENCRYPTED_CONFIG})


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("tenant_id", "another-tenant"),
        ("provider_credential_id", "byok-id"),
        ("provider_name", "another/provider"),
        ("credential_fingerprint", ""),
    ],
)
def test_authoritative_credential_pin_must_match_complete_owner_chain(field, value):
    from core.model_invocation_routing import _pinned_credential_fingerprint

    pin = {**credential_pin(), field: value}
    with pytest.raises(ModelRouteUnavailable):
        _pinned_credential_fingerprint({"preparation": pin}, plan().tenant_id, plan().credential_id)


def test_missing_pin_never_retrusts_the_current_edited_row():
    from core.model_invocation_routing import _pinned_credential_fingerprint

    with pytest.raises(ModelRouteUnavailable):
        _pinned_credential_fingerprint({}, plan().tenant_id, plan().credential_id, allow_provisioned=True)
