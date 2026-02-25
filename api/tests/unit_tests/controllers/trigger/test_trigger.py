"""Unit tests for Trigger Controller.

This module provides comprehensive test coverage for the trigger controller which handles
plugin endpoint trigger calls. The controller processes incoming HTTP requests and routes
them through a handling chain to either process endpoint triggers or builder validation
endpoints.

The trigger controller is responsible for:
- Validating endpoint IDs (must be valid UUIDs)
- Processing endpoint trigger calls through a handling chain
- Handling webhook trigger processing
- Managing schedule trigger validation
- Trigger status management
- Error handling and response formatting

Test Coverage:
- Endpoint ID validation (UUID format)
- Trigger endpoint processing
- Handling chain execution
- Webhook trigger handling
- Schedule trigger validation
- Error handling for various failure scenarios
- Response generation and status codes
"""

from unittest.mock import MagicMock, patch

import pytest
from flask import Flask, Request, Response, jsonify
from werkzeug.exceptions import NotFound

from controllers.trigger.trigger import trigger_endpoint


class TestTriggerEndpoint:
    """Test suite for trigger_endpoint function.

    This class tests the main trigger endpoint that handles plugin endpoint trigger calls.
    Tests cover:
    - Endpoint ID validation (UUID format)
    - Handling chain execution
    - Response processing
    - Error handling
    """

    @pytest.fixture
    def app(self):
        """Create Flask application instance for testing.

        Returns:
            Flask: Configured Flask app with testing enabled
        """
        app = Flask(__name__)
        app.config["TESTING"] = True
        app.config["SECRET_KEY"] = "test-secret-key"
        return app

    @pytest.fixture
    def valid_uuid(self):
        """Create a valid UUID string for testing.

        Returns:
            str: Valid UUID v4 string
        """
        return "12345678-1234-4123-8123-123456789abc"

    @pytest.fixture
    def invalid_endpoint_id(self):
        """Create an invalid endpoint ID (not a UUID).

        Returns:
            str: Invalid endpoint ID string
        """
        return "invalid-endpoint-id"

    @pytest.fixture
    def mock_request(self):
        """Create a mock Flask request object.

        Returns:
            MagicMock: Mock Flask Request with required attributes
        """
        request = MagicMock(spec=Request)
        request.method = "POST"
        request.url = "http://example.com/trigger/endpoint"
        request.headers = {}
        request.get_data.return_value = b'{"key": "value"}'
        return request

    def test_trigger_endpoint_valid_uuid_success(
        self, app, valid_uuid, mock_request
    ):
        """Test successful trigger endpoint processing with valid UUID.

        This test verifies that:
        - Valid UUID endpoint IDs are accepted
        - Handling chain is executed in order
        - First handler that returns a response is used
        - Successful response is returned

        Args:
            app: Flask application fixture
            valid_uuid: Valid UUID string fixture
            mock_request: Mock Flask request fixture
        """
        # Arrange: Set up test data
        expected_response = jsonify({"status": "success", "message": "Trigger processed"})
        expected_response.status_code = 200

        with app.test_request_context(
            method="POST",
            json={"key": "value"},
            path=f"/plugin/{valid_uuid}",
        ):
            with (
                # Mock the handling chain services
                patch(
                    "controllers.trigger.trigger.TriggerService.process_endpoint"
                ) as mock_process_endpoint,
                patch(
                    "controllers.trigger.trigger.TriggerSubscriptionBuilderService.process_builder_validation_endpoint"
                ) as mock_process_builder,
                patch("controllers.trigger.trigger.request", mock_request),
            ):
                # Configure first handler to return a response
                mock_process_endpoint.return_value = expected_response
                # Second handler should not be called since first returns response
                mock_process_builder.return_value = None

                # Act: Call the trigger endpoint
                result = trigger_endpoint(valid_uuid)

                # Assert: Verify the response
                assert result == expected_response
                # Verify first handler was called
                mock_process_endpoint.assert_called_once_with(valid_uuid, mock_request)
                # Verify second handler was not called (chain stops at first response)
                mock_process_builder.assert_not_called()

    def test_trigger_endpoint_second_handler_returns_response(
        self, app, valid_uuid, mock_request
    ):
        """Test trigger endpoint when first handler returns None and second returns response.

        This test verifies that:
        - Handling chain continues if first handler returns None
        - Second handler is called when first returns None
        - Response from second handler is returned

        Args:
            app: Flask application fixture
            valid_uuid: Valid UUID string fixture
            mock_request: Mock Flask request fixture
        """
        # Arrange: Set up test data
        expected_response = jsonify({"status": "builder_validation", "message": "Validation processed"})
        expected_response.status_code = 200

        with app.test_request_context(
            method="POST",
            json={"key": "value"},
            path=f"/plugin/{valid_uuid}",
        ):
            with (
                patch(
                    "controllers.trigger.trigger.TriggerService.process_endpoint"
                ) as mock_process_endpoint,
                patch(
                    "controllers.trigger.trigger.TriggerSubscriptionBuilderService.process_builder_validation_endpoint"
                ) as mock_process_builder,
                patch("controllers.trigger.trigger.request", mock_request),
            ):
                # Configure first handler to return None (no match)
                mock_process_endpoint.return_value = None
                # Configure second handler to return a response
                mock_process_builder.return_value = expected_response

                # Act: Call the trigger endpoint
                result = trigger_endpoint(valid_uuid)

                # Assert: Verify the response
                assert result == expected_response
                # Verify both handlers were called
                mock_process_endpoint.assert_called_once_with(valid_uuid, mock_request)
                mock_process_builder.assert_called_once_with(valid_uuid, mock_request)

    def test_trigger_endpoint_invalid_uuid_raises_not_found(
        self, app, invalid_endpoint_id, mock_request
    ):
        """Test trigger endpoint with invalid UUID format raises NotFound.

        This test verifies that:
        - Invalid endpoint IDs (non-UUID format) are rejected
        - NotFound exception is raised with appropriate message
        - UUID pattern validation works correctly

        Args:
            app: Flask application fixture
            invalid_endpoint_id: Invalid endpoint ID fixture
            mock_request: Mock Flask request fixture
        """
        # Arrange: Set up test with invalid endpoint ID
        with app.test_request_context(
            method="POST",
            json={"key": "value"},
            path=f"/plugin/{invalid_endpoint_id}",
        ):
            with patch("controllers.trigger.trigger.request", mock_request):
                # Act & Assert: Verify NotFound exception is raised
                with pytest.raises(NotFound) as exc_info:
                    trigger_endpoint(invalid_endpoint_id)

                # Verify error message
                assert "Invalid endpoint ID" in str(exc_info.value)

    def test_trigger_endpoint_no_handler_returns_response(
        self, app, valid_uuid, mock_request
    ):
        """Test trigger endpoint when no handler returns a response.

        This test verifies that:
        - When all handlers return None, 404 error is returned
        - Error message indicates endpoint not found
        - Appropriate status code is returned

        Args:
            app: Flask application fixture
            valid_uuid: Valid UUID string fixture
            mock_request: Mock Flask request fixture
        """
        # Arrange: Set up test data
        with app.test_request_context(
            method="POST",
            json={"key": "value"},
            path=f"/plugin/{valid_uuid}",
        ):
            with (
                patch(
                    "controllers.trigger.trigger.TriggerService.process_endpoint"
                ) as mock_process_endpoint,
                patch(
                    "controllers.trigger.trigger.TriggerSubscriptionBuilderService.process_builder_validation_endpoint"
                ) as mock_process_builder,
                patch("controllers.trigger.trigger.request", mock_request),
                patch("controllers.trigger.trigger.logger") as mock_logger,
            ):
                # Configure both handlers to return None
                mock_process_endpoint.return_value = None
                mock_process_builder.return_value = None

                # Act: Call the trigger endpoint
                result = trigger_endpoint(valid_uuid)

                # Assert: Verify 404 error response
                assert result[1] == 404  # Status code
                response_data = result[0].get_json()
                assert response_data["error"] == "Endpoint not found"
                
                # Verify both handlers were called
                mock_process_endpoint.assert_called_once_with(valid_uuid, mock_request)
                mock_process_builder.assert_called_once_with(valid_uuid, mock_request)
                
                # Verify error was logged
                mock_logger.error.assert_called_once_with(f"Endpoint not found for {valid_uuid}")

    def test_trigger_endpoint_value_error_handling(
        self, app, valid_uuid, mock_request
    ):
        """Test trigger endpoint error handling for ValueError exceptions.

        This test verifies that:
        - ValueError exceptions from handlers are caught
        - 400 Bad Request response is returned
        - Error message is included in response

        Args:
            app: Flask application fixture
            valid_uuid: Valid UUID string fixture
            mock_request: Mock Flask request fixture
        """
        # Arrange: Set up test data
        error_message = "Invalid endpoint configuration"

        with app.test_request_context(
            method="POST",
            json={"key": "value"},
            path=f"/plugin/{valid_uuid}",
        ):
            with (
                patch(
                    "controllers.trigger.trigger.TriggerService.process_endpoint"
                ) as mock_process_endpoint,
                patch("controllers.trigger.trigger.request", mock_request),
            ):
                # Configure handler to raise ValueError
                mock_process_endpoint.side_effect = ValueError(error_message)

                # Act: Call the trigger endpoint
                result = trigger_endpoint(valid_uuid)

                # Assert: Verify 400 error response
                assert result[1] == 400  # Status code
                response_data = result[0].get_json()
                assert response_data["error"] == "Endpoint processing failed"
                assert response_data["message"] == error_message

    def test_trigger_endpoint_generic_exception_handling(
        self, app, valid_uuid, mock_request
    ):
        """Test trigger endpoint error handling for generic exceptions.

        This test verifies that:
        - Generic exceptions from handlers are caught
        - 500 Internal Server Error response is returned
        - Error is logged appropriately
        - Generic error message is returned (no sensitive info)

        Args:
            app: Flask application fixture
            valid_uuid: Valid UUID string fixture
            mock_request: Mock Flask request fixture
        """
        # Arrange: Set up test data
        with app.test_request_context(
            method="POST",
            json={"key": "value"},
            path=f"/plugin/{valid_uuid}",
        ):
            with (
                patch(
                    "controllers.trigger.trigger.TriggerService.process_endpoint"
                ) as mock_process_endpoint,
                patch("controllers.trigger.trigger.request", mock_request),
                patch("controllers.trigger.trigger.logger") as mock_logger,
            ):
                # Configure handler to raise generic exception
                mock_process_endpoint.side_effect = Exception("Unexpected error occurred")

                # Act: Call the trigger endpoint
                result = trigger_endpoint(valid_uuid)

                # Assert: Verify 500 error response
                assert result[1] == 500  # Status code
                response_data = result[0].get_json()
                assert response_data["error"] == "Internal server error"
                
                # Verify exception was logged
                mock_logger.exception.assert_called_once()

    def test_trigger_endpoint_different_http_methods(
        self, app, valid_uuid, mock_request
    ):
        """Test trigger endpoint with different HTTP methods.

        This test verifies that:
        - All HTTP methods (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS) are supported
        - Request method is passed correctly to handlers
        - Response is generated appropriately for each method

        Args:
            app: Flask application fixture
            valid_uuid: Valid UUID string fixture
            mock_request: Mock Flask request fixture
        """
        # Arrange: Test all supported HTTP methods
        http_methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]

        for method in http_methods:
            # Update mock request method
            mock_request.method = method

            with app.test_request_context(
                method=method,
                path=f"/plugin/{valid_uuid}",
            ):
                with (
                    patch(
                        "controllers.trigger.trigger.TriggerService.process_endpoint"
                    ) as mock_process_endpoint,
                    patch("controllers.trigger.trigger.request", mock_request),
                ):
                    # Configure handler to return success response
                    expected_response = jsonify({"status": "success"})
                    expected_response.status_code = 200
                    mock_process_endpoint.return_value = expected_response

                    # Act: Call the trigger endpoint
                    result = trigger_endpoint(valid_uuid)

                    # Assert: Verify response for each method
                    assert result.status_code == 200
                    # Verify handler was called with correct request
                    mock_process_endpoint.assert_called_with(valid_uuid, mock_request)

    def test_trigger_endpoint_uuid_pattern_validation(
        self, app, mock_request
    ):
        """Test trigger endpoint UUID pattern validation with various formats.

        This test verifies that:
        - Only valid UUID v4 format is accepted
        - Invalid UUID formats are rejected
        - UUID pattern matching works correctly

        Args:
            app: Flask application fixture
            mock_request: Mock Flask request fixture
        """
        # Arrange: Test various UUID formats
        test_cases = [
            # (endpoint_id, should_be_valid, description)
            ("12345678-1234-4123-8123-123456789abc", True, "Valid UUID v4"),
            ("12345678-1234-4123-9123-123456789abc", True, "Valid UUID v4 (variant 1)"),
            ("12345678-1234-4123-a123-123456789abc", True, "Valid UUID v4 (variant 2)"),
            ("12345678-1234-3123-8123-123456789abc", False, "Invalid version (3 instead of 4)"),
            ("12345678-1234-5123-8123-123456789abc", False, "Invalid version (5 instead of 4)"),
            ("12345678-1234-4123-7123-123456789abc", False, "Invalid variant (7 instead of 8-9-a-b)"),
            ("12345678-1234-4123-8123", False, "Incomplete UUID"),
            ("not-a-uuid", False, "Plain string"),
            ("12345678123441238123123456789abc", False, "UUID without hyphens"),
            ("", False, "Empty string"),
        ]

        for endpoint_id, should_be_valid, description in test_cases:
            with app.test_request_context(
                method="POST",
                path=f"/plugin/{endpoint_id}",
            ):
                with patch("controllers.trigger.trigger.request", mock_request):
                    if should_be_valid:
                        # Act & Assert: Valid UUID should not raise exception
                        with (
                            patch(
                                "controllers.trigger.trigger.TriggerService.process_endpoint"
                            ) as mock_process_endpoint,
                        ):
                            mock_process_endpoint.return_value = jsonify({"status": "success"})
                            result = trigger_endpoint(endpoint_id)
                            assert result is not None, f"Failed for {description}"
                    else:
                        # Act & Assert: Invalid UUID should raise NotFound
                        with pytest.raises(NotFound, match="Invalid endpoint ID"):
                            trigger_endpoint(endpoint_id)

    def test_trigger_endpoint_handler_chain_order(
        self, app, valid_uuid, mock_request
    ):
        """Test trigger endpoint handler chain execution order.

        This test verifies that:
        - Handlers are executed in the correct order
        - Chain stops at first handler that returns a response
        - Subsequent handlers are not called if earlier handler succeeds

        Args:
            app: Flask application fixture
            valid_uuid: Valid UUID string fixture
            mock_request: Mock Flask request fixture
        """
        # Arrange: Set up test data
        with app.test_request_context(
            method="POST",
            json={"key": "value"},
            path=f"/plugin/{valid_uuid}",
        ):
            with (
                patch(
                    "controllers.trigger.trigger.TriggerService.process_endpoint"
                ) as mock_process_endpoint,
                patch(
                    "controllers.trigger.trigger.TriggerSubscriptionBuilderService.process_builder_validation_endpoint"
                ) as mock_process_builder,
                patch("controllers.trigger.trigger.request", mock_request),
            ):
                # Configure first handler to return response immediately
                first_response = jsonify({"handler": "first", "status": "success"})
                first_response.status_code = 200
                mock_process_endpoint.return_value = first_response

                # Configure second handler (should not be called)
                second_response = jsonify({"handler": "second", "status": "success"})
                second_response.status_code = 200
                mock_process_builder.return_value = second_response

                # Act: Call the trigger endpoint
                result = trigger_endpoint(valid_uuid)

                # Assert: Verify first handler's response is returned
                assert result == first_response
                # Verify first handler was called
                mock_process_endpoint.assert_called_once_with(valid_uuid, mock_request)
                # Verify second handler was NOT called (chain stops at first response)
                mock_process_builder.assert_not_called()

    def test_trigger_endpoint_response_status_codes(
        self, app, valid_uuid, mock_request
    ):
        """Test trigger endpoint with different response status codes.

        This test verifies that:
        - Different status codes from handlers are preserved
        - Status codes are correctly returned to client
        - Response structure is maintained

        Args:
            app: Flask application fixture
            valid_uuid: Valid UUID string fixture
            mock_request: Mock Flask request fixture
        """
        # Arrange: Test various status codes
        status_codes = [200, 201, 202, 204, 400, 401, 403, 404, 500, 502, 503]

        for status_code in status_codes:
            with app.test_request_context(
                method="POST",
                json={"key": "value"},
                path=f"/plugin/{valid_uuid}",
            ):
                with (
                    patch(
                        "controllers.trigger.trigger.TriggerService.process_endpoint"
                    ) as mock_process_endpoint,
                    patch("controllers.trigger.trigger.request", mock_request),
                ):
                    # Configure handler to return response with specific status code
                    response = Response(status=status_code)
                    mock_process_endpoint.return_value = response

                    # Act: Call the trigger endpoint
                    result = trigger_endpoint(valid_uuid)

                    # Assert: Verify status code is preserved
                    assert result.status_code == status_code

    def test_trigger_endpoint_handler_returns_response_object(
        self, app, valid_uuid, mock_request
    ):
        """Test trigger endpoint when handler returns Flask Response object.

        This test verifies that:
        - Flask Response objects from handlers are returned directly
        - Response objects maintain their properties
        - Response data is correctly formatted

        Args:
            app: Flask application fixture
            valid_uuid: Valid UUID string fixture
            mock_request: Mock Flask request fixture
        """
        # Arrange: Set up test data
        response_data = {"status": "processed", "endpoint_id": valid_uuid}
        response = Response(
            response=json.dumps(response_data),
            status=200,
            mimetype="application/json",
        )

        with app.test_request_context(
            method="POST",
            json={"key": "value"},
            path=f"/plugin/{valid_uuid}",
        ):
            with (
                patch(
                    "controllers.trigger.trigger.TriggerService.process_endpoint"
                ) as mock_process_endpoint,
                patch("controllers.trigger.trigger.request", mock_request),
            ):
                # Configure handler to return Response object
                mock_process_endpoint.return_value = response

                # Act: Call the trigger endpoint
                result = trigger_endpoint(valid_uuid)

                # Assert: Verify Response object is returned
                assert isinstance(result, Response)
                assert result.status_code == 200
                assert result.mimetype == "application/json"

    def test_trigger_endpoint_concurrent_requests(
        self, app, valid_uuid, mock_request
    ):
        """Test trigger endpoint handles concurrent requests correctly.

        This test verifies that:
        - Multiple requests to same endpoint are handled independently
        - Each request gets its own handler execution
        - No interference between concurrent requests

        Args:
            app: Flask application fixture
            valid_uuid: Valid UUID string fixture
            mock_request: Mock Flask request fixture
        """
        # Arrange: Set up test data for multiple requests
        with app.test_request_context(
            method="POST",
            json={"key": "value"},
            path=f"/plugin/{valid_uuid}",
        ):
            with (
                patch(
                    "controllers.trigger.trigger.TriggerService.process_endpoint"
                ) as mock_process_endpoint,
                patch("controllers.trigger.trigger.request", mock_request),
            ):
                # Configure handler to return different responses for each call
                responses = [
                    jsonify({"request": 1, "status": "success"}),
                    jsonify({"request": 2, "status": "success"}),
                    jsonify({"request": 3, "status": "success"}),
                ]
                mock_process_endpoint.side_effect = responses

                # Act: Make multiple calls
                result1 = trigger_endpoint(valid_uuid)
                result2 = trigger_endpoint(valid_uuid)
                result3 = trigger_endpoint(valid_uuid)

                # Assert: Verify each call gets independent response
                assert result1.get_json()["request"] == 1
                assert result2.get_json()["request"] == 2
                assert result3.get_json()["request"] == 3
                
                # Verify handler was called three times
                assert mock_process_endpoint.call_count == 3

    def test_trigger_endpoint_logging_on_error(
        self, app, valid_uuid, mock_request
    ):
        """Test trigger endpoint error logging.

        This test verifies that:
        - Errors are properly logged with endpoint ID
        - Logging includes appropriate context
        - Error messages are descriptive

        Args:
            app: Flask application fixture
            valid_uuid: Valid UUID string fixture
            mock_request: Mock Flask request fixture
        """
        # Arrange: Set up test data
        with app.test_request_context(
            method="POST",
            json={"key": "value"},
            path=f"/plugin/{valid_uuid}",
        ):
            with (
                patch(
                    "controllers.trigger.trigger.TriggerService.process_endpoint"
                ) as mock_process_endpoint,
                patch("controllers.trigger.trigger.request", mock_request),
                patch("controllers.trigger.trigger.logger") as mock_logger,
            ):
                # Configure handler to raise exception
                mock_process_endpoint.side_effect = Exception("Test error")

                # Act: Call the trigger endpoint
                trigger_endpoint(valid_uuid)

                # Assert: Verify error was logged
                mock_logger.exception.assert_called_once_with(f"Webhook processing failed for {valid_uuid}")

    def test_trigger_endpoint_empty_request_body(
        self, app, valid_uuid, mock_request
    ):
        """Test trigger endpoint with empty request body.

        This test verifies that:
        - Empty request bodies are handled correctly
        - Handlers receive empty request data
        - Response is generated appropriately

        Args:
            app: Flask application fixture
            valid_uuid: Valid UUID string fixture
            mock_request: Mock Flask request fixture
        """
        # Arrange: Set up test data with empty body
        mock_request.get_data.return_value = b""

        with app.test_request_context(
            method="POST",
            data="",
            path=f"/plugin/{valid_uuid}",
        ):
            with (
                patch(
                    "controllers.trigger.trigger.TriggerService.process_endpoint"
                ) as mock_process_endpoint,
                patch("controllers.trigger.trigger.request", mock_request),
            ):
                # Configure handler to return success response
                expected_response = jsonify({"status": "success"})
                expected_response.status_code = 200
                mock_process_endpoint.return_value = expected_response

                # Act: Call the trigger endpoint
                result = trigger_endpoint(valid_uuid)

                # Assert: Verify response
                assert result.status_code == 200
                # Verify handler was called with empty request
                mock_process_endpoint.assert_called_once_with(valid_uuid, mock_request)

