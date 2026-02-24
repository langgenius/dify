from core.model_runtime.errors.invoke import (
    InvokeAuthorizationError,
    InvokeBadRequestError,
    InvokeConnectionError,
    InvokeError,
    InvokeRateLimitError,
    InvokeServerUnavailableError,
)


class TestInvokeErrors:
    def test_invoke_error_with_description(self):
        error = InvokeError("Custom description")
        assert error.description == "Custom description"
        assert str(error) == "Custom description"
        assert isinstance(error, ValueError)

    def test_invoke_error_without_description(self):
        error = InvokeError()
        assert error.description is None
        assert str(error) == "InvokeError"

    def test_invoke_connection_error(self):
        # Current implementation overwrites class-level description with None
        error = InvokeConnectionError()
        assert error.description is None
        assert str(error) == "InvokeConnectionError"
        assert isinstance(error, InvokeError)

        # Test with explicit description
        error_with_desc = InvokeConnectionError("Connection Error")
        assert error_with_desc.description == "Connection Error"
        assert str(error_with_desc) == "Connection Error"

    def test_invoke_server_unavailable_error(self):
        error = InvokeServerUnavailableError()
        assert error.description is None
        assert str(error) == "InvokeServerUnavailableError"
        assert isinstance(error, InvokeError)

    def test_invoke_rate_limit_error(self):
        error = InvokeRateLimitError()
        assert error.description is None
        assert str(error) == "InvokeRateLimitError"
        assert isinstance(error, InvokeError)

    def test_invoke_authorization_error(self):
        error = InvokeAuthorizationError()
        assert error.description is None
        assert str(error) == "InvokeAuthorizationError"
        assert isinstance(error, InvokeError)

    def test_invoke_bad_request_error(self):
        error = InvokeBadRequestError()
        assert error.description is None
        assert str(error) == "InvokeBadRequestError"
        assert isinstance(error, InvokeError)

    def test_invoke_error_inheritance(self):
        # Test that we can override the default description in subclasses
        error = InvokeBadRequestError("Overridden Error")
        assert error.description == "Overridden Error"
        assert str(error) == "Overridden Error"
