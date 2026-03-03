from dify_graph.model_runtime.errors.invoke import (
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
        # Now preserves class-level description
        error = InvokeConnectionError()
        assert error.description == "Connection Error"
        assert str(error) == "Connection Error"
        assert isinstance(error, InvokeError)

        # Test with explicit description
        error_with_desc = InvokeConnectionError("Connection Error")
        assert error_with_desc.description == "Connection Error"
        assert str(error_with_desc) == "Connection Error"

    def test_invoke_server_unavailable_error(self):
        error = InvokeServerUnavailableError()
        assert error.description == "Server Unavailable Error"
        assert str(error) == "Server Unavailable Error"
        assert isinstance(error, InvokeError)

    def test_invoke_rate_limit_error(self):
        error = InvokeRateLimitError()
        assert error.description == "Rate Limit Error"
        assert str(error) == "Rate Limit Error"
        assert isinstance(error, InvokeError)

    def test_invoke_authorization_error(self):
        error = InvokeAuthorizationError()
        assert error.description == "Incorrect model credentials provided, please check and try again. "
        assert str(error) == "Incorrect model credentials provided, please check and try again. "
        assert isinstance(error, InvokeError)

    def test_invoke_bad_request_error(self):
        error = InvokeBadRequestError()
        assert error.description == "Bad Request Error"
        assert str(error) == "Bad Request Error"
        assert isinstance(error, InvokeError)

    def test_invoke_error_inheritance(self):
        # Test that we can override the default description in subclasses
        error = InvokeBadRequestError("Overridden Error")
        assert error.description == "Overridden Error"
        assert str(error) == "Overridden Error"
