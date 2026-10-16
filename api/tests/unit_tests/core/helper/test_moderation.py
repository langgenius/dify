from types import SimpleNamespace
from typing import cast

import pytest
from pytest_mock import MockerFixture

from core.app.entities.app_invoke_entities import ModelConfigWithCredentialsEntity
from core.helper.moderation import check_moderation
from core.plugin.entities.plugin import PluginInstallationSource
from core.plugin.entities.plugin_daemon import PluginModelProviderDeclaration
from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.model_entities import ModelType
from graphon.model_runtime.entities.provider_entities import ConfigurateMethod
from graphon.model_runtime.errors.invoke import InvokeAuthorizationError, InvokeBadRequestError
from models.provider import ProviderType


@pytest.fixture
def provider_declaration(mocker: MockerFixture) -> PluginModelProviderDeclaration:
    mocker.patch("core.helper.moderation.PluginService.is_plugin_verified", return_value=True)
    return PluginModelProviderDeclaration(
        provider="langgenius/openai/openai",
        plugin_unique_identifier="langgenius/openai:1.0.0@checksum",
        installation_source=PluginInstallationSource.Marketplace,
        label=I18nObject(en_US="OpenAI"),
        supported_model_types=[ModelType.MODERATION],
        configurate_methods=[ConfigurateMethod.PREDEFINED_MODEL],
    )


def _build_model_config(provider: str = "openai") -> SimpleNamespace:
    return SimpleNamespace(
        provider=provider,
        provider_model_bundle=SimpleNamespace(
            configuration=SimpleNamespace(using_provider_type=ProviderType.SYSTEM),
        ),
    )


def test_check_moderation_returns_false_when_feature_not_enabled(mocker: MockerFixture) -> None:
    mocker.patch(
        "core.helper.moderation.hosting_configuration",
        SimpleNamespace(moderation_config=None, provider_map={}),
    )

    assert (
        check_moderation(
            "tenant-1",
            cast(ModelConfigWithCredentialsEntity, _build_model_config()),
            "hello",
        )
        is False
    )


def test_check_moderation_returns_false_when_hosting_credentials_missing(mocker: MockerFixture) -> None:
    openai_provider = "langgenius/openai/openai"
    mocker.patch(
        "core.helper.moderation.hosting_configuration",
        SimpleNamespace(
            moderation_config=SimpleNamespace(enabled=True, providers={"openai"}),
            provider_map={openai_provider: SimpleNamespace(enabled=True, credentials=None)},
        ),
    )

    assert (
        check_moderation(
            "tenant-1",
            cast(ModelConfigWithCredentialsEntity, _build_model_config()),
            "hello",
        )
        is False
    )


def test_check_moderation_returns_true_when_model_accepts_text(
    mocker: MockerFixture, provider_declaration: PluginModelProviderDeclaration
) -> None:
    openai_provider = "langgenius/openai/openai"
    hosting_openai = SimpleNamespace(enabled=True, credentials={"api_key": "k"})
    mocker.patch(
        "core.helper.moderation.hosting_configuration",
        SimpleNamespace(
            moderation_config=SimpleNamespace(enabled=True, providers={"openai"}),
            provider_map={openai_provider: hosting_openai},
        ),
    )
    mocker.patch("core.helper.moderation.secrets.choice", return_value="chunk")

    moderation_model = SimpleNamespace(
        provider_schema=provider_declaration, invoke=lambda **invoke_kwargs: invoke_kwargs["text"] == "chunk"
    )
    assembly = SimpleNamespace(create_model_type_instance=lambda **_factory_kwargs: moderation_model)
    mocker.patch("core.helper.moderation.create_plugin_model_assembly", return_value=assembly)

    assert (
        check_moderation(
            "tenant-1",
            cast(ModelConfigWithCredentialsEntity, _build_model_config()),
            "abc",
        )
        is True
    )


def test_check_moderation_returns_true_when_text_is_empty(mocker: MockerFixture) -> None:
    openai_provider = "langgenius/openai/openai"
    hosting_openai = SimpleNamespace(enabled=True, credentials={"api_key": "k"})
    mocker.patch(
        "core.helper.moderation.hosting_configuration",
        SimpleNamespace(
            moderation_config=SimpleNamespace(enabled=True, providers={"openai"}),
            provider_map={openai_provider: hosting_openai},
        ),
    )
    factory_mock = mocker.patch("core.helper.moderation.create_plugin_model_assembly")
    choice_mock = mocker.patch("core.helper.moderation.secrets.choice")

    assert (
        check_moderation(
            "tenant-1",
            cast(ModelConfigWithCredentialsEntity, _build_model_config()),
            "",
        )
        is True
    )
    factory_mock.assert_not_called()
    choice_mock.assert_not_called()


