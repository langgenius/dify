import json

import pytest

from core.plugin.endpoint.exc import EndpointSetupFailedError
from core.plugin.entities.plugin_daemon import PluginDaemonInnerError
from core.plugin.impl.base import BasePluginClient
from core.trigger.errors import (
    EventIgnoreError,
    TriggerInvokeError,
    TriggerPluginInvokeError,
    TriggerProviderCredentialValidationError,
)


class _ResponseStub:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


class _StreamContext:
    def __init__(self, lines):
        self._lines = lines

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def iter_lines(self):
        return self._lines


class TestBasePluginClientImpl:
    def test_inject_trace_headers(self, mocker):
        client = BasePluginClient()
        mocker.patch("core.plugin.impl.base.dify_config.ENABLE_OTEL", True)
        trace_header = "00-abc-xyz-01"
        mocker.patch("core.helper.trace_id_helper.generate_traceparent_header", return_value=trace_header)

        headers = {}
        client._inject_trace_headers(headers)

        assert headers["traceparent"] == trace_header

        headers_with_existing = {"TraceParent": "exists"}
        client._inject_trace_headers(headers_with_existing)
        assert headers_with_existing["TraceParent"] == "exists"

    def test_stream_request_handles_data_lines_and_dict_payload(self, mocker):
        client = BasePluginClient()
        stream_mock = mocker.patch(
            "httpx.Client.stream",
            return_value=_StreamContext([b"", b"data: hello", "world"]),
        )

        result = list(client._stream_request("POST", "plugin/tenant/stream", data={"k": "v"}))

        assert result == ["hello", "world"]
        assert stream_mock.call_args.kwargs["data"] == {"k": "v"}

    def test_request_with_plugin_daemon_response_handles_request_exception(self, mocker):
        client = BasePluginClient()
        mocker.patch.object(client, "_request", side_effect=RuntimeError("boom"))

        with pytest.raises(ValueError, match="Failed to request plugin daemon"):
            client._request_with_plugin_daemon_response("GET", "plugin/tenant/path", bool)

    def test_request_with_plugin_daemon_response_applies_transformer(self, mocker):
        client = BasePluginClient()
        mocker.patch.object(client, "_request", return_value=_ResponseStub({"code": 0, "message": "", "data": True}))

        transformed = {}

        def transformer(payload):
            transformed.update(payload)
            return payload

        result = client._request_with_plugin_daemon_response("GET", "plugin/tenant/path", bool, transformer=transformer)

        assert result is True
        assert transformed == {"code": 0, "message": "", "data": True}

    def test_request_with_plugin_daemon_response_stream_malformed_json_error(self, mocker):
        client = BasePluginClient()
        mocker.patch.object(client, "_stream_request", return_value=iter(['{"error":"bad-line"}']))

        with pytest.raises(ValueError, match="bad-line"):
            list(client._request_with_plugin_daemon_response_stream("GET", "p", bool))

    def test_request_with_plugin_daemon_response_stream_plugin_daemon_inner_error(self, mocker):
        client = BasePluginClient()
        mocker.patch.object(
            client, "_stream_request", return_value=iter(['{"code":-500,"message":"not-json","data":null}'])
        )

        with pytest.raises(PluginDaemonInnerError) as exc_info:
            list(client._request_with_plugin_daemon_response_stream("GET", "p", bool))
        assert exc_info.value.message == "not-json"

    def test_request_with_plugin_daemon_response_stream_plugin_daemon_error(self, mocker):
        client = BasePluginClient()
        mocker.patch.object(client, "_stream_request", return_value=iter(['{"code":-1,"message":"err","data":null}']))

        with pytest.raises(ValueError, match="plugin daemon: err, code: -1"):
            list(client._request_with_plugin_daemon_response_stream("GET", "p", bool))

    def test_request_with_plugin_daemon_response_stream_empty_data_error(self, mocker):
        client = BasePluginClient()
        mocker.patch.object(client, "_stream_request", return_value=iter(['{"code":0,"message":"","data":null}']))

        with pytest.raises(ValueError, match="got empty data"):
            list(client._request_with_plugin_daemon_response_stream("GET", "p", bool))

    @pytest.mark.parametrize(
        ("error_type", "expected"),
        [
            (EndpointSetupFailedError.__name__, EndpointSetupFailedError),
            (TriggerProviderCredentialValidationError.__name__, TriggerProviderCredentialValidationError),
            (TriggerPluginInvokeError.__name__, TriggerPluginInvokeError),
            (TriggerInvokeError.__name__, TriggerInvokeError),
            (EventIgnoreError.__name__, EventIgnoreError),
        ],
    )
    def test_handle_plugin_daemon_error_trigger_branches(self, error_type, expected):
        client = BasePluginClient()
        message = json.dumps({"error_type": error_type, "message": "m"})

        with pytest.raises(expected):
            client._handle_plugin_daemon_error("PluginInvokeError", message)
