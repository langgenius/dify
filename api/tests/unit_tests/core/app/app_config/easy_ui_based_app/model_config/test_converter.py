"""Unit tests for ``ModelConfigConverter.convert``.

Every case below runs against the production entities instead of mocks: the app config is a real
``EasyUIBasedAppConfig``, the provider graph is a real ``ProviderConfiguration`` holding a real
``LargeLanguageModel``, and the returned value is a real ``ModelConfigWithCredentialsEntity``. The
converter accepts an already resolved ``ProviderModelBundle``, so these tests exercise the real
credential, model-status and schema logic without reaching the plugin daemon; the one case that must
cover bundle resolution stubs only ``create_plugin_provider_manager``.
"""

from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass, field
from unittest.mock import patch

import pytest
from pytest_mock import MockerFixture
from typing_extensions import TypedDict

from core.app.app_config.easy_ui_based_app.model_config.converter import ModelConfigConverter
from core.app.app_config.entities import (
    EasyUIBasedAppConfig,
    EasyUIBasedAppModelConfigFrom,
    ModelConfigEntity,
    PromptTemplateEntity,
)
from core.entities.provider_configuration import ProviderConfiguration, ProviderModelBundle
from core.entities.provider_entities import (
    CustomConfiguration,
    CustomProviderConfiguration,
    ProviderQuotaType,
    QuotaConfiguration,
    QuotaUnit,
    RestrictModel,
    SystemConfiguration,
)
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from core.plugin.impl.model import PluginModelClient
from core.plugin.impl.model_runtime_factory import create_plugin_model_runtime
from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.llm_entities import LLMMode
from graphon.model_runtime.entities.model_entities import AIModelEntity, FetchFrom, ModelPropertyKey, ModelType
from graphon.model_runtime.entities.provider_entities import ProviderEntity
from graphon.model_runtime.model_providers.base.large_language_model import LargeLanguageModel
from models.model import AppMode
from models.provider import ProviderType

TENANT_ID = "tenant_1"
APP_ID = "app_1"
PROVIDER_ID = "langgenius/openai/openai"
MODEL_NAME = "gpt-4"


class ProviderCredentials(TypedDict):
    """The custom (BYOK) provider credentials the converter only checks for presence."""

    api_key: str


class CompletionParameters(TypedDict, total=False):
    """The completion parameters the converter splits into ``parameters`` and ``stop``."""

    temperature: float
    max_tokens: int
    stop: list[str]


def _model_schema(model_properties: dict[ModelPropertyKey, object] | None = None) -> AIModelEntity:
    """Build the real provider-side schema the converter copies into the returned entity."""
    return AIModelEntity(
        model=MODEL_NAME,
        label=I18nObject(en_US="GPT-4"),
        model_type=ModelType.LLM,
        fetch_from=FetchFrom.PREDEFINED_MODEL,
        model_properties=model_properties if model_properties is not None else {},
    )


def _provider_schema(*, models: list[AIModelEntity] | None = None) -> ProviderEntity:
    """Build a real provider schema; carrying ``models`` keeps schema resolution fully offline."""
    return ProviderEntity(
        provider=PROVIDER_ID,
        label=I18nObject(en_US="OpenAI"),
        supported_model_types=[ModelType.LLM],
        configurate_methods=[],
        models=[_model_schema()] if models is None else models,
    )


def _custom_configuration(*, credentials: ProviderCredentials | None = None) -> CustomConfiguration:
    """Return a custom (BYOK) configuration; ``credentials=None`` means no credential is configured."""
    if credentials is None:
        return CustomConfiguration(provider=None)
    return CustomConfiguration(provider=CustomProviderConfiguration(credentials=credentials))


def _trial_system_configuration(*, restrict_models: list[str], is_valid: bool) -> SystemConfiguration:
    """Return a Dify-hosted trial configuration whose quota decides the model status."""
    return SystemConfiguration(
        enabled=True,
        credentials={"api_key": "hosted"},
        current_quota_type=ProviderQuotaType.TRIAL,
        quota_configurations=[
            QuotaConfiguration(
                quota_type=ProviderQuotaType.TRIAL,
                quota_unit=QuotaUnit.CREDITS,
                quota_limit=200,
                quota_used=0,
                is_valid=is_valid,
                restrict_models=[RestrictModel(model=name, model_type=ModelType.LLM) for name in restrict_models],
            )
        ],
    )


