from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, PropertyMock, patch

import pytest
from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.model_entities import ModelType
from pytest_mock import MockerFixture

from core.entities.provider_entities import ModelSettings
from core.provider_manager import ProviderManager
from models.provider import LoadBalancingModelConfig, ProviderModelSetting, TenantDefaultModel
from models.provider_ids import ModelProviderID


def _build_provider_manager(mocker: MockerFixture) -> ProviderManager:
    return ProviderManager(model_runtime=mocker.Mock())


def _build_session_context(session: Mock) -> MagicMock:
    session_cm = MagicMock()
    session_cm.__enter__.return_value = session
    session_cm.__exit__.return_value = False
    return session_cm


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


def test__to_model_settings(mocker: MockerFixture, mock_provider_entity):
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

    with patch(
        "core.helper.model_provider_cache.ProviderCredentialsCache.get",
        return_value={"openai_api_key": "fake_key"},
    ):
        provider_manager = _build_provider_manager(mocker)

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


def test__to_model_settings_only_one_lb(mocker: MockerFixture, mock_provider_entity):
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

    with patch(
        "core.helper.model_provider_cache.ProviderCredentialsCache.get",
        return_value={"openai_api_key": "fake_key"},
    ):
        provider_manager = _build_provider_manager(mocker)

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


def test__to_model_settings_lb_disabled(mocker: MockerFixture, mock_provider_entity):
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

    with patch(
        "core.helper.model_provider_cache.ProviderCredentialsCache.get",
        return_value={"openai_api_key": "fake_key"},
    ):
        provider_manager = _build_provider_manager(mocker)

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


def test_get_default_model_uses_first_available_active_model(mocker: MockerFixture):
    mock_session = Mock()
    mock_session.scalar.return_value = None

    provider_configurations = Mock()
    provider_configurations.get_models.return_value = [
        Mock(model="gpt-3.5-turbo", provider=Mock(provider="openai")),
        Mock(model="gpt-4", provider=Mock(provider="openai")),
    ]

    manager = _build_provider_manager(mocker)
    with (
        patch("core.provider_manager.db.session", mock_session),
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
        mock_session.add.assert_called_once()
        saved_default_model = mock_session.add.call_args.args[0]
        assert saved_default_model.model_name == "gpt-3.5-turbo"
        assert saved_default_model.provider_name == "openai"
        mock_session.commit.assert_called_once()


def test_get_default_model_returns_none_when_no_default_or_active_models(mocker: MockerFixture):
    mock_session = Mock()
    mock_session.scalar.return_value = None
    provider_configurations = Mock()
    provider_configurations.get_models.return_value = []
    manager = _build_provider_manager(mocker)

    with (
        patch("core.provider_manager.db.session", mock_session),
        patch.object(manager, "get_configurations", return_value=provider_configurations),
        patch("core.provider_manager.ModelProviderFactory") as mock_factory_cls,
    ):
        result = manager.get_default_model("tenant-id", ModelType.LLM)

    assert result is None
    provider_configurations.get_models.assert_called_once_with(model_type=ModelType.LLM, only_active=True)
    mock_factory_cls.assert_not_called()
    mock_session.add.assert_not_called()
    mock_session.commit.assert_not_called()


def test_get_default_model_uses_injected_runtime_for_existing_default_record(mocker: MockerFixture):
    existing_default_model = TenantDefaultModel(
        tenant_id="tenant-id",
        provider_name="openai",
        model_name="gpt-4",
        model_type=ModelType.LLM,
    )
    mock_session = Mock()
    mock_session.scalar.return_value = existing_default_model
    manager = _build_provider_manager(mocker)

    with (
        patch("core.provider_manager.db.session", mock_session),
        patch("core.provider_manager.ModelProviderFactory") as mock_factory_cls,
    ):
        mock_factory_cls.return_value.get_provider_schema.return_value = Mock(
            provider="openai",
            label=I18nObject(en_US="OpenAI", zh_Hans="OpenAI"),
            icon_small=I18nObject(en_US="icon_small.png", zh_Hans="icon_small.png"),
            supported_model_types=[ModelType.LLM],
        )

        result = manager.get_default_model("tenant-id", ModelType.LLM)

    mock_factory_cls.assert_called_once_with(model_runtime=manager._model_runtime)
    assert result is not None
    assert result.model == "gpt-4"
    assert result.provider.provider == "openai"


def test_get_configurations_uses_injected_runtime_and_adds_provider_aliases(mocker: MockerFixture):
    manager = _build_provider_manager(mocker)
    provider_records = {"openai": [SimpleNamespace(provider_name="openai")]}
    provider_model_records = {"openai": [SimpleNamespace(provider_name="openai")]}
    preferred_provider_records = {"openai": SimpleNamespace(preferred_provider_type="system")}

    with (
        patch.object(manager, "_get_all_providers", return_value=provider_records),
        patch.object(manager, "_init_trial_provider_records", return_value=provider_records),
        patch.object(manager, "_get_all_provider_models", return_value=provider_model_records),
        patch.object(manager, "_get_all_preferred_model_providers", return_value=preferred_provider_records),
        patch.object(manager, "_get_all_provider_model_settings", return_value={}),
        patch.object(manager, "_get_all_provider_load_balancing_configs", return_value={}),
        patch.object(manager, "_get_all_provider_model_credentials", return_value={}),
        patch("core.provider_manager.ModelProviderFactory") as mock_factory_cls,
    ):
        mock_factory_cls.return_value.get_providers.return_value = []

        result = manager.get_configurations("tenant-id")

    expected_alias = str(ModelProviderID("openai"))
    mock_factory_cls.assert_called_once_with(model_runtime=manager._model_runtime)
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


def test_get_provider_model_bundle_raises_for_unknown_provider(mocker: MockerFixture):
    manager = _build_provider_manager(mocker)

    with patch.object(manager, "get_configurations", return_value={}):
        with pytest.raises(ValueError, match="Provider openai does not exist."):
            manager.get_provider_model_bundle("tenant-id", "openai", ModelType.LLM)


def test_get_configurations_binds_manager_runtime_to_provider_configuration(
    mocker: MockerFixture, mock_provider_entity
):
    manager = _build_provider_manager(mocker)
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
        patch.object(manager, "_to_custom_configuration", return_value=custom_configuration),
        patch.object(manager, "_to_system_configuration", return_value=system_configuration),
        patch.object(manager, "_to_model_settings", return_value=[]),
        patch("core.provider_manager.ModelProviderFactory", return_value=provider_factory),
        patch("core.provider_manager.ProviderConfiguration", return_value=provider_configuration),
    ):
        manager.get_configurations("tenant-id")

    provider_configuration.bind_model_runtime.assert_called_once_with(manager._model_runtime)


