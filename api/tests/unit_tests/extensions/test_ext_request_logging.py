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
def enable_request_logging(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(dify_config, "ENABLE_REQUEST_LOGGING", True)


def _captured_records(caplog: pytest.LogCaptureFixture, level: int) -> list[logging.LogRecord]:
    return [
        record
        for record in caplog.records
        if record.name == ext_request_logging.logger.name and record.levelno == level
    ]


class TestRequestLoggingExtension:
    def test_receiver_should_not_be_invoked_if_configuration_is_disabled(
        self,
        monkeypatch: pytest.MonkeyPatch,
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
    def test_logging_should_be_skipped_if_level_is_above_debug(
        self, enable_request_logging, caplog: pytest.LogCaptureFixture
    ):
        caplog.set_level(logging.INFO, logger=ext_request_logging.logger.name)
        app = _get_test_app()
        init_app(app)

        with app.test_client() as client:
            client.post("/", json={_KEY_NEEDLE: _VALUE_NEEDLE})
        assert not _captured_records(caplog, logging.DEBUG)


class TestRequestReceiverLogging:
    @pytest.mark.usefixtures("enable_request_logging")
    def test_non_json_request(self, enable_request_logging, caplog: pytest.LogCaptureFixture, mock_response_receiver):
        caplog.set_level(logging.DEBUG, logger=ext_request_logging.logger.name)
        app = _get_test_app()
        init_app(app)

        with app.test_client() as client:
            client.post("/", data="plain text")
        debug_records = _captured_records(caplog, logging.DEBUG)
        assert len(debug_records) == 1
        record = debug_records[0]
        assert "Received Request" in record.msg
        assert record.args == ("POST", "/")
        assert "Request Body" not in record.msg

    @pytest.mark.usefixtures("enable_request_logging")
    def test_json_request(self, enable_request_logging, caplog: pytest.LogCaptureFixture, mock_response_receiver):
        caplog.set_level(logging.DEBUG, logger=ext_request_logging.logger.name)
        app = _get_test_app()
        init_app(app)

        with app.test_client() as client:
            client.post("/", json={_KEY_NEEDLE: _VALUE_NEEDLE})
        debug_records = _captured_records(caplog, logging.DEBUG)
        assert len(debug_records) == 1
        record = debug_records[0]
        assert "Received Request" in record.msg
        assert "Request Body" in record.msg
        assert record.args[0] == "POST"
        assert record.args[1] == "/"
        assert _KEY_NEEDLE in record.args[2]

    @pytest.mark.usefixtures("enable_request_logging")
    def test_json_request_with_empty_body(
        self, enable_request_logging, caplog: pytest.LogCaptureFixture, mock_response_receiver
    ):
        caplog.set_level(logging.DEBUG, logger=ext_request_logging.logger.name)
        app = _get_test_app()
        init_app(app)

        with app.test_client() as client:
            client.post("/", headers={"Content-Type": "application/json"})

        debug_records = _captured_records(caplog, logging.DEBUG)
        assert len(debug_records) == 1
        record = debug_records[0]
        assert "Received Request" in record.msg
        assert "Request Body" not in record.msg
        assert record.args == ("POST", "/")

    @pytest.mark.usefixtures("enable_request_logging")
    def test_json_request_with_invalid_json_as_body(
        self, enable_request_logging, caplog: pytest.LogCaptureFixture, mock_response_receiver
    ):
        caplog.set_level(logging.DEBUG, logger=ext_request_logging.logger.name)
        app = _get_test_app()
        init_app(app)

        with app.test_client() as client:
            client.post(
                "/",
                headers={"Content-Type": "application/json"},
                data="{",
            )
        assert not _captured_records(caplog, logging.DEBUG)
        error_records = _captured_records(caplog, logging.ERROR)
        assert len(error_records) == 1
        assert error_records[0].message == "Failed to parse JSON request"


class TestResponseReceiverLogging:
    @pytest.mark.usefixtures("enable_request_logging")
    def test_non_json_response(self, enable_request_logging, caplog: pytest.LogCaptureFixture):
        caplog.set_level(logging.DEBUG, logger=ext_request_logging.logger.name)
        app = _get_test_app()
        response = Response(
            "OK",
            headers={"Content-Type": "text/plain"},
        )
        _log_request_finished(app, response)
        debug_records = _captured_records(caplog, logging.DEBUG)
        assert len(debug_records) == 1
        record = debug_records[0]
        assert "Response" in record.msg
        assert "200" in record.args[0]
        assert record.args[1] == "text/plain"
        assert "Response Body" not in record.msg

    @pytest.mark.usefixtures("enable_request_logging")
    def test_json_response(self, enable_request_logging, caplog: pytest.LogCaptureFixture, mock_response_receiver):
        caplog.set_level(logging.DEBUG, logger=ext_request_logging.logger.name)
        app = _get_test_app()
        response = Response(
            json.dumps({_KEY_NEEDLE: _VALUE_NEEDLE}),
            headers={"Content-Type": "application/json"},
        )
        _log_request_finished(app, response)
        debug_records = _captured_records(caplog, logging.DEBUG)
        assert len(debug_records) == 1
        record = debug_records[0]
        assert "Response" in record.msg
        assert "Response Body" in record.msg
        assert "200" in record.args[0]
        assert record.args[1] == "application/json"
        assert _KEY_NEEDLE in record.args[2]

    @pytest.mark.usefixtures("enable_request_logging")
    def test_json_request_with_invalid_json_as_body(
        self, enable_request_logging, caplog: pytest.LogCaptureFixture, mock_response_receiver
    ):
        caplog.set_level(logging.DEBUG, logger=ext_request_logging.logger.name)
        app = _get_test_app()

        response = Response(
            "{",
            headers={"Content-Type": "application/json"},
        )
        _log_request_finished(app, response)
        assert not _captured_records(caplog, logging.DEBUG)
        error_records = _captured_records(caplog, logging.ERROR)
        assert len(error_records) == 1
        assert error_records[0].message == "Failed to parse JSON response"


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


class TestRequestFinishedInfoAccessLine:
    def test_info_access_log_includes_method_path_status_duration_trace_id(
        self, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
    ):
        """Ensure INFO access line contains expected fields with computed duration and trace id."""
        app = _get_test_app()
        # Push a real request context so flask.request and g are available
        with app.test_request_context("/foo", method="GET"):
            # Seed start timestamp via the extension's own start hook and control perf_counter deterministically
            seq = iter([100.0, 100.123456])
            monkeypatch.setattr(ext_request_logging.time, "perf_counter", lambda: next(seq))
            # Provide a deterministic trace id
            monkeypatch.setattr(
                ext_request_logging,
                "get_trace_id_from_otel_context",
                lambda: "trace-xyz",
            )
            # Simulate request_started to record start timestamp on g
            ext_request_logging._log_request_started(app)

            # Capture logs from the real logger at INFO level only (skip DEBUG branch)
            caplog.set_level(logging.INFO, logger=ext_request_logging.__name__)
            response = Response(json.dumps({"ok": True}), mimetype="application/json", status=200)
            _log_request_finished(app, response)

            # Verify a single INFO record with the five fields in order
            info_records = [rec for rec in caplog.records if rec.levelno == logging.INFO]
            assert len(info_records) == 1
            msg = info_records[0].getMessage()
            # Expected format: METHOD PATH STATUS DURATION_MS TRACE_ID
            assert "GET" in msg
            assert "/foo" in msg
            assert "200" in msg
            assert "123.456" in msg  # rounded to 3 decimals
            assert "trace-xyz" in msg

    def test_info_access_log_uses_dash_without_start_timestamp(
        self, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
    ):
        app = _get_test_app()
        with app.test_request_context("/bar", method="POST"):
            # No g.__request_started_ts set -> duration should be '-'
            monkeypatch.setattr(
                ext_request_logging,
                "get_trace_id_from_otel_context",
                lambda: "tid-no-start",
            )
            caplog.set_level(logging.INFO, logger=ext_request_logging.__name__)
            response = Response("OK", mimetype="text/plain", status=204)
            _log_request_finished(app, response)

            info_records = [rec for rec in caplog.records if rec.levelno == logging.INFO]
            assert len(info_records) == 1
            msg = info_records[0].getMessage()
            assert "POST" in msg
            assert "/bar" in msg
            assert "204" in msg
            # Duration placeholder
            # The fields are space separated; ensure a standalone '-' appears
            assert " - " in msg or msg.endswith(" -")
            assert "tid-no-start" in msg
