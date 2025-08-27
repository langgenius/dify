import json
import logging
from unittest import mock

import pytest
from flask import Flask, Response

from configs import dify_config
from extensions import ext_request_logging
from extensions.ext_request_logging import _is_content_type_json, _log_request_finished, init_app


def test_is_content_type_json():
    """
    Test the _is_content_type_json function.
    """

    assert _is_content_type_json("application/json") is True
    # content type header with charset option.
    assert _is_content_type_json("application/json; charset=utf-8") is True
    # content type header with charset option, in uppercase.
    assert _is_content_type_json("APPLICATION/JSON; CHARSET=UTF-8") is True
    assert _is_content_type_json("text/html") is False
    assert _is_content_type_json("") is False


_KEY_NEEDLE = "needle"
_VALUE_NEEDLE = _KEY_NEEDLE[::-1]
_RESPONSE_NEEDLE = "response"


def _get_test_app():
    app = Flask(__name__)

    @app.route("/", methods=["GET", "POST"])
    def handler():
        return _RESPONSE_NEEDLE

    return app


# NOTE(QuantumGhost): Due to the design of Flask, we need to use monkey patch to write tests.


@pytest.fixture
def mock_request_receiver(monkeypatch: pytest.MonkeyPatch) -> mock.Mock:
    mock_log_request_started = mock.Mock()
    monkeypatch.setattr(ext_request_logging, "_log_request_started", mock_log_request_started)
    return mock_log_request_started


@pytest.fixture
def mock_response_receiver(monkeypatch: pytest.MonkeyPatch) -> mock.Mock:
    mock_log_request_finished = mock.Mock()
    monkeypatch.setattr(ext_request_logging, "_log_request_finished", mock_log_request_finished)
    return mock_log_request_finished


@pytest.fixture
def mock_logger(monkeypatch: pytest.MonkeyPatch) -> logging.Logger:
    _logger = mock.MagicMock(spec=logging.Logger)
    monkeypatch.setattr(ext_request_logging, "logger", _logger)
    return _logger


