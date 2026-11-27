import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol, cast

import pytest
from flask import Flask
from pydantic import ValidationError
from sqlalchemy.orm import Session

from constants.oauth_bearer import TokenType
from controllers.common.fields import SimpleResultResponse
from controllers.openapi import model_providers
from controllers.openapi._errors import CredentialNotFound
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
    ModelProviderCredentialApi,
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
from tests.helpers.unit.model_factories import make_account, make_tenant


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


def _handler(view: Callable[..., object]) -> Callable[..., object]:
    """Return the bare view ``@endpoint`` attaches as ``__handler__``."""
    handler = vars(view).get("__handler__")
    assert callable(handler)
    return handler


def _visible(*_args: object, **_kwargs: object) -> list[CredentialConfiguration]:
    return [CredentialConfiguration(credential_id="cred-1", credential_name="main")]


def test_delete_removes_a_visible_credential(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    account_application_services: ApplicationServices,
) -> None:
    removed: list[tuple[str, str, str]] = []

    def remove(_self: ModelProviderService, *, tenant_id: str, provider: str, credential_id: str) -> None:
        removed.append((tenant_id, provider, credential_id))

    monkeypatch.setattr(ModelProviderService, "get_provider_available_credentials", _visible)
    monkeypatch.setattr(ModelProviderService, "remove_provider_credential", remove)
    monkeypatch.setattr(model_providers, "application_services", lambda: account_application_services)

    api = ModelProviderCredentialApi()
    with app.test_request_context(
        f"/openapi/v1/workspaces/ws/model-providers/{_OPENAI}/credentials/cred-1", method="DELETE"
    ):
        result = _handler(api.delete)(api, _context(sqlite_session), "ws", _OPENAI, "cred-1")

    assert result == SimpleResultResponse(result="success")
    assert removed == [("ws", _OPENAI, "cred-1")]


def test_delete_answers_404_for_a_credential_the_list_does_not_show(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    account_application_services: ApplicationServices,
) -> None:
    removed: list[object] = []

    def remove(*_args: object, **_kwargs: object) -> None:
        removed.append(None)

    monkeypatch.setattr(ModelProviderService, "get_provider_available_credentials", lambda *_a, **_k: [])
    monkeypatch.setattr(ModelProviderService, "remove_provider_credential", remove)
    monkeypatch.setattr(model_providers, "application_services", lambda: account_application_services)

    api = ModelProviderCredentialApi()
    with (
        app.test_request_context(
            f"/openapi/v1/workspaces/ws/model-providers/{_OPENAI}/credentials/missing", method="DELETE"
        ),
        pytest.raises(CredentialNotFound),
    ):
        _handler(api.delete)(api, _context(sqlite_session), "ws", _OPENAI, "missing")

    assert removed == []


# --- Phase-two endpoints: model credential delete/activate, model delete,
# default models, and model settings (enable + load balancing). ---

from controllers.openapi._errors import ModelNotFound, ProviderNotFound  # noqa: E402
from controllers.openapi._models import (  # noqa: E402
    DefaultModelResponse,
    LoadBalancingEntryPayload,
    LoadBalancingPayload,
    ModelRefQuery,
    ModelSettingsPutPayload,
    ModelSettingsQuery,
    ModelSettingsResponse,
)
from controllers.openapi.model_providers import (  # noqa: E402
    DefaultModelApi,
    ModelCredentialActivateApi,
    ModelCredentialApi,
    ModelProviderCredentialActivateApi,
    ModelSettingsApi,
    ProviderModelsApi,
    _lb_config_dicts,
)
from services.entities.model_provider_entities import DefaultModelResponse as ServiceDefaultModelResponse  # noqa: E402
from services.entities.model_provider_entities import SimpleProviderEntityResponse  # noqa: E402
from services.model_load_balancing_service import LoadBalancingConfigSummaryDict, ModelLoadBalancingService  # noqa: E402


def _ref_query() -> ModelRefQuery:
    return ModelRefQuery(model="llama3", model_type=ModelType.LLM)


def _settings_query() -> ModelSettingsQuery:
    return ModelSettingsQuery(model="llama3", model_type=ModelType.LLM, config_from="custom-model")


