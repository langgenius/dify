"""SQLite-backed tests for :mod:`services.model_load_balancing_service`."""

from __future__ import annotations

from collections.abc import Generator
from contextlib import contextmanager
from typing import cast
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import Engine, event, select
from sqlalchemy.orm import Session, sessionmaker

from constants import HIDDEN_VALUE
from core.entities.provider_configuration import ProviderConfiguration, ProviderConfigurations
from core.entities.provider_entities import CustomConfiguration, CustomProviderConfiguration, SystemConfiguration
from core.plugin.impl.model_runtime_factory import PluginModelAssembly
from core.provider_manager import ProviderManager
from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelType
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
from graphon.model_runtime.protocols.provider_runtime import ModelProviderRuntime
from graphon.model_runtime.protocols.runtime import ModelRuntime
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
from services.model_load_balancing_service import (
    LoadBalancingCredentials,
    LoadBalancingTokenCipher,
    ModelLoadBalancingService,
    encrypter_token_cipher,
)

_DEFAULT_STORED_CREDENTIALS = LoadBalancingCredentials({"api_key": "encrypted"}).model_dump_json()

pytestmark = pytest.mark.parametrize(
    "sqlite_session",
    [(LoadBalancingModelConfig, ProviderCredential, ProviderModelCredential, ProviderModelSetting)],
    indirect=True,
)


class PrefixTokenCipher:
    """In-memory cipher the service accepts in place of the tenant key provider."""

    def __init__(self, decrypted: dict[str, str] | None = None) -> None:
        self._decrypted = {} if decrypted is None else decrypted

    def encrypt_token(self, tenant_id: str, token: str) -> str:
        del tenant_id
        return f"enc-{token}"

    def decrypt_token(self, tenant_id: str, token: str) -> str:
        del tenant_id
        return self._decrypted.get(token, token)


class _SchemaRuntime:
    """Provider runtime that exposes one schema and accepts its credentials."""

    def __init__(self, provider: ProviderEntity) -> None:
        self._provider = provider

    def fetch_model_providers(self) -> list[ProviderEntity]:
        return [self._provider]

    def validate_provider_credentials(self, *, provider: str, credentials: dict[str, str | bool]) -> None:
        del provider, credentials

    def validate_model_credentials(
        self,
        *,
        provider: str,
        model_type: ModelType,
        model: str,
        credentials: dict[str, str | bool],
    ) -> None:
        del provider, model_type, model, credentials

    def get_provider_icon(self, *, provider: str, icon_type: str, lang: str) -> tuple[bytes, str]:
        del provider, icon_type, lang
        return b"", "image/png"

    def get_model_schema(
        self,
        *,
        provider: str,
        model_type: ModelType,
        model: str,
        credentials: dict[str, str | bool],
    ) -> AIModelEntity | None:
        del provider, model_type, model, credentials
        return None


def _credential_factory(provider: ProviderEntity) -> ModelProviderFactory:
    runtime: ModelProviderRuntime = _SchemaRuntime(provider)
    return ModelProviderFactory(runtime=runtime)


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
def service(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session) -> ServiceFixture:
    configuration = _provider_configuration()
    manager = MagicMock()
    manager.get_configurations.return_value = {"openai": configuration}
    svc = ModelLoadBalancingService()
    monkeypatch.setattr(svc, "_get_provider_manager", lambda _tenant_id: manager)
    monkeypatch.setattr(
        "services.model_load_balancing_service.create_plugin_provider_manager", lambda **_kwargs: manager
    )
    monkeypatch.setattr(
        "services.model_load_balancing_service.ProviderManager.invalidate_configurations_cache", MagicMock()
    )
    monkeypatch.setattr("services.model_load_balancing_service.ProviderCredentialsCache", MagicMock())
    sqlite_engine = cast(Engine, sqlite_session.get_bind())
    monkeypatch.setattr(type(db), "engine", property(lambda _db: sqlite_engine))
    return svc, manager, configuration


