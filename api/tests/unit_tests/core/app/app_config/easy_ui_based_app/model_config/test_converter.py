"""Unit tests for ``ModelConfigConverter.convert``.

Every case below runs against the production entities instead of mocks: the app config is a real
``EasyUIBasedAppConfig``, the provider graph is a real ``ProviderConfiguration`` holding a real
``LargeLanguageModel``, and the returned value is a real ``ModelConfigWithCredentialsEntity``. The
converter accepts an already resolved ``ProviderModelBundle``, so these tests exercise the real
credential, model-status and schema logic with the plugin daemon and cache confined to local
transports. The bundle-resolution case also stubs ``create_plugin_provider_manager``.
"""

import json
from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass, field

import httpx
import pytest
from pytest_mock import MockerFixture
from redis import Redis

import core.plugin.impl.base as plugin_client_module
import core.plugin.impl.model_runtime as model_runtime_module
from core.app.app_config.easy_ui_based_app.model_config.converter import (
    CompletionParameters,
    ModelConfigConverter,
    ProviderCredentials,
)
from core.app.app_config.entities import (
    EasyUIBasedAppConfig,
    EasyUIBasedAppModelConfigFrom,
    ModelConfigEntity,
    PromptTemplateEntity,
)
from core.entities.provider_configuration import (
    ProviderConfigurateMethodsRegistry,
    ProviderConfiguration,
    ProviderModelBundle,
    original_provider_configurate_methods,
)
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
from core.plugin.entities.plugin_daemon import PluginDaemonBasicResponse, PluginModelSchemaEntity
from core.plugin.impl.model import PluginModelClient
from core.plugin.impl.model_runtime import PluginModelRuntime
from core.plugin.plugin_service import PluginService
from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.llm_entities import LLMMode
from graphon.model_runtime.entities.model_entities import AIModelEntity, FetchFrom, ModelPropertyKey, ModelType
from graphon.model_runtime.entities.provider_entities import ConfigurateMethod, ProviderEntity
from graphon.model_runtime.model_providers.base.large_language_model import LargeLanguageModel
from models.model import AppMode
from models.provider import ProviderType

TENANT_ID = "tenant_1"
APP_ID = "app_1"
PROVIDER_ID = "langgenius/openai/openai"
MODEL_NAME = "gpt-4"
SCHEMA_USER_ID = "converter-test-user"


def _model_schema(model_properties: dict[ModelPropertyKey, object] | None = None) -> AIModelEntity:
    """Build the real provider-side schema the converter copies into the returned entity."""
    return AIModelEntity(
        model=MODEL_NAME,
        label=I18nObject(en_US="GPT-4"),
        model_type=ModelType.LLM,
        fetch_from=FetchFrom.PREDEFINED_MODEL,
        model_properties=model_properties if model_properties is not None else {},
    )


def _provider_schema(
    *,
    models: list[AIModelEntity] | None = None,
    configurate_methods: list[ConfigurateMethod] | None = None,
) -> ProviderEntity:
    """Build a real provider schema; carrying ``models`` keeps schema resolution fully offline."""
    return ProviderEntity(
        provider=PROVIDER_ID,
        label=I18nObject(en_US="OpenAI"),
        supported_model_types=[ModelType.LLM],
        configurate_methods=[] if configurate_methods is None else configurate_methods,
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
    configurate_methods: list[ConfigurateMethod] | None = None,
    registry: ProviderConfigurateMethodsRegistry | None = None,
) -> ProviderConfiguration:
    """Build a real provider configuration with an isolated original-method registry.

    Preconditions: optional values are valid production entities; an injected registry is a fresh
    production-owned dependency when the caller needs to inspect its captured provider snapshot.
    Postconditions: returns a real validated configuration without patching the production registry.
    """
    return ProviderConfiguration.model_validate_with_configurate_methods_registry(
        tenant_id=TENANT_ID,
        provider=_provider_schema(models=models, configurate_methods=configurate_methods),
        preferred_provider_type=using_provider_type,
        using_provider_type=using_provider_type,
        system_configuration=system_configuration or SystemConfiguration(enabled=False),
        custom_configuration=custom_configuration or _custom_configuration(credentials={"api_key": "key"}),
        model_settings=[],
        registry=registry if registry is not None else ProviderConfigurateMethodsRegistry(),
    )


