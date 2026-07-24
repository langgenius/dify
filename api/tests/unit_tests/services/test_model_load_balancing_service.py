"""SQLite-backed tests for :mod:`services.model_load_balancing_service`."""

from __future__ import annotations

import json
from collections.abc import Iterator
from contextlib import contextmanager
from typing import cast
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import Engine, event, select
from sqlalchemy.orm import Session

from constants import HIDDEN_VALUE
from core.entities.provider_configuration import ProviderConfiguration, ProviderConfigurations
from core.entities.provider_entities import CustomConfiguration, CustomProviderConfiguration, SystemConfiguration
from core.plugin.impl.model_runtime_factory import PluginModelAssembly
from core.provider_manager import ProviderManager
from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.model_entities import ModelType
from graphon.model_runtime.entities.provider_entities import (
    ConfigurateMethod,
    CredentialFormSchema,
    FieldModelSchema,
    FormType,
    ModelCredentialSchema,
    ProviderCredentialSchema,
    ProviderEntity,
)
from graphon.model_runtime.model_providers.model_provider_factory import ModelProviderFactory
from graphon.model_runtime.protocols.runtime import ModelRuntime
from models.base import TypeBase
from models.engine import db
from models.enums import CredentialSourceType
from models.provider import (
    LoadBalancingModelConfig,
    ProviderCredential,
    ProviderModelCredential,
    ProviderModelSetting,
    ProviderType,
)
from models.provider_ids import ModelProviderID
from services.model_load_balancing_service import ModelLoadBalancingService


@pytest.fixture
def orm_session(sqlite_engine: Engine) -> Iterator[Session]:
    tables = [
        model.__table__
        for model in (LoadBalancingModelConfig, ProviderCredential, ProviderModelCredential, ProviderModelSetting)
    ]
    TypeBase.metadata.create_all(sqlite_engine, tables=tables)
    with Session(sqlite_engine, expire_on_commit=False) as session:
        yield session


def _provider_schema() -> ProviderCredentialSchema:
    return ProviderCredentialSchema(
        credential_form_schemas=[
            CredentialFormSchema(variable="api_key", label=I18nObject(en_US="API Key"), type=FormType.SECRET_INPUT)
        ]
    )


def _model_schema() -> ModelCredentialSchema:
    return ModelCredentialSchema(
        model=FieldModelSchema(label=I18nObject(en_US="Model")),
        credential_form_schemas=[
            CredentialFormSchema(variable="api_key", label=I18nObject(en_US="API Key"), type=FormType.SECRET_INPUT)
        ],
    )


def _provider_configuration() -> ProviderConfiguration:
    """Build a concrete provider configuration for service tests."""
    return ProviderConfiguration(
        tenant_id="tenant-1",
        provider=ProviderEntity(
            provider="openai",
            label=I18nObject(en_US="OpenAI"),
            supported_model_types=[ModelType.LLM],
            configurate_methods=[ConfigurateMethod.PREDEFINED_MODEL],
            provider_credential_schema=_provider_schema(),
        ),
        preferred_provider_type=ProviderType.SYSTEM,
        using_provider_type=ProviderType.SYSTEM,
        system_configuration=SystemConfiguration(enabled=False),
        custom_configuration=CustomConfiguration(provider=None, models=[]),
        model_settings=[],
    )


type ServiceFixture = tuple[ModelLoadBalancingService, MagicMock, ProviderConfiguration]


@pytest.fixture
def service(monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine) -> ServiceFixture:
    configuration = _provider_configuration()
    manager = MagicMock()
    manager.get_configurations.return_value = {"openai": configuration}
    svc = ModelLoadBalancingService()
    monkeypatch.setattr(svc, "_get_provider_manager", lambda _tenant_id: manager)
    monkeypatch.setattr(
        "services.model_load_balancing_service.create_plugin_provider_manager", lambda tenant_id: manager
    )
    monkeypatch.setattr(
        "services.model_load_balancing_service.ProviderManager.invalidate_configurations_cache", MagicMock()
    )
    monkeypatch.setattr("services.model_load_balancing_service.ProviderCredentialsCache", MagicMock())
    monkeypatch.setattr(type(db), "engine", property(lambda _db: sqlite_engine))
    return svc, manager, configuration