def test_model_credential_delete_removes_a_visible_credential(
    app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    removed: list[dict[str, str]] = []
    monkeypatch.setattr(ModelProviderService, "get_provider_model_available_credentials", lambda *_a, **_k: _visible())
    monkeypatch.setattr(ModelProviderService, "remove_model_credential", lambda _self, **kwargs: removed.append(kwargs))

    api = ModelCredentialApi()
    with app.test_request_context(
        f"/openapi/v1/workspaces/ws/model-providers/{_OPENAI}/models/credentials/cred-1", method="DELETE"
    ):
        result = _handler(api.delete)(api, _context(sqlite_session), "ws", _OPENAI, "cred-1", query=_ref_query())

    assert result == SimpleResultResponse(result="success")
    assert removed == [
        {
            "tenant_id": "ws",
            "provider": _OPENAI,
            "model_type": "llm",
            "model": "llama3",
            "credential_id": "cred-1",
        }
    ]


def test_model_credential_delete_answers_404_for_an_unknown_id(
    app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    monkeypatch.setattr(ModelProviderService, "get_provider_model_available_credentials", lambda *_a, **_k: [])
    monkeypatch.setattr(ModelProviderService, "remove_model_credential", lambda *_a, **_k: None)

    api = ModelCredentialApi()
    with (
        app.test_request_context(
            f"/openapi/v1/workspaces/ws/model-providers/{_OPENAI}/models/credentials/missing", method="DELETE"
        ),
        pytest.raises(CredentialNotFound),
    ):
        _handler(api.delete)(api, _context(sqlite_session), "ws", _OPENAI, "missing", query=_ref_query())


def test_model_credential_delete_rejects_an_extra_query_parameter() -> None:
    with pytest.raises(ValidationError):
        ModelRefQuery.model_validate({"model": "m", "model_type": "llm", "surprise": "x"})


def test_provider_credential_activate_switches_a_visible_credential(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    account_application_services: ApplicationServices,
) -> None:
    switched: list[dict[str, str]] = []
    monkeypatch.setattr(ModelProviderService, "get_provider_available_credentials", lambda *_a, **_k: _visible())
    monkeypatch.setattr(
        ModelProviderService, "switch_active_provider_credential", lambda _self, **kwargs: switched.append(kwargs)
    )
    monkeypatch.setattr(model_providers, "application_services", lambda: account_application_services)
    monkeypatch.setattr(model_providers, "_provider", lambda *_a: _model_provider())

    api = ModelProviderCredentialActivateApi()
    with app.test_request_context(
        f"/openapi/v1/workspaces/ws/model-providers/{_OPENAI}/credentials/cred-1:activate", method="POST"
    ):
        response = _handler(api.post)(api, _context(sqlite_session), "ws", _OPENAI, "cred-1")

    assert isinstance(response, CredentialWriteResponse)
    assert switched == [{"tenant_id": "ws", "provider": _OPENAI, "credential_id": "cred-1"}]


def test_provider_credential_activate_answers_404_for_an_unknown_id(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    account_application_services: ApplicationServices,
) -> None:
    monkeypatch.setattr(ModelProviderService, "get_provider_available_credentials", lambda *_a, **_k: [])
    monkeypatch.setattr(model_providers, "application_services", lambda: account_application_services)

    api = ModelProviderCredentialActivateApi()
    with (
        app.test_request_context(
            f"/openapi/v1/workspaces/ws/model-providers/{_OPENAI}/credentials/missing:activate", method="POST"
        ),
        pytest.raises(CredentialNotFound),
    ):
        _handler(api.post)(api, _context(sqlite_session), "ws", _OPENAI, "missing")


def test_model_credential_activate_switches_a_visible_credential(
    app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    switched: list[dict[str, str]] = []
    monkeypatch.setattr(ModelProviderService, "get_provider_model_available_credentials", lambda *_a, **_k: _visible())
    monkeypatch.setattr(
        ModelProviderService,
        "switch_active_custom_model_credential",
        lambda _self, **kwargs: switched.append(kwargs),
    )
    monkeypatch.setattr(model_providers, "_provider", lambda *_a: _model_provider(_custom("cred-1")))

    api = ModelCredentialActivateApi()
    with app.test_request_context(
        f"/openapi/v1/workspaces/ws/model-providers/{_OPENAI}/models/credentials/cred-1:activate", method="POST"
    ):
        response = _handler(api.post)(api, _context(sqlite_session), "ws", _OPENAI, "cred-1", body=_LLAMA)

    assert isinstance(response, CredentialWriteResponse)
    assert switched == [
        {
            "tenant_id": "ws",
            "provider": _OPENAI,
            "model_type": "llm",
            "model": "llama3",
            "credential_id": "cred-1",
        }
    ]


def test_model_credential_activate_answers_404_for_an_unknown_id(
    app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    monkeypatch.setattr(ModelProviderService, "get_provider_model_available_credentials", lambda *_a, **_k: [])

    api = ModelCredentialActivateApi()
    with (
        app.test_request_context(
            f"/openapi/v1/workspaces/ws/model-providers/{_OPENAI}/models/credentials/missing:activate",
            method="POST",
        ),
        pytest.raises(CredentialNotFound),
    ):
        _handler(api.post)(api, _context(sqlite_session), "ws", _OPENAI, "missing", body=_LLAMA)


def test_model_delete_removes_a_custom_model(
    app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    removed: list[dict[str, str]] = []
    monkeypatch.setattr(model_providers, "_provider", lambda *_a: _model_provider(_custom("cred-1")))
    monkeypatch.setattr(ModelProviderService, "remove_model", lambda _self, **kwargs: removed.append(kwargs))

    api = ProviderModelsApi()
    with app.test_request_context(f"/openapi/v1/workspaces/ws/model-providers/{_OLLAMA}/models", method="DELETE"):
        result = _handler(api.delete)(api, _context(sqlite_session), "ws", _OLLAMA, query=_ref_query())

    assert result == SimpleResultResponse(result="success")
    assert removed == [{"tenant_id": "ws", "provider": _OLLAMA, "model_type": "llm", "model": "llama3"}]


def test_model_delete_answers_404_for_a_model_the_provider_does_not_list(
    app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    monkeypatch.setattr(model_providers, "_provider", lambda *_a: _model_provider())
    monkeypatch.setattr(ModelProviderService, "remove_model", lambda *_a, **_k: None)

    api = ProviderModelsApi()
    with (
        app.test_request_context(f"/openapi/v1/workspaces/ws/model-providers/{_OLLAMA}/models", method="DELETE"),
        pytest.raises(ModelNotFound),
    ):
        _handler(api.delete)(api, _context(sqlite_session), "ws", _OLLAMA, query=_ref_query())


def _default_entity() -> ServiceDefaultModelResponse:
    return ServiceDefaultModelResponse.model_construct(
        model="gpt-4o",
        model_type=ModelType.LLM,
        provider=SimpleProviderEntityResponse.model_construct(
            tenant_id="ws",
            provider=_OPENAI,
            label=I18nObject(en_US="OpenAI"),
            icon_small=None,
            supported_model_types=[ModelType.LLM],
        ),
    )


def test_default_model_describe_reads_the_saved_default(
    app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    monkeypatch.setattr(
        ModelProviderService, "get_default_model_of_model_type", lambda _self, *_a, **_k: _default_entity()
    )

    api = DefaultModelApi()
    with app.test_request_context("/openapi/v1/workspaces/ws/default-models/llm"):
        response = _handler(api.get)(api, _context(sqlite_session), "ws", "llm")

    assert response == DefaultModelResponse(model_type="llm", provider=_OPENAI, model="gpt-4o")


def test_default_model_describe_answers_nulls_while_unset(
    app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    monkeypatch.setattr(ModelProviderService, "get_default_model_of_model_type", lambda *_a, **_k: None)

    api = DefaultModelApi()
    with app.test_request_context("/openapi/v1/workspaces/ws/default-models/llm"):
        response = _handler(api.get)(api, _context(sqlite_session), "ws", "llm")

    assert response == DefaultModelResponse(model_type="llm", provider=None, model=None)


def test_default_model_set_updates_and_echoes_the_default(
    app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    updated: list[dict[str, str]] = []
    monkeypatch.setattr(
        ModelProviderService, "update_default_model_of_model_type", lambda _self, **k: updated.append(k)
    )

    api = DefaultModelApi()
    with app.test_request_context("/openapi/v1/workspaces/ws/default-models/llm", method="PUT"):
        response = _handler(api.put)(
            api,
            _context(sqlite_session),
            "ws",
            "llm",
            body=model_providers.DefaultModelPayload(provider=_OPENAI, model="gpt-4o"),
        )

    assert response == DefaultModelResponse(model_type="llm", provider=_OPENAI, model="gpt-4o")
    assert updated == [{"tenant_id": "ws", "model_type": "llm", "provider": _OPENAI, "model": "gpt-4o"}]


def test_an_unknown_default_model_type_answers_422(app: Flask, sqlite_session: Session) -> None:
    from werkzeug.exceptions import UnprocessableEntity

    api = DefaultModelApi()
    with (
        app.test_request_context("/openapi/v1/workspaces/ws/default-models/video"),
        pytest.raises(UnprocessableEntity),
    ):
        _handler(api.get)(api, _context(sqlite_session), "ws", "video")


@dataclass
class _FakeSetting:
    enabled: bool


@dataclass
class _FakeConfiguration:
    _setting: _FakeSetting | None

    def get_provider_model_setting(self, *, model_type: object, model: str) -> _FakeSetting | None:  # noqa: ARG002
        return self._setting


_LB_ROWS: list[LoadBalancingConfigSummaryDict] = [
    {
        "id": "inherit-id",
        "name": "__inherit__",
        "credentials": {"api_key": "s3cr3t"},
        "credential_id": None,
        "enabled": True,
        "in_cooldown": False,
        "ttl": 0,
    },
    {
        "id": "row-2",
        "name": "spare",
        "credentials": {"api_key": "other-secret"},
        "credential_id": "cred-2",
        "enabled": False,
        "in_cooldown": False,
        "ttl": 0,
    },
]


def _stub_balancing(
    monkeypatch: pytest.MonkeyPatch, rows: list[LoadBalancingConfigSummaryDict] | None = None
) -> list[dict[str, object]]:
    calls: list[dict[str, object]] = []
    monkeypatch.setattr(
        ModelLoadBalancingService,
        "get_load_balancing_configs",
        lambda _self, **_kwargs: (True, rows if rows is not None else list(_LB_ROWS)),
    )
    monkeypatch.setattr(
        ModelLoadBalancingService,
        "update_load_balancing_configs",
        lambda _self, **kwargs: calls.append(kwargs),
    )
    monkeypatch.setattr(ModelLoadBalancingService, "enable_model_load_balancing", lambda *_a, **_k: None)
    monkeypatch.setattr(ModelLoadBalancingService, "disable_model_load_balancing", lambda *_a, **_k: None)
    return calls


def test_model_settings_describe_reports_enabled_and_never_credentials(
    app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    monkeypatch.setattr(
        model_providers, "_provider_configuration", lambda *_a: _FakeConfiguration(_FakeSetting(enabled=False))
    )
    _stub_balancing(monkeypatch)

    api = ModelSettingsApi()
    with app.test_request_context(f"/openapi/v1/workspaces/ws/model-providers/{_OPENAI}/models/settings"):
        response = _handler(api.get)(api, _context(sqlite_session), "ws", _OPENAI, query=_settings_query())

    assert isinstance(response, ModelSettingsResponse)
    assert response.enabled is False
    assert response.load_balancing.enabled is True
    assert [(e.id, e.inherit) for e in response.load_balancing.entries] == [("inherit-id", True), ("row-2", False)]
    dumped = response.model_dump(mode="json")
    assert "credentials" not in dumped["load_balancing"]["entries"][0]
    assert "s3cr3t" not in str(dumped)


def test_model_settings_describe_defaults_to_enabled_without_a_setting_row(
    app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    monkeypatch.setattr(model_providers, "_provider_configuration", lambda *_a: _FakeConfiguration(None))
    _stub_balancing(monkeypatch, rows=[])

    api = ModelSettingsApi()
    with app.test_request_context(f"/openapi/v1/workspaces/ws/model-providers/{_OPENAI}/models/settings"):
        response = _handler(api.get)(api, _context(sqlite_session), "ws", _OPENAI, query=_settings_query())

    assert isinstance(response, ModelSettingsResponse)
    assert response.enabled is True


def test_model_settings_describe_answers_404_for_an_unknown_provider(
    app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    def missing(*_a: object) -> object:
        raise ProviderNotFound()

    monkeypatch.setattr(model_providers, "_provider_configuration", missing)

    api = ModelSettingsApi()
    with (
        app.test_request_context("/openapi/v1/workspaces/ws/model-providers/none/models/settings"),
        pytest.raises(ProviderNotFound),
    ):
        _handler(api.get)(api, _context(sqlite_session), "ws", "none", query=_settings_query())


def test_lb_config_dicts_reuse_existing_ids_and_the_inherit_row() -> None:
    desired = [
        LoadBalancingEntryPayload(credential_id=None, enabled=False),
        LoadBalancingEntryPayload(credential_id="cred-2", enabled=True),
        LoadBalancingEntryPayload(credential_id="cred-3", enabled=True),
    ]
    configs = _lb_config_dicts(list(_LB_ROWS), desired)

    assert configs == [
        {"id": "inherit-id", "name": "__inherit__", "enabled": False},
        {"id": "row-2", "name": "spare", "credential_id": "cred-2", "enabled": True},
        {"name": "cred-3", "credential_id": "cred-3", "enabled": True},
    ]


def test_model_settings_payload_rejects_duplicate_credentials() -> None:
    with pytest.raises(ValidationError):
        ModelSettingsPutPayload.model_validate(
            {
                "model": "llama3",
                "model_type": "llm",
                "config_from": "custom-model",
                "enabled": True,
                "load_balancing": {
                    "enabled": True,
                    "entries": [{"credential_id": "c1", "enabled": True}, {"credential_id": "c1", "enabled": True}],
                },
            }
        )
    with pytest.raises(ValidationError):
        ModelSettingsPutPayload.model_validate(
            {
                "model": "llama3",
                "model_type": "llm",
                "config_from": "custom-model",
                "enabled": True,
                "load_balancing": {
                    "enabled": True,
                    "entries": [{"credential_id": None, "enabled": True}, {"credential_id": None, "enabled": True}],
                },
            }
        )


def test_model_settings_put_translates_entries_and_replaces_the_whole_list(
    app: Flask, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    calls = _stub_balancing(monkeypatch)
    enabled_models: list[dict[str, object]] = []
    monkeypatch.setattr(model_providers, "_provider_configuration", lambda *_a: _FakeConfiguration(None))
    monkeypatch.setattr(ModelProviderService, "enable_model", lambda _self, **k: enabled_models.append(k))
    monkeypatch.setattr(ModelProviderService, "disable_model", lambda *_a, **_k: None)

    body = ModelSettingsPutPayload(
        model="llama3",
        model_type=ModelType.LLM,
        config_from="custom-model",
        enabled=True,
        load_balancing=LoadBalancingPayload(
            enabled=True,
            entries=[
                LoadBalancingEntryPayload(credential_id=None, enabled=True),
                LoadBalancingEntryPayload(credential_id="cred-3", enabled=True),
            ],
        ),
    )

    api = ModelSettingsApi()
    with app.test_request_context(f"/openapi/v1/workspaces/ws/model-providers/{_OPENAI}/models/settings", method="PUT"):
        response = _handler(api.put)(api, _context(sqlite_session), "ws", _OPENAI, body=body)

    assert isinstance(response, ModelSettingsResponse)
    # cred-2's row is absent from the desired list, so the service deletes it;
    # the inherit row keeps its existing id and cred-3 becomes a new entry.
    [update] = calls
    assert update["configs"] == [
        {"id": "inherit-id", "name": "__inherit__", "enabled": True},
        {"name": "cred-3", "credential_id": "cred-3", "enabled": True},
    ]
    assert enabled_models == [{"tenant_id": "ws", "provider": _OPENAI, "model": "llama3", "model_type": "llm"}]
