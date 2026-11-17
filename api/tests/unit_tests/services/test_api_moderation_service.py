import re
from collections.abc import Iterator
from typing import Literal

import pytest
from pydantic import JsonValue, ValidationError
from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from graphon.file import File, FileTransferMethod, FileType
from models.api_based_extension import APIBasedExtension, APIBasedExtensionPoint
from models.base import TypeBase
from repositories.api_based_extension_repository import APIBasedExtensionRepository
from services.api_based_extension_adapters import APIModerationGateway
from services.api_moderation_service import (
    APIModerationConfig,
    APIModerationService,
    DisabledDirection,
    EnabledDirection,
    ModerationInputParams,
    ModerationOutputParams,
    parse_direction,
)
from services.entities.message_entities import MessageInputValue

_EXTENSION_ID = "a0000000-0000-0000-0000-000000000001"
_FOREIGN_EXTENSION_ID = "a0000000-0000-0000-0000-000000000002"
_MISSING_EXTENSION_ID = "a0000000-0000-0000-0000-000000000003"
_TENANT_ID = "a0000000-0000-0000-0000-000000000004"
_FOREIGN_TENANT_ID = "a0000000-0000-0000-0000-000000000005"
_ENDPOINT = "https://moderation.example.test/check"
_EXTENSION_NOT_FOUND = r"^API-based Extension not found\. Please check it again\.$"
_INVALID_EXTENSION_CONFIGS: tuple[dict[str, JsonValue], ...] = (
    {},
    {"api_based_extension_id": None},
    {"api_based_extension_id": ""},
    {"api_based_extension_id": False},
    {"api_based_extension_id": True},
    {"api_based_extension_id": 0},
    {"api_based_extension_id": 17},
    {"api_based_extension_id": []},
    {"api_based_extension_id": [_EXTENSION_ID]},
    {"api_based_extension_id": {}},
    {"api_based_extension_id": {"id": _EXTENSION_ID}},
)


class _Outbound:
    """Explicit capabilities that observe ordering after a real repository read."""

    def __init__(self, events: list[str]) -> None:
        self.events = events
        self.response: object = {"flagged": False, "action": "direct_output", "preset_response": ""}
        self.failure: tuple[str, RuntimeError] | None = None
        self.params: ModerationInputParams | ModerationOutputParams | None = None

    def decrypt(self, tenant_id: str, ciphertext: str) -> str:
        assert self.events == ["checkout", "checkin"]
        assert (tenant_id, ciphertext) == (_TENANT_ID, "encrypted-key")
        self.events.append("decrypt")
        if self.failure is not None and self.failure[0] == "decrypt":
            raise self.failure[1]
        return "decrypted-key"

    def inputs(self, endpoint: str, key: str, params: ModerationInputParams) -> object:
        return self._request(endpoint, key, params)

    def outputs(self, endpoint: str, key: str, params: ModerationOutputParams) -> object:
        return self._request(endpoint, key, params)

    def _request(self, endpoint: str, key: str, params: ModerationInputParams | ModerationOutputParams) -> object:
        assert self.events == ["checkout", "checkin", "decrypt"]
        assert (endpoint, key) == (_ENDPOINT, "decrypted-key")
        self.events.append("request")
        self.params = params
        if self.failure is not None and self.failure[0] == "request":
            raise self.failure[1]
        return self.response


@pytest.fixture
def api_config() -> APIModerationConfig:
    return {
        "inputs_config": {"enabled": True},
        "outputs_config": {"enabled": True},
        "api_based_extension_id": _EXTENSION_ID,
    }