def _config(
    session: Session,
    *,
    tenant_id: str = "tenant-1",
    provider: str = "openai",
    model: str = "gpt-4o-mini",
    name: str = "primary",
    encrypted_config: str | None = '{"api_key":"encrypted"}',
    credential_id: str | None = None,
    source: CredentialSourceType | None = None,
    enabled: bool = True,
) -> LoadBalancingModelConfig:
    config = LoadBalancingModelConfig(
        tenant_id=tenant_id,
        provider_name=provider,
        model_name=model,
        model_type=ModelType.LLM,
        name=name,
        encrypted_config=encrypted_config,
        credential_id=credential_id,
        credential_source_type=source,
        enabled=enabled,
    )
    session.add(config)
    session.commit()
    return config


@contextmanager
def _raise_on_insert(engine: Engine) -> Iterator[None]:
    def raise_error(_conn, _cursor, statement, _parameters, _context, _executemany):
        if statement.lstrip().upper().startswith("INSERT") and "load_balancing_model_configs" in statement:
            raise RuntimeError("forced INSERT")

    event.listen(engine, "before_cursor_execute", raise_error)
    try:
        yield
    finally:
        event.remove(engine, "before_cursor_execute", raise_error)


@pytest.mark.parametrize("enabled", [True, False])
def test_enable_disable_persists_provider_model_setting(
    enabled: bool,
    monkeypatch: pytest.MonkeyPatch,
    orm_session: Session,
    sqlite_engine: Engine,
) -> None:
    _config(orm_session, name="primary")
    _config(orm_session, name="secondary")
    configuration = _provider_configuration()
    configurations = ProviderConfigurations(tenant_id="tenant-1")
    configurations[str(ModelProviderID("openai"))] = configuration
    manager = ProviderManager(cast(ModelRuntime, object()))
    manager._configurations_cache["tenant-1"] = configurations
    svc = ModelLoadBalancingService()
    monkeypatch.setattr(svc, "_get_provider_manager", lambda _tenant_id: manager)
    monkeypatch.setattr(type(db), "engine", property(lambda _db: sqlite_engine))

    if enabled:
        svc.enable_model_load_balancing("tenant-1", "openai", "gpt-4o-mini", "text-generation")
    else:
        svc.disable_model_load_balancing("tenant-1", "openai", "gpt-4o-mini", "text-generation")

    orm_session.expire_all()
    model_setting = orm_session.scalar(
        select(ProviderModelSetting).where(
            ProviderModelSetting.tenant_id == "tenant-1",
            ProviderModelSetting.provider_name == "openai",
            ProviderModelSetting.model_name == "gpt-4o-mini",
            ProviderModelSetting.model_type == ModelType.LLM,
        )
    )
    assert model_setting is not None
    assert model_setting.load_balancing_enabled is enabled


def test_provider_missing_errors_use_runtime_boundary(service: ServiceFixture, orm_session: Session) -> None:
    svc, manager, _ = service
    manager.get_configurations.return_value = {}
    with pytest.raises(ValueError, match="Provider openai does not exist"):
        svc.enable_model_load_balancing("tenant-1", "openai", "model", ModelType.LLM)
    with pytest.raises(ValueError, match="Provider openai does not exist"):
        svc.get_load_balancing_configs("tenant-1", "openai", "model", ModelType.LLM, session=orm_session)