def _config(
    session: Session,
    *,
    tenant_id: str = "tenant-1",
    provider: str = "openai",
    model: str = "gpt-4o-mini",
    name: str = "primary",
    encrypted_config: str | None = _DEFAULT_STORED_CREDENTIALS,
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
def _raise_on_insert(engine: Engine) -> Generator[None]:
    def raise_error(_conn, _cursor, statement: str, _parameters, _context, _executemany) -> None:
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
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _config(sqlite_session, name="primary")
    _config(sqlite_session, name="secondary")
    configuration = _provider_configuration()
    configurations = ProviderConfigurations(tenant_id="tenant-1")
    configurations[str(ModelProviderID("openai"))] = configuration
    manager = ProviderManager(cast(ModelRuntime, object()), session_maker=sqlite_session_factory)
    manager._configurations_cache["tenant-1"] = configurations
    svc = ModelLoadBalancingService()
    monkeypatch.setattr(svc, "_get_provider_manager", lambda _tenant_id: manager)
    sqlite_engine = cast(Engine, sqlite_session.get_bind())
    monkeypatch.setattr(type(db), "engine", property(lambda _db: sqlite_engine))

    if enabled:
        svc.enable_model_load_balancing("tenant-1", "openai", "gpt-4o-mini", "llm")
    else:
        svc.disable_model_load_balancing("tenant-1", "openai", "gpt-4o-mini", "llm")

    sqlite_session.expire_all()
    model_setting = sqlite_session.scalar(
        select(ProviderModelSetting).where(
            ProviderModelSetting.tenant_id == "tenant-1",
            ProviderModelSetting.provider_name == "openai",
            ProviderModelSetting.model_name == "gpt-4o-mini",
            ProviderModelSetting.model_type == ModelType.LLM,
        )
    )
    assert model_setting is not None
    assert model_setting.load_balancing_enabled is enabled


def test_provider_missing_errors_use_runtime_boundary(service: ServiceFixture, sqlite_session: Session) -> None:
    svc, manager, _ = service
    manager.get_configurations.return_value = dict[str, ProviderConfiguration]()
    with pytest.raises(ValueError, match="Provider openai does not exist"):
        svc.enable_model_load_balancing("tenant-1", "openai", "model", ModelType.LLM)
    with pytest.raises(ValueError, match="Provider openai does not exist"):
        svc.get_load_balancing_configs("tenant-1", "openai", "model", ModelType.LLM, session=sqlite_session)


def test_get_configs_inserts_inherit_and_filters_tenant_provider_and_source(
    monkeypatch: pytest.MonkeyPatch,
    service: ServiceFixture,
    sqlite_session: Session,
) -> None:
    svc, _, configuration = service
    configuration.custom_configuration.provider = CustomProviderConfiguration(credentials={})
    sqlite_session.add(
        ProviderModelSetting(
            tenant_id="tenant-1",
            provider_name="openai",
            model_name="gpt-4o-mini",
            model_type=ModelType.LLM,
            load_balancing_enabled=True,
        )
    )
    sqlite_session.commit()
    matching = _config(sqlite_session, credential_id="cred-1", source=CredentialSourceType.PROVIDER, name="matching")
    _config(sqlite_session, tenant_id="tenant-2", source=CredentialSourceType.PROVIDER, name="foreign-tenant")
    _config(sqlite_session, provider="anthropic", source=CredentialSourceType.PROVIDER, name="foreign-provider")
    _config(sqlite_session, source=CredentialSourceType.CUSTOM_MODEL, name="foreign-source")
    monkeypatch.setattr(
        "services.model_load_balancing_service.encrypter.get_decrypt_decoding", lambda _tenant: ("rsa", "cipher")
    )
    monkeypatch.setattr(
        "services.model_load_balancing_service.encrypter.decrypt_token_with_decoding",
        lambda _value, _decoding: "plain",
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
        session=sqlite_session,
    )
    assert enabled is True
    assert [config["name"] for config in configs] == ["__inherit__", "matching"]
    assert configs[1]["id"] == matching.id
    assert configs[1]["credentials"] == LoadBalancingCredentials({"api_key": "*" * 20}).root
    persisted = sqlite_session.scalar(
        select(LoadBalancingModelConfig).where(LoadBalancingModelConfig.name == "__inherit__")
    )
    assert persisted is not None
    assert persisted.tenant_id == "tenant-1"


def test_get_configs_returns_empty_for_noncustom_provider(
    monkeypatch: pytest.MonkeyPatch,
    service: ServiceFixture,
    sqlite_session: Session,
) -> None:
    svc, _, _ = service
    monkeypatch.setattr(
        "services.model_load_balancing_service.encrypter.get_decrypt_decoding", lambda _tenant: ("rsa", "cipher")
    )
    enabled, configs = svc.get_load_balancing_configs(
        "tenant-1", "openai", "gpt-4o-mini", ModelType.LLM, session=sqlite_session
    )
    assert enabled is False
    assert configs == []


def test_get_configs_reorders_existing_inherit_and_tolerates_bad_credentials(
    monkeypatch: pytest.MonkeyPatch,
    service: ServiceFixture,
    sqlite_session: Session,
) -> None:
    svc, _, configuration = service
    configuration.custom_configuration.provider = CustomProviderConfiguration(credentials={})
    _config(
        sqlite_session,
        name="normal",
        encrypted_config=LoadBalancingCredentials({"api_key": "bad"}).model_dump_json(),
    )
    _config(sqlite_session, name="__inherit__", encrypted_config="not-json", enabled=False)
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
    _, configs = svc.get_load_balancing_configs(
        "tenant-1", "openai", "gpt-4o-mini", ModelType.LLM, session=sqlite_session
    )
    assert [config["name"] for config in configs] == ["__inherit__", "normal"]
    assert configs[0]["credentials"] == LoadBalancingCredentials({}).root
    assert configs[1]["credentials"] == LoadBalancingCredentials({"api_key": "*" * 20}).root
    assert configs[1]["in_cooldown"] is True


def test_get_single_config_is_tenant_scoped_and_obfuscated(service: ServiceFixture, sqlite_session: Session) -> None:
    svc, _, _ = service
    config = _config(
        sqlite_session,
        encrypted_config=LoadBalancingCredentials({"api_key": "secret"}).model_dump_json(),
    )
    assert svc.get_load_balancing_config(
        "tenant-1", "openai", "gpt-4o-mini", ModelType.LLM, config.id, session=sqlite_session
    ) == {
        "id": config.id,
        "name": "primary",
        "credentials": LoadBalancingCredentials({"api_key": "*" * 20}).root,
        "enabled": True,
    }
    assert (
        svc.get_load_balancing_config(
            "tenant-2", "openai", "gpt-4o-mini", ModelType.LLM, config.id, session=sqlite_session
        )
        is None
    )


def test_init_inherit_config_persists_and_sql_failure_rolls_back(
    service: ServiceFixture,
    sqlite_session: Session,
) -> None:
    svc, _, _ = service
    created = svc._init_inherit_config("tenant-1", "openai", "gpt-4o-mini", ModelType.LLM, sqlite_session)
    assert sqlite_session.get(LoadBalancingModelConfig, created.id) is not None
    sqlite_session.delete(created)
    sqlite_session.commit()
    sqlite_engine = cast(Engine, sqlite_session.get_bind())
    with _raise_on_insert(sqlite_engine), pytest.raises(RuntimeError, match="forced INSERT"):
        svc._init_inherit_config("tenant-1", "openai", "gpt-4o-mini", ModelType.LLM, sqlite_session)
    sqlite_session.rollback()
    assert sqlite_session.scalar(select(LoadBalancingModelConfig)) is None


type InvalidLoadBalancingUpdate = str | list[str] | list[dict[str, bool]] | list[dict[str, str]]


@pytest.mark.parametrize(
    ("configs", "message"),
    [
        ("invalid", "Invalid load balancing configs"),
        (["invalid"], "Invalid load balancing config"),
        ([{"enabled": True}], "Invalid load balancing config name"),
        ([{"name": "missing-enabled"}], "Invalid load balancing config enabled"),
    ],
)
def test_update_configs_rejects_invalid_payloads(
    configs: InvalidLoadBalancingUpdate,
    message: str,
    service: ServiceFixture,
    sqlite_session: Session,
) -> None:
    svc, _, _ = service
    with pytest.raises(ValueError, match=message):
        svc.update_load_balancing_configs(
            "tenant-1",
            "openai",
            "gpt-4o-mini",
            ModelType.LLM,
            configs,  # pyrefly: ignore[bad-argument-type]
            "custom-model",
            sqlite_session,
        )


@pytest.mark.parametrize("existing", [True, False])
def test_update_configs_rejects_invalid_credentials_for_existing_and_new_configs(
    existing: bool,
    service: ServiceFixture,
    sqlite_session: Session,
) -> None:
    svc, _, _ = service
    config = _config(sqlite_session) if existing else None
    payload = {"name": "new", "enabled": True, "credentials": "bad"}
    if config is not None:
        payload["id"] = config.id

    with pytest.raises(ValueError, match="Invalid load balancing config credentials"):
        svc.update_load_balancing_configs(
            "tenant-1", "openai", "gpt-4o-mini", ModelType.LLM, [payload], "custom-model", sqlite_session
        )


def test_update_configs_updates_creates_and_deletes_persisted_rows(
    service: ServiceFixture,
    sqlite_session: Session,
) -> None:
    svc, _, _ = service
    keep = _config(
        sqlite_session,
        name="keep",
        encrypted_config=LoadBalancingCredentials({"api_key": "old"}).model_dump_json(),
    )
    removed = _config(sqlite_session, name="remove")
    cipher: LoadBalancingTokenCipher = PrefixTokenCipher()
    svc.update_load_balancing_configs(
        "tenant-1",
        "openai",
        "gpt-4o-mini",
        ModelType.LLM,
        [
            {
                "id": keep.id,
                "name": "updated",
                "enabled": False,
                "credentials": LoadBalancingCredentials({"api_key": "new"}),
            },
            {
                "name": "created",
                "enabled": True,
                "credentials": {"api_key": "fresh"},
            },
        ],
        "custom-model",
        sqlite_session,
        token_cipher=cipher,
    )
    sqlite_session.expire_all()
    records = sqlite_session.scalars(select(LoadBalancingModelConfig)).all()
    assert {record.name for record in records} == {"updated", "created"}
    assert sqlite_session.get(LoadBalancingModelConfig, removed.id) is None
    updated = sqlite_session.get(LoadBalancingModelConfig, keep.id)
    assert updated is not None
    assert updated.enabled is False
    assert updated.encrypted_config is not None
    assert LoadBalancingCredentials.model_validate_json(updated.encrypted_config) == LoadBalancingCredentials(
        {"api_key": "enc-new"}
    )
    created = sqlite_session.scalar(select(LoadBalancingModelConfig).where(LoadBalancingModelConfig.name == "created"))
    assert created is not None
    assert created.encrypted_config is not None
    assert LoadBalancingCredentials.model_validate_json(created.encrypted_config) == LoadBalancingCredentials(
        {"api_key": "enc-fresh"}
    )


def test_update_configs_creates_from_tenant_scoped_provider_credential(
    service: ServiceFixture, sqlite_session: Session
) -> None:
    svc, _, _ = service
    credential = ProviderCredential(
        tenant_id="tenant-1",
        provider_name="openai",
        credential_name="Credential",
        encrypted_config=LoadBalancingCredentials({"api_key": "enc"}).model_dump_json(),
    )
    foreign = ProviderCredential(
        tenant_id="tenant-2",
        provider_name="openai",
        credential_name="Foreign",
        encrypted_config=LoadBalancingCredentials({}).model_dump_json(),
    )
    sqlite_session.add_all([credential, foreign])
    sqlite_session.commit()
    svc.update_load_balancing_configs(
        "tenant-1",
        "openai",
        "gpt-4o-mini",
        ModelType.LLM,
        [{"credential_id": credential.id, "enabled": True}],
        "predefined-model",
        sqlite_session,
    )
    created = sqlite_session.scalar(select(LoadBalancingModelConfig))
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
            sqlite_session,
        )


