"""Exercise the named provider with the real repository and observed pool events."""

import json
from collections.abc import Iterator
from dataclasses import dataclass, field

import httpx
import pytest
from flask import Flask
from pydantic import JsonValue, ValidationError
from sqlalchemy import Engine, event
from sqlalchemy.orm import Session, sessionmaker

from core.moderation.api.api import ApiModeration
from core.moderation.base import Moderation
from core.moderation.factory import ModerationFactory
from models.api_based_extension import APIBasedExtension
from repositories.api_based_extension_repository import APIBasedExtensionRepository
from services.api_based_extension_adapters import WorkspaceTokenCipher
from services.api_moderation_adapters import request_inputs, request_outputs
from services.api_moderation_service import APIModerationService


@pytest.fixture(autouse=True)
def _provide_app_context() -> None:
    """Keep these lifetime tests outside the parent fixture's automatic Flask context."""


@dataclass
class Outbound:
    events: list[str]
    calls: list[tuple[str, str, dict[str, object]]] = field(default_factory=list)
    response: JsonValue = field(default_factory=lambda: {"flagged": False, "action": "direct_output"})
    failure: tuple[str, Exception] | None = None

    def decrypt(self, tenant_id: str, ciphertext: str) -> str:
        assert tenant_id == "tenant-a"
        assert ciphertext == "encrypted-key"
        assert self.events[-1] == "checkin"
        self.events.append("decrypt")
        self._fail("decrypt")
        return "plaintext-key"

    def inputs(self, endpoint: str, key: str, params: dict[str, object]) -> JsonValue:
        return self._request("inputs", endpoint, key, params)

    def outputs(self, endpoint: str, key: str, params: dict[str, object]) -> JsonValue:
        return self._request("outputs", endpoint, key, params)

    def _request(self, direction: str, endpoint: str, key: str, params: dict[str, object]) -> JsonValue:
        assert endpoint == "https://moderation.example"
        assert key == "plaintext-key"
        assert self.events[-2:] == ["checkin", "decrypt"]
        self.events.append(direction)
        self.calls.append((direction, endpoint, params))
        self._fail("request")
        return self.response

    def _fail(self, stage: str) -> None:
        if self.failure is not None and self.failure[0] == stage:
            raise self.failure[1]


@pytest.fixture
def outbound(sqlite_engine: Engine, sqlite_session_factory: sessionmaker[Session]) -> Iterator[Outbound]:
    with sqlite_session_factory.begin() as session:
        extension = APIBasedExtension(
            tenant_id="tenant-a",
            name="moderation",
            api_endpoint="https://moderation.example",
            api_key="encrypted-key",
        )
        extension.id = "extension-a"
        session.add(extension)
    events: list[str] = []

    def checkout(*_args: object) -> None:
        events.append("checkout")

    def checkin(*_args: object) -> None:
        events.append("checkin")

    event.listen(sqlite_engine, "checkout", checkout)
    event.listen(sqlite_engine, "checkin", checkin)
    try:
        yield Outbound(events)
    finally:
        event.remove(sqlite_engine, "checkout", checkout)
        event.remove(sqlite_engine, "checkin", checkin)


@pytest.fixture
def service(sqlite_session_factory: sessionmaker[Session], outbound: Outbound) -> APIModerationService:
    return APIModerationService(
        find_extension=APIBasedExtensionRepository(session_factory=sqlite_session_factory).find_extension,
        decrypt_key=outbound.decrypt,
        request_inputs=outbound.inputs,
        request_outputs=outbound.outputs,
    )


@pytest.fixture
def app(service: APIModerationService) -> Flask:
    app = Flask(__name__)
    app.extensions["api_moderation"] = service
    return app


def config() -> dict[str, object]:
    return {
        "inputs_config": {"enabled": True},
        "outputs_config": {"enabled": True},
        "api_based_extension_id": "extension-a",
    }


def invoke(provider: ApiModeration, operation: str) -> None:
    if operation == "validate":
        assert provider.config is not None
        ApiModeration.validate_config(provider.tenant_id, provider.config)
    elif operation == "inputs":
        provider.moderation_for_inputs({})
    else:
        provider.moderation_for_outputs("text")


def test_validation_releases_connection_without_decrypting(app: Flask, outbound: Outbound) -> None:
    with app.app_context():
        ApiModeration.validate_config("tenant-a", config())
    assert outbound.events == ["checkout", "checkin"]
    assert outbound.calls == []