def test_get_configs_inserts_inherit_and_filters_tenant_provider_and_source(
    monkeypatch: pytest.MonkeyPatch,
    service: ServiceFixture,
    orm_session: Session,
) -> None:
    svc, _, configuration = service
    configuration.custom_configuration.provider = CustomProviderConfiguration(credentials={})
    orm_session.add(
        ProviderModelSetting(
            tenant_id="tenant-1",
            provider_name="openai",
            model_name="gpt-4o-mini",
            model_type=ModelType.LLM,
            load_balancing_enabled=True,
        )
    )
    orm_session.commit()
    matching = _config(orm_session, credential_id="cred-1", source=CredentialSourceType.PROVIDER, name="matching")
    _config(orm_session, tenant_id="tenant-2", source=CredentialSourceType.PROVIDER, name="foreign-tenant")
    _config(orm_session, provider="anthropic", source=CredentialSourceType.PROVIDER, name="foreign-provider")
    _config(orm_session, source=CredentialSourceType.CUSTOM_MODEL, name="foreign-source")
    monkeypatch.setattr(
        "services.model_load_balancing_service.encrypter.get_decrypt_decoding", lambda _tenant: ("rsa", "cipher")
    )
    monkeypatch.setattr(
        "services.model_load_balancing_service.encrypter.decrypt_token_with_decoding",
        lambda _value, _key, _cipher: "plain",
    )
    monkeypatch.setattr(
        "services.model_load_balancing_service.LBModelManager.get_config_in_cooldown_and_ttl",
        lambda **_kwargs: (False, 0),
    )
    enabled, configs = svc.get_load_balancing_configs(
        "tenant-1",
        "openai",
        "gpt-4o-mini",
        ModelType.LLM,
        config_from="predefined-model",
        session=orm_session,
    )
    assert enabled is True
    assert [config["name"] for config in configs] == ["__inherit__", "matching"]
    assert configs[1]["id"] == matching.id
    assert configs[1]["credentials"] == {"api_key": "*" * 20}
    persisted = orm_session.scalar(
        select(LoadBalancingModelConfig).where(LoadBalancingModelConfig.name == "__inherit__")
    )
    assert persisted is not None
    assert persisted.tenant_id == "tenant-1"


def test_get_configs_returns_empty_for_noncustom_provider(
    monkeypatch: pytest.MonkeyPatch,
    service: ServiceFixture,
    orm_session: Session,
) -> None:
    svc, _, _ = service
    monkeypatch.setattr(
        "services.model_load_balancing_service.encrypter.get_decrypt_decoding", lambda _tenant: ("rsa", "cipher")
    )
    enabled, configs = svc.get_load_balancing_configs(
        "tenant-1", "openai", "gpt-4o-mini", ModelType.LLM, session=orm_session
    )
    assert enabled is False
    assert configs == []


def test_get_configs_reorders_existing_inherit_and_tolerates_bad_credentials(
    monkeypatch: pytest.MonkeyPatch,
    service: ServiceFixture,
    orm_session: Session,
) -> None:
    svc, _, configuration = service
    configuration.custom_configuration.provider = CustomProviderConfiguration(credentials={})
    _config(orm_session, name="normal", encrypted_config='{"api_key":"bad"}')
    _config(orm_session, name="__inherit__", encrypted_config="not-json", enabled=False)
    monkeypatch.setattr(
        "services.model_load_balancing_service.encrypter.get_decrypt_decoding", lambda _tenant: ("rsa", "cipher")
    )
    monkeypatch.setattr(
        "services.model_load_balancing_service.encrypter.decrypt_token_with_decoding",
        MagicMock(side_effect=ValueError("cannot decrypt")),
    )
    monkeypatch.setattr(
        "services.model_load_balancing_service.LBModelManager.get_config_in_cooldown_and_ttl",
        lambda **_kwargs: (True, 15),
    )
    _, configs = svc.get_load_balancing_configs("tenant-1", "openai", "gpt-4o-mini", ModelType.LLM, session=orm_session)
    assert [config["name"] for config in configs] == ["__inherit__", "normal"]
    assert configs[0]["credentials"] == {}
    assert configs[1]["credentials"] == {"api_key": "*" * 20}
    assert configs[1]["in_cooldown"] is True