def _provider_configuration(
    *,
    custom_configuration: CustomConfiguration | None = None,
    system_configuration: SystemConfiguration | None = None,
    using_provider_type: ProviderType = ProviderType.CUSTOM,
    models: list[AIModelEntity] | None = None,
) -> ProviderConfiguration:
    """Build a real provider configuration.

    The model validator records the provider's configure methods in a module-level registry, so the
    registry is replaced for the duration of the construction to keep tests isolated from each other.
    """
    with patch("core.entities.provider_configuration.original_provider_configurate_methods", dict[str, object]()):
        return ProviderConfiguration(
            tenant_id=TENANT_ID,
            provider=_provider_schema(models=models),
            preferred_provider_type=using_provider_type,
            using_provider_type=using_provider_type,
            system_configuration=system_configuration or SystemConfiguration(enabled=False),
            custom_configuration=custom_configuration or _custom_configuration(credentials={"api_key": "key"}),
            model_settings=[],
        )


def _provider_model_bundle(configuration: ProviderConfiguration) -> ProviderModelBundle:
    """Build a real bundle around the configuration, with a real LLM model type instance."""
    return ProviderModelBundle(
        configuration=configuration,
        model_type_instance=LargeLanguageModel(
            provider_schema=_provider_schema(),
            model_runtime=create_plugin_model_runtime(tenant_id=TENANT_ID),
        ),
    )


def _app_config(
    *,
    model: str = MODEL_NAME,
    mode: str | None = None,
    parameters: CompletionParameters | None = None,
) -> EasyUIBasedAppConfig:
    """Build the real app config the converter reads its model settings from."""
    return EasyUIBasedAppConfig(
        tenant_id=TENANT_ID,
        app_id=APP_ID,
        app_mode=AppMode.CHAT,
        app_model_config_from=EasyUIBasedAppModelConfigFrom.ARGS,
        app_model_config_dict={},
        model=ModelConfigEntity(
            provider=PROVIDER_ID,
            model=model,
            mode=mode,
            parameters={} if parameters is None else parameters,
        ),
        prompt_template=PromptTemplateEntity(prompt_type=PromptTemplateEntity.PromptType.SIMPLE),
    )


@contextmanager
def _provider_schema_lookup(schema: AIModelEntity | None) -> Generator[None]:
    """Serve ``schema`` (or a miss) for the plugin model client the real runtime delegates to.

    ``PluginModelRuntime.get_model_schema`` consults the schema cache first and treats an
    uninitialized cache as a miss, so patching the client keeps the lookup offline.
    """

    def _get_model_schema(_client: PluginModelClient, **_kwargs: object) -> AIModelEntity | None:
        return schema

    with patch.object(PluginModelClient, "get_model_schema", _get_model_schema):
        yield


@dataclass
class _RecordingProviderManager:
    """Provider manager stub standing in for the tenant-scoped resolver.

    The converter calls exactly one method on the manager, so recording that call is enough to prove
    the production path resolves the bundle for the app's tenant and provider.
    """

    bundle: ProviderModelBundle
    requests: list[dict[str, str]] = field(default_factory=list)

    def get_provider_model_bundle(self, *, tenant_id: str, provider: str, model_type: ModelType) -> ProviderModelBundle:
        self.requests.append({"tenant_id": tenant_id, "provider": provider, "model_type": model_type.value})
        return self.bundle


