import json
from collections.abc import Callable
from urllib.parse import quote

import httpx
import pytest
from pydantic import BaseModel, JsonValue
from pytest_mock import MockerFixture

from core.plugin.endpoint.exc import EndpointSetupFailedError
from core.plugin.entities.plugin_daemon import (
    PluginDaemonBasicResponse,
    PluginDaemonInnerError,
    PluginDaemonRawResponse,
    PluginListResponse,
)
from core.plugin.impl.base import PLUGIN_DAEMON_MAX_PATH_LENGTH, BasePluginClient
from core.plugin.impl.exc import PluginLLMPollingUnsupportedError, PluginRuntimeError
from core.trigger.errors import (
    EventIgnoreError,
    TriggerInvokeError,
    TriggerPluginInvokeError,
    TriggerProviderCredentialValidationError,
)


def _response[T: BaseModel | dict[str, JsonValue] | list[JsonValue] | bool | str](
    payload: PluginDaemonBasicResponse[T],
) -> httpx.Response:
    """Serve the real daemon envelope through the real response class the client consumes."""

    return httpx.Response(
        200,
        json=payload.model_dump(),
        request=httpx.Request("GET", "http://plugin-daemon/test"),
    )


def _legacy_array_response(payload: list[JsonValue]) -> httpx.Response:
    """Serve a bare JSON array, the shape older daemons returned for plugin lists."""

    return httpx.Response(200, json=payload, request=httpx.Request("GET", "http://plugin-daemon/test"))


def _stream_line_response(line: str) -> httpx.Response:
    """Serve one SSE-style daemon line through the real response the stream client consumes."""

    return httpx.Response(200, content=f"data: {line}\n", request=httpx.Request("GET", "http://plugin-daemon/test"))