def test_get_single_config_is_tenant_scoped_and_obfuscated(service: ServiceFixture, orm_session: Session) -> None:
    svc, _, _ = service
    config = _config(orm_session, encrypted_config='{"api_key":"secret"}')
    assert svc.get_load_balancing_config(
        "tenant-1", "openai", "gpt-4o-mini", ModelType.LLM, config.id, session=orm_session
    ) == {"id": config.id, "name": "primary", "credentials": {"api_key": "*" * 20}, "enabled": True}
    assert (
        svc.get_load_balancing_config(
            "tenant-2", "openai", "gpt-4o-mini", ModelType.LLM, config.id, session=orm_session
        )
        is None
    )


def test_init_inherit_config_persists_and_sql_failure_rolls_back(
    service: ServiceFixture,
    orm_session: Session,
    sqlite_engine: Engine,
) -> None:
    svc, _, _ = service
    created = svc._init_inherit_config("tenant-1", "openai", "gpt-4o-mini", ModelType.LLM, orm_session)
    assert orm_session.get(LoadBalancingModelConfig, created.id) is not None
    orm_session.delete(created)
    orm_session.commit()
    with _raise_on_insert(sqlite_engine), pytest.raises(RuntimeError, match="forced INSERT"):
        svc._init_inherit_config("tenant-1", "openai", "gpt-4o-mini", ModelType.LLM, orm_session)
    orm_session.rollback()
    assert orm_session.scalar(select(LoadBalancingModelConfig)) is None


@pytest.mark.parametrize(
    ("configs", "message"),
    [
        ("invalid", "Invalid load balancing configs"),
        (["invalid"], "Invalid load balancing config"),
        ([{"enabled": True}], "Invalid load balancing config name"),
        ([{"name": "missing-enabled"}], "Invalid load balancing config enabled"),
        ([{"name": "new", "enabled": True, "credentials": "bad"}], "Invalid load balancing config credentials"),
    ],
)
def test_update_configs_rejects_invalid_payloads(
    configs,
    message: str,
    service: ServiceFixture,
    orm_session: Session,
) -> None:
    svc, _, _ = service
    with pytest.raises(ValueError, match=message):
        svc.update_load_balancing_configs(
            "tenant-1", "openai", "gpt-4o-mini", ModelType.LLM, configs, "custom-model", orm_session
        )


def test_update_configs_updates_creates_and_deletes_persisted_rows(
    monkeypatch: pytest.MonkeyPatch,
    service: ServiceFixture,
    orm_session: Session,
) -> None:
    svc, _, _ = service
    keep = _config(orm_session, name="keep", encrypted_config='{"api_key":"old"}')
    removed = _config(orm_session, name="remove")
    monkeypatch.setattr(
        svc,
        "_custom_credentials_validate",
        lambda **kwargs: {"api_key": f"enc-{kwargs['credentials']['api_key']}"},
    )
    svc.update_load_balancing_configs(
        "tenant-1",
        "openai",
        "gpt-4o-mini",
        ModelType.LLM,
        [
            {"id": keep.id, "name": "updated", "enabled": False, "credentials": {"api_key": "new"}},
            {"name": "created", "enabled": True, "credentials": {"api_key": "fresh"}},
        ],
        "custom-model",
        orm_session,
    )
    orm_session.expire_all()
    records = orm_session.scalars(select(LoadBalancingModelConfig)).all()
    assert {record.name for record in records} == {"updated", "created"}
    assert orm_session.get(LoadBalancingModelConfig, removed.id) is None
    updated = orm_session.get(LoadBalancingModelConfig, keep.id)
    assert updated is not None
    assert updated.enabled is False
    assert json.loads(updated.encrypted_config) == {"api_key": "enc-new"}