def test_validation_lookup_failure_checks_in_and_keeps_error_identity(
    app: Flask, outbound: Outbound, sqlite_engine: Engine
) -> None:
    failure = RuntimeError("lookup")

    def fail_lookup(*_args: object) -> None:
        raise failure

    event.listen(sqlite_engine, "do_execute", fail_lookup)
    try:
        with app.app_context(), pytest.raises(RuntimeError) as raised:
            ApiModeration.validate_config("tenant-a", config())
        assert raised.value is failure
        assert outbound.events == ["checkout", "checkin"]
        assert outbound.calls == []
    finally:
        event.remove(sqlite_engine, "do_execute", fail_lookup)


@pytest.mark.parametrize("direction", ["inputs", "outputs"])
def test_enabled_entrypoint_checks_in_before_decrypt_and_request(
    app: Flask, outbound: Outbound, direction: str
) -> None:
    provider = ApiModeration("app-a", "tenant-a", config())
    assert outbound.events == []
    with app.app_context():
        result = (
            provider.moderation_for_inputs({"x": "value"}, "query")
            if direction == "inputs"
            else provider.moderation_for_outputs("text")
        )
    assert result.flagged is False
    assert outbound.events == ["checkout", "checkin", "decrypt", direction]
    expected = (
        {"app_id": "app-a", "inputs": {"x": "value"}, "query": "query"}
        if direction == "inputs"
        else {"app_id": "app-a", "text": "text"}
    )
    assert outbound.calls == [(direction, "https://moderation.example", expected)]


@pytest.mark.parametrize("operation", ["validate", "inputs", "outputs"])
@pytest.mark.parametrize(("tenant_id", "extension_id"), [("tenant-b", "extension-a"), ("tenant-a", "missing")])
def test_absent_or_foreign_extension_has_no_outbound_work(
    app: Flask, outbound: Outbound, operation: str, tenant_id: str, extension_id: str
) -> None:
    settings = config() | {"api_based_extension_id": extension_id}
    provider = ApiModeration("app-a", tenant_id, settings)
    with app.app_context(), pytest.raises(ValueError, match="API-based Extension not found"):
        invoke(provider, operation)
    assert outbound.events == ["checkout", "checkin"]
    assert outbound.calls == []


@pytest.mark.parametrize("direction", ["inputs", "outputs"])
@pytest.mark.parametrize("stage", ["lookup", "decrypt", "request"])
def test_dependency_error_identity_and_cleanup(
    app: Flask, outbound: Outbound, sqlite_engine: Engine, direction: str, stage: str
) -> None:
    failure = RuntimeError(stage)
    outbound.failure = (stage, failure)

    def fail_lookup(*_args: object) -> None:
        raise failure

    if stage == "lookup":
        event.listen(sqlite_engine, "do_execute", fail_lookup)
    provider = ApiModeration("app-a", "tenant-a", config())
    try:
        with app.app_context(), pytest.raises(RuntimeError) as raised:
            invoke(provider, direction)
        assert raised.value is failure
        expected = ["checkout", "checkin"]
        if stage != "lookup":
            expected.append("decrypt")
        if stage == "request":
            expected.append(direction)
        assert outbound.events == expected
    finally:
        if stage == "lookup":
            event.remove(sqlite_engine, "do_execute", fail_lookup)


@pytest.mark.parametrize("registration", [None, object()])
@pytest.mark.parametrize("direction", ["inputs", "outputs"])
def test_disabled_direction_skips_binding_and_io(outbound: Outbound, registration: object, direction: str) -> None:
    settings = {f"{direction}_config": {"enabled": False}}
    provider = ApiModeration("app-a", "tenant-a", settings)
    invalid_app = Flask("invalid")
    invalid_app.extensions["api_moderation"] = registration
    with invalid_app.app_context():
        result = provider.moderation_for_inputs({}) if direction == "inputs" else provider.moderation_for_outputs("")
    assert result.flagged is False
    assert outbound.events == []
    assert provider._runtime is None


def test_first_enabled_operation_binds_active_app_then_survives_other_contexts(
    app: Flask, outbound: Outbound, sqlite_session_factory: sessionmaker[Session]
) -> None:
    other = Flask("other")
    other_outbound = Outbound(outbound.events)
    other.extensions["api_moderation"] = APIModerationService(
        find_extension=APIBasedExtensionRepository(session_factory=sqlite_session_factory).find_extension,
        decrypt_key=other_outbound.decrypt,
        request_inputs=other_outbound.inputs,
        request_outputs=other_outbound.outputs,
    )
    with other.app_context():
        provider = ApiModeration("app-a", "tenant-a", config())
    with app.app_context():
        provider.moderation_for_inputs({})
    with other.app_context():
        provider.moderation_for_outputs("text")
    provider.moderation_for_outputs("outside")
    assert (
        outbound.events
        == ["checkout", "checkin", "decrypt", "inputs"] + ["checkout", "checkin", "decrypt", "outputs"] * 2
    )
    assert other_outbound.calls == []


