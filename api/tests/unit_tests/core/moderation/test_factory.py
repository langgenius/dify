from collections.abc import Iterator

import pytest
from flask import Flask
from pydantic import JsonValue, ValidationError
from sqlalchemy import Engine, event
from sqlalchemy.orm import Session, sessionmaker

from core.extension.extensible import ExtensionModule
from core.moderation.base import ModerationAction, ModerationInputsResult, ModerationOutputsResult
from core.moderation.factory import API_MODERATION_EXTENSION_KEY, APIModerationCallbacks, ModerationFactory
from domain.moderation.api_config import APIModerationConfig
from extensions.ext_code_based_extension import code_based_extension
from models.agent_config_entities import AgentModerationIOConfig, AgentModerationProviderConfig
from models.api_based_extension import APIBasedExtension
from repositories.api_based_extension_repository import APIBasedExtensionRepository
from services.api_moderation_service import (
    APIModerationService,
    ModerationInputParams,
    ModerationOutputParams,
)

_TENANT_ID = "a0000000-0000-0000-0000-000000000004"
_EXTENSION_ID = "a0000000-0000-0000-0000-000000000001"


class _Requests:
    def __init__(self) -> None:
        self.response: JsonValue = {"flagged": True, "action": "direct_output", "preset_response": "Blocked by API"}
        self.calls: list[tuple[str, str] | tuple[str, str, ModerationInputParams | ModerationOutputParams]] = []

    def decrypt(self, tenant_id: str, value: str) -> str:
        self.calls.append((tenant_id, value))
        return "plaintext"

    def inputs(self, endpoint: str, key: str, params: ModerationInputParams) -> JsonValue:
        self.calls.append((endpoint, key, params))
        return self.response

    def outputs(self, endpoint: str, key: str, params: ModerationOutputParams) -> JsonValue:
        self.calls.append((endpoint, key, params))
        return self.response


@pytest.fixture
def requests() -> _Requests:
    return _Requests()


@pytest.fixture
def moderation_app(sqlite_session_factory: sessionmaker[Session], requests: _Requests) -> Flask:
    extension = APIBasedExtension(
        tenant_id=_TENANT_ID,
        name="Owned extension",
        api_endpoint="https://moderation.example.test/check",
        api_key="encrypted-key",
    )
    extension.id = _EXTENSION_ID
    with sqlite_session_factory.begin() as session:
        session.add(extension)
    service = APIModerationService(
        find_extension=APIBasedExtensionRepository(session_factory=sqlite_session_factory).find_extension,
        decrypt_key=requests.decrypt,
        request_inputs=requests.inputs,
        request_outputs=requests.outputs,
    )
    app = Flask(__name__)
    app.extensions[API_MODERATION_EXTENSION_KEY] = APIModerationCallbacks(
        service.validate_config, service.moderate_inputs, service.moderate_outputs
    )
    return app


@pytest.mark.parametrize(
    "config",
    [
        None,
        {
            "inputs_config": {"enabled": False},
            "outputs_config": {"enabled": False},
            "api_based_extension_id": _EXTENSION_ID,
        },
    ],
)
def test_api_construction_needs_no_app_context_or_io(config: APIModerationConfig | None, sqlite_engine: Engine) -> None:
    events: list[str] = []

    def checkout(*_args: object) -> None:
        events.append("checkout")

    event.listen(sqlite_engine, "checkout", checkout)
    try:
        ModerationFactory("api", "app", _TENANT_ID, dict(config) if config is not None else None)
    finally:
        event.remove(sqlite_engine, "checkout", checkout)
    assert events == []


@pytest.mark.parametrize("direction", ["inputs", "outputs"])
def test_api_factory_adapts_response_with_existing_model(
    moderation_app: Flask, direction: str, requests: _Requests
) -> None:
    factory = ModerationFactory(
        "api",
        "test-app-id",
        _TENANT_ID,
        {
            "inputs_config": {"enabled": True},
            "outputs_config": {"enabled": True},
            "api_based_extension_id": _EXTENSION_ID,
        },
    )
    with moderation_app.app_context():
        if direction == "inputs":
            result = factory.moderation_for_inputs({"q": "a"}, "hello")
            assert result == ModerationInputsResult(
                flagged=True, action=ModerationAction.DIRECT_OUTPUT, preset_response="Blocked by API"
            )
        else:
            requests.response = {"flagged": False, "action": "direct_output", "preset_response": ""}
            result = factory.moderation_for_outputs("hello world")
            assert result == ModerationOutputsResult(action=ModerationAction.DIRECT_OUTPUT)
    assert requests.calls[0] == (_TENANT_ID, "encrypted-key")
    assert len(requests.calls) == 2