def test_validate_credentials_uses_real_config_lookup(
    service: ServiceFixture,
    sqlite_session: Session,
) -> None:
    svc, manager, configuration = service
    config = _config(sqlite_session)
    assembly = PluginModelAssembly(tenant_id="tenant-1")
    assembly._provider_manager = manager
    assembly._model_provider_factory = _credential_factory(configuration.provider)
    cipher: LoadBalancingTokenCipher = PrefixTokenCipher()
    svc.validate_load_balancing_credentials(
        "tenant-1",
        "openai",
        "gpt-4o-mini",
        ModelType.LLM,
        {"api_key": "raw"},
        sqlite_session,
        token_cipher=cipher,
        model_assembly=assembly,
    )
    svc.validate_load_balancing_credentials(
        "tenant-1",
        "openai",
        "gpt-4o-mini",
        ModelType.LLM,
        LoadBalancingCredentials({"api_key": "raw"}),
        sqlite_session,
        config.id,
        token_cipher=cipher,
        model_assembly=assembly,
    )
    with pytest.raises(ValueError, match="does not exist"):
        svc.validate_load_balancing_credentials(
            "tenant-1",
            "openai",
            "gpt-4o-mini",
            ModelType.LLM,
            LoadBalancingCredentials({}),
            sqlite_session,
            "missing",
            token_cipher=cipher,
            model_assembly=assembly,
        )
    manager.get_configurations.return_value = dict[str, ProviderConfiguration]()
    with pytest.raises(ValueError, match="does not exist"):
        svc.validate_load_balancing_credentials(
            "tenant-1",
            "openai",
            "gpt-4o-mini",
            ModelType.LLM,
            LoadBalancingCredentials({"api_key": "raw"}),
            sqlite_session,
            token_cipher=cipher,
            model_assembly=assembly,
        )