@pytest.fixture
def lookup_events(sqlite_engine: Engine, sqlite_session_factory: sessionmaker[Session]) -> Iterator[list[str]]:
    """Commit owned/foreign rows, then observe real read connection ownership."""
    target = APIBasedExtension(
        tenant_id=_TENANT_ID, name="Target extension", api_endpoint=_ENDPOINT, api_key="encrypted-key"
    )
    target.id = _EXTENSION_ID
    foreign = APIBasedExtension(
        tenant_id=_FOREIGN_TENANT_ID,
        name="Foreign extension",
        api_endpoint="https://moderation.example.test/foreign",
        api_key="foreign-key",
    )
    foreign.id = _FOREIGN_EXTENSION_ID
    with sqlite_session_factory.begin() as session:
        session.add_all((target, foreign))
    events: list[str] = []

    def checkout(*_args: object) -> None:
        events.append("checkout")

    def checkin(*_args: object) -> None:
        events.append("checkin")

    event.listen(sqlite_engine, "checkout", checkout)
    event.listen(sqlite_engine, "checkin", checkin)
    try:
        yield events
    finally:
        event.remove(sqlite_engine, "checkout", checkout)
        event.remove(sqlite_engine, "checkin", checkin)


@pytest.fixture
def outbound(lookup_events: list[str]) -> _Outbound:
    return _Outbound(lookup_events)


@pytest.fixture
def lookup_queries(sqlite_engine: Engine) -> Iterator[list[str]]:
    """Record real SQL execution separately from connection ownership events."""
    queries: list[str] = []

    def before_cursor_execute(*_args: object) -> None:
        queries.append("query")

    event.listen(sqlite_engine, "before_cursor_execute", before_cursor_execute)
    try:
        yield queries
    finally:
        event.remove(sqlite_engine, "before_cursor_execute", before_cursor_execute)


@pytest.fixture
def service(sqlite_session_factory: sessionmaker[Session], outbound: _Outbound) -> APIModerationService:
    return APIModerationService(
        find_extension=APIBasedExtensionRepository(session_factory=sqlite_session_factory).find_extension,
        decrypt_key=outbound.decrypt,
        request_inputs=outbound.inputs,
        request_outputs=outbound.outputs,
    )


def _moderate(
    service: APIModerationService, config: APIModerationConfig | None, direction: Literal["inputs", "outputs"]
) -> object:
    """Exercise either runtime operation with complete authored settings or no config."""
    if direction == "inputs":
        return service.moderate_inputs(_TENANT_ID, "test-app-id", config, {"q": "a"}, "hello")
    return service.moderate_outputs(_TENANT_ID, "test-app-id", config, "hello world")


def test_moderation_input_params() -> None:
    params = ModerationInputParams(app_id="app-1", inputs={"key": "val"}, query="test query")
    assert params.app_id == "app-1"
    assert params.inputs == {"key": "val"}
    assert params.query == "test query"
    params_default = ModerationInputParams()
    assert params_default.app_id == ""
    assert params_default.inputs == {}
    assert params_default.query == ""


def test_moderation_output_params() -> None:
    params = ModerationOutputParams(app_id="app-1", text="test text")
    assert params.app_id == "app-1"
    assert params.text == "test text"
    with pytest.raises(ValidationError):
        ModerationOutputParams.model_validate({})


@pytest.mark.parametrize(("inputs_enabled", "outputs_enabled"), [(True, True), (True, False), (False, True)])
def test_validate_config_success(
    service: APIModerationService,
    api_config: APIModerationConfig,
    lookup_events: list[str],
    inputs_enabled: bool,
    outputs_enabled: bool,
) -> None:
    """Each valid combination permits one scoped read and no outbound work."""
    api_config["inputs_config"]["enabled"] = inputs_enabled
    api_config["outputs_config"]["enabled"] = outputs_enabled
    service.validate_config(_TENANT_ID, api_config)
    assert lookup_events == ["checkout", "checkin"]


@pytest.mark.parametrize("config", [{}, {"inputs_config": [], "outputs_config": []}, {"inputs_config": {}}])
def test_validate_config_rejects_invalid_config_before_lookup(
    service: APIModerationService,
    config: dict[str, JsonValue],
    lookup_events: list[str],
    lookup_queries: list[str],
) -> None:
    """Raw malformed forms fail validation before acquiring or querying a connection."""
    with pytest.raises(ValidationError):
        service.validate_config(_TENANT_ID, config)
    assert lookup_events == []
    assert lookup_queries == []


