import json
from collections.abc import Callable, Iterator
from typing import override
from urllib.parse import quote

import httpx
import pytest
from pytest_mock import MockerFixture

from core.plugin.endpoint.exc import EndpointSetupFailedError
from core.plugin.entities.plugin_daemon import PluginDaemonInnerError, PluginListResponse
from core.plugin.impl.base import PLUGIN_DAEMON_MAX_PATH_LENGTH, BasePluginClient
from core.plugin.impl.exc import PluginLLMPollingUnsupportedError, PluginRuntimeError
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


class _TrackedHTTPStream(httpx.SyncByteStream):
    def __init__(self, chunks: list[bytes], *, fail_close: bool = False) -> None:
        self._chunks: list[bytes] = chunks
        self._fail_close: bool = fail_close
        self.close_calls: int = 0

    @override
    def __iter__(self) -> Iterator[bytes]:
        yield from self._chunks

    @override
    def close(self) -> None:
        self.close_calls += 1
        if self._fail_close:
            raise RuntimeError("HTTP close failed")


class TestBasePluginClientImpl:
    def test_inject_trace_headers(self, mocker: MockerFixture, config_overrides: Callable[..., None]):
        client = BasePluginClient()
        config_overrides(ENABLE_OTEL=True)
        trace_header = "00-abc-xyz-01"
        mocker.patch("core.helper.trace_id_helper.generate_traceparent_header", return_value=trace_header)

        headers = {}
        client._inject_trace_headers(headers)

        assert headers["traceparent"] == trace_header

        headers_with_existing = {"TraceParent": "exists"}
        client._inject_trace_headers(headers_with_existing)
        assert headers_with_existing["TraceParent"] == "exists"

    def test_stream_request_handles_data_lines_and_dict_payload(self, mocker: MockerFixture):
        client = BasePluginClient()
        stream_mock = mocker.patch(
            "httpx.Client.stream",
            return_value=_StreamContext([b"", b"data: hello", "world"]),
        )

        result = list(client._stream_request("POST", "plugin/tenant/stream", data={"k": "v"}))

        assert result == ["hello", "world"]
        assert stream_mock.call_args.kwargs["data"] == {"k": "v"}

    @pytest.mark.parametrize(
        "path",
        [
            "plugin/tenant/%252e%252e%252ftarget",
            "plugin/tenant/%2e%2e%252ftarget",
        ],
    )
    def test_prepare_request_rejects_encoded_traversal_with_encoded_separator(self, path: str):
        client = BasePluginClient()

        with pytest.raises(ValueError, match="traversal sequence detected"):
            client._prepare_request(path, None, None, None, None)

    def test_prepare_request_rejects_path_exceeding_max_length(self):
        client = BasePluginClient()
        path = "a" * (PLUGIN_DAEMON_MAX_PATH_LENGTH + 1)

        with pytest.raises(ValueError, match="path length exceeds"):
            client._prepare_request(path, None, None, None, None)

    def test_prepare_request_rejects_excessively_encoded_path(self):
        client = BasePluginClient()
        segment = "..%2Ftarget"
        for _ in range(9):
            segment = quote(segment, safe="")
        path = f"plugin/tenant/{segment}"

        with pytest.raises(ValueError, match="too deeply encoded"):
            client._prepare_request(path, None, None, None, None)

    def test_request_with_plugin_daemon_response_handles_request_exception(self, mocker: MockerFixture):
        client = BasePluginClient()
        mocker.patch.object(client, "_request", side_effect=RuntimeError("boom"))

        with pytest.raises(ValueError, match="Failed to request plugin daemon"):
            client._request_with_plugin_daemon_response("GET", "plugin/tenant/path", bool)

    def test_request_with_plugin_daemon_response_applies_transformer(self, mocker: MockerFixture):
        client = BasePluginClient()
        mocker.patch.object(client, "_request", return_value=_ResponseStub({"code": 0, "message": "", "data": True}))

        transformed = {}

        def transformer(payload):
            transformed.update(payload)
            return payload

        result = client._request_with_plugin_daemon_response("GET", "plugin/tenant/path", bool, transformer=transformer)

        assert result is True
        assert transformed == {"code": 0, "message": "", "data": True}

    def test_request_with_plugin_daemon_response_accepts_legacy_plugin_list_data_array(self, mocker: MockerFixture):
        client = BasePluginClient()
        mocker.patch.object(client, "_request", return_value=_ResponseStub({"code": 0, "message": "", "data": []}))

        result = client._request_with_plugin_daemon_response("GET", "plugin/tenant/management/list", PluginListResponse)

        assert result.list == []
        assert result.total == 0

    def test_request_with_plugin_daemon_response_accepts_legacy_plugin_list_top_level_array(
        self, mocker: MockerFixture
    ):
        client = BasePluginClient()
        mocker.patch.object(client, "_request", return_value=_ResponseStub([]))

        result = client._request_with_plugin_daemon_response("GET", "plugin/tenant/management/list", PluginListResponse)

        assert result.list == []
        assert result.total == 0

    def test_request_with_plugin_daemon_response_stream_malformed_json_error(self, mocker: MockerFixture):
        client = BasePluginClient()
        mocker.patch.object(client, "_stream_request", return_value=iter(['{"error":"bad-line"}']))

        with pytest.raises(ValueError, match="bad-line"):
            list(client._request_with_plugin_daemon_response_stream("GET", "p", bool))

    def test_request_with_plugin_daemon_response_stream_plugin_daemon_inner_error(self, mocker: MockerFixture):
        client = BasePluginClient()
        mocker.patch.object(
            client, "_stream_request", return_value=iter(['{"code":-500,"message":"not-json","data":null}'])
        )

        with pytest.raises(PluginDaemonInnerError) as exc_info:
            list(client._request_with_plugin_daemon_response_stream("GET", "p", bool))
        assert exc_info.value.message == "not-json"

    def test_request_with_plugin_daemon_response_stream_plugin_daemon_error(self, mocker: MockerFixture):
        client = BasePluginClient()
        mocker.patch.object(client, "_stream_request", return_value=iter(['{"code":-1,"message":"err","data":null}']))

        with pytest.raises(ValueError, match="plugin daemon: err, code: -1"):
            list(client._request_with_plugin_daemon_response_stream("GET", "p", bool))

    def test_request_with_plugin_daemon_response_stream_empty_data_error(self, mocker: MockerFixture):
        client = BasePluginClient()
        mocker.patch.object(client, "_stream_request", return_value=iter(['{"code":0,"message":"","data":null}']))

        with pytest.raises(ValueError, match="got empty data"):
            list(client._request_with_plugin_daemon_response_stream("GET", "p", bool))

    @pytest.mark.parametrize("consume_all", [False, True])
    def test_response_decoder_closes_retained_http_stream(self, mocker: MockerFixture, consume_all: bool) -> None:
        client = BasePluginClient()
        transport_stream = _TrackedHTTPStream(
            [b'{"code":0,"message":"","data":true}\n', b'{"code":0,"message":"","data":false}\n']
        )
        transport = httpx.MockTransport(lambda _: httpx.Response(200, stream=transport_stream))

        with httpx.Client(transport=transport) as http_client:
            mocker.patch("core.plugin.impl.base._httpx_client", http_client)
            # Keep the live transport generator referenced so GC cannot hide a missing close.
            request_stream = client._stream_request("GET", "plugin/tenant/stream")
            mocker.patch.object(client, "_stream_request", return_value=request_stream)
            response = client._request_with_plugin_daemon_response_stream("GET", "plugin/tenant/stream", bool)
            assert next(response) is True
            assert transport_stream.close_calls == 0
            if consume_all:
                assert list(response) == [False]
            response.close()
            response.close()

            assert transport_stream.close_calls == 1

    @pytest.mark.parametrize("valid_first_chunk", [False, True])
    @pytest.mark.parametrize("fail_close", [False, True])
    def test_response_decoder_preserves_invalid_frame_error_when_http_cleanup_fails(
        self, mocker: MockerFixture, valid_first_chunk: bool, fail_close: bool
    ) -> None:
        client = BasePluginClient()
        chunks = [b'{"code":0,"message":"","data":true}\n'] if valid_first_chunk else []
        transport_stream = _TrackedHTTPStream([*chunks, b"broken-json\n"], fail_close=fail_close)
        transport = httpx.MockTransport(lambda _: httpx.Response(200, stream=transport_stream))

        with httpx.Client(transport=transport) as http_client:
            mocker.patch("core.plugin.impl.base._httpx_client", http_client)
            request_stream = client._stream_request("GET", "plugin/tenant/stream")
            mocker.patch.object(client, "_stream_request", return_value=request_stream)
            with pytest.raises(ValueError, match="^broken-json$"):
                list(client._request_with_plugin_daemon_response_stream("GET", "plugin/tenant/stream", bool))

            assert transport_stream.close_calls == 1

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

    def test_handle_plugin_daemon_error_maps_unsupported_polling_to_typed_exception(self):
        client = BasePluginClient()
        message = json.dumps({"error_type": PluginLLMPollingUnsupportedError.__name__, "message": "m"})

        with pytest.raises(PluginLLMPollingUnsupportedError):
            client._handle_plugin_daemon_error("PluginInvokeError", message)

    def test_handle_plugin_daemon_error_maps_runtime_error_to_typed_exception(self):
        client = BasePluginClient()
        lambda_request_id = "45664803-3d3c-4d4f-93fe-e3b19e43092b"
        message = json.dumps(
            {
                "error_type": PluginRuntimeError.__name__,
                "message": (
                    "Plugin runtime request failed: Runtime.ExitError: "
                    f"RequestId: {lambda_request_id} Error: Runtime exited with error: exit status 1"
                ),
                "args": {"request_id": lambda_request_id, "status_code": 200},
            }
        )

        with pytest.raises(PluginRuntimeError) as exc_info:
            client._handle_plugin_daemon_error("PluginInvokeError", message)

        assert exc_info.value.description == (
            "Plugin runtime request failed: Runtime.ExitError: Runtime exited with error: exit status 1"
        )
        assert exc_info.value.lambda_request_id == lambda_request_id