@pytest.mark.parametrize(
    "encrypted_config",
    [None, "", "not-json", '["api_key"]', '"api_key"', "null", '{"api_key": 1}', '{"api_key": {"nested": true}}'],
)
def test_get_single_config_tolerates_missing_malformed_and_non_object_credentials(
    service: ServiceFixture, sqlite_session: Session, encrypted_config: str | None
) -> None:
    svc, _, _ = service
    config = _config(sqlite_session, encrypted_config=encrypted_config)
    assert svc.get_load_balancing_config(
        "tenant-1", "openai", "gpt-4o-mini", ModelType.LLM, config.id, session=sqlite_session
    ) == {
        "id": config.id,
        "name": "primary",
        "credentials": LoadBalancingCredentials({}).root,
        "enabled": True,
    }


def test_get_single_config_keeps_switch_values(service: ServiceFixture, sqlite_session: Session) -> None:
    svc, _, _ = service
    stored = LoadBalancingCredentials({"api_key": "secret", "use_international": True})
    config = _config(sqlite_session, encrypted_config=stored.model_dump_json())
    assert svc.get_load_balancing_config(
        "tenant-1", "openai", "gpt-4o-mini", ModelType.LLM, config.id, session=sqlite_session
    ) == {
        "id": config.id,
        "name": "primary",
        "credentials": LoadBalancingCredentials({"api_key": "*" * 20, "use_international": True}).root,
        "enabled": True,
    }


