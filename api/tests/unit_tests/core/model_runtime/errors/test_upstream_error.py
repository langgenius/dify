from core.app.apps.base_app_generate_response_converter import AppGenerateResponseConverter
from core.model_runtime.errors.invoke import InvokeError
from core.model_runtime.errors.upstream import maybe_convert_upstream_error


class TestUpstreamErrorConversion:
    def test_convert_known_code_used_up(self):
        # Arrange
        provider_name = "openai"
        raw = {"error": {"code": "used_up", "message": "Your balance is not sufficient"}}
        err = ValueError(raw)

        # Act
        converted = maybe_convert_upstream_error(provider_name=provider_name, error=err)

        # Assert
        assert isinstance(converted, InvokeError)
        assert converted.error_code == "used_up"
        assert "Your balance is not sufficient" in (converted.description or "")
        assert converted.description
        assert converted.description.startswith("[openai]")

    def test_convert_unknown_code_keeps_message(self):
        # Arrange
        provider_name = "openai"
        raw = {"code": "some_new_code", "message": "Something happened upstream"}
        err = ValueError(raw)

        # Act
        converted = maybe_convert_upstream_error(provider_name=provider_name, error=err)

        # Assert
        assert isinstance(converted, InvokeError)
        assert converted.error_code == "some_new_code"
        assert "Something happened upstream" in (converted.description or "")

    def test_non_structured_value_error_not_converted(self):
        # Arrange
        err = ValueError("plain message")

        # Act
        converted = maybe_convert_upstream_error(provider_name="openai", error=err)

        # Assert
        assert converted is None


class TestStreamErrorCodeOverride:
    def test_invoke_error_with_error_code_overrides_response_code(self):
        # Arrange
        err = InvokeError(description="[openai] 余额不足", error_code="used_up")

        # Act
        data = AppGenerateResponseConverter._error_to_stream_response(err)

        # Assert
        assert data["code"] == "used_up"
        assert data["status"] == 400
        assert data["message"] == "[openai] 余额不足"
