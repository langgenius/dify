from unittest.mock import MagicMock

import pytest
from pytest_mock import MockerFixture

from core.app.entities.app_invoke_entities import ModelConfigWithCredentialsEntity
from core.helper.moderation import check_moderation
from core.hosting_configuration import HostedModerationConfig, HostingConfiguration, HostingProvider
from core.plugin.entities.plugin import PluginInstallationSource
from core.plugin.entities.plugin_daemon import PluginModelProviderDeclaration
from core.plugin.impl.model import PluginModelClient
from core.plugin.plugin_service import PluginService
from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.model_entities import ModelType
from graphon.model_runtime.entities.provider_entities import ConfigurateMethod, ProviderEntity
from graphon.model_runtime.errors.invoke import InvokeAuthorizationError, InvokeBadRequestError
from graphon.model_runtime.model_providers.model_provider_factory import ModelProviderFactory
from models.provider import ProviderType
from tests.unit_tests.core.model_fixtures import make_model_config

OPENAI_PROVIDER = "langgenius/openai/openai"
ANTHROPIC_PROVIDER = "langgenius/anthropic/anthropic"


@pytest.fixture(autouse=True)
def hosting(mocker: MockerFixture) -> HostingConfiguration:
    configuration = HostingConfiguration()
    configuration.moderation_config = HostedModerationConfig(enabled=True, providers=[ANTHROPIC_PROVIDER])
    configuration.provider_map[OPENAI_PROVIDER] = HostingProvider(
        enabled=True, credentials={"api_key": "fake-hosted-key"}
    )
    mocker.patch("core.helper.moderation.hosting_configuration", configuration)
    return configuration


@pytest.fixture
def model_config() -> ModelConfigWithCredentialsEntity:
    configuration = make_model_config(provider=ANTHROPIC_PROVIDER, model="test-model", mode="chat")
    configuration.provider_model_bundle.configuration.using_provider_type = ProviderType.SYSTEM
    return configuration


@pytest.fixture(autouse=True)
def provider_declaration(mocker: MockerFixture) -> PluginModelProviderDeclaration:
    declaration = PluginModelProviderDeclaration(
        provider=OPENAI_PROVIDER,
        plugin_unique_identifier="langgenius/openai:1.0.0@checksum",
        installation_source=PluginInstallationSource.Marketplace,
        label=I18nObject(en_US="OpenAI"),
        supported_model_types=[ModelType.MODERATION],
        configurate_methods=[ConfigurateMethod.PREDEFINED_MODEL],
    )
    mocker.patch.object(PluginService, "fetch_plugin_model_providers", return_value=[declaration])
    mocker.patch.object(PluginService, "is_plugin_verified", return_value=True)
    return declaration


@pytest.fixture
def invoke(mocker: MockerFixture) -> MagicMock:
    return mocker.patch.object(PluginModelClient, "invoke_moderation", return_value=False)


@pytest.mark.parametrize("result", [False, True])
def test_trusted_moderation_receives_hosted_credentials(
    hosting: HostingConfiguration,
    model_config: ModelConfigWithCredentialsEntity,
    invoke: MagicMock,
    provider_declaration: PluginModelProviderDeclaration,
    mocker: MockerFixture,
    result: bool,
) -> None:
    verified = mocker.patch.object(PluginService, "is_plugin_verified", return_value=True)
    invoke.return_value = result

    assert check_moderation("tenant-1", model_config, "hello") is result

    verified.assert_called_once_with("tenant-1", provider_declaration.plugin_unique_identifier)
    invoke.assert_called_once_with(
        tenant_id="tenant-1",
        user_id=None,
        plugin_id="langgenius/openai",
        plugin_unique_identifier="langgenius/openai:1.0.0@checksum",
        provider="openai",
        model="omni-moderation-latest",
        credentials=hosting.provider_map[OPENAI_PROVIDER].credentials,
        text="hello",
    )


@pytest.mark.parametrize(
    "case", ["package", "github", "remote", "missing_source", "unverified", "verification_error", "invalid_schema"]
)
def test_provider_validation_fails_before_moderation_invocation(
    model_config: ModelConfigWithCredentialsEntity,
    provider_declaration: PluginModelProviderDeclaration,
    invoke: MagicMock,
    mocker: MockerFixture,
    case: str,
) -> None:
    if case in {"package", "github", "remote"}:
        provider_declaration.installation_source = PluginInstallationSource(case)
    elif case == "missing_source":
        provider_declaration.installation_source = None
    elif case == "unverified":
        mocker.patch.object(PluginService, "is_plugin_verified", return_value=False)
    elif case == "verification_error":
        mocker.patch.object(PluginService, "is_plugin_verified", side_effect=RuntimeError("private daemon detail"))
    elif case == "invalid_schema":
        schema = ProviderEntity.model_validate(provider_declaration.model_dump())
        mocker.patch.object(ModelProviderFactory, "get_provider_schema", return_value=schema)

    with pytest.raises(InvokeAuthorizationError, match="^Untrusted hosted moderation provider\\.$"):
        check_moderation("tenant-1", model_config, "hello")

    invoke.assert_not_called()


@pytest.mark.parametrize("disabled", ["feature", "credentials", "allowlist", "custom_provider"])
def test_check_moderation_skips_inapplicable_requests(
    hosting: HostingConfiguration,
    model_config: ModelConfigWithCredentialsEntity,
    invoke: MagicMock,
    mocker: MockerFixture,
    disabled: str,
) -> None:
    if disabled == "feature":
        hosting.moderation_config = None
    elif disabled == "credentials":
        hosting.provider_map[OPENAI_PROVIDER].credentials = None
    elif disabled == "allowlist":
        hosting.moderation_config = HostedModerationConfig(enabled=True, providers=[OPENAI_PROVIDER])
    else:
        model_config.provider_model_bundle.configuration.using_provider_type = ProviderType.CUSTOM
    factory = mocker.spy(ModelProviderFactory, "get_provider_schema")

    assert check_moderation("tenant-1", model_config, "hello") is False

    factory.assert_not_called()
    invoke.assert_not_called()


def test_check_moderation_returns_true_when_text_is_empty(
    model_config: ModelConfigWithCredentialsEntity, invoke: MagicMock
) -> None:
    assert check_moderation("tenant-1", model_config, "") is True
    invoke.assert_not_called()


def test_check_moderation_only_sends_selected_text_chunk(
    model_config: ModelConfigWithCredentialsEntity,
    invoke: MagicMock,
    mocker: MockerFixture,
) -> None:
    choice = mocker.patch("core.helper.moderation.secrets.choice", return_value="tail")

    assert check_moderation("tenant-1", model_config, "a" * 2000 + "tail") is False

    choice.assert_called_once_with(["a" * 2000, "tail"])
    assert invoke.call_args.kwargs["text"] == "tail"


def test_check_moderation_raises_bad_request_when_provider_call_fails(
    model_config: ModelConfigWithCredentialsEntity, invoke: MagicMock
) -> None:
    invoke.side_effect = RuntimeError("boom")

    with pytest.raises(InvokeBadRequestError, match="Rate limit exceeded, please try again later"):
        check_moderation("tenant-1", model_config, "hello")