def test_custom_credentials_validate_reuses_hidden_secret_and_encrypts(
    service: ServiceFixture,
    sqlite_session: Session,
) -> None:
    svc, _, configuration = service
    config = _config(
        sqlite_session,
        encrypted_config=LoadBalancingCredentials({"api_key": "old-encrypted"}).model_dump_json(),
    )
    cipher: LoadBalancingTokenCipher = PrefixTokenCipher({"old-encrypted": "old-plain"})
    result = svc._custom_credentials_validate(
        "tenant-1",
        configuration,
        ModelType.LLM,
        "gpt-4o-mini",
        LoadBalancingCredentials({"api_key": HIDDEN_VALUE, "endpoint": "https://example.com"}),
        config,
        validate=False,
        token_cipher=cipher,
    )
    assert result == LoadBalancingCredentials({"api_key": "enc-old-plain", "endpoint": "https://example.com"})


def test_custom_credentials_validate_skips_hidden_secret_without_stored_string(
    service: ServiceFixture,
    sqlite_session: Session,
) -> None:
    svc, _, configuration = service
    config = _config(sqlite_session, encrypted_config=LoadBalancingCredentials({"endpoint": "kept"}).model_dump_json())
    cipher: LoadBalancingTokenCipher = PrefixTokenCipher()
    result = svc._custom_credentials_validate(
        "tenant-1",
        configuration,
        ModelType.LLM,
        "gpt-4o-mini",
        LoadBalancingCredentials({"api_key": HIDDEN_VALUE}),
        config,
        validate=False,
        token_cipher=cipher,
    )
    assert result == LoadBalancingCredentials({"api_key": f"enc-{HIDDEN_VALUE}"})


