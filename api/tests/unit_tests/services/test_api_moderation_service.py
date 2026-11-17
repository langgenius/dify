import re
from collections.abc import Iterator, Mapping

import pytest
from pydantic import ValidationError
from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from models.api_based_extension import APIBasedExtension
from models.base import TypeBase
from repositories.api_based_extension_repository import APIBasedExtensionRepository
from services.api_moderation_service import (
    APIModerationConfig,
    APIModerationService,
    DisabledDirection,
    ModerationInputParams,
    ModerationOutputParams,
    parse_direction,
)

_EXTENSION_ID = "a0000000-0000-0000-0000-000000000001"
_FOREIGN_EXTENSION_ID = "a0000000-0000-0000-0000-000000000002"
_MISSING_EXTENSION_ID = "a0000000-0000-0000-0000-000000000003"
_TENANT_ID = "a0000000-0000-0000-0000-000000000004"
_FOREIGN_TENANT_ID = "a0000000-0000-0000-0000-000000000005"
_ENDPOINT = "https://moderation.example.test/check"
_EXTENSION_NOT_FOUND = r"^API-based Extension not found\. Please check it again\.$"


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
def service(sqlite_session_factory: sessionmaker[Session], outbound: _Outbound) -> APIModerationService:
    return APIModerationService(
        find_extension=APIBasedExtensionRepository(session_factory=sqlite_session_factory).find_extension,
        decrypt_key=outbound.decrypt,
        request_inputs=outbound.inputs,
        request_outputs=outbound.outputs,
    )


def _moderate(service: APIModerationService, raw: Mapping[str, object] | None, direction: str) -> object:
    if direction == "inputs":
        return service.moderate_inputs(_TENANT_ID, "test-app-id", raw, {"q": "a"}, "hello")
    return service.moderate_outputs(_TENANT_ID, "test-app-id", raw, "hello world")


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


def test_validate_config_success(
    service: APIModerationService, api_config: APIModerationConfig, lookup_events: list[str]
) -> None:
    service.validate_config(_TENANT_ID, api_config)
    assert lookup_events == ["checkout", "checkin"]


@pytest.mark.parametrize(
    ("config", "message"),
    [
        ({}, "inputs_config must be a dict"),
        ({"inputs_config": [], "outputs_config": []}, "inputs_config must be a dict"),
        ({"inputs_config": {}}, "outputs_config must be a dict"),
        (
            {"inputs_config": {"enabled": False}, "outputs_config": {"enabled": False}},
            "At least one of inputs_config or outputs_config must be enabled",
        ),
        (
            {"inputs_config": {"enabled": True}, "outputs_config": {"enabled": True}},
            "api_based_extension_id is required",
        ),
    ],
)
def test_validate_config_rejects_invalid_config_before_lookup(
    service: APIModerationService, config: dict[str, object], message: str, lookup_events: list[str]
) -> None:
    with pytest.raises(ValueError, match=f"^{re.escape(message)}$"):
        service.validate_config(_TENANT_ID, config)
    assert lookup_events == []


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
    direction: str,
    api_config: APIModerationConfig,
    lookup_events: list[str],
    outbound: _Outbound,
) -> None:
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
@pytest.mark.parametrize("extension_id", [_MISSING_EXTENSION_ID, _FOREIGN_EXTENSION_ID, None])
def test_enabled_moderation_extension_not_found(
    service: APIModerationService,
    direction: str,
    extension_id: str | None,
    api_config: APIModerationConfig,
    lookup_events: list[str],
) -> None:
    if extension_id is None:
        del api_config["api_based_extension_id"]
    else:
        api_config["api_based_extension_id"] = extension_id
    with pytest.raises(ValueError, match=_EXTENSION_NOT_FOUND):
        _moderate(service, api_config, direction)
    assert lookup_events == ["checkout", "checkin"]


@pytest.mark.parametrize("direction", ["inputs", "outputs"])
def test_disabled_moderation_skips_lookup(
    service: APIModerationService, direction: str, api_config: APIModerationConfig, lookup_events: list[str]
) -> None:
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
    service: APIModerationService, direction: str, lookup_events: list[str]
) -> None:
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
    direction: str,
    stage: str,
) -> None:
    failure = RuntimeError(f"{stage} failed")
    outbound.failure = (stage, failure)
    with pytest.raises(RuntimeError) as exc_info:
        _moderate(service, api_config, direction)
    assert exc_info.value is failure
    expected = ["checkout", "checkin", "decrypt"]
    if stage == "request":
        expected.append("request")
    assert lookup_events == expected


@pytest.mark.parametrize("value", ["yes", 1, [False]])
def test_non_boolean_truthiness_is_preserved(
    service: APIModerationService, api_config: APIModerationConfig, value: object, lookup_events: list[str]
) -> None:
    api_config["inputs_config"] = {"enabled": value}
    service.moderate_inputs(_TENANT_ID, "app", api_config, {})
    assert lookup_events == ["checkout", "checkin", "decrypt", "request"]


@pytest.mark.parametrize("selected", [None, [], "invalid", 1, {}])
def test_selected_malformed_direction_retains_native_error(
    service: APIModerationService, selected: object, lookup_events: list[str]
) -> None:
    raw = {"inputs_config": selected}
    with pytest.raises((KeyError, TypeError)):
        service.moderate_inputs(_TENANT_ID, "app", raw, {})
    assert lookup_events == []


def test_disabled_directions_ignore_opposite_malformed_values(
    service: APIModerationService, lookup_events: list[str]
) -> None:
    assert parse_direction({"inputs_config": {"enabled": False}, "outputs_config": None}, "inputs_config") == (
        DisabledDirection()
    )
    for direction in ("inputs", "outputs"):
        assert _moderate(
            service, {"inputs_config": {"enabled": False}, "outputs_config": {"enabled": False}}, direction
        ) == {"flagged": False, "action": "direct_output", "preset_response": ""}
    assert lookup_events == []


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