@pytest.mark.parametrize("extension_id", [_MISSING_EXTENSION_ID, _FOREIGN_EXTENSION_ID])
def test_validate_config_extension_not_found(
    service: APIModerationService, extension_id: str, api_config: APIModerationConfig, lookup_events: list[str]
) -> None:
    api_config["api_based_extension_id"] = extension_id
    with pytest.raises(ValueError, match=_EXTENSION_NOT_FOUND):
        service.validate_config(_TENANT_ID, api_config)
    assert lookup_events == ["checkout", "checkin"]


@pytest.mark.parametrize("direction", ["inputs", "outputs"])
def test_enabled_moderation_releases_connection_before_external_io(
    service: APIModerationService,
    direction: Literal["inputs", "outputs"],
    api_config: APIModerationConfig,
    lookup_events: list[str],
    outbound: _Outbound,
) -> None:
    """Each operation passes the validated payload onward after its read session closes."""
    if direction == "inputs":
        outbound.response = {"flagged": True, "action": "direct_output", "preset_response": "Blocked by API"}
        expected = {"app_id": "test-app-id", "inputs": {"q": "a"}, "query": "hello"}
    else:
        expected = {"app_id": "test-app-id", "text": "hello world"}
    assert _moderate(service, api_config, direction) is outbound.response
    assert outbound.params is not None
    assert outbound.params.model_dump() == expected
    assert lookup_events == ["checkout", "checkin", "decrypt", "request"]


@pytest.mark.parametrize("direction", ["inputs", "outputs"])
@pytest.mark.parametrize("extension_id", [_MISSING_EXTENSION_ID, _FOREIGN_EXTENSION_ID])
def test_enabled_moderation_extension_not_found(
    service: APIModerationService,
    direction: Literal["inputs", "outputs"],
    extension_id: str,
    api_config: APIModerationConfig,
    lookup_events: list[str],
) -> None:
    """Missing and foreign valid string IDs retain the scoped not-found failure."""
    api_config["api_based_extension_id"] = extension_id
    with pytest.raises(ValueError, match=_EXTENSION_NOT_FOUND):
        _moderate(service, api_config, direction)
    assert lookup_events == ["checkout", "checkin"]


@pytest.mark.parametrize("direction", ["inputs", "outputs"])
def test_disabled_moderation_skips_lookup(
    service: APIModerationService,
    direction: Literal["inputs", "outputs"],
    api_config: APIModerationConfig,
    lookup_events: list[str],
) -> None:
    """A disabled authored direction returns the established result without a lookup."""
    if direction == "inputs":
        api_config["inputs_config"] = {"enabled": False}
    else:
        api_config["outputs_config"] = {"enabled": False}
    assert _moderate(service, api_config, direction) == {
        "flagged": False,
        "action": "direct_output",
        "preset_response": "",
    }
    assert lookup_events == []


@pytest.mark.parametrize("direction", ["inputs", "outputs"])
def test_moderation_without_config_skips_lookup(
    service: APIModerationService, direction: Literal["inputs", "outputs"], lookup_events: list[str]
) -> None:
    """Absent runtime config retains its explicit error before persistence access."""
    with pytest.raises(ValueError, match=r"^The config is not set\.$"):
        _moderate(service, None, direction)
    assert lookup_events == []


def test_parse_direction_no_config(lookup_events: list[str]) -> None:
    with pytest.raises(ValueError, match=r"^The config is not set\.$"):
        parse_direction(None, "inputs_config")
    assert lookup_events == []


def test_lookup_failure_releases_connection(
    service: APIModerationService, api_config: APIModerationConfig, lookup_events: list[str], sqlite_engine: Engine
) -> None:
    failure = RuntimeError("lookup failed")

    def fail_query(*_args: object) -> None:
        raise failure

    event.listen(sqlite_engine, "before_cursor_execute", fail_query)
    try:
        with pytest.raises(RuntimeError) as exc_info:
            service.moderate_outputs(_TENANT_ID, "test-app-id", api_config, "test")
    finally:
        event.remove(sqlite_engine, "before_cursor_execute", fail_query)
    assert exc_info.value is failure
    assert lookup_events == ["checkout", "checkin"]