class TestBasePluginClientImpl:
    def test_inject_trace_headers(self, mocker: MockerFixture, config_overrides: Callable[..., None]) -> None:
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

    def test_stream_request_handles_data_lines_and_dict_payload(self) -> None:
        seen: dict[str, bytes] = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen["content"] = request.content
            return httpx.Response(200, content=b"\n\ndata: hello\nworld\n")

        client = BasePluginClient(httpx_client=httpx.Client(transport=httpx.MockTransport(handler)))

        result = list(client._stream_request("POST", "plugin/tenant/stream", data={"k": "v"}))

        assert result == ["hello", "world"]
        assert seen["content"] == b"k=v"

    @pytest.mark.parametrize(
        "path",
        [
            "plugin/tenant/%252e%252e%252ftarget",
            "plugin/tenant/%2e%2e%252ftarget",
        ],
    )
    def test_prepare_request_rejects_encoded_traversal_with_encoded_separator(self, path: str) -> None:
        client = BasePluginClient()

        with pytest.raises(ValueError, match="traversal sequence detected"):
            client._prepare_request(path, None, None, None, None)

    def test_prepare_request_rejects_path_exceeding_max_length(self) -> None:
        client = BasePluginClient()
        path = "a" * (PLUGIN_DAEMON_MAX_PATH_LENGTH + 1)

        with pytest.raises(ValueError, match="path length exceeds"):
            client._prepare_request(path, None, None, None, None)

    def test_prepare_request_rejects_excessively_encoded_path(self) -> None:
        client = BasePluginClient()
        segment = "..%2Ftarget"
        for _ in range(9):
            segment = quote(segment, safe="")
        path = f"plugin/tenant/{segment}"

        with pytest.raises(ValueError, match="too deeply encoded"):
            client._prepare_request(path, None, None, None, None)

    def test_request_with_plugin_daemon_response_handles_request_exception(self) -> None:
        def handler(_request: httpx.Request) -> httpx.Response:
            raise RuntimeError("boom")

        client = BasePluginClient(httpx_client=httpx.Client(transport=httpx.MockTransport(handler)))

        with pytest.raises(ValueError, match="Failed to request plugin daemon"):
            client._request_with_plugin_daemon_response("GET", "plugin/tenant/path", bool)

    def test_request_with_plugin_daemon_response_applies_typed_transformer_and_preserves_unknown_keys(self) -> None:
        payload = {
            "code": 0,
            "message": "",
            "data": {"nested": ["keep", {"future": True}]},
            "future_envelope_key": {"also": "keep"},
        }
        transport = httpx.MockTransport(
            lambda _: httpx.Response(200, json=payload, request=httpx.Request("GET", "http://plugin-daemon/test"))
        )
        client = BasePluginClient(httpx_client=httpx.Client(transport=transport))
        transformed: list[PluginDaemonRawResponse] = []

        def transformer(json_response: PluginDaemonRawResponse) -> PluginDaemonRawResponse:
            transformed.append(json_response)
            return json_response

        result = client._request_with_plugin_daemon_response(
            "GET", "plugin/tenant/path", dict[str, JsonValue], transformer=transformer
        )

        assert result == payload["data"]
        assert [response.model_dump(mode="json") for response in transformed] == [payload]

    def test_request_with_plugin_daemon_response_applies_transformer_to_bool_data(self) -> None:
        envelope = PluginDaemonBasicResponse[bool](code=0, message="", data=True)
        client = BasePluginClient(
            httpx_client=httpx.Client(transport=httpx.MockTransport(lambda _: _response(envelope)))
        )

        def transformer(json_response: PluginDaemonRawResponse) -> PluginDaemonRawResponse:
            assert json_response.data is True
            return json_response

        result = client._request_with_plugin_daemon_response("GET", "plugin/tenant/path", bool, transformer=transformer)

        assert result is True

    @pytest.mark.parametrize("include_data", [False, True])
    def test_request_with_plugin_daemon_response_transformer_accepts_missing_or_null_data(
        self, include_data: bool
    ) -> None:
        payload: dict[str, JsonValue] = {"code": 0, "message": ""}
        if include_data:
            payload["data"] = None
        client = BasePluginClient(
            httpx_client=httpx.Client(
                transport=httpx.MockTransport(
                    lambda _: httpx.Response(
                        200,
                        json=payload,
                        request=httpx.Request("GET", "http://plugin-daemon/test"),
                    )
                )
            )
        )

        def transformer(json_response: PluginDaemonRawResponse) -> PluginDaemonRawResponse:
            return json_response

        with pytest.raises(ValueError, match="got empty data from plugin daemon"):
            client._request_with_plugin_daemon_response("GET", "plugin/tenant/path", bool, transformer=transformer)

    def test_request_with_plugin_daemon_response_accepts_legacy_plugin_list_data_array(self) -> None:
        envelope = PluginDaemonBasicResponse[list[JsonValue]](code=0, message="", data=[])
        client = BasePluginClient(
            httpx_client=httpx.Client(transport=httpx.MockTransport(lambda _: _response(envelope)))
        )

        result = client._request_with_plugin_daemon_response("GET", "plugin/tenant/management/list", PluginListResponse)

        assert result.list == []
        assert result.total == 0

    def test_request_with_plugin_daemon_response_accepts_legacy_plugin_list_top_level_array(self) -> None:
        client = BasePluginClient(
            httpx_client=httpx.Client(transport=httpx.MockTransport(lambda _: _legacy_array_response([])))
        )

        result = client._request_with_plugin_daemon_response("GET", "plugin/tenant/management/list", PluginListResponse)

        assert result.list == []
        assert result.total == 0

    def test_request_with_plugin_daemon_response_stream_malformed_json_error(self) -> None:
        client = BasePluginClient(
            httpx_client=httpx.Client(
                transport=httpx.MockTransport(lambda _: _stream_line_response('{"error":"bad-line"}'))
            )
        )

        with pytest.raises(ValueError, match="bad-line"):
            list(client._request_with_plugin_daemon_response_stream("GET", "plugin/tenant/stream", bool))

    def test_request_with_plugin_daemon_response_stream_plugin_daemon_inner_error(self) -> None:
        client = BasePluginClient(
            httpx_client=httpx.Client(
                transport=httpx.MockTransport(
                    lambda _: _stream_line_response('{"code":-500,"message":"not-json","data":null}')
                )
            )
        )

        with pytest.raises(PluginDaemonInnerError) as exc_info:
            list(client._request_with_plugin_daemon_response_stream("GET", "plugin/tenant/stream", bool))
        assert exc_info.value.message == "not-json"

    def test_request_with_plugin_daemon_response_stream_plugin_daemon_error(self) -> None:
        client = BasePluginClient(
            httpx_client=httpx.Client(
                transport=httpx.MockTransport(
                    lambda _: _stream_line_response('{"code":-1,"message":"err","data":null}')
                )
            )
        )

        with pytest.raises(ValueError, match="plugin daemon: err, code: -1"):
            list(client._request_with_plugin_daemon_response_stream("GET", "plugin/tenant/stream", bool))

    def test_request_with_plugin_daemon_response_stream_empty_data_error(self) -> None:
        client = BasePluginClient(
            httpx_client=httpx.Client(
                transport=httpx.MockTransport(lambda _: _stream_line_response('{"code":0,"message":"","data":null}'))
            )
        )

        with pytest.raises(ValueError, match="got empty data"):
            list(client._request_with_plugin_daemon_response_stream("GET", "plugin/tenant/stream", bool))

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
    def test_handle_plugin_daemon_error_trigger_branches(self, error_type: str, expected: type[BaseException]) -> None:
        client = BasePluginClient()
        message = json.dumps({"error_type": error_type, "message": "m"})

        with pytest.raises(expected):
            client._handle_plugin_daemon_error("PluginInvokeError", message)

    def test_handle_plugin_daemon_error_maps_unsupported_polling_to_typed_exception(self) -> None:
        client = BasePluginClient()
        message = json.dumps({"error_type": PluginLLMPollingUnsupportedError.__name__, "message": "m"})

        with pytest.raises(PluginLLMPollingUnsupportedError):
            client._handle_plugin_daemon_error("PluginInvokeError", message)

    def test_handle_plugin_daemon_error_maps_runtime_error_to_typed_exception(self) -> None:
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