@pytest.mark.parametrize("response", [None, [], "invalid", {"action": "invalid"}])
def test_api_factory_retains_external_response_validation(
    moderation_app: Flask, requests: _Requests, response: JsonValue
) -> None:
    requests.response = response
    with moderation_app.app_context(), pytest.raises(ValidationError):
        ModerationFactory(
            "api", "app", _TENANT_ID, {"inputs_config": {"enabled": True}, "api_based_extension_id": _EXTENSION_ID}
        ).moderation_for_inputs({})


def test_api_factory_binds_once_at_first_operation(moderation_app: Flask, requests: _Requests) -> None:
    factory = ModerationFactory("api", "app", _TENANT_ID, {"inputs_config": {"enabled": False}})
    with moderation_app.app_context():
        assert factory.moderation_for_inputs({}) == ModerationInputsResult(action=ModerationAction.DIRECT_OUTPUT)
        moderation_app.extensions[API_MODERATION_EXTENSION_KEY] = object()
        assert factory.moderation_for_inputs({}) == ModerationInputsResult(action=ModerationAction.DIRECT_OUTPUT)
    assert requests.calls == []


def test_api_factory_outputs_reuse_callbacks_after_app_context_closes(
    moderation_app: Flask, requests: _Requests
) -> None:
    """Use the owned-row app fixture to bind and call the real service twice.

    Both outputs and recorded requests must survive closing the first app context.
    """
    factory = ModerationFactory(
        "api", "app", _TENANT_ID, {"outputs_config": {"enabled": True}, "api_based_extension_id": _EXTENSION_ID}
    )
    expected = ModerationOutputsResult(
        flagged=True, action=ModerationAction.DIRECT_OUTPUT, preset_response="Blocked by API"
    )
    with moderation_app.app_context():
        assert factory.moderation_for_outputs("first") == expected
    assert factory.moderation_for_outputs("second") == expected
    assert requests.calls == [
        (_TENANT_ID, "encrypted-key"),
        ("https://moderation.example.test/check", "plaintext", ModerationOutputParams(app_id="app", text="first")),
        (_TENANT_ID, "encrypted-key"),
        ("https://moderation.example.test/check", "plaintext", ModerationOutputParams(app_id="app", text="second")),
    ]


def test_api_factory_requires_root_bundle(moderation_app: Flask) -> None:
    moderation_app.extensions[API_MODERATION_EXTENSION_KEY] = object()
    with moderation_app.app_context(), pytest.raises(TypeError, match="API moderation callbacks are not configured"):
        ModerationFactory("api", "app", _TENANT_ID, {}).moderation_for_inputs({})


def test_api_factory_reparses_settings_after_binding(moderation_app: Flask, requests: _Requests) -> None:
    """Reusing callbacks must still admit the current settings for each operation."""
    config: APIModerationConfig = {
        "inputs_config": {"enabled": False},
        "outputs_config": {"enabled": True},
        "api_based_extension_id": _EXTENSION_ID,
    }
    factory = ModerationFactory("api", "app", _TENANT_ID, dict(config))
    with moderation_app.app_context():
        assert factory.moderation_for_outputs("first") == ModerationOutputsResult(
            flagged=True, action=ModerationAction.DIRECT_OUTPUT, preset_response="Blocked by API"
        )
    assert len(requests.calls) == 2
    config["outputs_config"]["enabled"] = False
    assert factory.moderation_for_outputs("second") == ModerationOutputsResult(action=ModerationAction.DIRECT_OUTPUT)
    assert len(requests.calls) == 2


def test_api_factory_keeps_binding_after_failed_admission(moderation_app: Flask, requests: _Requests) -> None:
    """A failed first parse keeps the resolved app callbacks for later operations."""
    raw: dict[str, JsonValue] = {"outputs_config": {"enabled": "yes"}}
    factory = ModerationFactory("api", "app", _TENANT_ID, raw)
    with moderation_app.app_context(), pytest.raises(ValidationError):
        factory.moderation_for_outputs("first")
    raw["outputs_config"] = {"enabled": False}
    assert factory.moderation_for_outputs("second") == ModerationOutputsResult(action=ModerationAction.DIRECT_OUTPUT)
    assert requests.calls == []