@pytest.mark.parametrize("direction", ["inputs", "outputs"])
@pytest.mark.parametrize("stage", ["decrypt", "request"])
def test_external_failure_preserves_identity_after_checkin(
    service: APIModerationService,
    api_config: APIModerationConfig,
    outbound: _Outbound,
    lookup_events: list[str],
    direction: Literal["inputs", "outputs"],
    stage: Literal["decrypt", "request"],
) -> None:
    """Original decrypt and request failures propagate after the connection is returned."""
    failure = RuntimeError(f"{stage} failed")
    outbound.failure = (stage, failure)
    with pytest.raises(RuntimeError) as exc_info:
        _moderate(service, api_config, direction)
    assert exc_info.value is failure
    expected = ["checkout", "checkin", "decrypt"]
    if stage == "request":
        expected.append("request")
    assert lookup_events == expected


@pytest.mark.parametrize("direction", ["inputs", "outputs"])
@pytest.mark.parametrize("validation", ["runtime", "form"])
@pytest.mark.parametrize("value", ["yes", "false", "", 0, 1, [], [False], {}, {"enabled": True}, None])
def test_non_boolean_flags_are_rejected_before_lookup(
    service: APIModerationService,
    direction: Literal["inputs", "outputs"],
    validation: Literal["runtime", "form"],
    value: JsonValue,
    lookup_events: list[str],
    lookup_queries: list[str],
) -> None:
    """Only actual boolean flags enter runtime or form execution."""
    raw: dict[str, JsonValue] = {
        "inputs_config": {"enabled": True},
        "outputs_config": {"enabled": True},
        "api_based_extension_id": _EXTENSION_ID,
    }
    raw[f"{direction}_config"] = {"enabled": value}
    if validation == "form":
        with pytest.raises(ValidationError):
            service.validate_config(_TENANT_ID, raw)
    elif direction == "inputs":
        with pytest.raises(ValidationError):
            service.moderate_inputs(_TENANT_ID, "app", raw, {})
    else:
        with pytest.raises(ValidationError):
            service.moderate_outputs(_TENANT_ID, "app", raw, "answer")
    assert lookup_events == []
    assert lookup_queries == []


@pytest.mark.parametrize("direction", ["inputs", "outputs"])
@pytest.mark.parametrize("validation", ["runtime", "form"])
@pytest.mark.parametrize("selected", [None, [], "invalid", 1, {}])
def test_malformed_direction_is_rejected_before_lookup(
    service: APIModerationService,
    direction: Literal["inputs", "outputs"],
    validation: Literal["runtime", "form"],
    selected: JsonValue,
    lookup_events: list[str],
    lookup_queries: list[str],
) -> None:
    """Malformed selected settings fail before SQL or outbound capabilities."""
    raw: dict[str, JsonValue] = {
        "inputs_config": {"enabled": True},
        "outputs_config": {"enabled": True},
        "api_based_extension_id": _EXTENSION_ID,
    }
    raw[f"{direction}_config"] = selected
    if validation == "form":
        with pytest.raises(ValidationError):
            service.validate_config(_TENANT_ID, raw)
    elif direction == "inputs":
        with pytest.raises(ValidationError):
            service.moderate_inputs(_TENANT_ID, "app", raw, {})
    else:
        with pytest.raises(ValidationError):
            service.moderate_outputs(_TENANT_ID, "app", raw, "answer")
    assert lookup_events == []
    assert lookup_queries == []


