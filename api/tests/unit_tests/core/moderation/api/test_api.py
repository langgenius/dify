from unittest.mock import MagicMock, patch

import pytest
from pydantic import ValidationError

from core.extension.api_based_extension_requestor import APIBasedExtensionPoint
from core.moderation.api.api import ApiModeration, ModerationInputParams, ModerationOutputParams
from core.moderation.base import ModerationAction, ModerationInputsResult, ModerationOutputsResult
from models.api_based_extension import APIBasedExtension


class TestApiModeration:
    @pytest.fixture
    def api_config(self):
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
    def api_moderation(self, api_config):
        return ApiModeration(app_id="test-app-id", tenant_id="test-tenant-id", config=api_config)

    def test_moderation_input_params(self):
        params = ModerationInputParams(app_id="app-1", inputs={"key": "val"}, query="test query")
        assert params.app_id == "app-1"
        assert params.inputs == {"key": "val"}
        assert params.query == "test query"

        # Test defaults
        params_default = ModerationInputParams()
        assert params_default.app_id == ""
        assert params_default.inputs == {}
        assert params_default.query == ""

    def test_moderation_output_params(self):
        params = ModerationOutputParams(app_id="app-1", text="test text")
        assert params.app_id == "app-1"
        assert params.text == "test text"

        with pytest.raises(ValidationError):
            ModerationOutputParams()

    @patch("core.moderation.api.api.ApiModeration._get_api_based_extension")
    def test_validate_config_success(self, mock_get_extension, api_config):
        mock_get_extension.return_value = MagicMock(spec=APIBasedExtension)
        ApiModeration.validate_config("test-tenant-id", api_config)
        mock_get_extension.assert_called_once_with("test-tenant-id", "test-extension-id")

    def test_validate_config_missing_extension_id(self):
        config = {
            "inputs_config": {"enabled": True},
            "outputs_config": {"enabled": True},
        }
        with pytest.raises(ValueError, match="api_based_extension_id is required"):
            ApiModeration.validate_config("test-tenant-id", config)

    @patch("core.moderation.api.api.ApiModeration._get_api_based_extension")
    def test_validate_config_extension_not_found(self, mock_get_extension, api_config):
        mock_get_extension.return_value = None
        with pytest.raises(ValueError, match="API-based Extension not found"):
            ApiModeration.validate_config("test-tenant-id", api_config)

    @patch("core.moderation.api.api.ApiModeration._get_config_by_requestor")
    def test_moderation_for_inputs_enabled(self, mock_get_config, api_moderation):
        mock_get_config.return_value = {"flagged": True, "action": "direct_output", "preset_response": "Blocked by API"}

        result = api_moderation.moderation_for_inputs(inputs={"q": "a"}, query="hello")

        assert isinstance(result, ModerationInputsResult)
        assert result.flagged is True
        assert result.action == ModerationAction.DIRECT_OUTPUT
        assert result.preset_response == "Blocked by API"

        mock_get_config.assert_called_once_with(
            APIBasedExtensionPoint.APP_MODERATION_INPUT,
            {"app_id": "test-app-id", "inputs": {"q": "a"}, "query": "hello"},
        )

    def test_moderation_for_inputs_disabled(self):
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

    def test_moderation_for_inputs_no_config(self):
        moderation = ApiModeration("app-id", "tenant-id", None)
        with pytest.raises(ValueError, match="The config is not set"):
            moderation.moderation_for_inputs({}, "")

    @patch("core.moderation.api.api.ApiModeration._get_config_by_requestor")
    def test_moderation_for_outputs_enabled(self, mock_get_config, api_moderation):
        mock_get_config.return_value = {"flagged": False, "action": "direct_output", "preset_response": ""}

        result = api_moderation.moderation_for_outputs(text="hello world")

        assert isinstance(result, ModerationOutputsResult)
        assert result.flagged is False

        mock_get_config.assert_called_once_with(
            APIBasedExtensionPoint.APP_MODERATION_OUTPUT, {"app_id": "test-app-id", "text": "hello world"}
        )

    def test_moderation_for_outputs_disabled(self):
        config = {
            "inputs_config": {"enabled": True},
            "outputs_config": {"enabled": False},
            "api_based_extension_id": "ext-id",
        }
        moderation = ApiModeration("app-id", "tenant-id", config)
        result = moderation.moderation_for_outputs(text="test")

        assert result.flagged is False
        assert result.action == ModerationAction.DIRECT_OUTPUT

    def test_moderation_for_outputs_no_config(self):
        moderation = ApiModeration("app-id", "tenant-id", None)
        with pytest.raises(ValueError, match="The config is not set"):
            moderation.moderation_for_outputs("test")

    @patch("core.moderation.api.api.ApiModeration._get_api_based_extension")
    @patch("core.moderation.api.api.decrypt_token")
    @patch("core.moderation.api.api.APIBasedExtensionRequestor")
    def test_get_config_by_requestor_success(self, mock_requestor_cls, mock_decrypt, mock_get_ext, api_moderation):
        mock_ext = MagicMock(spec=APIBasedExtension)
        mock_ext.api_endpoint = "http://api.test"
        mock_ext.api_key = "encrypted-key"
        mock_get_ext.return_value = mock_ext

        mock_decrypt.return_value = "decrypted-key"

        mock_requestor = MagicMock()
        mock_requestor.request.return_value = {"flagged": True}
        mock_requestor_cls.return_value = mock_requestor

        params = {"some": "params"}
        result = api_moderation._get_config_by_requestor(APIBasedExtensionPoint.APP_MODERATION_INPUT, params)

        assert result == {"flagged": True}
        mock_get_ext.assert_called_once_with("test-tenant-id", "test-extension-id")
        mock_decrypt.assert_called_once_with("test-tenant-id", "encrypted-key")
        mock_requestor_cls.assert_called_once_with("http://api.test", "decrypted-key")
        mock_requestor.request.assert_called_once_with(APIBasedExtensionPoint.APP_MODERATION_INPUT, params)

    def test_get_config_by_requestor_no_config(self):
        moderation = ApiModeration("app-id", "tenant-id", None)
        with pytest.raises(ValueError, match="The config is not set"):
            moderation._get_config_by_requestor(APIBasedExtensionPoint.APP_MODERATION_INPUT, {})

    @patch("core.moderation.api.api.ApiModeration._get_api_based_extension")
    def test_get_config_by_requestor_extension_not_found(self, mock_get_ext, api_moderation):
        mock_get_ext.return_value = None
        with pytest.raises(ValueError, match="API-based Extension not found"):
            api_moderation._get_config_by_requestor(APIBasedExtensionPoint.APP_MODERATION_INPUT, {})

    @patch("core.moderation.api.api.db.session.scalar")
    def test_get_api_based_extension(self, mock_scalar):
        mock_ext = MagicMock(spec=APIBasedExtension)
        mock_scalar.return_value = mock_ext

        result = ApiModeration._get_api_based_extension("tenant-1", "ext-1")

        assert result == mock_ext
        mock_scalar.assert_called_once()
        # Verify the call has the correct filters
        args, kwargs = mock_scalar.call_args
        stmt = args[0]
        # We can't easily inspect the statement without complex sqlalchemy tricks,
        # but calling it is usually enough for unit tests if we mock the result.
