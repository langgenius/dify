from collections.abc import Iterator
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, PropertyMock, patch

import pytest
from sqlalchemy import Engine, event, select
from sqlalchemy.orm import Session, sessionmaker

from core import provider_manager as provider_manager_module
from core.entities.provider_entities import ModelSettings
from core.provider_manager import ProviderConfigurationCacheSource, ProviderManager
from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.model_entities import ModelType
from models.base import TypeBase
from models.provider import (
    LoadBalancingModelConfig,
    Provider,
    ProviderCredential,
    ProviderModel,
    ProviderModelCredential,
    ProviderModelSetting,
    ProviderType,
    TenantDefaultModel,
    TenantPreferredModelProvider,
)
from models.provider_ids import ModelProviderID


def _build_provider_manager() -> ProviderManager:
    return ProviderManager(model_runtime=Mock())


def _persist_model_configuration(
    session: Session,
    setting: ProviderModelSetting,
    load_balancing_configs: list[LoadBalancingModelConfig],
) -> tuple[list[ProviderModelSetting], list[LoadBalancingModelConfig]]:
    session.add_all([setting, *load_balancing_configs])
    session.commit()
    session.expire_all()
    settings = list(
        session.scalars(select(ProviderModelSetting).where(ProviderModelSetting.tenant_id == setting.tenant_id)).all()
    )
    configs = list(
        session.scalars(
            select(LoadBalancingModelConfig).where(LoadBalancingModelConfig.tenant_id == setting.tenant_id)
        ).all()
    )
    return settings, configs


@pytest.fixture
def provider_db(sqlite_engine: Engine, monkeypatch: pytest.MonkeyPatch) -> Iterator[Session]:
    """Bind request-owned and provider-owned sessions to one isolated SQLite database."""
    TypeBase.metadata.create_all(
        sqlite_engine,
        tables=[
            Provider.__table__,
            ProviderCredential.__table__,
            ProviderModel.__table__,
            ProviderModelCredential.__table__,
            ProviderModelSetting.__table__,
            LoadBalancingModelConfig.__table__,
            TenantDefaultModel.__table__,
            TenantPreferredModelProvider.__table__,
        ],
    )
    owned_session_factory = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    with owned_session_factory() as request_session:
        monkeypatch.setattr(provider_manager_module.db, "session", request_session)
        monkeypatch.setattr(provider_manager_module.session_factory, "create_session", owned_session_factory)
        yield request_session


class _FakeRedis:
    def __init__(self) -> None:
        self.store: dict[str, str] = {}
        self.expirations: dict[str, int] = {}

    def get(self, key: str):
        return self.store.get(key)

    def set(self, key: str, value: str, *, ex: int | None = None) -> None:
        self.store[key] = value
        if ex is not None:
            self.expirations[key] = ex

    def setex(self, key: str, time: int, value: str) -> None:
        self.store[key] = value
        self.expirations[key] = time

    def incr(self, key: str) -> int:
        value = int(self.store.get(key, "0")) + 1
        self.store[key] = str(value)
        return value

    def expire(self, key: str, time: int) -> None:
        self.expirations[key] = time


@pytest.fixture
def mock_provider_entity():
    mock_entity = Mock()
    mock_entity.provider = "openai"
    mock_entity.configurate_methods = ["predefined-model"]
    mock_entity.supported_model_types = [ModelType.LLM]

    # Use PropertyMock to ensure credential_form_schemas is iterable
    provider_credential_schema = Mock()
    type(provider_credential_schema).credential_form_schemas = PropertyMock(return_value=[])
    mock_entity.provider_credential_schema = provider_credential_schema

    model_credential_schema = Mock()
    type(model_credential_schema).credential_form_schemas = PropertyMock(return_value=[])
    mock_entity.model_credential_schema = model_credential_schema

    return mock_entity


def test__to_model_settings(mock_provider_entity, provider_db: Session):
    # Mocking the inputs
    ps = ProviderModelSetting(
        tenant_id="tenant_id",
        provider_name="openai",
        model_name="gpt-4",
        model_type="llm",
        enabled=True,
        load_balancing_enabled=True,
    )
    ps.id = "id"

    provider_model_settings = [ps]

    load_balancing_model_configs = [
        LoadBalancingModelConfig(
            tenant_id="tenant_id",
            provider_name="openai",
            model_name="gpt-4",
            model_type="llm",
            name="__inherit__",
            encrypted_config=None,
            enabled=True,
        ),
        LoadBalancingModelConfig(
            tenant_id="tenant_id",
            provider_name="openai",
            model_name="gpt-4",
            model_type="llm",
            name="first",
            encrypted_config='{"openai_api_key": "fake_key"}',
            enabled=True,
        ),
    ]
    load_balancing_model_configs[0].id = "id1"
    load_balancing_model_configs[1].id = "id2"
    provider_model_settings, load_balancing_model_configs = _persist_model_configuration(
        provider_db, ps, load_balancing_model_configs
    )

    with patch(
        "core.helper.model_provider_cache.ProviderCredentialsCache.get",
        return_value={"openai_api_key": "fake_key"},
    ):
        provider_manager = _build_provider_manager()

        # Running the method
        result = provider_manager._to_model_settings(
            provider_entity=mock_provider_entity,
            provider_model_settings=provider_model_settings,
            load_balancing_model_configs=load_balancing_model_configs,
        )

    # Asserting that the result is as expected
    assert len(result) == 1
    assert isinstance(result[0], ModelSettings)
    assert result[0].model == "gpt-4"
    assert result[0].model_type == ModelType.LLM
    assert result[0].enabled is True
    assert len(result[0].load_balancing_configs) == 2
    assert result[0].load_balancing_configs[0].name == "__inherit__"
    assert result[0].load_balancing_configs[1].name == "first"