def test_update_configs_creates_from_tenant_scoped_provider_credential(
    service: ServiceFixture, orm_session: Session
) -> None:
    svc, _, _ = service
    credential = ProviderCredential(
        tenant_id="tenant-1",
        provider_name="openai",
        credential_name="Credential",
        encrypted_config='{"api_key":"enc"}',
    )
    foreign = ProviderCredential(
        tenant_id="tenant-2",
        provider_name="openai",
        credential_name="Foreign",
        encrypted_config="{}",
    )
    orm_session.add_all([credential, foreign])
    orm_session.commit()
    svc.update_load_balancing_configs(
        "tenant-1",
        "openai",
        "gpt-4o-mini",
        ModelType.LLM,
        [{"credential_id": credential.id, "enabled": True}],
        "predefined-model",
        orm_session,
    )
    created = orm_session.scalar(select(LoadBalancingModelConfig))
    assert created is not None
    assert created.name == "Credential"
    assert created.credential_id == credential.id
    assert created.credential_source_type == CredentialSourceType.PROVIDER
    with pytest.raises(ValueError, match="not found"):
        svc.update_load_balancing_configs(
            "tenant-1",
            "openai",
            "other-model",
            ModelType.LLM,
            [{"credential_id": foreign.id, "enabled": True}],
            "predefined-model",
            orm_session,
        )


def test_validate_credentials_uses_real_config_lookup(
    monkeypatch: pytest.MonkeyPatch,
    service: ServiceFixture,
    orm_session: Session,
) -> None:
    svc, manager, _ = service
    config = _config(orm_session)
    assembly = PluginModelAssembly(tenant_id="tenant-1")
    assembly._provider_manager = manager
    assembly._model_provider_factory = ModelProviderFactory(runtime=cast(ModelRuntime, object()))
    monkeypatch.setattr(
        "services.model_load_balancing_service.create_plugin_model_assembly", lambda **_kwargs: assembly
    )
    validate = MagicMock()
    monkeypatch.setattr(svc, "_custom_credentials_validate", validate)
    svc.validate_load_balancing_credentials(
        "tenant-1",
        "openai",
        "gpt-4o-mini",
        ModelType.LLM,
        {"api_key": "raw"},
        orm_session,
        config.id,
    )
    assert validate.call_args.kwargs["load_balancing_model_config"].id == config.id
    with pytest.raises(ValueError, match="does not exist"):
        svc.validate_load_balancing_credentials(
            "tenant-1", "openai", "gpt-4o-mini", ModelType.LLM, {}, orm_session, "missing"
        )


def test_custom_credentials_validate_reuses_hidden_secret_and_encrypts(
    monkeypatch: pytest.MonkeyPatch,
    service: ServiceFixture,
    orm_session: Session,
) -> None:
    svc, _, configuration = service
    config = _config(orm_session, encrypted_config='{"api_key":"old-encrypted"}')
    monkeypatch.setattr("services.model_load_balancing_service.encrypter.decrypt_token", lambda *_args: "old-plain")
    monkeypatch.setattr(
        "services.model_load_balancing_service.encrypter.encrypt_token", lambda _tenant, value: f"enc-{value}"
    )
    result = svc._custom_credentials_validate(
        "tenant-1",
        configuration,
        ModelType.LLM,
        "gpt-4o-mini",
        {"api_key": HIDDEN_VALUE},
        config,
        validate=False,
    )
    assert result == {"api_key": "enc-old-plain"}


def test_schema_selection_and_cache_boundary(service: ServiceFixture) -> None:
    svc, _, configuration = service
    provider_schema = configuration.provider.provider_credential_schema
    assert svc._get_credential_schema(configuration) is provider_schema
    configuration.provider.model_credential_schema = _model_schema()
    assert isinstance(svc._get_credential_schema(configuration), ModelCredentialSchema)
    configuration.provider.model_credential_schema = None
    configuration.provider.provider_credential_schema = None
    with pytest.raises(ValueError, match="No credential schema"):
        svc._get_credential_schema(configuration)
    with patch("services.model_load_balancing_service.ProviderCredentialsCache") as cache:
        svc._clear_credentials_cache("tenant-1", "config-1")
    cache.return_value.delete.assert_called_once()
