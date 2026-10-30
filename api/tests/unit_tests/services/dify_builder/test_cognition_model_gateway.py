"""Native selected credential chain, including one LB choice before dispatch."""

from typing import override

import pytest

from core.dify_builder.models import Actor
from core.entities.provider_entities import CustomProviderConfiguration, ModelLoadBalancingConfiguration
from core.model_manager import LBModelManager
from services.dify_builder.cognition_model_gateway import NativeCognitionModels
from tests.helpers.unit.core.model_fixtures import make_model_instance


class Credentials:
    selected: dict[str, object] | None = None

    def model_credentials_visible(self, **kwargs: object) -> bool:
        self.selected = kwargs
        return kwargs["provider_credential_ids"] == ["chosen"]


class NativeSelection(LBModelManager):
    def __init__(self) -> None:
        pass

    @override
    def fetch_next(self) -> ModelLoadBalancingConfiguration:
        return ModelLoadBalancingConfiguration(
            id="lb",
            name="one",
            credentials={"token": "chosen"},
            credential_source_type="provider",
            credential_id="chosen",
        )


def test_visibility_follows_selected_lb_chain_and_cannot_retry_another_credential() -> None:
    credentials = Credentials()
    gateway = NativeCognitionModels(credentials)
    instance = make_model_instance(provider="openai", model="gpt")
    instance.provider_model_bundle.configuration.custom_configuration.provider = CustomProviderConfiguration(
        credentials={"token": "other"}, current_credential_id="unselected-private"
    )
    instance.load_balancing_manager = NativeSelection()
    assert gateway._visible(Actor(tenant_id="tenant", account_id="admin"), instance)
    assert credentials.selected is not None
    assert credentials.selected["provider_credential_ids"] == ["chosen"]
    assert instance.credentials == {"token": "chosen"}
    assert instance.load_balancing_manager is None


@pytest.mark.parametrize("failure", [TimeoutError, ValueError, None])
def test_configured_custom_model_schema_failure_stays_unknown_without_fallback(
    monkeypatch: pytest.MonkeyPatch,
    failure: type[Exception] | None,
) -> None:
    from core.entities.provider_configuration import ProviderConfiguration
    from core.entities.provider_entities import CustomModelConfiguration
    from core.model_manager import ModelInstance, ModelManager
    from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelType
    from services.dify_builder.application.cognition_policy import (
        CognitionModel,
        CognitionPolicy,
        CognitionPolicyDeniedError,
        CognitionPolicyService,
    )
    from tests.unit_tests.services.dify_builder.test_cognition_policy import Policies

    actor = Actor(tenant_id="tenant", account_id="admin")
    instance = make_model_instance(provider="openai", model="custom-primary")
    configuration = instance.provider_model_bundle.configuration
    configuration.custom_configuration.models = [
        CustomModelConfiguration(
            model="custom-primary",
            model_type=ModelType.LLM,
            credentials={"token": "selected"},
            current_credential_id="chosen",
        )
    ]
    monkeypatch.setattr(ProviderConfiguration, "_get_provider_schema", lambda _self: configuration.provider)

    def unavailable_schema(_self: ProviderConfiguration, **_kwargs: object) -> AIModelEntity | None:
        if failure is not None:
            raise failure("schema RPC outcome unknown")
        return None

    monkeypatch.setattr(ProviderConfiguration, "get_model_schema", unavailable_schema)
    # Exercise the real native lossy boundary first: ordinary catalogue behavior
    # deliberately remains unchanged; Builder must not treat this omission as a
    # locally known absent configuration.
    assert configuration.get_provider_model(ModelType.LLM, "custom-primary", only_active=True) is None
    manager = ModelManager.for_tenant("tenant")
    selections: list[str] = []

    def resolve(*, model: str, **_kwargs: object) -> ModelInstance:
        selections.append(model)
        return instance

    monkeypatch.setattr(manager, "get_model_instance", resolve)
    monkeypatch.setattr(manager, "get_default_model_instance", lambda **_kwargs: instance)
    monkeypatch.setattr(ModelManager, "for_tenant", lambda *_args, **_kwargs: manager)
    gateway = NativeCognitionModels(Credentials())
    policies = Policies()
    primary = CognitionModel("primary", "openai", "custom-primary", "chat", {})
    fallback = CognitionModel("fallback", "openai", "backup", "chat", {})
    policies.policy = CognitionPolicy(True, (primary, fallback), "primary", ("fallback",), 1, "explicit")
    service = CognitionPolicyService(policies, gateway)
    with pytest.raises(CognitionPolicyDeniedError, match="model_availability_unknown"):
        service.select(actor, None)
    assert selections == ["custom-primary"]
    assert service.availability(actor).health["primary"] == "unknown"
    with pytest.raises(CognitionPolicyDeniedError, match="model_availability_unknown"):
        gateway.workspace_default(actor)
    policies.policy = None
    inherited = service.availability(actor)
    assert inherited.policy.source == "workspace_default"
    assert inherited.policy.revision == 0
    assert not inherited.available
    assert inherited.reason_code == "model_availability_unknown"