def test__to_model_settings_only_one_lb(mock_provider_entity, provider_db: Session):
    # Mocking the inputs

    ps = ProviderModelSetting(
        tenant_id="tenant_id",
        provider_name="openai",
        model_name="gpt-4",
        model_type="llm",
        enabled=True,
        load_balancing_enabled=True,
    )
    ps.id = "id"
    provider_model_settings = [ps]
    load_balancing_model_configs = [
        LoadBalancingModelConfig(
            tenant_id="tenant_id",
            provider_name="openai",
            model_name="gpt-4",
            model_type="llm",
            name="__inherit__",
            encrypted_config=None,
            enabled=True,
        )
    ]
    load_balancing_model_configs[0].id = "id1"
    provider_model_settings, load_balancing_model_configs = _persist_model_configuration(
        provider_db, ps, load_balancing_model_configs
    )

    with patch(
        "core.helper.model_provider_cache.ProviderCredentialsCache.get",
        return_value={"openai_api_key": "fake_key"},
    ):
        provider_manager = _build_provider_manager()

        # Running the method
        result = provider_manager._to_model_settings(
            provider_entity=mock_provider_entity,
            provider_model_settings=provider_model_settings,
            load_balancing_model_configs=load_balancing_model_configs,
        )

    # Asserting that the result is as expected
    assert len(result) == 1
    assert isinstance(result[0], ModelSettings)
    assert result[0].model == "gpt-4"
    assert result[0].model_type == ModelType.LLM
    assert result[0].enabled is True
    assert len(result[0].load_balancing_configs) == 0


def test__to_model_settings_lb_disabled(mock_provider_entity, provider_db: Session):
    # Mocking the inputs
    ps = ProviderModelSetting(
        tenant_id="tenant_id",
        provider_name="openai",
        model_name="gpt-4",
        model_type="llm",
        enabled=True,
        load_balancing_enabled=False,
    )
    ps.id = "id"
    provider_model_settings = [ps]
    load_balancing_model_configs = [
        LoadBalancingModelConfig(
            tenant_id="tenant_id",
            provider_name="openai",
            model_name="gpt-4",
            model_type="llm",
            name="__inherit__",
            encrypted_config=None,
            enabled=True,
        ),
        LoadBalancingModelConfig(
            tenant_id="tenant_id",
            provider_name="openai",
            model_name="gpt-4",
            model_type="llm",
            name="first",
            encrypted_config='{"openai_api_key": "fake_key"}',
            enabled=True,
        ),
    ]
    load_balancing_model_configs[0].id = "id1"
    load_balancing_model_configs[1].id = "id2"
    provider_model_settings, load_balancing_model_configs = _persist_model_configuration(
        provider_db, ps, load_balancing_model_configs
    )

    with patch(
        "core.helper.model_provider_cache.ProviderCredentialsCache.get",
        return_value={"openai_api_key": "fake_key"},
    ):
        provider_manager = _build_provider_manager()

        # Running the method
        result = provider_manager._to_model_settings(
            provider_entity=mock_provider_entity,
            provider_model_settings=provider_model_settings,
            load_balancing_model_configs=load_balancing_model_configs,
        )

    # Asserting that the result is as expected
    assert len(result) == 1
    assert isinstance(result[0], ModelSettings)
    assert result[0].model == "gpt-4"
    assert result[0].model_type == ModelType.LLM
    assert result[0].enabled is True
    assert len(result[0].load_balancing_configs) == 0