@pytest.mark.parametrize("direction", ["inputs", "outputs"])
@pytest.mark.parametrize("validation", ["runtime", "form"])
def test_missing_direction_is_rejected_before_lookup(
    service: APIModerationService,
    direction: Literal["inputs", "outputs"],
    validation: Literal["runtime", "form"],
    lookup_events: list[str],
    lookup_queries: list[str],
) -> None:
    """Missing selected settings are validation failures with no persistence work."""
    opposite = "outputs_config" if direction == "inputs" else "inputs_config"
    raw: dict[str, JsonValue] = {opposite: {"enabled": True}, "api_based_extension_id": _EXTENSION_ID}
    if validation == "form":
        with pytest.raises(ValidationError):
            service.validate_config(_TENANT_ID, raw)
    elif direction == "inputs":
        with pytest.raises(ValidationError):
            service.moderate_inputs(_TENANT_ID, "app", raw, {})
    else:
        with pytest.raises(ValidationError):
            service.moderate_outputs(_TENANT_ID, "app", raw, "answer")
    assert lookup_events == []
    assert lookup_queries == []


@pytest.mark.parametrize("operation", ["inputs", "outputs", "form"])
@pytest.mark.parametrize("extension_config", _INVALID_EXTENSION_CONFIGS)
def test_invalid_extension_id_is_rejected_before_lookup(
    service: APIModerationService,
    operation: Literal["inputs", "outputs", "form"],
    extension_config: dict[str, JsonValue],
    lookup_events: list[str],
    lookup_queries: list[str],
) -> None:
    """Enabled operations and forms reject missing, empty or non-string IDs before I/O."""
    raw: dict[str, JsonValue] = {
        "inputs_config": {"enabled": True},
        "outputs_config": {"enabled": True},
        **extension_config,
    }
    if operation == "form":
        with pytest.raises(ValidationError):
            service.validate_config(_TENANT_ID, raw)
    elif operation == "inputs":
        with pytest.raises(ValidationError):
            service.moderate_inputs(_TENANT_ID, "app", raw, {})
    else:
        with pytest.raises(ValidationError):
            service.moderate_outputs(_TENANT_ID, "app", raw, "answer")
    assert lookup_events == []
    assert lookup_queries == []


@pytest.mark.parametrize("extension_config", _INVALID_EXTENSION_CONFIGS)
def test_both_disabled_form_precedes_extension_id_validation(
    service: APIModerationService,
    extension_config: dict[str, JsonValue],
    lookup_events: list[str],
    lookup_queries: list[str],
) -> None:
    """Two false flags retain their business error even with an invalid or absent ID."""
    raw: dict[str, JsonValue] = {
        "inputs_config": {"enabled": False},
        "outputs_config": {"enabled": False},
        **extension_config,
    }
    message = "At least one of inputs_config or outputs_config must be enabled"
    with pytest.raises(ValueError, match=f"^{re.escape(message)}$"):
        service.validate_config(_TENANT_ID, raw)
    assert lookup_events == []
    assert lookup_queries == []


def test_form_parses_inputs_direction_before_outputs_direction(
    service: APIModerationService, lookup_events: list[str], lookup_queries: list[str]
) -> None:
    """The input direction's missing flag wins over malformed output settings."""
    raw: dict[str, JsonValue] = {"inputs_config": {}, "outputs_config": None}
    with pytest.raises(ValidationError) as raised:
        service.validate_config(_TENANT_ID, raw)
    assert [(error["loc"], error["type"]) for error in raised.value.errors()] == [(("enabled",), "missing")]
    assert lookup_events == []
    assert lookup_queries == []


@pytest.mark.parametrize("direction", ["inputs", "outputs"])
@pytest.mark.parametrize("extension_config", _INVALID_EXTENSION_CONFIGS)
def test_disabled_direction_ignores_invalid_id_opposite_settings_and_payload(
    service: APIModerationService,
    direction: Literal["inputs", "outputs"],
    extension_config: dict[str, JsonValue],
    lookup_events: list[str],
    lookup_queries: list[str],
) -> None:
    """A false selected flag skips invalid ID, opposite settings and input values."""
    selected: Literal["inputs_config", "outputs_config"] = (
        "inputs_config" if direction == "inputs" else "outputs_config"
    )
    opposite = "outputs_config" if direction == "inputs" else "inputs_config"
    raw: dict[str, JsonValue] = {selected: {"enabled": False}, opposite: None, **extension_config}
    assert parse_direction(raw, selected) == DisabledDirection()
    if direction == "inputs":
        result = service.moderate_inputs(_TENANT_ID, "app", raw, {"unsupported": object()})
    else:
        result = service.moderate_outputs(_TENANT_ID, "app", raw, "answer")
    assert result == {"flagged": False, "action": "direct_output", "preset_response": ""}
    assert lookup_events == []
    assert lookup_queries == []


