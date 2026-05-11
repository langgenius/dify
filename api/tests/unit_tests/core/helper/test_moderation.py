from types import SimpleNamespace
from typing import cast

import pytest
from pytest_mock import MockerFixture

from core.app.entities.app_invoke_entities import ModelConfigWithCredentialsEntity
from core.helper.moderation import check_moderation
from graphon.model_runtime.errors.invoke import InvokeBadRequestError
from models.provider import ProviderType


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


def test_check_moderation_returns_true_when_model_accepts_text(mocker: MockerFixture) -> None:
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

    moderation_model = SimpleNamespace(invoke=lambda **invoke_kwargs: invoke_kwargs["text"] == "chunk")
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


def test_check_moderation_returns_false_when_model_rejects_text(mocker: MockerFixture) -> None:
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

    moderation_model = SimpleNamespace(invoke=lambda **_invoke_kwargs: False)
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


def test_check_moderation_raises_bad_request_when_provider_call_fails(mocker: MockerFixture) -> None:
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
