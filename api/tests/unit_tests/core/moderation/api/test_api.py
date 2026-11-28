from collections.abc import Iterator
from dataclasses import dataclass, field
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from pydantic import JsonValue, ValidationError
from sqlalchemy.orm import Session, sessionmaker

from core.extension.api_based_extension_requestor import APIBasedExtensionPoint
from core.moderation.api.api import ApiModeration, ModerationInputParams, ModerationOutputParams
from core.moderation.base import ModerationAction, ModerationInputsResult, ModerationOutputsResult
from models.api_based_extension import APIBasedExtension
from repositories.api_based_extension_repository import APIBasedExtensionRepository
from services.api_moderation_service import APIModerationService


@dataclass
class _Outbound:
    calls: list[tuple[str, str, dict[str, object]]] = field(default_factory=list)
    decrypt_calls: list[tuple[str, str]] = field(default_factory=list)

    def decrypt(self, tenant_id: str, ciphertext: str) -> str:
        self.decrypt_calls.append((tenant_id, ciphertext))
        return "decrypted-key"

    def request(self, endpoint: str, key: str, params: dict[str, object]) -> JsonValue:
        self.calls.append((endpoint, key, params))
        return {"flagged": True}


class TestApiModeration:
    @pytest.fixture(autouse=True)
    def bound_runtime(self, sqlite_session_factory: sessionmaker[Session]) -> Iterator[_Outbound]:
        with sqlite_session_factory.begin() as session:
            extension = APIBasedExtension(
                tenant_id="test-tenant-id",
                name="Test Extension",
                api_endpoint="http://api.test",
                api_key="encrypted-key",
            )
            extension.id = "test-extension-id"
            session.add(extension)
        outbound = _Outbound()
        app = Flask(__name__)
        app.extensions["api_moderation"] = APIModerationService(
            find_extension=APIBasedExtensionRepository(session_factory=sqlite_session_factory).find_extension,
            decrypt_key=outbound.decrypt,
            request_inputs=outbound.request,
            request_outputs=outbound.request,
        )
        with app.app_context():
            yield outbound

    @pytest.fixture
    def api_config(self) -> dict[str, object]:
        return {
            "inputs_config": {
                "enabled": True,
            },
            "outputs_config": {
                "enabled": True,
            },
            "api_based_extension_id": "test-extension-id",
        }

    @pytest.fixture
    def api_moderation(self, api_config: dict[str, object]) -> ApiModeration:
        return ApiModeration(app_id="test-app-id", tenant_id="test-tenant-id", config=api_config)

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
        params = ModerationOutputParams(app_id="app-1", text="test text")
        assert params.app_id == "app-1"
        assert params.text == "test text"

        with pytest.raises(ValidationError):
            ModerationOutputParams()  # pyrefly: ignore[missing-argument]

    def test_validate_config_success(self, bound_runtime: _Outbound, api_config: dict[str, object]) -> None:
        ApiModeration.validate_config("test-tenant-id", api_config)
        assert bound_runtime.decrypt_calls == []
        assert bound_runtime.calls == []

    def test_validate_config_missing_extension_id(self) -> None:
        config = {
            "inputs_config": {"enabled": True},
            "outputs_config": {"enabled": True},
        }
        with pytest.raises(ValueError, match="api_based_extension_id is required"):
            ApiModeration.validate_config("test-tenant-id", config)

    def test_validate_config_extension_not_found(self, api_config: dict[str, object]) -> None:
        api_config["api_based_extension_id"] = "missing"
        with pytest.raises(ValueError, match="API-based Extension not found"):
            ApiModeration.validate_config("test-tenant-id", api_config)

    @patch("core.moderation.api.api.ApiModeration._get_config_by_requestor")
    def test_moderation_for_inputs_enabled(self, mock_get_config: MagicMock, api_moderation: ApiModeration) -> None:
        mock_get_config.return_value = {"flagged": True, "action": "direct_output", "preset_response": "Blocked by API"}

        result = api_moderation.moderation_for_inputs(inputs={"q": "a"}, query="hello")

        assert isinstance(result, ModerationInputsResult)
        assert result.flagged is True
        assert result.action == ModerationAction.DIRECT_OUTPUT
        assert result.preset_response == "Blocked by API"

        mock_get_config.assert_called_once_with(
            APIBasedExtensionPoint.APP_MODERATION_INPUT,
            {"app_id": "test-app-id", "inputs": {"q": "a"}, "query": "hello"},
            "test-extension-id",
        )

    def test_moderation_for_inputs_disabled(self) -> None:
        config = {
            "inputs_config": {"enabled": False},
            "outputs_config": {"enabled": True},
            "api_based_extension_id": "ext-id",
        }
        moderation = ApiModeration("app-id", "tenant-id", config)
        result = moderation.moderation_for_inputs(inputs={}, query="")

        assert result.flagged is False
        assert result.action == ModerationAction.DIRECT_OUTPUT
        assert result.preset_response == ""

    def test_moderation_for_inputs_no_config(self) -> None:
        moderation = ApiModeration("app-id", "tenant-id", None)
        with pytest.raises(ValueError, match="The config is not set"):
            moderation.moderation_for_inputs({}, "")

    @patch("core.moderation.api.api.ApiModeration._get_config_by_requestor")
    def test_moderation_for_outputs_enabled(self, mock_get_config: MagicMock, api_moderation: ApiModeration) -> None:
        mock_get_config.return_value = {"flagged": False, "action": "direct_output", "preset_response": ""}

        result = api_moderation.moderation_for_outputs(text="hello world")

        assert isinstance(result, ModerationOutputsResult)
        assert result.flagged is False

        mock_get_config.assert_called_once_with(
            APIBasedExtensionPoint.APP_MODERATION_OUTPUT,
            {"app_id": "test-app-id", "text": "hello world"},
            "test-extension-id",
        )

    def test_moderation_for_outputs_disabled(self) -> None:
        config = {
            "inputs_config": {"enabled": True},
            "outputs_config": {"enabled": False},
            "api_based_extension_id": "ext-id",
        }
        moderation = ApiModeration("app-id", "tenant-id", config)
        result = moderation.moderation_for_outputs(text="test")

        assert result.flagged is False
        assert result.action == ModerationAction.DIRECT_OUTPUT

    def test_moderation_for_outputs_no_config(self) -> None:
        moderation = ApiModeration("app-id", "tenant-id", None)
        with pytest.raises(ValueError, match="The config is not set"):
            moderation.moderation_for_outputs("test")

    def test_get_config_by_requestor_success(self, bound_runtime: _Outbound, api_moderation: ApiModeration) -> None:
        params = {"some": "params"}
        result = api_moderation._get_config_by_requestor(
            APIBasedExtensionPoint.APP_MODERATION_INPUT, params, "test-extension-id"
        )

        assert result == {"flagged": True}
        assert bound_runtime.decrypt_calls == [("test-tenant-id", "encrypted-key")]
        assert bound_runtime.calls == [("http://api.test", "decrypted-key", params)]
        assert bound_runtime.calls[0][2] is params

    def test_get_config_by_requestor_no_config(self) -> None:
        moderation = ApiModeration("app-id", "tenant-id", None)
        with pytest.raises(ValueError, match="The config is not set"):
            moderation._get_config_by_requestor(APIBasedExtensionPoint.APP_MODERATION_INPUT, {}, "test-extension-id")

    def test_get_config_by_requestor_extension_not_found(self, api_moderation: ApiModeration) -> None:
        with pytest.raises(ValueError, match="API-based Extension not found"):
            api_moderation._get_config_by_requestor(APIBasedExtensionPoint.APP_MODERATION_INPUT, {}, "missing")

    def test_get_api_based_extension(
        self, sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        target = APIBasedExtension(
            tenant_id="tenant-1",
            name="Target extension",
            api_endpoint="https://example.com/moderate",
            api_key="encrypted-key",
        )
        target.id = "ext-1"
        other_tenant = APIBasedExtension(
            tenant_id="tenant-2",
            name="Other extension",
            api_endpoint="https://example.com/other",
            api_key="other-key",
        )
        other_tenant.id = "ext-2"
        sqlite_session.add_all((target, other_tenant))
        sqlite_session.commit()

        repository = APIBasedExtensionRepository(session_factory=sqlite_session_factory)
        result = repository.find_extension("tenant-1", "ext-1")
        assert result is not None
        assert result.id == target.id
        assert result.api_endpoint == target.api_endpoint
        assert repository.find_extension("tenant-1", "ext-2") is None