def test_api_factory_validation_uses_injected_real_repository(moderation_app: Flask, requests: _Requests) -> None:
    """Validate owned settings through the fixture's repository without outbound calls.

    The same settings in another workspace must fail with the missing-row error.
    """
    with moderation_app.app_context():
        ModerationFactory.validate_config(
            "api",
            _TENANT_ID,
            {
                "inputs_config": {"enabled": True},
                "outputs_config": {"enabled": False},
                "api_based_extension_id": _EXTENSION_ID,
            },
        )
        with pytest.raises(ValueError, match="API-based Extension not found"):
            ModerationFactory.validate_config(
                "api",
                "foreign",
                {
                    "inputs_config": {"enabled": True},
                    "outputs_config": {"enabled": False},
                    "api_based_extension_id": _EXTENSION_ID,
                },
            )
    assert requests.calls == []


@pytest.fixture
def scanned_providers() -> Iterator[None]:
    code_based_extension.init()
    yield
    code_based_extension.init()


@pytest.mark.usefixtures("scanned_providers")
@pytest.mark.parametrize("operation", ["construct", "validate"])
def test_factory_rejects_scanned_class_from_another_extension_module(operation: str) -> None:
    """Misregister a scanned external-data class and require TypeError on either path.

    The scanned_providers fixture restores the registry after success or failure.
    """
    provider = code_based_extension.module_extension(ExtensionModule.MODERATION, "keywords")
    provider.extension_class = code_based_extension.extension_class(ExtensionModule.EXTERNAL_DATA_TOOL, "api")

    if operation == "construct":
        with pytest.raises(TypeError, match="Extension keywords is not a moderation provider"):
            ModerationFactory("keywords", "app", _TENANT_ID, {})
    else:
        with pytest.raises(TypeError, match="Extension keywords is not a moderation provider"):
            ModerationFactory.validate_config("keywords", _TENANT_ID, {})


@pytest.mark.usefixtures("scanned_providers")
@pytest.mark.parametrize("name", ["keywords", "openai_moderation"])
def test_scanned_provider_constructor_and_class_validation_are_unchanged(name: str) -> None:
    valid = {
        "inputs_config": {"enabled": True, "preset_response": "Blocked"},
        "outputs_config": {"enabled": False},
        "keywords": "blocked",
    }
    ModerationFactory.validate_config(name, _TENANT_ID, valid)
    factory = ModerationFactory(
        name, "app", _TENANT_ID, {"inputs_config": {"enabled": False}, "outputs_config": {"enabled": False}}
    )
    assert factory.moderation_for_inputs({}) == ModerationInputsResult(action=ModerationAction.DIRECT_OUTPUT)
    assert factory.moderation_for_outputs("text") == ModerationOutputsResult(action=ModerationAction.DIRECT_OUTPUT)


@pytest.mark.usefixtures("scanned_providers")
class TestModerationFactoryIntegration:
    """Exercise factory dispatch through real scanned moderation providers."""

    def test_factory_delegates_to_extension(self) -> None:
        """Pass settings and payloads to the scanned keywords provider."""
        factory = ModerationFactory(
            "keywords",
            "app",
            _TENANT_ID,
            {"inputs_config": {"enabled": True, "preset_response": "Blocked"}, "keywords": "bad"},
        )
        result = factory.moderation_for_inputs({"field": "value"}, "query")
        assert result == ModerationInputsResult(action=ModerationAction.DIRECT_OUTPUT, preset_response="Blocked")
        assert result.flagged is False
        assert factory.moderation_for_inputs({"text": "BAD"}) == ModerationInputsResult(
            flagged=True, action=ModerationAction.DIRECT_OUTPUT, preset_response="Blocked"
        )

    def test_factory_validate_config_delegates(self) -> None:
        """Run the actual provider's form rules through factory class validation."""
        valid = AgentModerationProviderConfig(
            inputs_config=AgentModerationIOConfig(enabled=True, preset_response="Blocked"),
            outputs_config=AgentModerationIOConfig(enabled=False),
            keywords="bad",
        ).model_dump(exclude_none=True)
        ModerationFactory.validate_config("keywords", _TENANT_ID, valid)
        invalid = dict(valid)
        del invalid["keywords"]
        with pytest.raises(ValueError, match="^keywords is required$"):
            ModerationFactory.validate_config("keywords", _TENANT_ID, invalid)