def test_get_default_model_uses_first_available_active_model(provider_db: Session):
    other_tenant_default = TenantDefaultModel(
        tenant_id="other-tenant",
        provider_name="anthropic",
        model_name="claude",
        model_type=ModelType.LLM,
    )
    provider_db.add(other_tenant_default)
    provider_db.commit()
    provider_configurations = Mock()
    provider_configurations.get_models.return_value = [
        Mock(model="gpt-3.5-turbo", provider=Mock(provider="openai")),
        Mock(model="gpt-4", provider=Mock(provider="openai")),
    ]

    manager = _build_provider_manager()
    with (
        patch.object(manager, "get_configurations", return_value=provider_configurations),
        patch("core.provider_manager.ModelProviderFactory") as mock_factory_cls,
    ):
        mock_factory_cls.return_value.get_provider_schema.return_value = Mock(
            provider="openai",
            label=I18nObject(en_US="OpenAI", zh_Hans="OpenAI"),
            icon_small=I18nObject(en_US="icon_small.png", zh_Hans="icon_small.png"),
            supported_model_types=[ModelType.LLM],
        )

        result = manager.get_default_model("tenant-id", ModelType.LLM)

        assert result is not None
        assert result.model == "gpt-3.5-turbo"
        assert result.provider.provider == "openai"
        provider_configurations.get_models.assert_called_once_with(model_type=ModelType.LLM, only_active=True)
        saved_default_model = provider_db.scalar(
            select(TenantDefaultModel).where(TenantDefaultModel.tenant_id == "tenant-id")
        )
        assert saved_default_model is not None
        assert saved_default_model.model_name == "gpt-3.5-turbo"
        assert saved_default_model.provider_name == "openai"
        assert (
            provider_db.scalar(select(TenantDefaultModel).where(TenantDefaultModel.tenant_id == "other-tenant"))
            is other_tenant_default
        )


def test_get_default_model_returns_none_when_no_default_or_active_models(provider_db: Session):
    provider_db.add(
        TenantDefaultModel(
            tenant_id="other-tenant",
            provider_name="anthropic",
            model_name="claude",
            model_type=ModelType.LLM,
        )
    )
    provider_db.commit()
    provider_configurations = Mock()
    provider_configurations.get_models.return_value = []
    manager = _build_provider_manager()

    with (
        patch.object(manager, "get_configurations", return_value=provider_configurations),
        patch("core.provider_manager.ModelProviderFactory") as mock_factory_cls,
    ):
        result = manager.get_default_model("tenant-id", ModelType.LLM)

    assert result is None
    provider_configurations.get_models.assert_called_once_with(model_type=ModelType.LLM, only_active=True)
    mock_factory_cls.assert_not_called()
    assert provider_db.scalar(select(TenantDefaultModel).where(TenantDefaultModel.tenant_id == "tenant-id")) is None
    assert (
        provider_db.scalar(select(TenantDefaultModel).where(TenantDefaultModel.tenant_id == "other-tenant")) is not None
    )


def test_get_default_model_uses_injected_runtime_for_existing_default_record(provider_db: Session):
    existing_default_model = TenantDefaultModel(
        tenant_id="tenant-id",
        provider_name="openai",
        model_name="gpt-4",
        model_type=ModelType.LLM,
    )
    provider_db.add(existing_default_model)
    provider_db.commit()
    manager = _build_provider_manager()

    with (
        patch("core.provider_manager.ModelProviderFactory") as mock_factory_cls,
    ):
        mock_factory_cls.return_value.get_provider_schema.return_value = Mock(
            provider="openai",
            label=I18nObject(en_US="OpenAI", zh_Hans="OpenAI"),
            icon_small=I18nObject(en_US="icon_small.png", zh_Hans="icon_small.png"),
            supported_model_types=[ModelType.LLM],
        )

        result = manager.get_default_model("tenant-id", ModelType.LLM)

    mock_factory_cls.assert_called_once_with(runtime=manager._model_runtime)
    assert result is not None
    assert result.model == "gpt-4"
    assert result.provider.provider == "openai"


def test_get_configurations_uses_injected_runtime_and_adds_provider_aliases(provider_db: Session):
    manager = _build_provider_manager()
    provider = Provider(
        tenant_id="tenant-id",
        provider_name="openai",
        provider_type=ProviderType.CUSTOM,
        is_valid=True,
    )
    provider_model = ProviderModel(
        tenant_id="tenant-id",
        provider_name="openai",
        model_name="gpt-4",
        model_type=ModelType.LLM,
        is_valid=True,
    )
    preferred_provider = TenantPreferredModelProvider(
        tenant_id="tenant-id",
        provider_name="openai",
        preferred_provider_type=ProviderType.SYSTEM,
    )
    provider_db.add_all([provider, provider_model, preferred_provider])
    provider_db.commit()
    with patch("core.provider_manager.redis_client", _FakeRedis()):
        provider_model_records = ProviderManager._get_all_provider_models("tenant-id")
        preferred_provider_records = ProviderManager._get_all_preferred_model_providers("tenant-id")
    provider_records = {"openai": [provider]}

    with (
        patch.object(manager, "_get_all_providers", return_value=provider_records),
        patch.object(manager, "_init_trial_provider_records", return_value=provider_records),
        patch.object(manager, "_get_all_provider_models", return_value=provider_model_records),
        patch.object(manager, "_get_all_preferred_model_providers", return_value=preferred_provider_records),
        patch.object(manager, "_get_all_provider_model_settings", return_value={}),
        patch.object(manager, "_get_all_provider_load_balancing_configs", return_value={}),
        patch.object(manager, "_get_all_provider_model_credentials", return_value={}),
        patch.object(manager, "_get_all_provider_credentials", return_value={}),
        patch("core.provider_manager.ModelProviderFactory") as mock_factory_cls,
    ):
        mock_factory_cls.return_value.get_providers.return_value = []

        result = manager.get_configurations("tenant-id")

    expected_alias = str(ModelProviderID("openai"))
    mock_factory_cls.assert_called_once_with(runtime=manager._model_runtime)
    assert result.tenant_id == "tenant-id"
    assert expected_alias in provider_records
    assert expected_alias in provider_model_records
    assert expected_alias in preferred_provider_records