def test_get_provider_model_bundle_returns_selected_model_type_instance(mocker: MockerFixture):
    manager = _build_provider_manager(mocker)
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


def test_get_first_provider_first_model_returns_none_when_no_models(mocker: MockerFixture):
    manager = _build_provider_manager(mocker)
    provider_configurations = Mock()
    provider_configurations.get_models.return_value = []

    with patch.object(manager, "get_configurations", return_value=provider_configurations):
        result = manager.get_first_provider_first_model("tenant-id", ModelType.LLM)

    assert result == (None, None)
    provider_configurations.get_models.assert_called_once_with(model_type=ModelType.LLM, only_active=False)


def test_get_first_provider_first_model_returns_first_model_and_provider(mocker: MockerFixture):
    manager = _build_provider_manager(mocker)
    provider_configurations = Mock()
    provider_configurations.get_models.return_value = [
        Mock(model="gpt-4", provider=Mock(provider="openai")),
        Mock(model="gpt-4o", provider=Mock(provider="openai")),
    ]

    with patch.object(manager, "get_configurations", return_value=provider_configurations):
        result = manager.get_first_provider_first_model("tenant-id", ModelType.LLM)

    assert result == ("openai", "gpt-4")


def test_update_default_model_record_raises_for_unknown_provider(mocker: MockerFixture):
    manager = _build_provider_manager(mocker)

    with patch.object(manager, "get_configurations", return_value={}):
        with pytest.raises(ValueError, match="Provider openai does not exist."):
            manager.update_default_model_record("tenant-id", ModelType.LLM, "openai", "gpt-4")


def test_update_default_model_record_raises_for_unknown_model(mocker: MockerFixture):
    manager = _build_provider_manager(mocker)
    provider_configurations = MagicMock()
    provider_configurations.__contains__.return_value = True
    provider_configurations.get_models.return_value = [Mock(model="gpt-4")]

    with patch.object(manager, "get_configurations", return_value=provider_configurations):
        with pytest.raises(ValueError, match="Model gpt-3.5-turbo does not exist."):
            manager.update_default_model_record("tenant-id", ModelType.LLM, "openai", "gpt-3.5-turbo")

    provider_configurations.get_models.assert_called_once_with(model_type=ModelType.LLM, only_active=True)


def test_update_default_model_record_updates_existing_record(mocker: MockerFixture):
    manager = _build_provider_manager(mocker)
    provider_configurations = MagicMock()
    provider_configurations.__contains__.return_value = True
    provider_configurations.get_models.return_value = [Mock(model="gpt-3.5-turbo")]
    existing_default_model = TenantDefaultModel(
        tenant_id="tenant-id",
        provider_name="anthropic",
        model_name="claude-3-sonnet",
        model_type=ModelType.LLM,
    )
    mock_session = Mock()
    mock_session.scalar.return_value = existing_default_model

    with (
        patch.object(manager, "get_configurations", return_value=provider_configurations),
        patch("core.provider_manager.db.session", mock_session),
    ):
        result = manager.update_default_model_record("tenant-id", ModelType.LLM, "openai", "gpt-3.5-turbo")

    assert result is existing_default_model
    assert existing_default_model.provider_name == "openai"
    assert existing_default_model.model_name == "gpt-3.5-turbo"
    mock_session.commit.assert_called_once()
    mock_session.add.assert_not_called()


