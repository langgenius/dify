import re
from collections.abc import Iterator

import pytest
from pydantic import ValidationError
from sqlalchemy import Engine, event
from sqlalchemy.orm import Session, sessionmaker

from core.extension.api_based_extension_requestor import APIBasedExtensionRequestor
from core.moderation.api.api import ApiModeration, ModerationInputParams, ModerationOutputParams
from core.moderation.base import ModerationAction, ModerationInputsResult, ModerationOutputsResult
from models.api_based_extension import APIBasedExtension, APIBasedExtensionPoint

_EXTENSION_ID = "a0000000-0000-0000-0000-000000000001"
_FOREIGN_EXTENSION_ID = "a0000000-0000-0000-0000-000000000002"
_MISSING_EXTENSION_ID = "a0000000-0000-0000-0000-000000000003"
_TENANT_ID = "a0000000-0000-0000-0000-000000000004"
_FOREIGN_TENANT_ID = "a0000000-0000-0000-0000-000000000005"
_ENDPOINT = "https://moderation.example.test/check"
_EXTENSION_NOT_FOUND = r"^API-based Extension not found\. Please check it again\.$"


class TestApiModeration:
    @pytest.fixture
    def api_config(self) -> dict[str, object]:
        """Return enabled input/output settings for the seeded tenant-owned extension."""
        return {
            "inputs_config": {
                "enabled": True,
            },
            "outputs_config": {
                "enabled": True,
            },
            "api_based_extension_id": _EXTENSION_ID,
        }

    @pytest.fixture
    def lookup_events(
        self, sqlite_engine: Engine, sqlite_session_factory: sessionmaker[Session]
    ) -> Iterator[list[str]]:
        """Observe pool activity after committing the owner and foreign extension rows."""
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
            """Record that the lookup acquired a real pooled connection."""
            events.append("checkout")

        def checkin(*_args: object) -> None:
            """Record that the lookup returned its pooled connection."""
            events.append("checkin")

        event.listen(sqlite_engine, "checkout", checkout)
        event.listen(sqlite_engine, "checkin", checkin)
        try:
            yield events
        finally:
            event.remove(sqlite_engine, "checkout", checkout)
            event.remove(sqlite_engine, "checkin", checkin)

    @pytest.fixture
    def no_external_calls(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Fail if moderation attempts decryption or dispatches an extension request."""

        def unexpected_call(*_args: object, **_kwargs: object) -> None:
            """Fail if a guarded path decrypts or dispatches an extension request."""
            pytest.fail("Unexpected decryption or extension request")

        monkeypatch.setattr("core.moderation.api.api.decrypt_token", unexpected_call)
        monkeypatch.setattr(APIBasedExtensionRequestor, "request", unexpected_call)

    def test_moderation_input_params(self) -> None:
        params = ModerationInputParams(app_id="app-1", inputs={"key": "val"}, query="test query")
        assert params.app_id == "app-1"
        assert params.inputs == {"key": "val"}
        assert params.query == "test query"

        # Test defaults
        params_default = ModerationInputParams()
        assert params_default.app_id == ""
        assert params_default.inputs == {}
        assert params_default.query == ""

    def test_moderation_output_params(self) -> None:
        """Validate output parameter values and reject a missing required text field."""
        params = ModerationOutputParams(app_id="app-1", text="test text")
        assert params.app_id == "app-1"
        assert params.text == "test text"

        with pytest.raises(ValidationError):
            ModerationOutputParams.model_validate({})

    @pytest.mark.usefixtures("no_external_calls")
    def test_validate_config_success(self, api_config: dict[str, object], lookup_events: list[str]) -> None:
        """Accept the seeded owned extension and release the read without external I/O."""
        ApiModeration.validate_config(_TENANT_ID, api_config)

        assert lookup_events == ["checkout", "checkin"]

    @pytest.mark.parametrize(
        ("config", "message"),
        [
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
    @pytest.mark.usefixtures("no_external_calls")
    def test_validate_config_rejects_invalid_config_before_lookup(
        self, config: dict[str, object], message: str, lookup_events: list[str]
    ) -> None:
        """Reject invalid settings in the existing order without opening a connection."""
        with pytest.raises(ValueError, match=f"^{re.escape(message)}$"):
            ApiModeration.validate_config(_TENANT_ID, config)

        assert lookup_events == []

    @pytest.mark.parametrize("extension_id", [_MISSING_EXTENSION_ID, _FOREIGN_EXTENSION_ID])
    @pytest.mark.usefixtures("no_external_calls")
    def test_validate_config_extension_not_found(
        self, extension_id: str, api_config: dict[str, object], lookup_events: list[str]
    ) -> None:
        """Reject missing or foreign extensions and release the lookup connection."""
        api_config["api_based_extension_id"] = extension_id

        with pytest.raises(ValueError, match=_EXTENSION_NOT_FOUND):
            ApiModeration.validate_config(_TENANT_ID, api_config)

        assert lookup_events == ["checkout", "checkin"]

    @pytest.mark.parametrize("direction", ["inputs", "outputs"])
    def test_enabled_moderation_releases_connection_before_external_io(
        self,
        direction: str,
        api_config: dict[str, object],
        lookup_events: list[str],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Preserve the selected request and result after returning the lookup connection."""
        moderation = ApiModeration("test-app-id", _TENANT_ID, api_config)
        response: dict[str, object]
        if direction == "inputs":
            point = APIBasedExtensionPoint.APP_MODERATION_INPUT
            params = {"app_id": "test-app-id", "inputs": {"q": "a"}, "query": "hello"}
            response = {"flagged": True, "action": "direct_output", "preset_response": "Blocked by API"}
            expected = ModerationInputsResult(
                flagged=True, action=ModerationAction.DIRECT_OUTPUT, preset_response="Blocked by API"
            )
        else:
            point = APIBasedExtensionPoint.APP_MODERATION_OUTPUT
            params = {"app_id": "test-app-id", "text": "hello world"}
            response = {"flagged": False, "action": "direct_output", "preset_response": ""}
            expected = ModerationOutputsResult(action=ModerationAction.DIRECT_OUTPUT)

        def decrypt(tenant_id: str, encrypted_key: str) -> str:
            """Check the tenant and ciphertext after lookup release, then supply the test key."""
            assert lookup_events == ["checkout", "checkin"]
            assert (tenant_id, encrypted_key) == (_TENANT_ID, "encrypted-key")
            lookup_events.append("decrypt")
            return "decrypted-key"

        def request(
            requestor: APIBasedExtensionRequestor,
            actual_point: APIBasedExtensionPoint,
            actual_params: dict[str, object],
        ) -> dict[str, object]:
            """Check the constructed requestor and dispatch arguments after lookup release."""
            assert lookup_events == ["checkout", "checkin", "decrypt"]
            assert requestor.api_endpoint == _ENDPOINT
            assert requestor.api_key == "decrypted-key"
            assert actual_point is point
            assert actual_params == params
            lookup_events.append("request")
            return response

        monkeypatch.setattr("core.moderation.api.api.decrypt_token", decrypt)
        monkeypatch.setattr(APIBasedExtensionRequestor, "request", request)

        assert _moderate(moderation, direction) == expected
        assert lookup_events == ["checkout", "checkin", "decrypt", "request"]

    @pytest.mark.parametrize("direction", ["inputs", "outputs"])
    @pytest.mark.parametrize("extension_id", [_MISSING_EXTENSION_ID, _FOREIGN_EXTENSION_ID, None])
    @pytest.mark.usefixtures("no_external_calls")
    def test_enabled_moderation_extension_not_found(
        self, direction: str, extension_id: str | None, api_config: dict[str, object], lookup_events: list[str]
    ) -> None:
        """Reject absent or foreign runtime extensions without external I/O."""
        if extension_id is None:
            del api_config["api_based_extension_id"]
        else:
            api_config["api_based_extension_id"] = extension_id
        moderation = ApiModeration("test-app-id", _TENANT_ID, api_config)

        with pytest.raises(ValueError, match=_EXTENSION_NOT_FOUND):
            _moderate(moderation, direction)

        assert lookup_events == ["checkout", "checkin"]

    @pytest.mark.parametrize("direction", ["inputs", "outputs"])
    @pytest.mark.usefixtures("no_external_calls")
    def test_disabled_moderation_skips_lookup(
        self, direction: str, api_config: dict[str, object], lookup_events: list[str]
    ) -> None:
        """Return the disabled result without database or external I/O."""
        api_config[f"{direction}_config"] = {"enabled": False}
        moderation = ApiModeration("test-app-id", _TENANT_ID, api_config)

        result = _moderate(moderation, direction)
        if direction == "inputs":
            assert result == ModerationInputsResult(action=ModerationAction.DIRECT_OUTPUT)
        else:
            assert result == ModerationOutputsResult(action=ModerationAction.DIRECT_OUTPUT)

        assert lookup_events == []

    @pytest.mark.parametrize("direction", ["inputs", "outputs"])
    @pytest.mark.usefixtures("no_external_calls")
    def test_moderation_without_config_skips_lookup(self, direction: str, lookup_events: list[str]) -> None:
        """Reject absent runtime config before database or external I/O."""
        moderation = ApiModeration("test-app-id", _TENANT_ID, None)

        with pytest.raises(ValueError, match=r"^The config is not set\.$"):
            _moderate(moderation, direction)

        assert lookup_events == []

    @pytest.mark.usefixtures("no_external_calls")
    def test_get_config_by_requestor_no_config(self, lookup_events: list[str]) -> None:
        """Reject absent config in the private request helper without I/O."""
        moderation = ApiModeration("test-app-id", _TENANT_ID, None)

        with pytest.raises(ValueError, match=r"^The config is not set\.$"):
            moderation._get_config_by_requestor(APIBasedExtensionPoint.APP_MODERATION_INPUT, {})

        assert lookup_events == []

    @pytest.mark.usefixtures("no_external_calls")
    def test_lookup_failure_releases_connection(
        self, api_config: dict[str, object], lookup_events: list[str], sqlite_engine: Engine
    ) -> None:
        """Propagate the original query failure after returning its connection."""
        failure = RuntimeError("lookup failed")

        def fail_query(*_args: object) -> None:
            """Raise the test failure after the real connection has been checked out."""
            raise failure

        event.listen(sqlite_engine, "before_cursor_execute", fail_query)
        try:
            with pytest.raises(RuntimeError) as exc_info:
                ApiModeration("test-app-id", _TENANT_ID, api_config).moderation_for_outputs("test")
        finally:
            event.remove(sqlite_engine, "before_cursor_execute", fail_query)

        assert exc_info.value is failure
        assert lookup_events == ["checkout", "checkin"]


def _moderate(moderation: ApiModeration, direction: str) -> ModerationInputsResult | ModerationOutputsResult:
    """Call the selected public moderation entry point with sample content."""
    if direction == "inputs":
        return moderation.moderation_for_inputs({"q": "a"}, "hello")
    return moderation.moderation_for_outputs("hello world")