@pytest.mark.parametrize(
    ("provider_name", "expected_provider_names"),
    [
        ("openai", ["openai", "langgenius/openai/openai"]),
        ("langgenius/openai/openai", ["langgenius/openai/openai", "openai"]),
        ("langgenius/gemini/google", ["langgenius/gemini/google", "google"]),
    ],
)
def test_get_provider_names_returns_short_and_full_aliases(provider_name: str, expected_provider_names: list[str]):
    assert ProviderManager._get_provider_names(provider_name) == expected_provider_names


def test_get_provider_model_bundle_raises_for_unknown_provider():
    manager = _build_provider_manager()

    with patch.object(manager, "get_configurations", return_value={}):
        with pytest.raises(ValueError, match="Provider openai does not exist."):
            manager.get_provider_model_bundle("tenant-id", "openai", ModelType.LLM)


def test_get_configurations_binds_manager_runtime_to_provider_configuration(mock_provider_entity):
    manager = _build_provider_manager()
    provider_configuration = Mock()
    provider_factory = Mock()
    provider_factory.get_providers.return_value = [mock_provider_entity]
    custom_configuration = SimpleNamespace(provider=None, models=[])
    system_configuration = SimpleNamespace(enabled=False, quota_configurations=[], current_quota_type=None)

    with (
        patch.object(manager, "_get_all_providers", return_value={"openai": []}),
        patch.object(manager, "_init_trial_provider_records", return_value={"openai": []}),
        patch.object(manager, "_get_all_provider_models", return_value={"openai": []}),
        patch.object(manager, "_get_all_preferred_model_providers", return_value={}),
        patch.object(manager, "_get_all_provider_model_settings", return_value={}),
        patch.object(manager, "_get_all_provider_load_balancing_configs", return_value={}),
        patch.object(manager, "_get_all_provider_model_credentials", return_value={}),
        patch.object(manager, "_get_all_provider_credentials", return_value={}),
        patch.object(manager, "_to_custom_configuration", return_value=custom_configuration),
        patch.object(manager, "_to_system_configuration", return_value=system_configuration),
        patch.object(manager, "_to_model_settings", return_value=[]),
        patch("core.provider_manager.ModelProviderFactory", return_value=provider_factory),
        patch("core.provider_manager.ProviderConfiguration", return_value=provider_configuration),
    ):
        manager.get_configurations("tenant-id")

    provider_configuration.bind_model_runtime.assert_called_once_with(manager._model_runtime)


def test_get_configurations_reuses_cached_result_for_same_tenant(mock_provider_entity):
    manager = _build_provider_manager()
    provider_configuration = Mock()
    provider_factory = Mock()
    provider_factory.get_providers.return_value = [mock_provider_entity]
    custom_configuration = SimpleNamespace(provider=None, models=[])
    system_configuration = SimpleNamespace(enabled=False, quota_configurations=[], current_quota_type=None)

    with (
        patch.object(manager, "_get_all_providers", return_value={"openai": []}) as mock_get_all_providers,
        patch.object(manager, "_init_trial_provider_records", return_value={"openai": []}),
        patch.object(manager, "_get_all_provider_models", return_value={"openai": []}),
        patch.object(manager, "_get_all_preferred_model_providers", return_value={}),
        patch.object(manager, "_get_all_provider_model_settings", return_value={}),
        patch.object(manager, "_get_all_provider_load_balancing_configs", return_value={}),
        patch.object(manager, "_get_all_provider_model_credentials", return_value={}),
        patch.object(manager, "_get_all_provider_credentials", return_value={}),
        patch.object(manager, "_to_custom_configuration", return_value=custom_configuration),
        patch.object(manager, "_to_system_configuration", return_value=system_configuration),
        patch.object(manager, "_to_model_settings", return_value=[]),
        patch("core.provider_manager.ModelProviderFactory", return_value=provider_factory) as mock_factory_cls,
        patch(
            "core.provider_manager.ProviderConfiguration",
            return_value=provider_configuration,
        ) as mock_provider_configuration,
    ):
        first = manager.get_configurations("tenant-id")
        second = manager.get_configurations("tenant-id")

    assert first is second
    mock_get_all_providers.assert_called_once_with("tenant-id")
    mock_factory_cls.assert_called_once_with(runtime=manager._model_runtime)
    mock_provider_configuration.assert_called_once()
    provider_configuration.bind_model_runtime.assert_called_once_with(manager._model_runtime)


