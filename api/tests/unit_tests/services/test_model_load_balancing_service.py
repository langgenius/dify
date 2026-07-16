"""SQLite-backed tests for :mod:`services.model_load_balancing_service`."""

from __future__ import annotations

import json
from collections.abc import Iterator
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import Engine, event, select
from sqlalchemy.orm import Session

from constants import HIDDEN_VALUE
from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.model_entities import ModelType
from graphon.model_runtime.entities.provider_entities import (
    CredentialFormSchema,
    FieldModelSchema,
    FormType,
    ModelCredentialSchema,
    ProviderCredentialSchema,
)
from models.base import TypeBase
from models.enums import CredentialSourceType
from models.provider import (
    LoadBalancingModelConfig,
    ProviderCredential,
    ProviderModelCredential,
    ProviderModelSetting,
)
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


def _provider_configuration(
    *,
    custom: bool = False,
    load_balancing_enabled: bool | None = None,
    model_schema: ModelCredentialSchema | None = None,
    provider_schema: ProviderCredentialSchema | None = None,
) -> MagicMock:
    configuration = MagicMock()
    configuration.provider = SimpleNamespace(
        provider="openai",
        model_credential_schema=model_schema,
        provider_credential_schema=provider_schema or _provider_schema(),
    )
    configuration.custom_configuration = SimpleNamespace(provider=custom)
    configuration.extract_secret_variables.return_value = ["api_key"]
    configuration.obfuscated_credentials.side_effect = lambda credentials, credential_form_schemas: credentials
    configuration.get_provider_model_setting.return_value = (
        None if load_balancing_enabled is None else SimpleNamespace(load_balancing_enabled=load_balancing_enabled)
    )
    return configuration


@pytest.fixture
def service(monkeypatch: pytest.MonkeyPatch) -> tuple[ModelLoadBalancingService, MagicMock, MagicMock]:
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


@pytest.mark.parametrize("method_name", ["enable_model_load_balancing", "disable_model_load_balancing"])
def test_enable_disable_dispatches_to_provider_configuration(
    method_name: str, service: tuple[ModelLoadBalancingService, MagicMock, MagicMock]
) -> None:
    svc, _, configuration = service
    getattr(svc, method_name)("tenant-1", "openai", "gpt-4o-mini", "text-generation")
    getattr(configuration, method_name).assert_called_once_with(model="gpt-4o-mini", model_type=ModelType.LLM)


def test_provider_missing_errors_use_runtime_boundary(
    service: tuple[ModelLoadBalancingService, MagicMock, MagicMock], orm_session: Session
) -> None:
    svc, manager, _ = service
    manager.get_configurations.return_value = {}
    with pytest.raises(ValueError, match="Provider openai does not exist"):
        svc.enable_model_load_balancing("tenant-1", "openai", "model", ModelType.LLM)
    with pytest.raises(ValueError, match="Provider openai does not exist"):
        svc.get_load_balancing_configs("tenant-1", "openai", "model", ModelType.LLM, session=orm_session)


def test_get_configs_inserts_inherit_and_filters_tenant_provider_and_source(
    monkeypatch: pytest.MonkeyPatch,
    service: tuple[ModelLoadBalancingService, MagicMock, MagicMock],
    orm_session: Session,
) -> None:
    svc, _, configuration = service
    configuration.custom_configuration.provider = True
    configuration.get_provider_model_setting.return_value = SimpleNamespace(load_balancing_enabled=True)
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
    assert configs[1]["credentials"] == {"api_key": "plain"}
    persisted = orm_session.scalar(
        select(LoadBalancingModelConfig).where(LoadBalancingModelConfig.name == "__inherit__")
    )
    assert persisted is not None
    assert persisted.tenant_id == "tenant-1"


def test_get_configs_returns_empty_for_noncustom_provider(
    monkeypatch: pytest.MonkeyPatch,
    service: tuple[ModelLoadBalancingService, MagicMock, MagicMock],
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
    service: tuple[ModelLoadBalancingService, MagicMock, MagicMock],
    orm_session: Session,
) -> None:
    svc, _, configuration = service
    configuration.custom_configuration.provider = True
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
    assert configs[1]["credentials"] == {"api_key": "bad"}
    assert configs[1]["in_cooldown"] is True


def test_get_single_config_is_tenant_scoped_and_obfuscated(
    service: tuple[ModelLoadBalancingService, MagicMock, MagicMock], orm_session: Session
) -> None:
    svc, _, configuration = service
    configuration.obfuscated_credentials.side_effect = lambda credentials, credential_form_schemas: {
        "masked": credentials.get("api_key", "")
    }
    config = _config(orm_session, encrypted_config='{"api_key":"secret"}')
    assert svc.get_load_balancing_config(
        "tenant-1", "openai", "gpt-4o-mini", ModelType.LLM, config.id, session=orm_session
    ) == {"id": config.id, "name": "primary", "credentials": {"masked": "secret"}, "enabled": True}
    assert (
        svc.get_load_balancing_config(
            "tenant-2", "openai", "gpt-4o-mini", ModelType.LLM, config.id, session=orm_session
        )
        is None
    )


def test_init_inherit_config_persists_and_sql_failure_rolls_back(
    service: tuple[ModelLoadBalancingService, MagicMock, MagicMock],
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
    service: tuple[ModelLoadBalancingService, MagicMock, MagicMock],
    orm_session: Session,
) -> None:
    svc, _, _ = service
    with pytest.raises(ValueError, match=message):
        svc.update_load_balancing_configs(
            "tenant-1", "openai", "gpt-4o-mini", ModelType.LLM, configs, "custom-model", orm_session
        )


def test_update_configs_updates_creates_and_deletes_persisted_rows(
    monkeypatch: pytest.MonkeyPatch,
    service: tuple[ModelLoadBalancingService, MagicMock, MagicMock],
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
    service: tuple[ModelLoadBalancingService, MagicMock, MagicMock], orm_session: Session
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
    service: tuple[ModelLoadBalancingService, MagicMock, MagicMock],
    orm_session: Session,
) -> None:
    svc, manager, _ = service
    config = _config(orm_session)
    assembly = SimpleNamespace(provider_manager=manager, model_provider_factory=MagicMock())
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
    service: tuple[ModelLoadBalancingService, MagicMock, MagicMock],
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


def test_schema_selection_and_cache_boundary(service: tuple[ModelLoadBalancingService, MagicMock, MagicMock]) -> None:
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
