import json
import logging
from collections.abc import Callable
from urllib.parse import quote

import httpx
import pytest
from pytest_mock import MockerFixture

from core.plugin.endpoint.exc import EndpointSetupFailedError
from core.plugin.entities.plugin_daemon import PluginDaemonInnerError, PluginListResponse, PluginToolProviderEntity
from core.plugin.impl.base import PLUGIN_DAEMON_MAX_PATH_LENGTH, BasePluginClient
from core.plugin.impl.exc import (
    PluginDaemonClientSideError,
    PluginDaemonInternalServerError,
    PluginDaemonUnauthorizedError,
    PluginLLMPollingUnsupportedError,
    PluginRuntimeError,
)
from core.trigger.errors import (
    EventIgnoreError,
    TriggerInvokeError,
    TriggerPluginInvokeError,
    TriggerProviderCredentialValidationError,
)


class _ResponseStub:
    def __init__(self, payload, raise_for_status_error: Exception | None = None):
        self._payload = payload
        self._raise_for_status_error = raise_for_status_error

    def raise_for_status(self):
        if self._raise_for_status_error is not None:
            raise self._raise_for_status_error

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


def _i18n(text: str) -> dict[str, str]:
    return {"en_US": text}


def _tool_provider_payload(
    *,
    plugin_id: str = "langgenius/weather",
    provider: str = "weather",
    tools: list[dict] | None = None,
) -> dict:
    if tools is None:
        tools = [
            {
                "identity": {
                    "author": "langgenius",
                    "name": "get_weather",
                    "label": _i18n("Get Weather"),
                    "provider": provider,
                },
                "description": {"human": _i18n("Get weather"), "llm": "Get weather"},
            }
        ]
    return {
        "provider": provider,
        "plugin_unique_identifier": f"{plugin_id}:0.0.1@abc",
        "plugin_id": plugin_id,
        "declaration": {
            "identity": {
                "author": "langgenius",
                "name": provider,
                "description": _i18n(provider),
                "icon": "icon.svg",
                "label": _i18n(provider),
            },
            "tools": tools,
        },
    }


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

    def test_request_with_plugin_daemon_response_skips_invalid_list_items(self, mocker: MockerFixture, caplog):
        client = BasePluginClient()
        valid = _tool_provider_payload()
        malformed = {
            "plugin_id": "langgenius/broken",
            "provider": "broken",
            "plugin_unique_identifier": "langgenius/broken:0.0.1@def",
        }
        mocker.patch.object(
            client,
            "_request",
            return_value=_ResponseStub({"code": 0, "message": "", "data": [valid, malformed, "not-an-object"]}),
        )

        with caplog.at_level(logging.WARNING):
            result = client._request_with_plugin_daemon_response(
                "GET",
                "plugin/tenant/management/tools",
                list[PluginToolProviderEntity],
            )

        assert len(result) == 1
        assert result[0].plugin_id == "langgenius/weather"
        assert "plugin_id=langgenius/broken" in caplog.text
        assert "non-object str" in caplog.text

    def test_request_with_plugin_daemon_response_all_invalid_list_returns_empty(self, mocker: MockerFixture):
        client = BasePluginClient()
        mocker.patch.object(
            client,
            "_request",
            return_value=_ResponseStub({"code": 0, "message": "", "data": [{"bad": True}, 12]}),
        )

        result = client._request_with_plugin_daemon_response(
            "GET",
            "plugin/tenant/management/tools",
            list[PluginToolProviderEntity],
        )

        assert result == []

    def test_request_with_plugin_daemon_response_single_object_stays_strict(self, mocker: MockerFixture):
        client = BasePluginClient()
        mocker.patch.object(
            client,
            "_request",
            return_value=_ResponseStub({"code": 0, "message": "", "data": {"plugin_id": "langgenius/broken"}}),
        )

        with pytest.raises(ValueError, match="Failed to parse response from plugin daemon"):
            client._request_with_plugin_daemon_response(
                "GET",
                "plugin/tenant/management/tool",
                PluginToolProviderEntity,
            )

    def test_request_with_plugin_daemon_response_primitive_list_stays_strict(self, mocker: MockerFixture):
        client = BasePluginClient()
        mocker.patch.object(
            client,
            "_request",
            return_value=_ResponseStub({"code": 0, "message": "", "data": [True, "nope"]}),
        )

        with pytest.raises(ValueError, match="Failed to parse response from plugin daemon"):
            client._request_with_plugin_daemon_response(
                "POST",
                "plugin/tenant/management/tools/check_existence",
                list[bool],
            )

    def test_request_with_plugin_daemon_response_list_preserves_daemon_code_error(self, mocker: MockerFixture):
        client = BasePluginClient()
        mocker.patch.object(
            client,
            "_request",
            return_value=_ResponseStub(
                {"code": -1, "message": "daemon exploded", "data": [_tool_provider_payload(), {"bad": True}]}
            ),
        )

        with pytest.raises(ValueError, match="daemon exploded, code: -1"):
            client._request_with_plugin_daemon_response(
                "GET",
                "plugin/tenant/management/tools",
                list[PluginToolProviderEntity],
            )

    def test_request_with_plugin_daemon_response_list_preserves_typed_daemon_error(self, mocker: MockerFixture):
        client = BasePluginClient()
        error_message = json.dumps({"error_type": "PluginDaemonUnauthorizedError", "message": "Unauthorized access"})
        mocker.patch.object(
            client,
            "_request",
            return_value=_ResponseStub({"code": -1, "message": error_message, "data": [_tool_provider_payload()]}),
        )

        with pytest.raises(PluginDaemonUnauthorizedError):
            client._request_with_plugin_daemon_response(
                "GET",
                "plugin/tenant/management/tools",
                list[PluginToolProviderEntity],
            )

    def test_request_with_plugin_daemon_response_http_4xx_unchanged(self, mocker: MockerFixture):
        client = BasePluginClient()
        request = httpx.Request("GET", "http://plugin-daemon/plugin/tenant/management/tools")
        response = httpx.Response(400, request=request)
        mocker.patch.object(
            client,
            "_request",
            return_value=_ResponseStub(
                {},
                raise_for_status_error=httpx.HTTPStatusError("Bad Request", request=request, response=response),
            ),
        )

        with pytest.raises(PluginDaemonClientSideError):
            client._request_with_plugin_daemon_response(
                "GET",
                "plugin/tenant/management/tools",
                list[PluginToolProviderEntity],
            )

    def test_request_with_plugin_daemon_response_http_5xx_unchanged(self, mocker: MockerFixture):
        client = BasePluginClient()
        request = httpx.Request("GET", "http://plugin-daemon/plugin/tenant/management/tools")
        response = httpx.Response(503, request=request)
        mocker.patch.object(
            client,
            "_request",
            return_value=_ResponseStub(
                {},
                raise_for_status_error=httpx.HTTPStatusError("Service Unavailable", request=request, response=response),
            ),
        )

        with pytest.raises(PluginDaemonInternalServerError):
            client._request_with_plugin_daemon_response(
                "GET",
                "plugin/tenant/management/tools",
                list[PluginToolProviderEntity],
            )