def test_clear_configurations_cache_rebuilds_requested_tenant(mock_provider_entity):
    manager = _build_provider_manager()
    provider_factory = Mock()
    provider_factory.get_providers.return_value = [mock_provider_entity]
    custom_configuration = SimpleNamespace(provider=None, models=[])
    system_configuration = SimpleNamespace(enabled=False, quota_configurations=[], current_quota_type=None)
    provider_configuration_first = Mock()
    provider_configuration_second = Mock()

    with (
        patch.object(manager, "_get_all_providers", return_value={"openai": []}) as mock_get_all_providers,
        patch.object(manager, "_init_trial_provider_records", return_value={"openai": []}),
        patch.object(manager, "_get_all_provider_models", return_value={"openai": []}),
        patch.object(manager, "_get_all_preferred_model_providers", return_value={}),
        patch.object(manager, "_get_all_provider_model_settings", return_value={}),
        patch.object(manager, "_get_all_provider_load_balancing_configs", return_value={}),
        patch.object(manager, "_get_all_provider_model_credentials", return_value={}),
        patch.object(manager, "_get_all_provider_credentials", return_value={}),
        patch.object(manager, "_to_custom_configuration", return_value=custom_configuration),
        patch.object(manager, "_to_system_configuration", return_value=system_configuration),
        patch.object(manager, "_to_model_settings", return_value=[]),
        patch("core.provider_manager.ModelProviderFactory", return_value=provider_factory),
        patch(
            "core.provider_manager.ProviderConfiguration",
            side_effect=[provider_configuration_first, provider_configuration_second],
        ) as mock_provider_configuration,
    ):
        first = manager.get_configurations("tenant-id")
        manager.clear_configurations_cache("tenant-id")
        second = manager.get_configurations("tenant-id")

    assert first is not second
    assert mock_get_all_providers.call_count == 2
    assert mock_provider_configuration.call_count == 2
    provider_configuration_first.bind_model_runtime.assert_called_once_with(manager._model_runtime)
    provider_configuration_second.bind_model_runtime.assert_called_once_with(manager._model_runtime)


def test_get_provider_model_bundle_returns_selected_model_type_instance():
    manager = _build_provider_manager()
    provider_configuration = Mock()
    model_type_instance = Mock()
    provider_configuration.get_model_type_instance.return_value = model_type_instance
    expected_bundle = Mock()

    with (
        patch.object(manager, "get_configurations", return_value={"openai": provider_configuration}),
        patch("core.provider_manager.ProviderModelBundle", return_value=expected_bundle) as mock_bundle,
    ):
        result = manager.get_provider_model_bundle("tenant-id", "openai", ModelType.LLM)

    provider_configuration.get_model_type_instance.assert_called_once_with(ModelType.LLM)
    mock_bundle.assert_called_once_with(
        configuration=provider_configuration,
        model_type_instance=model_type_instance,
    )
    assert result is expected_bundle


def test_get_first_provider_first_model_returns_none_when_no_models():
    manager = _build_provider_manager()
    provider_configurations = Mock()
    provider_configurations.get_models.return_value = []

    with patch.object(manager, "get_configurations", return_value=provider_configurations):
        result = manager.get_first_provider_first_model("tenant-id", ModelType.LLM)

    assert result == (None, None)
    provider_configurations.get_models.assert_called_once_with(model_type=ModelType.LLM, only_active=False)


def test_get_first_provider_first_model_returns_first_model_and_provider():
    manager = _build_provider_manager()
    provider_configurations = Mock()
    provider_configurations.get_models.return_value = [
        Mock(model="gpt-4", provider=Mock(provider="openai")),
        Mock(model="gpt-4o", provider=Mock(provider="openai")),
    ]

    with patch.object(manager, "get_configurations", return_value=provider_configurations):
        result = manager.get_first_provider_first_model("tenant-id", ModelType.LLM)

    assert result == ("openai", "gpt-4")


def test_update_default_model_record_raises_for_unknown_provider():
    manager = _build_provider_manager()

    with patch.object(manager, "get_configurations", return_value={}):
        with pytest.raises(ValueError, match="Provider openai does not exist."):
            manager.update_default_model_record("tenant-id", ModelType.LLM, "openai", "gpt-4")


def test_update_default_model_record_raises_for_unknown_model():
    manager = _build_provider_manager()
    provider_configurations = MagicMock()
    provider_configurations.__contains__.return_value = True
    provider_configurations.get_models.return_value = [Mock(model="gpt-4")]

    with patch.object(manager, "get_configurations", return_value=provider_configurations):
        with pytest.raises(ValueError, match="Model gpt-3.5-turbo does not exist."):
            manager.update_default_model_record("tenant-id", ModelType.LLM, "openai", "gpt-3.5-turbo")

    provider_configurations.get_models.assert_called_once_with(model_type=ModelType.LLM, only_active=True)