def _provider_model_bundle(configuration: ProviderConfiguration) -> ProviderModelBundle:
    """Share a fixture-owned plugin runtime between the real configuration and LLM."""
    runtime = PluginModelRuntime(
        tenant_id=configuration.tenant_id,
        user_id=SCHEMA_USER_ID,
        client=PluginModelClient(),
        plugin_service=PluginService,
    )
    configuration.bind_model_runtime(runtime)
    return ProviderModelBundle(
        configuration=configuration,
        model_type_instance=LargeLanguageModel(
            provider_schema=configuration.provider,
            model_runtime=runtime,
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
def _provider_schema_lookup(schema: AIModelEntity | None) -> Generator[list[httpx.Request]]:
    """Serve schema dispatch over HTTPX, with a fresh network-free Redis cache per lookup."""
    requests: list[httpx.Request] = []
    cache_data: dict[str, str] = {}

    def dispatch(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        stream = ""
        if schema is not None:
            envelope = PluginDaemonBasicResponse[PluginModelSchemaEntity](
                code=0, message="", data=PluginModelSchemaEntity(model_schema=schema)
            )
            stream = f"data: {envelope.model_dump_json()}\n\n"
        return httpx.Response(200, text=stream, headers={"Content-Type": "text/event-stream"})

    def execute_cache_command(command: str, key: str, *args: object, **_kwargs: object) -> str | bool | None:
        """Read or write only the schema cache in this test's local store."""
        if command == "GET":
            return cache_data.get(key)
        if command == "SETEX":
            _expiry, value = args
            assert isinstance(value, str)
            cache_data[key] = value
            return True
        raise AssertionError(f"Unexpected schema cache command: {command}")

    with (
        httpx.Client(transport=httpx.MockTransport(dispatch)) as http_client,
        Redis() as cache,
        pytest.MonkeyPatch.context() as monkeypatch,
    ):
        monkeypatch.setattr(cache, "execute_command", execute_cache_command)
        monkeypatch.setattr(model_runtime_module, "redis_client", cache)
        monkeypatch.setattr(plugin_client_module, "_httpx_client", http_client)
        yield requests


def _assert_schema_dispatch(requests: list[httpx.Request]) -> None:
    """Require one real dispatch carrying the fixture runtime's caller and credentials."""
    (request,) = requests
    assert request.method == "POST"
    assert request.url.path == f"/plugin/{TENANT_ID}/dispatch/model/schema"
    assert request.headers["Content-Type"] == "application/json"
    assert request.headers["X-Plugin-ID"] == "langgenius/openai"
    assert json.loads(request.content) == {
        "user_id": SCHEMA_USER_ID,
        "data": {
            "provider": "openai",
            "model_type": ModelType.LLM.value,
            "model": MODEL_NAME,
            "credentials": {"api_key": "key"},
        },
    }


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
    def test_provider_configuration_uses_injected_registry(self) -> None:
        original_registry_before = {
            provider_id: tuple(methods) for provider_id, methods in original_provider_configurate_methods.items()
        }
        registry = ProviderConfigurateMethodsRegistry()
        initial_methods = [ConfigurateMethod.CUSTOMIZABLE_MODEL]
        subsequent_methods = [ConfigurateMethod.PREDEFINED_MODEL]

        initial_configuration = _provider_configuration(
            registry=registry,
            configurate_methods=initial_methods,
            system_configuration=_trial_system_configuration(restrict_models=[MODEL_NAME], is_valid=True),
        )
        subsequent_configuration = _provider_configuration(registry=registry, configurate_methods=subsequent_methods)

        assert initial_configuration.provider.configurate_methods == [
            ConfigurateMethod.CUSTOMIZABLE_MODEL,
            ConfigurateMethod.PREDEFINED_MODEL,
        ]
        assert initial_configuration._get_original_provider_configurate_methods() == initial_methods
        assert subsequent_configuration._get_original_provider_configurate_methods() == subsequent_methods
        assert registry.methods_by_provider == {PROVIDER_ID: initial_methods}
        assert {
            provider_id: tuple(methods) for provider_id, methods in original_provider_configurate_methods.items()
        } == original_registry_before

    # =============================
    # Positive Scenarios
    # =============================

    def test_convert_success_default_mode(self) -> None:
        bundle = _provider_model_bundle(_provider_configuration())

        schema = _model_schema({ModelPropertyKey.CONTEXT_SIZE: 8192})
        with _provider_schema_lookup(schema) as requests:
            result = ModelConfigConverter.convert(
                _app_config(parameters={"temperature": 0.5}), provider_model_bundle=bundle
            )

        assert result.provider == PROVIDER_ID
        assert result.model == MODEL_NAME
        assert result.mode == LLMMode.CHAT
        assert result.parameters == {"temperature": 0.5}
        assert result.stop == []
        assert result.model_schema == schema
        assert result.credentials == {"api_key": "key"}
        _assert_schema_dispatch(requests)

    def test_convert_success_with_stop_parameter(self) -> None:
        bundle = _provider_model_bundle(_provider_configuration())

        with _provider_schema_lookup(_model_schema()):
            result = ModelConfigConverter.convert(
                _app_config(parameters={"temperature": 0.7, "stop": ["\n"]}),
                provider_model_bundle=bundle,
            )

        assert result.parameters == {"temperature": 0.7}
        assert result.stop == ["\n"]

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

        with _provider_schema_lookup(None) as requests:
            with pytest.raises(ValueError, match="Model gpt\\-4 not exist\\."):
                ModelConfigConverter.convert(_app_config(), provider_model_bundle=bundle)
        _assert_schema_dispatch(requests)

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
        expected_parameters = dict(parameters)
        expected_parameters.pop("stop", None)
        assert result.stop == expected_stop
        assert result.parameters == expected_parameters