@pytest.mark.parametrize("direction", ["inputs", "outputs"])
@pytest.mark.parametrize("opposite_value", [None, [], "invalid", 1, {}, {"enabled": "yes"}])
def test_enabled_direction_ignores_malformed_opposite_settings(
    service: APIModerationService,
    direction: Literal["inputs", "outputs"],
    opposite_value: JsonValue,
    lookup_events: list[str],
    outbound: _Outbound,
) -> None:
    """An enabled runtime selection reads only its own direction settings."""
    selected = "inputs_config" if direction == "inputs" else "outputs_config"
    opposite = "outputs_config" if direction == "inputs" else "inputs_config"
    raw: dict[str, JsonValue] = {
        selected: {"enabled": True},
        opposite: opposite_value,
        "api_based_extension_id": _EXTENSION_ID,
    }
    if direction == "inputs":
        result = service.moderate_inputs(_TENANT_ID, "app", raw, {})
    else:
        result = service.moderate_outputs(_TENANT_ID, "app", raw, "answer")
    assert result is outbound.response
    assert lookup_events == ["checkout", "checkin", "decrypt", "request"]


@pytest.mark.parametrize("extension_id", ["custom-extension-key", " ", _EXTENSION_ID.upper()])
def test_direction_selection_preserves_string_ids_and_ignores_unknown_keys(extension_id: str) -> None:
    """Nonempty strings are kept exactly and unrelated config fields are ignored."""
    raw: dict[str, JsonValue] = {
        "inputs_config": {"enabled": True, "unknown": [1, True]},
        "api_based_extension_id": extension_id,
        "unknown": None,
    }
    assert parse_direction(raw, "inputs_config") == EnabledDirection(extension_id)


@pytest.mark.parametrize("inputs", [{"invalid": object()}, {"invalid": [object()]}, {"invalid": {"nested": object()}}])
def test_enabled_input_payload_rejects_unsupported_values_before_lookup(
    service: APIModerationService,
    api_config: APIModerationConfig,
    inputs: dict[str, object],
    lookup_events: list[str],
    lookup_queries: list[str],
) -> None:
    """Arbitrary objects, including nested ones, fail admission before any I/O."""
    with pytest.raises(ValidationError):
        service.moderate_inputs(_TENANT_ID, "app", api_config, inputs)
    assert lookup_events == []
    assert lookup_queries == []