def test_update_default_model_record_updates_existing_record(provider_db: Session):
    manager = _build_provider_manager()
    provider_configurations = MagicMock()
    provider_configurations.__contains__.return_value = True
    provider_configurations.get_models.return_value = [Mock(model="gpt-3.5-turbo")]
    existing_default_model = TenantDefaultModel(
        tenant_id="tenant-id",
        provider_name="anthropic",
        model_name="claude-3-sonnet",
        model_type=ModelType.LLM,
    )
    other_tenant_default = TenantDefaultModel(
        tenant_id="other-tenant",
        provider_name="cohere",
        model_name="command-r",
        model_type=ModelType.LLM,
    )
    provider_db.add_all([existing_default_model, other_tenant_default])
    provider_db.commit()

    with patch.object(manager, "get_configurations", return_value=provider_configurations):
        result = manager.update_default_model_record("tenant-id", ModelType.LLM, "openai", "gpt-3.5-turbo")

    assert result is existing_default_model
    assert existing_default_model.provider_name == "openai"
    assert existing_default_model.model_name == "gpt-3.5-turbo"
    provider_db.expire_all()
    assert provider_db.get(TenantDefaultModel, existing_default_model.id).provider_name == "openai"
    persisted_other_default = provider_db.get(TenantDefaultModel, other_tenant_default.id)
    assert persisted_other_default is not None
    assert persisted_other_default.provider_name == "cohere"
    assert persisted_other_default.model_name == "command-r"


def test_update_default_model_record_creates_record_with_origin_model_type(provider_db: Session):
    manager = _build_provider_manager()
    provider_configurations = MagicMock()
    provider_configurations.__contains__.return_value = True
    provider_configurations.get_models.return_value = [Mock(model="gpt-4")]
    provider_db.add(
        TenantDefaultModel(
            tenant_id="other-tenant",
            provider_name="anthropic",
            model_name="claude",
            model_type=ModelType.LLM,
        )
    )
    provider_db.commit()

    with patch.object(manager, "get_configurations", return_value=provider_configurations):
        result = manager.update_default_model_record("tenant-id", ModelType.LLM, "openai", "gpt-4")

    assert result.tenant_id == "tenant-id"
    assert result.provider_name == "openai"
    assert result.model_name == "gpt-4"
    assert result.model_type == ModelType.LLM
    persisted_defaults = list(provider_db.scalars(select(TenantDefaultModel)).all())
    assert {record.tenant_id for record in persisted_defaults} == {"tenant-id", "other-tenant"}


def test_get_all_providers_normalizes_provider_names_with_model_provider_id(provider_db: Session) -> None:
    openai_provider = Provider(
        tenant_id="tenant-id",
        provider_name="openai",
        provider_type=ProviderType.CUSTOM,
        is_valid=True,
    )
    gemini_provider = Provider(
        tenant_id="tenant-id",
        provider_name="langgenius/gemini/google",
        provider_type=ProviderType.CUSTOM,
        is_valid=True,
    )
    other_tenant_provider = Provider(
        tenant_id="other-tenant",
        provider_name="anthropic",
        provider_type=ProviderType.CUSTOM,
        is_valid=True,
    )
    provider_db.add_all([openai_provider, gemini_provider, other_tenant_provider])
    provider_db.commit()

    result = ProviderManager._get_all_providers("tenant-id")

    assert list(result[str(ModelProviderID("openai"))]) == [openai_provider]
    assert list(result[str(ModelProviderID("langgenius/gemini/google"))]) == [gemini_provider]
    assert str(ModelProviderID("anthropic")) not in result


def test_get_all_providers_attaches_active_credentials(provider_db: Session) -> None:
    provider = Provider(
        tenant_id="tenant-id",
        provider_name="openai",
        provider_type=ProviderType.CUSTOM,
        is_valid=True,
        credential_id="credential-id",
    )
    credential = ProviderCredential(
        tenant_id="tenant-id",
        provider_name="openai",
        credential_name="primary",
        encrypted_config='{"api_key": "secret"}',
    )
    credential.id = "credential-id"
    provider_db.add_all(
        [
            provider,
            credential,
            Provider(
                tenant_id="other-tenant",
                provider_name="anthropic",
                provider_type=ProviderType.CUSTOM,
                is_valid=True,
            ),
        ]
    )
    provider_db.commit()

    result = ProviderManager._get_all_providers("tenant-id")

    assert result[str(ModelProviderID("openai"))][0].credential_name == "primary"
    assert result[str(ModelProviderID("openai"))][0].encrypted_config == '{"api_key": "secret"}'
    assert str(ModelProviderID("anthropic")) not in result