def test_default_token_cipher_delegates_to_injected_encrypter(
    service: ServiceFixture,
    sqlite_session: Session,
) -> None:
    svc, _, configuration = service
    config = _config(
        sqlite_session,
        encrypted_config=LoadBalancingCredentials({"api_key": "stored"}).model_dump_json(),
    )

    def encrypt_token(tenant_id: str, token: str) -> str:
        return f"enc-{tenant_id}-{token}"

    def decrypt_token(tenant_id: str, token: str) -> str:
        return f"plain-{tenant_id}-{token}"

    cipher = encrypter_token_cipher(encrypt_token=encrypt_token, decrypt_token=decrypt_token)
    result = svc._custom_credentials_validate(
        "tenant-1",
        configuration,
        ModelType.LLM,
        "gpt-4o-mini",
        LoadBalancingCredentials({"api_key": HIDDEN_VALUE}),
        config,
        validate=False,
        token_cipher=cipher,
    )
    assert result == LoadBalancingCredentials({"api_key": "enc-tenant-1-plain-tenant-1-stored"})


def test_custom_credentials_validate_leaves_boolean_secrets_unencrypted(service: ServiceFixture) -> None:
    svc, _, configuration = service
    cipher: LoadBalancingTokenCipher = PrefixTokenCipher()
    result = svc._custom_credentials_validate(
        "tenant-1",
        configuration,
        ModelType.LLM,
        "gpt-4o-mini",
        LoadBalancingCredentials({"api_key": True}),
        validate=False,
        token_cipher=cipher,
    )
    assert result == LoadBalancingCredentials({"api_key": True})


def test_custom_credentials_validate_filters_provider_and_model_schemas(service: ServiceFixture) -> None:
    svc, _, configuration = service
    configuration.provider.provider_credential_schema = ProviderCredentialSchema(
        credential_form_schemas=[
            CredentialFormSchema(variable="api_key", label=I18nObject(en_US="API Key"), type=FormType.SECRET_INPUT),
            CredentialFormSchema(
                variable="use_international",
                label=I18nObject(en_US="International"),
                type=FormType.SWITCH,
            ),
        ]
    )
    cipher: LoadBalancingTokenCipher = PrefixTokenCipher()
    submitted = LoadBalancingCredentials({"api_key": "secret", "use_international": "true"})
    provider_result = svc._custom_credentials_validate(
        "tenant-1",
        configuration,
        ModelType.LLM,
        "gpt-4o-mini",
        submitted,
        model_provider_factory=_credential_factory(configuration.provider),
        token_cipher=cipher,
    )
    assert provider_result == LoadBalancingCredentials({"api_key": "enc-secret", "use_international": True})

    configuration.provider.model_credential_schema = _model_schema()
    model_result = svc._custom_credentials_validate(
        "tenant-1",
        configuration,
        ModelType.LLM,
        "gpt-4o-mini",
        LoadBalancingCredentials({"api_key": "secret"}),
        model_provider_factory=_credential_factory(configuration.provider),
        token_cipher=cipher,
    )
    assert model_result == LoadBalancingCredentials({"api_key": "enc-secret"})


@pytest.mark.parametrize("credentials", [None, {}, LoadBalancingCredentials({})])
def test_update_configs_rejects_empty_credentials_for_new_config(
    credentials: dict[str, str] | LoadBalancingCredentials | None,
    service: ServiceFixture,
    sqlite_session: Session,
) -> None:
    svc, _, _ = service
    payload: dict[str, str | bool | dict[str, str] | LoadBalancingCredentials | None] = {"name": "new", "enabled": True}
    if credentials is not None:
        payload["credentials"] = credentials
    with pytest.raises(ValueError, match="Invalid load balancing config credentials"):
        svc.update_load_balancing_configs(
            "tenant-1", "openai", "gpt-4o-mini", ModelType.LLM, [payload], "custom-model", sqlite_session
        )


def test_update_configs_keeps_stored_credentials_when_omitted(service: ServiceFixture, sqlite_session: Session) -> None:
    svc, _, _ = service
    stored = LoadBalancingCredentials({"api_key": "old"}).model_dump_json()
    keep = _config(sqlite_session, name="keep", encrypted_config=stored)
    svc.update_load_balancing_configs(
        "tenant-1",
        "openai",
        "gpt-4o-mini",
        ModelType.LLM,
        [{"id": keep.id, "name": "renamed", "enabled": False}],
        "custom-model",
        sqlite_session,
    )
    sqlite_session.expire_all()
    updated = sqlite_session.get(LoadBalancingModelConfig, keep.id)
    assert updated is not None
    assert updated.name == "renamed"
    assert updated.enabled is False
    assert updated.encrypted_config == stored


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
