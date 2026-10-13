from collections.abc import Callable
from types import SimpleNamespace
from typing import Protocol, cast
from unittest.mock import Mock

import pytest
from flask import Flask
from pydantic import ValidationError

from controllers.openapi import model_providers
from controllers.openapi._models import CredentialWriteResponse, ModelCredentialCreatePayload, ModelListQuery, ModelRef
from controllers.openapi._search import matches
from controllers.openapi.auth.context import Context
from controllers.openapi.model_providers import (
    ModelCredentialsApi,
    _model_write_response,
    _provider_write_response,
    model_rows,
)
from core.entities.model_entities import ModelStatus, ModelWithProviderEntity, SimpleModelProviderEntity
from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.model_entities import FetchFrom, ModelPropertyKey, ModelType
from services.entities.model_provider_entities import ProviderResponse
from services.model_provider.service import ModelProviderService


def _model(
    name: str,
    *,
    provider: str = "langgenius/openai/openai",
    deprecated: bool = False,
    model_type: ModelType = ModelType.LLM,
    model_properties: dict[ModelPropertyKey, object] | None = None,
) -> ModelWithProviderEntity:
    data: dict[str, object] = {
        "model": name,
        "label": {"en_US": name.upper()},
        "model_type": model_type,
        "features": [],
        "fetch_from": FetchFrom.PREDEFINED_MODEL,
        "model_properties": model_properties or {},
        "deprecated": deprecated,
        "status": ModelStatus.ACTIVE,
        "load_balancing_enabled": False,
        "has_invalid_load_balancing_configs": False,
    }
    # The entity's __init__ takes a ProviderEntity; build the short form directly.
    simple = SimpleModelProviderEntity.model_construct(
        provider=provider, label=I18nObject(en_US="OpenAI"), supported_model_types=[ModelType.LLM]
    )
    return ModelWithProviderEntity.model_validate({**data, "provider": simple})


def test_rows_carry_their_provider() -> None:
    [row] = model_rows([_model("gpt-4o")], words="", language=None)
    assert (row.provider, row.provider_label, row.model, row.label) == (
        "langgenius/openai/openai",
        "OpenAI",
        "gpt-4o",
        "GPT-4O",
    )


def test_llm_rows_carry_the_node_model_block() -> None:
    model = _model("gpt-4o", model_properties={ModelPropertyKey.MODE: "chat"})
    [row] = model_rows([model], words="", language=None)
    assert row.node_model is not None
    assert row.node_model.model_dump() == {
        "provider": "langgenius/openai/openai",
        "name": "gpt-4o",
        "mode": "chat",
        "completion_params": {},
    }


def test_rows_without_a_node_model_when_not_llm_or_no_mode() -> None:
    embedding = _model("embed", model_type=ModelType.TEXT_EMBEDDING, model_properties={ModelPropertyKey.MODE: "chat"})
    no_mode = _model("plain")
    assert [r.node_model for r in model_rows([embedding, no_mode], words="", language=None)] == [None, None]


def test_deprecated_models_are_left_out() -> None:
    rows = model_rows([_model("gpt-4o"), _model("gpt-3", deprecated=True)], words="", language=None)
    assert [r.model for r in rows] == ["gpt-4o"]


def test_query_matches_model_label_or_provider() -> None:
    models = [_model("gpt-4o"), _model("claude", provider="langgenius/anthropic/anthropic")]
    assert [r.model for r in model_rows(models, words="anthropic", language=None)] == ["claude"]
    assert [r.model for r in model_rows(models, words="GPT", language=None)] == ["gpt-4o"]


def test_unknown_model_type_is_rejected() -> None:
    with pytest.raises(ValidationError):
        ModelListQuery.model_validate({"model_type": "video"})


def test_matches_ignores_case_and_none() -> None:
    assert matches("Git", None, "github")
    assert matches("", None)
    assert not matches("slack", "github", None)


def test_inactive_credential_hints_replace_active() -> None:
    configuration = SimpleNamespace(
        current_credential_id="active-id",
        available_credentials=[
            SimpleNamespace(credential_id="active-id", credential_name="main"),
            SimpleNamespace(credential_id="new-id", credential_name="spare"),
        ],
    )
    provider = SimpleNamespace(provider="langgenius/openai/openai", custom_configuration=configuration)
    response = _provider_write_response("ws", cast(ProviderResponse, provider), "new-id")
    [hint] = response.hints
    assert not response.active
    assert hint.op == "set.model_provider.credential"
    assert hint.input["credential_id"] == "active-id"


class _CreateView(Protocol):
    __handler__: Callable[..., tuple[CredentialWriteResponse, int]]


def _model_provider(*custom_models: SimpleNamespace) -> ProviderResponse:
    configuration = SimpleNamespace(custom_models=list(custom_models))
    return cast(ProviderResponse, SimpleNamespace(provider=_OLLAMA, custom_configuration=configuration))


def _custom(current: str | None) -> SimpleNamespace:
    return SimpleNamespace(
        model="llama3",
        model_type=ModelType.LLM,
        current_credential_id=current,
        available_model_credentials=[
            SimpleNamespace(credential_id="new-id", credential_name="spare"),
            SimpleNamespace(credential_id="other-id", credential_name="main"),
        ],
    )


_LLAMA = ModelRef(model="llama3", model_type=ModelType.LLM)
_OLLAMA = "langgenius/ollama/ollama"


def test_a_new_models_first_credential_reads_back_active() -> None:
    response = _model_write_response("ws", _model_provider(_custom("new-id")), _LLAMA, "new-id")
    assert (response.active, response.name, response.hints) == (True, "spare", [])


def test_a_credential_beside_an_active_one_hints_replacing_the_active_one() -> None:
    response = _model_write_response("ws", _model_provider(_custom("other-id")), _LLAMA, "new-id")
    [hint] = response.hints
    assert not response.active
    assert hint.op == "set.model.credential"
    assert hint.input["credential_id"] == "other-id"


@pytest.mark.parametrize(
    "provider", [_model_provider(_custom(None)), _model_provider()], ids=["none-active", "unknown"]
)
def test_nothing_active_reads_back_inactive_without_a_hint(provider: ProviderResponse) -> None:
    response = _model_write_response("ws", provider, _LLAMA, "new-id")
    assert (response.active, response.hints) == (False, [])


def test_creating_a_model_credential_never_switches_the_active_one(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    service = Mock(spec=ModelProviderService)
    service.create_model_credential.return_value = "new-id"
    monkeypatch.setattr(model_providers, "ModelProviderService", Mock(return_value=service))
    monkeypatch.setattr(model_providers, "_provider", lambda *_args: _model_provider(_custom("other-id")))
    body = ModelCredentialCreatePayload(model="llama3", model_type=ModelType.LLM, credentials={"base_url": "x"})
    ctx = cast(Context, SimpleNamespace(workspace=SimpleNamespace(id="ws")))

    api = ModelCredentialsApi()
    with app.test_request_context("/openapi/v1/workspaces/ws/model-providers/x/models/credentials", method="POST"):
        response, status = cast(_CreateView, api.post).__handler__(api, ctx, "ws", _OLLAMA, body=body)

    assert status == 201
    assert not response.active
    assert [call[0] for call in service.method_calls] == ["create_model_credential"]