def test_invalidate_configurations_cache_bumps_selected_source_version() -> None:
    fake_redis = _FakeRedis()

    with patch("core.provider_manager.redis_client", fake_redis):
        ProviderManager.invalidate_configurations_cache(
            "tenant-id",
            sources=(ProviderConfigurationCacheSource.PROVIDER_CREDENTIALS,),
        )
        ProviderManager.invalidate_configurations_cache(
            "tenant-id",
            sources=(ProviderConfigurationCacheSource.PROVIDER_CREDENTIALS,),
        )

    assert fake_redis.store["provider_configurations:tenant:tenant-id:source:provider_credentials:version"] == "2"
    assert fake_redis.expirations["provider_configurations:tenant:tenant-id:source:provider_credentials:version"] == 360
    assert "provider_configurations:tenant:tenant-id:source:provider_models:version" not in fake_redis.store


def test_provider_model_credentials_cache_returns_cache_entries(provider_db: Session) -> None:
    fake_redis = _FakeRedis()
    credential_record = ProviderModelCredential(
        tenant_id="tenant-id",
        provider_name="openai",
        model_name="gpt-4",
        model_type=ModelType.LLM,
        credential_name="primary",
        encrypted_config='{"api_key": "secret"}',
    )
    credential_record.id = "credential-id"
    provider_db.add_all(
        [
            credential_record,
            ProviderModelCredential(
                tenant_id="other-tenant",
                provider_name="anthropic",
                model_name="claude",
                model_type=ModelType.LLM,
                credential_name="other",
                encrypted_config='{"api_key": "other"}',
            ),
        ]
    )
    provider_db.commit()

    with patch("core.provider_manager.redis_client", fake_redis):
        first = ProviderManager._get_all_provider_model_credentials("tenant-id")
        second = ProviderManager._get_all_provider_model_credentials("tenant-id")

    version_key = "provider_configurations:tenant:tenant-id:source:provider_model_credentials:version"
    assert fake_redis.expirations[version_key] == 360
    assert first["openai"][0] is not credential_record
    assert second["openai"][0].credential_name == "primary"
    assert second["openai"][0].model_type == ModelType.LLM
    assert "anthropic" not in second


def test_provider_configuration_cache_skips_write_when_version_changes_during_load(
    provider_db: Session, sqlite_engine: Engine
) -> None:
    fake_redis = _FakeRedis()
    version_key = "provider_configurations:tenant:tenant-id:source:provider_model_credentials:version"
    credential_record = ProviderModelCredential(
        tenant_id="tenant-id",
        provider_name="openai",
        model_name="gpt-4",
        model_type=ModelType.LLM,
        credential_name="primary",
        encrypted_config='{"api_key": "secret"}',
    )
    credential_record.id = "credential-id"
    provider_db.add(credential_record)
    provider_db.commit()
    version_bumped = False

    def bump_version_on_credential_query(_conn, _cursor, statement, _parameters, _context, _executemany) -> None:
        nonlocal version_bumped
        if (
            not version_bumped
            and statement.lstrip().upper().startswith("SELECT")
            and "provider_model_credentials" in statement
        ):
            version_bumped = True
            fake_redis.incr(version_key)

    event.listen(sqlite_engine, "before_cursor_execute", bump_version_on_credential_query)
    try:
        with patch("core.provider_manager.redis_client", fake_redis):
            result = ProviderManager._get_all_provider_model_credentials("tenant-id")
    finally:
        event.remove(sqlite_engine, "before_cursor_execute", bump_version_on_credential_query)

    assert version_bumped is True
    assert fake_redis.store[version_key] == "1"
    assert "provider_configurations:tenant:tenant-id:source:provider_model_credentials:v:0" not in fake_redis.store
    assert "provider_configurations:tenant:tenant-id:source:provider_model_credentials:v:1" not in fake_redis.store
    assert result["openai"][0].credential_name == "primary"


@pytest.mark.parametrize(
    "method_name",
    [
        "_get_all_provider_models",
        "_get_all_provider_model_settings",
        "_get_all_provider_model_credentials",
        "_get_all_provider_credentials",
    ],
)
def test_provider_grouping_helpers_group_records_by_provider_name(method_name: str, provider_db: Session) -> None:
    def build_record(provider_name: str, index: int, *, tenant_id: str = "tenant-id"):
        match method_name:
            case "_get_all_provider_models":
                record = ProviderModel(
                    tenant_id=tenant_id,
                    provider_name=provider_name,
                    model_name=f"model-{index}",
                    model_type=ModelType.LLM,
                    credential_id=None,
                    is_valid=True,
                )
            case "_get_all_provider_model_settings":
                record = ProviderModelSetting(
                    tenant_id=tenant_id,
                    provider_name=provider_name,
                    model_name=f"model-{index}",
                    model_type=ModelType.LLM,
                    enabled=True,
                    load_balancing_enabled=False,
                )
            case "_get_all_provider_model_credentials":
                record = ProviderModelCredential(
                    tenant_id=tenant_id,
                    provider_name=provider_name,
                    model_name=f"model-{index}",
                    model_type=ModelType.LLM,
                    credential_name=f"credential-{index}",
                    encrypted_config='{"api_key": "secret"}',
                )
            case "_get_all_provider_credentials":
                record = ProviderCredential(
                    tenant_id=tenant_id,
                    provider_name=provider_name,
                    credential_name=f"credential-{index}",
                    encrypted_config='{"api_key": "secret"}',
                )
            case _:
                raise AssertionError(f"Unexpected method: {method_name}")
        record.id = f"record-{index}"
        return record

    openai_primary = build_record("openai", 1)
    openai_secondary = build_record("openai", 2)
    anthropic_record = build_record("anthropic", 3)
    other_tenant_record = build_record("other-provider", 4, tenant_id="other-tenant")
    provider_db.add_all([openai_primary, openai_secondary, anthropic_record, other_tenant_record])
    provider_db.commit()

    with patch("core.provider_manager.redis_client", _FakeRedis()):
        result = getattr(ProviderManager, method_name)("tenant-id")

    assert [record.provider_name for record in result["openai"]] == ["openai", "openai"]
    assert [record.provider_name for record in result["anthropic"]] == ["anthropic"]
    assert "other-provider" not in result