def test_check_moderation_returns_false_when_model_rejects_text(
    mocker: MockerFixture, provider_declaration: PluginModelProviderDeclaration
) -> None:
    openai_provider = "langgenius/openai/openai"
    hosting_openai = SimpleNamespace(enabled=True, credentials={"api_key": "k"})
    mocker.patch(
        "core.helper.moderation.hosting_configuration",
        SimpleNamespace(
            moderation_config=SimpleNamespace(enabled=True, providers={"openai"}),
            provider_map={openai_provider: hosting_openai},
        ),
    )
    mocker.patch("core.helper.moderation.secrets.choice", return_value="chunk")

    moderation_model = SimpleNamespace(provider_schema=provider_declaration, invoke=lambda **_invoke_kwargs: False)
    assembly = SimpleNamespace(create_model_type_instance=lambda **_factory_kwargs: moderation_model)
    mocker.patch("core.helper.moderation.create_plugin_model_assembly", return_value=assembly)

    assert (
        check_moderation(
            "tenant-1",
            cast(ModelConfigWithCredentialsEntity, _build_model_config()),
            "abc",
        )
        is False
    )


def test_check_moderation_raises_bad_request_when_provider_call_fails(
    mocker: MockerFixture, provider_declaration: PluginModelProviderDeclaration
) -> None:
    openai_provider = "langgenius/openai/openai"
    hosting_openai = SimpleNamespace(enabled=True, credentials={"api_key": "k"})
    mocker.patch(
        "core.helper.moderation.hosting_configuration",
        SimpleNamespace(
            moderation_config=SimpleNamespace(enabled=True, providers={"openai"}),
            provider_map={openai_provider: hosting_openai},
        ),
    )
    mocker.patch("core.helper.moderation.secrets.choice", return_value="chunk")

    failing_model = SimpleNamespace(
        provider_schema=provider_declaration,
        invoke=lambda **_invoke_kwargs: (_ for _ in ()).throw(RuntimeError("boom")),
    )
    assembly = SimpleNamespace(create_model_type_instance=lambda **_factory_kwargs: failing_model)
    mocker.patch("core.helper.moderation.create_plugin_model_assembly", return_value=assembly)

    with pytest.raises(InvokeBadRequestError, match="Rate limit exceeded, please try again later."):
        check_moderation(
            "tenant-1",
            cast(ModelConfigWithCredentialsEntity, _build_model_config()),
            "abc",
        )


@pytest.mark.parametrize(
    "case",
    ["trusted", "package", "github", "remote", "missing_source", "unverified", "verification_error", "invalid_schema"],
)
def test_hosted_credentials_require_trusted_moderation_plugin(
    mocker: MockerFixture, provider_declaration: PluginModelProviderDeclaration, case: str
) -> None:
    anthropic = "langgenius/anthropic/anthropic"
    mocker.patch(
        "core.helper.moderation.hosting_configuration",
        SimpleNamespace(
            moderation_config=SimpleNamespace(enabled=True, providers=[anthropic]),
            provider_map={
                "langgenius/openai/openai": SimpleNamespace(enabled=True, credentials={"api_key": "fake-hosted-key"})
            },
        ),
    )
    model = SimpleNamespace(provider_schema=provider_declaration, invoke=mocker.Mock(return_value=False))
    factory = mocker.Mock(return_value=model)
    mocker.patch(
        "core.helper.moderation.create_plugin_model_assembly",
        return_value=SimpleNamespace(create_model_type_instance=factory),
    )
    verified = mocker.patch("core.helper.moderation.PluginService.is_plugin_verified", return_value=True)
    if case in {"package", "github", "remote"}:
        provider_declaration.installation_source = PluginInstallationSource(case)
    elif case == "missing_source":
        provider_declaration.installation_source = None
    elif case == "unverified":
        verified.return_value = False
    elif case == "verification_error":
        verified.side_effect = RuntimeError("private daemon detail")
    elif case == "invalid_schema":
        model.provider_schema = {"provider": provider_declaration.provider}

    model_config = cast(ModelConfigWithCredentialsEntity, _build_model_config(anthropic))
    if case == "trusted":
        assert check_moderation("tenant-1", model_config, "hello") is False
        verified.assert_called_once_with("tenant-1", provider_declaration.plugin_unique_identifier)
        model.invoke.assert_called_once_with(
            model="omni-moderation-latest", credentials={"api_key": "fake-hosted-key"}, text="hello"
        )
    else:
        with pytest.raises(InvokeAuthorizationError, match="^Untrusted hosted moderation provider\\.$"):
            check_moderation("tenant-1", model_config, "hello")
        model.invoke.assert_not_called()


def test_hosted_provider_outside_moderation_allowlist_does_not_trigger(mocker: MockerFixture) -> None:
    mocker.patch(
        "core.helper.moderation.hosting_configuration",
        SimpleNamespace(
            moderation_config=SimpleNamespace(enabled=True, providers=["langgenius/openai/openai"]),
            provider_map={
                "langgenius/openai/openai": SimpleNamespace(enabled=True, credentials={"api_key": "fake-hosted-key"})
            },
        ),
    )
    factory = mocker.patch("core.helper.moderation.create_plugin_model_assembly")

    assert (
        check_moderation(
            "tenant-1",
            cast(ModelConfigWithCredentialsEntity, _build_model_config("langgenius/anthropic/anthropic")),
            "hello",
        )
        is False
    )
    factory.assert_not_called()