@pytest.fixture
def enable_request_logging(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(dify_config, "ENABLE_REQUEST_LOGGING", True)


class TestRequestLoggingExtension:
    def test_receiver_should_not_be_invoked_if_configuration_is_disabled(
        self,
        monkeypatch,
        mock_request_receiver,
        mock_response_receiver,
    ):
        monkeypatch.setattr(dify_config, "ENABLE_REQUEST_LOGGING", False)

        app = _get_test_app()
        init_app(app)

        with app.test_client() as client:
            client.get("/")

        mock_request_receiver.assert_not_called()
        mock_response_receiver.assert_not_called()

    def test_receiver_should_be_called_if_enabled(
        self,
        enable_request_logging,
        mock_request_receiver,
        mock_response_receiver,
    ):
        """
        Test the request logging extension with JSON data.
        """

        app = _get_test_app()
        init_app(app)

        with app.test_client() as client:
            client.post("/", json={_KEY_NEEDLE: _VALUE_NEEDLE})

        mock_request_receiver.assert_called_once()
        mock_response_receiver.assert_called_once()


class TestLoggingLevel:
    @pytest.mark.usefixtures("enable_request_logging")
    def test_logging_should_be_skipped_if_level_is_above_debug(self, enable_request_logging, mock_logger):
        mock_logger.isEnabledFor.return_value = False
        app = _get_test_app()
        init_app(app)

        with app.test_client() as client:
            client.post("/", json={_KEY_NEEDLE: _VALUE_NEEDLE})
        mock_logger.debug.assert_not_called()


class TestRequestReceiverLogging:
    @pytest.mark.usefixtures("enable_request_logging")
    def test_non_json_request(self, enable_request_logging, mock_logger, mock_response_receiver):
        mock_logger.isEnabledFor.return_value = True
        app = _get_test_app()
        init_app(app)

        with app.test_client() as client:
            client.post("/", data="plain text")
        assert mock_logger.debug.call_count == 1
        call_args = mock_logger.debug.call_args[0]
        assert "Received Request" in call_args[0]
        assert call_args[1] == "POST"
        assert call_args[2] == "/"
        assert "Request Body" not in call_args[0]

    @pytest.mark.usefixtures("enable_request_logging")
    def test_json_request(self, enable_request_logging, mock_logger, mock_response_receiver):
        mock_logger.isEnabledFor.return_value = True
        app = _get_test_app()
        init_app(app)

        with app.test_client() as client:
            client.post("/", json={_KEY_NEEDLE: _VALUE_NEEDLE})
        assert mock_logger.debug.call_count == 1
        call_args = mock_logger.debug.call_args[0]
        assert "Received Request" in call_args[0]
        assert "Request Body" in call_args[0]
        assert call_args[1] == "POST"
        assert call_args[2] == "/"
        assert _KEY_NEEDLE in call_args[3]

    @pytest.mark.usefixtures("enable_request_logging")
    def test_json_request_with_empty_body(self, enable_request_logging, mock_logger, mock_response_receiver):
        mock_logger.isEnabledFor.return_value = True
        app = _get_test_app()
        init_app(app)

        with app.test_client() as client:
            client.post("/", headers={"Content-Type": "application/json"})

        assert mock_logger.debug.call_count == 1
        call_args = mock_logger.debug.call_args[0]
        assert "Received Request" in call_args[0]
        assert "Request Body" not in call_args[0]
        assert call_args[1] == "POST"
        assert call_args[2] == "/"

    @pytest.mark.usefixtures("enable_request_logging")
    def test_json_request_with_invalid_json_as_body(self, enable_request_logging, mock_logger, mock_response_receiver):
        mock_logger.isEnabledFor.return_value = True
        app = _get_test_app()
        init_app(app)

        with app.test_client() as client:
            client.post(
                "/",
                headers={"Content-Type": "application/json"},
                data="{",
            )
        assert mock_logger.debug.call_count == 0
        assert mock_logger.exception.call_count == 1

        exception_call_args = mock_logger.exception.call_args[0]
        assert exception_call_args[0] == "Failed to parse JSON request"


class TestResponseReceiverLogging:
    @pytest.mark.usefixtures("enable_request_logging")
    def test_non_json_response(self, enable_request_logging, mock_logger):
        mock_logger.isEnabledFor.return_value = True
        app = _get_test_app()
        response = Response(
            "OK",
            headers={"Content-Type": "text/plain"},
        )
        _log_request_finished(app, response)
        assert mock_logger.debug.call_count == 1
        call_args = mock_logger.debug.call_args[0]
        assert "Response" in call_args[0]
        assert "200" in call_args[1]
        assert call_args[2] == "text/plain"
        assert "Response Body" not in call_args[0]

    @pytest.mark.usefixtures("enable_request_logging")
    def test_json_response(self, enable_request_logging, mock_logger, mock_response_receiver):
        mock_logger.isEnabledFor.return_value = True
        app = _get_test_app()
        response = Response(
            json.dumps({_KEY_NEEDLE: _VALUE_NEEDLE}),
            headers={"Content-Type": "application/json"},
        )
        _log_request_finished(app, response)
        assert mock_logger.debug.call_count == 1
        call_args = mock_logger.debug.call_args[0]
        assert "Response" in call_args[0]
        assert "Response Body" in call_args[0]
        assert "200" in call_args[1]
        assert call_args[2] == "application/json"
        assert _KEY_NEEDLE in call_args[3]

    @pytest.mark.usefixtures("enable_request_logging")
    def test_json_request_with_invalid_json_as_body(self, enable_request_logging, mock_logger, mock_response_receiver):
        mock_logger.isEnabledFor.return_value = True
        app = _get_test_app()

        response = Response(
            "{",
            headers={"Content-Type": "application/json"},
        )
        _log_request_finished(app, response)
        assert mock_logger.debug.call_count == 0
        assert mock_logger.exception.call_count == 1

        exception_call_args = mock_logger.exception.call_args[0]
        assert exception_call_args[0] == "Failed to parse JSON response"


class TestResponseUnmodified:
    def test_when_request_logging_disabled(self):
        app = _get_test_app()
        init_app(app)

        with app.test_client() as client:
            response = client.post(
                "/",
                headers={"Content-Type": "application/json"},
                data="{",
            )
        assert response.text == _RESPONSE_NEEDLE
        assert response.status_code == 200

    @pytest.mark.usefixtures("enable_request_logging")
    def test_when_request_logging_enabled(self, enable_request_logging):
        app = _get_test_app()
        init_app(app)

        with app.test_client() as client:
            response = client.post(
                "/",
                headers={"Content-Type": "application/json"},
                data="{",
            )
        assert response.text == _RESPONSE_NEEDLE
        assert response.status_code == 200