def test_get_all_preferred_model_providers_returns_mapping_by_provider_name(provider_db: Session) -> None:
    openai_preference = TenantPreferredModelProvider(
        tenant_id="tenant-id", provider_name="openai", preferred_provider_type=ProviderType.SYSTEM
    )
    anthropic_preference = TenantPreferredModelProvider(
        tenant_id="tenant-id", provider_name="anthropic", preferred_provider_type=ProviderType.CUSTOM
    )
    provider_db.add_all(
        [
            openai_preference,
            anthropic_preference,
            TenantPreferredModelProvider(
                tenant_id="other-tenant",
                provider_name="other-provider",
                preferred_provider_type=ProviderType.SYSTEM,
            ),
        ]
    )
    provider_db.commit()

    with patch("core.provider_manager.redis_client", _FakeRedis()):
        result = ProviderManager._get_all_preferred_model_providers("tenant-id")

    assert result["openai"].preferred_provider_type == ProviderType.SYSTEM
    assert result["anthropic"].preferred_provider_type == ProviderType.CUSTOM
    assert "other-provider" not in result


def test_get_all_provider_load_balancing_configs_returns_empty_when_cached_flag_is_disabled(
    provider_db: Session, sqlite_engine: Engine
) -> None:
    statements: list[str] = []

    def record_statement(_conn, _cursor, statement, _parameters, _context, _executemany) -> None:
        statements.append(statement)

    event.listen(sqlite_engine, "before_cursor_execute", record_statement)
    try:
        with (
            patch("core.provider_manager.redis_client.get", return_value=b"False"),
            patch("core.provider_manager.FeatureService.get_features") as mock_get_features,
        ):
            result = ProviderManager._get_all_provider_load_balancing_configs("tenant-id")
    finally:
        event.remove(sqlite_engine, "before_cursor_execute", record_statement)

    assert result == {}
    mock_get_features.assert_not_called()
    assert statements == []


def test_get_all_provider_load_balancing_configs_populates_cache_and_groups_configs(provider_db: Session) -> None:
    openai_config = LoadBalancingModelConfig(
        tenant_id="tenant-id",
        provider_name="openai",
        model_name="gpt-4",
        model_type=ModelType.LLM,
        name="primary",
        encrypted_config=None,
        credential_id=None,
        credential_source_type=None,
        enabled=True,
    )
    openai_config.id = "lb-1"
    anthropic_config = LoadBalancingModelConfig(
        tenant_id="tenant-id",
        provider_name="anthropic",
        model_name="claude",
        model_type=ModelType.LLM,
        name="primary",
        encrypted_config=None,
        credential_id=None,
        credential_source_type=None,
        enabled=True,
    )
    anthropic_config.id = "lb-2"
    other_tenant_config = LoadBalancingModelConfig(
        tenant_id="other-tenant",
        provider_name="other-provider",
        model_name="other-model",
        model_type=ModelType.LLM,
        name="primary",
        encrypted_config=None,
        credential_id=None,
        credential_source_type=None,
        enabled=True,
    )
    provider_db.add_all([openai_config, anthropic_config, other_tenant_config])
    provider_db.commit()

    with (
        patch("core.provider_manager.redis_client.get", return_value=None),
        patch("core.provider_manager.redis_client.setex") as mock_setex,
        patch(
            "core.provider_manager.FeatureService.get_features",
            return_value=SimpleNamespace(model_load_balancing_enabled=True),
        ),
    ):
        result = ProviderManager._get_all_provider_load_balancing_configs("tenant-id")

    mock_setex.assert_any_call("tenant:tenant-id:model_load_balancing_enabled", 120, "True")
    assert [record.provider_name for record in result["openai"]] == ["openai"]
    assert [record.provider_name for record in result["anthropic"]] == ["anthropic"]
    assert "other-provider" not in result
