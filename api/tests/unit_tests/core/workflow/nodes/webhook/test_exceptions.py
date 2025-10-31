import pytest

from core.workflow.nodes.base.exc import BaseNodeError
from core.workflow.nodes.trigger_webhook.exc import (
    WebhookConfigError,
    WebhookNodeError,
    WebhookNotFoundError,
    WebhookTimeoutError,
)


def test_webhook_node_error_inheritance():
    """Test WebhookNodeError inherits from BaseNodeError."""
    assert issubclass(WebhookNodeError, BaseNodeError)

    # Test instantiation
    error = WebhookNodeError("Test error message")
    assert str(error) == "Test error message"
    assert isinstance(error, BaseNodeError)


def test_webhook_timeout_error():
    """Test WebhookTimeoutError functionality."""
    # Test inheritance
    assert issubclass(WebhookTimeoutError, WebhookNodeError)
    assert issubclass(WebhookTimeoutError, BaseNodeError)

    # Test instantiation with message
    error = WebhookTimeoutError("Webhook request timed out")
    assert str(error) == "Webhook request timed out"

    # Test instantiation without message
    error_no_msg = WebhookTimeoutError()
    assert isinstance(error_no_msg, WebhookTimeoutError)


def test_webhook_not_found_error():
    """Test WebhookNotFoundError functionality."""
    # Test inheritance
    assert issubclass(WebhookNotFoundError, WebhookNodeError)
    assert issubclass(WebhookNotFoundError, BaseNodeError)

    # Test instantiation with message
    error = WebhookNotFoundError("Webhook trigger not found")
    assert str(error) == "Webhook trigger not found"

    # Test instantiation without message
    error_no_msg = WebhookNotFoundError()
    assert isinstance(error_no_msg, WebhookNotFoundError)


def test_webhook_config_error():
    """Test WebhookConfigError functionality."""
    # Test inheritance
    assert issubclass(WebhookConfigError, WebhookNodeError)
    assert issubclass(WebhookConfigError, BaseNodeError)

    # Test instantiation with message
    error = WebhookConfigError("Invalid webhook configuration")
    assert str(error) == "Invalid webhook configuration"

    # Test instantiation without message
    error_no_msg = WebhookConfigError()
    assert isinstance(error_no_msg, WebhookConfigError)


def test_webhook_error_hierarchy():
    """Test the complete webhook error hierarchy."""
    # All webhook errors should inherit from WebhookNodeError
    webhook_errors = [
        WebhookTimeoutError,
        WebhookNotFoundError,
        WebhookConfigError,
    ]

    for error_class in webhook_errors:
        assert issubclass(error_class, WebhookNodeError)
        assert issubclass(error_class, BaseNodeError)


def test_webhook_error_instantiation_with_args():
    """Test webhook error instantiation with various arguments."""
    # Test with single string argument
    error1 = WebhookNodeError("Simple error message")
    assert str(error1) == "Simple error message"

    # Test with multiple arguments
    error2 = WebhookTimeoutError("Timeout after", 30, "seconds")
    # Note: The exact string representation depends on Exception.__str__ implementation
    assert "Timeout after" in str(error2)

    # Test with keyword arguments (if supported by base Exception)
    error3 = WebhookConfigError("Config error in field: timeout")
    assert "Config error in field: timeout" in str(error3)


def test_webhook_error_as_exceptions():
    """Test that webhook errors can be raised and caught properly."""
    # Test raising and catching WebhookNodeError
    with pytest.raises(WebhookNodeError) as exc_info:
        raise WebhookNodeError("Base webhook error")
    assert str(exc_info.value) == "Base webhook error"

    # Test raising and catching specific errors
    with pytest.raises(WebhookTimeoutError) as exc_info:
        raise WebhookTimeoutError("Request timeout")
    assert str(exc_info.value) == "Request timeout"

    with pytest.raises(WebhookNotFoundError) as exc_info:
        raise WebhookNotFoundError("Webhook not found")
    assert str(exc_info.value) == "Webhook not found"

    with pytest.raises(WebhookConfigError) as exc_info:
        raise WebhookConfigError("Invalid config")
    assert str(exc_info.value) == "Invalid config"


def test_webhook_error_catching_hierarchy():
    """Test that webhook errors can be caught by their parent classes."""
    # WebhookTimeoutError should be catchable as WebhookNodeError
    with pytest.raises(WebhookNodeError):
        raise WebhookTimeoutError("Timeout error")

    # WebhookNotFoundError should be catchable as WebhookNodeError
    with pytest.raises(WebhookNodeError):
        raise WebhookNotFoundError("Not found error")

    # WebhookConfigError should be catchable as WebhookNodeError
    with pytest.raises(WebhookNodeError):
        raise WebhookConfigError("Config error")

    # All webhook errors should be catchable as BaseNodeError
    with pytest.raises(BaseNodeError):
        raise WebhookTimeoutError("Timeout as base error")

    with pytest.raises(BaseNodeError):
        raise WebhookNotFoundError("Not found as base error")

    with pytest.raises(BaseNodeError):
        raise WebhookConfigError("Config as base error")


def test_webhook_error_attributes():
    """Test webhook error class attributes."""
    # Test that all error classes have proper __name__
    assert WebhookNodeError.__name__ == "WebhookNodeError"
    assert WebhookTimeoutError.__name__ == "WebhookTimeoutError"
    assert WebhookNotFoundError.__name__ == "WebhookNotFoundError"
    assert WebhookConfigError.__name__ == "WebhookConfigError"

    # Test that all error classes have proper __module__
    expected_module = "core.workflow.nodes.trigger_webhook.exc"
    assert WebhookNodeError.__module__ == expected_module
    assert WebhookTimeoutError.__module__ == expected_module
    assert WebhookNotFoundError.__module__ == expected_module
    assert WebhookConfigError.__module__ == expected_module


def test_webhook_error_docstrings():
    """Test webhook error class docstrings."""
    assert WebhookNodeError.__doc__ == "Base webhook node error."
    assert WebhookTimeoutError.__doc__ == "Webhook timeout error."
    assert WebhookNotFoundError.__doc__ == "Webhook not found error."
    assert WebhookConfigError.__doc__ == "Webhook configuration error."


def test_webhook_error_repr_and_str():
    """Test webhook error string representations."""
    error = WebhookNodeError("Test message")

    # Test __str__ method
    assert str(error) == "Test message"

    # Test __repr__ method (should include class name)
    repr_str = repr(error)
    assert "WebhookNodeError" in repr_str
    assert "Test message" in repr_str


def test_webhook_error_with_no_message():
    """Test webhook errors with no message."""
    # Test that errors can be instantiated without messages
    errors = [
        WebhookNodeError(),
        WebhookTimeoutError(),
        WebhookNotFoundError(),
        WebhookConfigError(),
    ]

    for error in errors:
        # Should be instances of their respective classes
        assert isinstance(error, type(error))
        # Should be able to be raised
        with pytest.raises(type(error)):
            raise error