class TestModelConfigConverter:
    # =============================
    # Positive Scenarios
    # =============================

    def test_convert_success_default_mode(self) -> None:
        bundle = _provider_model_bundle(_provider_configuration())

        with _provider_schema_lookup(_model_schema()):
            result = ModelConfigConverter.convert(
                _app_config(parameters={"temperature": 0.5}), provider_model_bundle=bundle
            )

        assert result.provider == PROVIDER_ID
        assert result.model == MODEL_NAME
        assert result.mode == LLMMode.CHAT
        assert result.parameters == {"temperature": 0.5}
        assert result.stop == []
        assert result.model_schema.model == MODEL_NAME
        assert result.credentials == {"api_key": "key"}

    def test_convert_success_with_stop_parameter(self) -> None:
        bundle = _provider_model_bundle(_provider_configuration())

        with _provider_schema_lookup(_model_schema()):
            result = ModelConfigConverter.convert(
                _app_config(parameters={"temperature": 0.7, "stop": ["\\n"]}),
                provider_model_bundle=bundle,
            )

        assert result.parameters == {"temperature": 0.7}
        assert result.stop == ["\\n"]

    def test_convert_resolves_bundle_from_provider_manager(self, mocker: MockerFixture) -> None:
        manager = _RecordingProviderManager(bundle=_provider_model_bundle(_provider_configuration()))
        mocker.patch(
            "core.app.app_config.easy_ui_based_app.model_config.converter.create_plugin_provider_manager",
            return_value=manager,
        )

        with _provider_schema_lookup(_model_schema()):
            result = ModelConfigConverter.convert(_app_config())

        assert manager.requests == [
            {"tenant_id": TENANT_ID, "provider": PROVIDER_ID, "model_type": ModelType.LLM.value}
        ]
        assert result.provider == PROVIDER_ID
        assert result.provider_model_bundle is manager.bundle

    def test_convert_mode_from_schema_valid(self) -> None:
        bundle = _provider_model_bundle(_provider_configuration())

        with _provider_schema_lookup(_model_schema({ModelPropertyKey.MODE: LLMMode.COMPLETION.value})):
            result = ModelConfigConverter.convert(_app_config(), provider_model_bundle=bundle)

        assert result.mode == LLMMode.COMPLETION

    def test_convert_mode_from_schema_invalid_fallback(self) -> None:
        bundle = _provider_model_bundle(_provider_configuration())

        with _provider_schema_lookup(_model_schema({ModelPropertyKey.MODE: "invalid"})):
            result = ModelConfigConverter.convert(_app_config(), provider_model_bundle=bundle)

        assert result.mode == LLMMode.CHAT

    # =============================
    # Credential Errors
    # =============================

    def test_convert_credentials_none_raises(self) -> None:
        bundle = _provider_model_bundle(_provider_configuration(custom_configuration=_custom_configuration()))

        with _provider_schema_lookup(_model_schema()):
            with pytest.raises(ProviderTokenNotInitError):
                ModelConfigConverter.convert(_app_config(), provider_model_bundle=bundle)

    # =============================
    # Provider Model Errors
    # =============================

    def test_convert_provider_model_none_raises(self) -> None:
        bundle = _provider_model_bundle(
            _provider_configuration(
                models=[_model_schema().model_copy(update={"model": "gpt-3.5-turbo"})],
            )
        )

        with _provider_schema_lookup(_model_schema()):
            with pytest.raises(ValueError, match="Model gpt\\-4 not exist\\."):
                ModelConfigConverter.convert(_app_config(), provider_model_bundle=bundle)

    @pytest.mark.parametrize(
        ("restrict_models", "is_valid", "expected_exception"),
        [
            (["other-model"], True, ModelCurrentlyNotSupportError),
            ([MODEL_NAME], False, QuotaExceededError),
        ],
    )
    def test_convert_provider_model_status_errors(
        self,
        restrict_models: list[str],
        is_valid: bool,
        expected_exception: type[Exception],
    ) -> None:
        bundle = _provider_model_bundle(
            _provider_configuration(
                using_provider_type=ProviderType.SYSTEM,
                custom_configuration=_custom_configuration(),
                system_configuration=_trial_system_configuration(restrict_models=restrict_models, is_valid=is_valid),
            )
        )

        with _provider_schema_lookup(_model_schema()):
            with pytest.raises(expected_exception):
                ModelConfigConverter.convert(_app_config(), provider_model_bundle=bundle)

    # =============================
    # Schema Errors
    # =============================

    def test_convert_model_schema_none_raises(self) -> None:
        bundle = _provider_model_bundle(_provider_configuration())

        with _provider_schema_lookup(None):
            with pytest.raises(ValueError, match="Model gpt\\-4 not exist\\."):
                ModelConfigConverter.convert(_app_config(), provider_model_bundle=bundle)

    # =============================
    # Edge Cases
    # =============================

    @pytest.mark.parametrize(
        "parameters",
        [
            {},
            {"stop": []},
            {"stop": ["END"], "max_tokens": 100},
        ],
    )
    def test_convert_parameter_edge_cases(self, parameters: CompletionParameters) -> None:
        bundle = _provider_model_bundle(_provider_configuration())

        with _provider_schema_lookup(_model_schema()):
            result = ModelConfigConverter.convert(
                _app_config(parameters=parameters),
                provider_model_bundle=bundle,
            )

        expected_stop: list[str] = parameters.get("stop", [])
        expected_parameters: dict[str, object] = {key: value for key, value in parameters.items() if key != "stop"}
        assert result.stop == expected_stop
        assert result.parameters == expected_parameters
