from unittest.mock import patch

import pytest
from werkzeug.exceptions import NotFound

import controllers.trigger.trigger as module


@pytest.fixture(autouse=True)
def mock_request():
    module.request = object()


@pytest.fixture(autouse=True)
def mock_jsonify():
    module.jsonify = lambda payload: payload


VALID_UUID = "123e4567-e89b-42d3-a456-426614174000"
INVALID_UUID = "not-a-uuid"


class TestTriggerEndpoint:
    def test_invalid_uuid(self):
        with pytest.raises(NotFound):
            module.trigger_endpoint(INVALID_UUID)

    @patch.object(module.TriggerService, "process_endpoint")
    @patch.object(module.TriggerSubscriptionBuilderService, "process_builder_validation_endpoint")
    def test_first_handler_returns_response(self, mock_builder, mock_trigger):
        mock_trigger.return_value = ("ok", 200)
        mock_builder.return_value = None

        response = module.trigger_endpoint(VALID_UUID)

        assert response == ("ok", 200)
        mock_builder.assert_not_called()

    @patch.object(module.TriggerService, "process_endpoint")
    @patch.object(module.TriggerSubscriptionBuilderService, "process_builder_validation_endpoint")
    def test_second_handler_returns_response(self, mock_builder, mock_trigger):
        mock_trigger.return_value = None
        mock_builder.return_value = ("ok", 200)

        response = module.trigger_endpoint(VALID_UUID)

        assert response == ("ok", 200)

    @patch.object(module.TriggerService, "process_endpoint")
    @patch.object(module.TriggerSubscriptionBuilderService, "process_builder_validation_endpoint")
    def test_no_handler_returns_response(self, mock_builder, mock_trigger):
        mock_trigger.return_value = None
        mock_builder.return_value = None

        response, status = module.trigger_endpoint(VALID_UUID)

        assert status == 404
        assert response["error"] == "Endpoint not found"

    @patch.object(module.TriggerService, "process_endpoint", side_effect=ValueError("bad input"))
    def test_value_error(self, mock_trigger):
        response, status = module.trigger_endpoint(VALID_UUID)

        assert status == 400
        assert response["error"] == "Endpoint processing failed"
        assert response["message"] == "bad input"

    @patch.object(module.TriggerService, "process_endpoint", side_effect=Exception("boom"))
    def test_unexpected_exception(self, mock_trigger):
        response, status = module.trigger_endpoint(VALID_UUID)

        assert status == 500
        assert response["error"] == "Internal server error"
