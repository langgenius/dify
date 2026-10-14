import uuid
from collections.abc import Callable
from typing import Protocol, cast

import pytest
from flask import Flask
from pydantic import ValidationError
from sqlalchemy.orm import Session

from constants.oauth_bearer import TokenType
from controllers.openapi import model_providers
from controllers.openapi._models import (
    CredentialWriteResponse,
    ModelCredentialCreatePayload,
    ModelListQuery,
    ModelProviderDetailResponse,
    ModelRef,
)
from controllers.openapi._search import matches
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.subjects import AccountSubject
from controllers.openapi.model_providers import (
    ModelCredentialsApi,
    ModelProviderApi,
    _model_write_response,
    _provider_write_response,
    model_rows,
)
from core.entities.model_entities import ModelStatus, ModelWithProviderEntity, SimpleModelProviderEntity
from core.entities.provider_entities import CredentialConfiguration, CustomModelConfiguration
from extensions.ext_application_services import ApplicationServices
from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.model_entities import FetchFrom, ModelPropertyKey, ModelType
from graphon.model_runtime.entities.provider_entities import (
    ConfigurateMethod,
    CredentialFormSchema,
    FormType,
    ProviderCredentialSchema,
)
from libs.oauth_bearer import AuthContext
from services.entities.model_provider_entities import (
    CustomConfigurationResponse,
    CustomConfigurationStatus,
    ProviderResponse,
    ProviderType,
    SystemConfigurationResponse,
)
from services.model_provider.service import ModelProviderService
from tests.unit_tests.model_factories import make_account, make_tenant


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


def _provider_response(
    provider: str,
    configuration: CustomConfigurationResponse,
    schema: ProviderCredentialSchema | None = None,
) -> ProviderResponse:
    return ProviderResponse(
        tenant_id="ws",
        provider=provider,
        label=I18nObject(en_US=provider),
        supported_model_types=[ModelType.LLM],
        configurate_methods=[ConfigurateMethod.PREDEFINED_MODEL],
        provider_credential_schema=schema,
        preferred_provider_type=ProviderType.CUSTOM,
        custom_configuration=configuration,
        system_configuration=SystemConfigurationResponse(enabled=False),
    )


def _context(session: Session) -> Context:
    subject = AccountSubject(
        AuthContext(
            subject_email="caller@example.com",
            subject_issuer="dify:account",
            account_id=uuid.uuid4(),
            client_id="difyctl",
            token_id=uuid.uuid4(),
            token_type=TokenType.OAUTH_ACCOUNT,
            expires_at=None,
        )
    )
    ctx = Context(subject, session, {"workspace_id": "ws"})
    ctx._workspace = make_tenant(tenant_id="ws")
    ctx._caller = make_account(interface_language="en-US")
    return ctx


def test_inactive_credential_hints_replace_active() -> None:
    configuration = CustomConfigurationResponse(
        status=CustomConfigurationStatus.ACTIVE,
        current_credential_id="active-id",
        available_credentials=[
            CredentialConfiguration(credential_id="active-id", credential_name="main"),
            CredentialConfiguration(credential_id="new-id", credential_name="spare"),
        ],
    )
    provider = _provider_response("langgenius/openai/openai", configuration)
    response = _provider_write_response("ws", provider, "new-id")
    [hint] = response.hints
    assert not response.active
    assert hint.op == "set.model_provider.credential"
    assert hint.input["credential_id"] == "active-id"


class _CreateView(Protocol):
    __handler__: Callable[..., tuple[CredentialWriteResponse, int]]


def _model_provider(*custom_models: CustomModelConfiguration) -> ProviderResponse:
    configuration = CustomConfigurationResponse(
        status=CustomConfigurationStatus.ACTIVE, custom_models=list(custom_models)
    )
    return _provider_response(_OLLAMA, configuration)


def _custom(current: str | None) -> CustomModelConfiguration:
    return CustomModelConfiguration(
        model="llama3",
        model_type=ModelType.LLM,
        credentials=None,
        current_credential_id=current,
        available_model_credentials=[
            CredentialConfiguration(credential_id="new-id", credential_name="spare"),
            CredentialConfiguration(credential_id="other-id", credential_name="main"),
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


def test_creating_a_model_credential_never_switches_the_active_one(
    app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    writes: list[str] = []

    def create_model_credential(_self: ModelProviderService, **_kwargs: object) -> str:
        writes.append("create_model_credential")
        return "new-id"

    def recorded(name: str) -> Callable[..., None]:
        return lambda *_args, **_kwargs: writes.append(name)

    monkeypatch.setattr(ModelProviderService, "create_model_credential", create_model_credential)
    for switch in (
        "switch_active_custom_model_credential",
        "switch_active_provider_credential",
        "add_model_credential_to_model_list",
    ):
        monkeypatch.setattr(ModelProviderService, switch, recorded(switch))
    monkeypatch.setattr(model_providers, "_provider", lambda *_args: _model_provider(_custom("other-id")))
    body = ModelCredentialCreatePayload(model="llama3", model_type=ModelType.LLM, credentials={"base_url": "x"})

    api = ModelCredentialsApi()
    with app.test_request_context("/openapi/v1/workspaces/ws/model-providers/x/models/credentials", method="POST"):
        response, status = cast(_CreateView, api.post).__handler__(
            api, _context(sqlite_session), "ws", _OLLAMA, body=body
        )

    assert status == 201
    assert not response.active
    assert writes == ["create_model_credential"]


class _DescribeView(Protocol):
    __handler__: Callable[..., ModelProviderDetailResponse]


def _describable_provider(status: CustomConfigurationStatus) -> ProviderResponse:
    schema = ProviderCredentialSchema(
        credential_form_schemas=[
            CredentialFormSchema(variable="api_key", label=I18nObject(en_US="API Key"), type=FormType.SECRET_INPUT)
        ]
    )
    return _provider_response(_OPENAI, CustomConfigurationResponse(status=status), schema)


_OPENAI = "langgenius/openai/openai"
_ASK_SUMMARY = "Ask the user for these values, then save them"


@pytest.mark.parametrize(
    ("status", "visible", "asks"),
    [
        (CustomConfigurationStatus.ACTIVE, [], False),
        (
            CustomConfigurationStatus.ACTIVE,
            [CredentialConfiguration(credential_id="c1", credential_name="main")],
            False,
        ),
        (CustomConfigurationStatus.NO_CONFIGURE, [], True),
    ],
    ids=["active-via-a-credential-the-caller-cannot-see", "active-and-visible", "not-configured"],
)
def test_describe_asks_for_credentials_only_while_the_provider_is_not_configured(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    account_application_services: ApplicationServices,
    status: CustomConfigurationStatus,
    visible: list[CredentialConfiguration],
    asks: bool,
) -> None:
    monkeypatch.setattr(ModelProviderService, "get_provider_available_credentials", lambda *_args, **_kwargs: visible)
    monkeypatch.setattr(model_providers, "_provider", lambda *_args: _describable_provider(status))
    monkeypatch.setattr(model_providers, "application_services", lambda: account_application_services)

    api = ModelProviderApi()
    with app.test_request_context(f"/openapi/v1/workspaces/ws/model-providers/{_OPENAI}"):
        response = cast(_DescribeView, api.get).__handler__(api, _context(sqlite_session), "ws", _OPENAI)

    assert (_ASK_SUMMARY in [hint.summary for hint in response.hints]) is asks
    assert response.configured is (status == CustomConfigurationStatus.ACTIVE)