def test_update_default_model_record_creates_record_with_origin_model_type(mocker: MockerFixture):
    manager = _build_provider_manager(mocker)
    provider_configurations = MagicMock()
    provider_configurations.__contains__.return_value = True
    provider_configurations.get_models.return_value = [Mock(model="gpt-4")]
    mock_session = Mock()
    mock_session.scalar.return_value = None

    with (
        patch.object(manager, "get_configurations", return_value=provider_configurations),
        patch("core.provider_manager.db.session", mock_session),
    ):
        result = manager.update_default_model_record("tenant-id", ModelType.LLM, "openai", "gpt-4")

    mock_session.add.assert_called_once()
    created_default_model = mock_session.add.call_args.args[0]
    assert result is created_default_model
    assert created_default_model.tenant_id == "tenant-id"
    assert created_default_model.provider_name == "openai"
    assert created_default_model.model_name == "gpt-4"
    assert created_default_model.model_type == ModelType.LLM
    mock_session.commit.assert_called_once()


def test_get_all_providers_normalizes_provider_names_with_model_provider_id() -> None:
    session = Mock()
    openai_provider = SimpleNamespace(provider_name="openai")
    gemini_provider = SimpleNamespace(provider_name="langgenius/gemini/google")
    session.scalars.return_value = [openai_provider, gemini_provider]

    with (
        patch("core.provider_manager.db", SimpleNamespace(engine=object())),
        patch("core.provider_manager.Session", return_value=_build_session_context(session)),
    ):
        result = ProviderManager._get_all_providers("tenant-id")

    assert list(result[str(ModelProviderID("openai"))]) == [openai_provider]
    assert list(result[str(ModelProviderID("langgenius/gemini/google"))]) == [gemini_provider]


@pytest.mark.parametrize(
    "method_name",
    [
        "_get_all_provider_models",
        "_get_all_provider_model_settings",
        "_get_all_provider_model_credentials",
    ],
)
def test_provider_grouping_helpers_group_records_by_provider_name(method_name: str) -> None:
    session = Mock()
    openai_primary = SimpleNamespace(provider_name="openai")
    openai_secondary = SimpleNamespace(provider_name="openai")
    anthropic_record = SimpleNamespace(provider_name="anthropic")
    session.scalars.return_value = [openai_primary, openai_secondary, anthropic_record]

    with (
        patch("core.provider_manager.db", SimpleNamespace(engine=object())),
        patch("core.provider_manager.Session", return_value=_build_session_context(session)),
    ):
        result = getattr(ProviderManager, method_name)("tenant-id")

    assert list(result["openai"]) == [openai_primary, openai_secondary]
    assert list(result["anthropic"]) == [anthropic_record]


def test_get_all_preferred_model_providers_returns_mapping_by_provider_name() -> None:
    session = Mock()
    openai_preference = SimpleNamespace(provider_name="openai")
    anthropic_preference = SimpleNamespace(provider_name="anthropic")
    session.scalars.return_value = [openai_preference, anthropic_preference]

    with (
        patch("core.provider_manager.db", SimpleNamespace(engine=object())),
        patch("core.provider_manager.Session", return_value=_build_session_context(session)),
    ):
        result = ProviderManager._get_all_preferred_model_providers("tenant-id")

    assert result == {
        "openai": openai_preference,
        "anthropic": anthropic_preference,
    }


def test_get_all_provider_load_balancing_configs_returns_empty_when_cached_flag_is_disabled() -> None:
    with (
        patch("core.provider_manager.redis_client.get", return_value=b"False"),
        patch("core.provider_manager.FeatureService.get_features") as mock_get_features,
        patch("core.provider_manager.Session") as mock_session_cls,
    ):
        result = ProviderManager._get_all_provider_load_balancing_configs("tenant-id")

    assert result == {}
    mock_get_features.assert_not_called()
    mock_session_cls.assert_not_called()


def test_get_all_provider_load_balancing_configs_populates_cache_and_groups_configs() -> None:
    session = Mock()
    openai_config = SimpleNamespace(provider_name="openai")
    anthropic_config = SimpleNamespace(provider_name="anthropic")
    session.scalars.return_value = [openai_config, anthropic_config]

    with (
        patch("core.provider_manager.db", SimpleNamespace(engine=object())),
        patch("core.provider_manager.redis_client.get", return_value=None),
        patch("core.provider_manager.redis_client.setex") as mock_setex,
        patch(
            "core.provider_manager.FeatureService.get_features",
            return_value=SimpleNamespace(model_load_balancing_enabled=True),
        ),
        patch("core.provider_manager.Session", return_value=_build_session_context(session)),
    ):
        result = ProviderManager._get_all_provider_load_balancing_configs("tenant-id")

    mock_setex.assert_called_once_with("tenant:tenant-id:model_load_balancing_enabled", 120, "True")
    assert list(result["openai"]) == [openai_config]
    assert list(result["anthropic"]) == [anthropic_config]