def test_input_domain_survives_sqlite_and_gateway_serialization(
    api_config: APIModerationConfig,
    sqlite_session_factory: sessionmaker[Session],
    outbound: _Outbound,
    lookup_events: list[str],
    lookup_queries: list[str],
) -> None:
    """Real files and dynamic JSON retain their values through admission, SQL and the wire gateway."""
    attachment = File(
        file_id="66666666-6666-4666-8666-666666666666",
        file_type=FileType.DOCUMENT,
        transfer_method=FileTransferMethod.REMOTE_URL,
        remote_url="https://example.com/input.pdf",
        filename="input.pdf",
        extension=".pdf",
        mime_type="application/pdf",
        size=12,
    )
    file_shaped_json: dict[str, JsonValue] = {
        "dify_model_identity": "__dify__file__",
        "id": "77777777-7777-4777-8777-777777777777",
        "type": "document",
        "transfer_method": "remote_url",
        "remote_url": "https://example.com/ordinary.json",
        "reference": None,
        "filename": "ordinary.json",
        "extension": ".json",
        "mime_type": "application/json",
        "size": 4,
        "related_id": None,
        "url": "https://example.com/ordinary.json",
        "ordinary_json": {"keep": [1, True]},
    }
    values: dict[str, MessageInputValue] = {
        "任意用户变量": "你好",
        "empty_text": "",
        "nothing": None,
        "empty_object": {},
        "empty_list": [],
        "number": 1.5,
        "checked": True,
        "nested": {"object": {"flags": [1, True], "null": None}},
        "mixed": [1, True],
        "file": attachment,
        "files": [attachment],
        "file_json": file_shaped_json,
    }
    response = {"flagged": False, "action": "direct_output", "preset_response": ""}
    calls: list[tuple[str, str, APIBasedExtensionPoint, dict[str, object]]] = []
    admitted: list[ModerationInputParams] = []

    def request(endpoint: str, key: str, point: APIBasedExtensionPoint, params: dict[str, object]) -> object:
        assert lookup_events == ["checkout", "checkin", "decrypt"]
        lookup_events.append("request")
        calls.append((endpoint, key, point, params))
        return response

    gateway = APIModerationGateway(request=request)

    def request_inputs(endpoint: str, key: str, params: ModerationInputParams) -> object:
        admitted.append(params)
        return gateway.inputs(endpoint, key, params)

    service = APIModerationService(
        find_extension=APIBasedExtensionRepository(session_factory=sqlite_session_factory).find_extension,
        decrypt_key=outbound.decrypt,
        request_inputs=request_inputs,
        request_outputs=gateway.outputs,
    )
    assert service.moderate_inputs(_TENANT_ID, "test-app-id", api_config, values, "hello") is response
    assert len(admitted) == 1
    params = admitted[0]
    assert params.inputs == values
    assert params.inputs["file"] is attachment
    files = params.inputs["files"]
    assert isinstance(files, list)
    assert len(files) == 1
    assert files[0] is attachment
    assert isinstance(params.inputs["file_json"], dict)
    assert params.inputs["file_json"] == file_shaped_json
    mixed = params.inputs["mixed"]
    assert isinstance(mixed, list)
    assert type(mixed[0]) is int
    assert type(mixed[1]) is bool
    expected = {
        "app_id": "test-app-id",
        "inputs": {**values, "file": attachment.model_dump(), "files": [attachment.model_dump()]},
        "query": "hello",
    }
    assert calls == [(_ENDPOINT, "decrypted-key", APIBasedExtensionPoint.APP_MODERATION_INPUT, expected)]
    assert lookup_events == ["checkout", "checkin", "decrypt", "request"]
    assert lookup_queries == ["query"]


def test_service_uses_explicit_database_instead_of_global(
    sqlite_session_factory: sessionmaker[Session], api_config: APIModerationConfig
) -> None:
    """The autouse global DB is empty; only the independently supplied DB owns this ID."""
    assert (
        APIBasedExtensionRepository(session_factory=sqlite_session_factory).find_extension(_TENANT_ID, _EXTENSION_ID)
        is None
    )
    engine = create_engine("sqlite://")
    try:
        TypeBase.metadata.create_all(engine)
        explicit_factory = sessionmaker(bind=engine)
        repository = APIBasedExtensionRepository(session_factory=explicit_factory)
        target = APIBasedExtension(
            tenant_id=_TENANT_ID, name="Explicit database", api_endpoint=_ENDPOINT, api_key="encrypted-key"
        )
        target.id = _EXTENSION_ID
        with explicit_factory.begin() as session:
            session.add(target)
        outbound = _Outbound([])
        explicit_service = APIModerationService(
            find_extension=repository.find_extension,
            decrypt_key=outbound.decrypt,
            request_inputs=outbound.inputs,
            request_outputs=outbound.outputs,
        )
        explicit_service.validate_config(_TENANT_ID, api_config)
        assert (
            APIBasedExtensionRepository(session_factory=sqlite_session_factory).find_extension(
                _TENANT_ID, _EXTENSION_ID
            )
            is None
        )
    finally:
        engine.dispose()