@pytest.mark.parametrize("failure", [TimeoutError, ValueError, None])
def test_hosted_customizable_schema_uncertainty_never_chooses_available_fallback(
    monkeypatch: pytest.MonkeyPatch,
    failure: type[Exception] | None,
) -> None:
    from core.entities.provider_configuration import ProviderConfiguration
    from core.entities.provider_entities import (
        ModelSettings,
        ProviderQuotaType,
        QuotaConfiguration,
        QuotaUnit,
        RestrictModel,
        SystemConfiguration,
    )
    from core.model_manager import ModelInstance, ModelManager
    from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelType
    from graphon.model_runtime.entities.provider_entities import ConfigurateMethod
    from models.provider import ProviderType
    from services.dify_builder.application.cognition_policy import (
        CognitionModel,
        CognitionPolicy,
        CognitionPolicyDeniedError,
        CognitionPolicyService,
    )
    from tests.helpers.unit.core.model_fixtures import make_model_config
    from tests.unit_tests.services.dify_builder.test_cognition_policy import Policies

    actor = Actor(tenant_id="tenant", account_id="admin")
    primary = make_model_instance(provider="openai", model="hosted-custom")
    backup = make_model_instance(provider="openai", model="backup")
    backup_schema = make_model_config(provider="openai", model="backup", mode="chat").model_schema
    for instance in (primary, backup):
        configuration = instance.provider_model_bundle.configuration
        configuration.using_provider_type = ProviderType.SYSTEM
        configuration.system_configuration = SystemConfiguration(
            enabled=True,
            current_quota_type=ProviderQuotaType.PAID,
            credentials={"token": "managed"},
            quota_configurations=[
                QuotaConfiguration(
                    quota_type=ProviderQuotaType.PAID,
                    quota_unit=QuotaUnit.TIMES,
                    quota_limit=100,
                    quota_used=1,
                    is_valid=True,
                    restrict_models=[
                        RestrictModel(model=model, model_type=ModelType.LLM, base_model_name="base")
                        for model in ("hosted-custom", "backup")
                    ],
                )
            ],
        )
    monkeypatch.setattr(ProviderConfiguration, "_get_provider_schema", lambda self: self.provider)
    monkeypatch.setattr(
        ProviderConfiguration,
        "_get_original_provider_configurate_methods",
        lambda _self: [ConfigurateMethod.CUSTOMIZABLE_MODEL],
    )
    schema_calls: list[str] = []

    def schema(
        _self: ProviderConfiguration, *, model: str, credentials: dict[str, object], model_type: ModelType
    ) -> AIModelEntity | None:
        assert model_type == ModelType.LLM
        assert credentials["base_model_name"] == "base"
        schema_calls.append(model)
        if model == "backup":
            return backup_schema
        if failure is not None:
            raise failure("hosted schema metadata unknown")
        return None

    monkeypatch.setattr(ProviderConfiguration, "get_model_schema", schema)
    # Confirm the real native SYSTEM/CUSTOMIZABLE_MODEL omission still exists;
    # this change must be scoped to Builder rather than altering that owner.
    assert (
        primary.provider_model_bundle.configuration.get_provider_model(
            ModelType.LLM,
            "hosted-custom",
            only_active=True,
        )
        is None
    )
    manager = ModelManager.for_tenant("tenant")
    selections: list[str] = []

    def resolve(*, model: str, **_kwargs: object) -> ModelInstance:
        selections.append(model)
        return primary if model == "hosted-custom" else backup

    monkeypatch.setattr(manager, "get_model_instance", resolve)
    monkeypatch.setattr(manager, "get_default_model_instance", lambda **_kwargs: primary)
    monkeypatch.setattr(ModelManager, "for_tenant", lambda *_args, **_kwargs: manager)
    gateway = NativeCognitionModels(Credentials())
    policies = Policies()
    policies.policy = CognitionPolicy(
        True,
        (
            CognitionModel("primary", "openai", "hosted-custom", "chat", {}),
            CognitionModel("fallback", "openai", "backup", "chat", {}),
        ),
        "primary",
        ("fallback",),
        1,
        "explicit",
    )
    service = CognitionPolicyService(policies, gateway)
    with pytest.raises(CognitionPolicyDeniedError, match="model_availability_unknown"):
        service.select(actor, None)
    assert selections == ["hosted-custom"]
    status = service.availability(actor)
    assert status.health == {"primary": "unknown", "fallback": "configured"}
    assert not status.available
    assert status.reason_code == "model_availability_unknown"
    policies.policy = None
    inherited = service.availability(actor)
    assert inherited.policy.source == "workspace_default"
    assert inherited.policy.revision == 0
    assert inherited.reason_code == "model_availability_unknown"

    # Local quota, exact allowlist and disablement are known refusals: none
    # should turn into an unknown schema state or make an unnecessary RPC.
    configuration = primary.provider_model_bundle.configuration
    quota = configuration.system_configuration.quota_configurations[0]
    choice = CognitionModel("primary", "openai", "hosted-custom", "chat", {})
    schema_calls.clear()
    quota.is_valid = False
    assert not gateway.available(actor, choice)
    assert schema_calls == []
    quota.is_valid = True
    permitted = quota.restrict_models
    quota.restrict_models = [model for model in permitted if model.model == "backup"]
    assert not gateway.available(actor, choice)
    assert schema_calls == []
    quota.restrict_models = permitted
    configuration.model_settings = [ModelSettings(model="hosted-custom", model_type=ModelType.LLM, enabled=False)]
    assert not gateway.available(actor, choice)
    assert schema_calls == []