def test_missing_context_does_not_bind_and_can_retry(app: Flask, outbound: Outbound) -> None:
    provider = ApiModeration("app-a", "tenant-a", config())
    with pytest.raises(RuntimeError, match="application context"):
        provider.moderation_for_inputs({})
    assert outbound.events == []
    assert provider._runtime is None
    with app.app_context():
        provider.moderation_for_inputs({})
    assert outbound.events == ["checkout", "checkin", "decrypt", "inputs"]


@pytest.mark.parametrize("registration", [None, object()])
def test_invalid_binding_fails_before_lookup(outbound: Outbound, registration: object) -> None:
    invalid_app = Flask("invalid")
    invalid_app.extensions["api_moderation"] = registration
    with invalid_app.app_context(), pytest.raises(TypeError, match="runtime registration"):
        ApiModeration("app-a", "tenant-a", config()).moderation_for_inputs({})
    assert outbound.events == []


def test_scanner_registers_only_named_api_provider(
    app: Flask, outbound: Outbound, monkeypatch: pytest.MonkeyPatch
) -> None:
    from extensions.ext_code_based_extension import code_based_extension

    registrations = Moderation.scan_extensions()
    monkeypatch.setattr(code_based_extension, "_Extension__module_extensions", {"moderation": registrations})
    provider_class = code_based_extension.extension_class(Moderation.module, "api")
    assert provider_class.__name__ == "ApiModeration"
    assert provider_class.__module__ == "core.moderation.api.api"
    with app.app_context():
        ModerationFactory.validate_config("api", "tenant-a", config())
        factory = ModerationFactory("api", "app-a", "tenant-a", config())
        assert factory.moderation_for_inputs({}).flagged is False
    assert outbound.events == ["checkout", "checkin", "checkout", "checkin", "decrypt", "inputs"]


@pytest.mark.parametrize("direction", ["inputs", "outputs"])
@pytest.mark.parametrize("malformed_response", [False, True])
def test_runtime_adapters_preserve_wire_payload_and_response_validation(
    sqlite_session_factory: sessionmaker[Session],
    outbound: Outbound,
    monkeypatch: pytest.MonkeyPatch,
    direction: str,
    malformed_response: bool,
) -> None:
    from configs import dify_config
    from services import api_based_extension_adapters

    monkeypatch.setattr(dify_config, "SSRF_PROXY_HTTP_URL", "")
    monkeypatch.setattr(dify_config, "SSRF_PROXY_HTTPS_URL", "")
    monkeypatch.setattr(api_based_extension_adapters, "decrypt_token", outbound.decrypt)
    sent: list[object] = []

    def handle(request: httpx.Request) -> httpx.Response:
        assert outbound.events == ["checkout", "checkin", "decrypt"]
        assert request.headers["Authorization"] == "Bearer plaintext-key"
        assert request.url == "https://moderation.example"
        sent.append(json.loads(request.content))
        return httpx.Response(200, json=[] if malformed_response else {"flagged": True, "action": "direct_output"})

    real_client = httpx.Client

    def client(*, mounts: dict[str, httpx.BaseTransport] | None, timeout: httpx.Timeout) -> httpx.Client:
        assert mounts is None
        return real_client(transport=httpx.MockTransport(handle), timeout=timeout)

    monkeypatch.setattr(httpx, "Client", client)
    app = Flask("runtime-adapters")
    app.extensions["api_moderation"] = APIModerationService(
        find_extension=APIBasedExtensionRepository(session_factory=sqlite_session_factory).find_extension,
        decrypt_key=WorkspaceTokenCipher().decrypt,
        request_inputs=request_inputs,
        request_outputs=request_outputs,
    )
    provider = ApiModeration("app-a", "tenant-a", config())
    with app.app_context():
        if malformed_response:
            with pytest.raises(ValidationError):
                invoke(provider, direction)
        else:
            invoke(provider, direction)
    expected_params: dict[str, object] = (
        {"app_id": "app-a", "inputs": {}, "query": ""} if direction == "inputs" else {"app_id": "app-a", "text": "text"}
    )
    point = "app.moderation.input" if direction == "inputs" else "app.moderation.output"
    assert sent == [{"point": point, "params": expected_params}]
