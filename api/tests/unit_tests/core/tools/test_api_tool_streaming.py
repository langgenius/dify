"""Tests for ApiTool streaming support."""

import contextlib
import json
from unittest.mock import MagicMock, patch

import httpx
import pytest

from core.helper import ssrf_proxy
from core.tools.custom_tool.tool import ApiTool
from core.tools.entities.tool_bundle import ApiToolBundle
from core.tools.entities.tool_entities import ToolEntity, ToolInvokeMessage
from core.tools.errors import ToolInvokeError, ToolSSRFError

# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------


def _msg_text(msg: ToolInvokeMessage) -> str:
    """Extract plain text from a ToolInvokeMessage regardless of inner type."""
    inner = msg.message
    if hasattr(inner, "text"):
        return inner.text
    return str(inner)


def _make_api_tool(streaming: bool = False) -> ApiTool:
    bundle = ApiToolBundle(
        server_url="https://api.example.com/v1/chat",
        method="post",
        summary="test",
        operation_id="test_op",
        parameters=[],
        author="test",
        icon=None,
        openapi={},
        streaming=streaming,
    )

    entity = MagicMock(spec=ToolEntity)
    entity.identity = MagicMock()
    entity.identity.name = "test_tool"
    entity.identity.author = "test"
    entity.output_schema = {}

    runtime = MagicMock()
    runtime.credentials = {"auth_type": "none"}
    runtime.runtime_parameters = {}

    return ApiTool(entity=entity, api_bundle=bundle, runtime=runtime, provider_id="test_provider")


class FakeStreamResponse:
    def __init__(
        self,
        status_code: int,
        content_type: str,
        lines: list[str] | None = None,
        chunks: list[str] | None = None,
        text: str = "",
        extra_headers: dict[str, str] | None = None,
    ):
        self.status_code = status_code
        self.headers = {"content-type": content_type}
        if extra_headers:
            self.headers.update(extra_headers)
        self.text = text
        self._lines = lines or []
        self._chunks = chunks or []

    def iter_lines(self):
        yield from self._lines

    def iter_text(self, chunk_size=4096):
        yield from self._chunks

    def iter_bytes(self, chunk_size=8192):
        yield self.text.encode("utf-8")

    def read(self):
        pass


@contextlib.contextmanager
def _fake_stream_ctx(response: FakeStreamResponse):
    yield response


# ---------------------------------------------------------------------------
# ApiToolBundle.streaming default value
# ---------------------------------------------------------------------------


class TestApiToolBundleStreaming:
    def test_default_false(self):
        bundle = ApiToolBundle(
            server_url="https://example.com",
            method="get",
            operation_id="op",
            parameters=[],
            author="",
            openapi={},
        )
        assert bundle.streaming is False

    def test_explicit_true(self):
        bundle = ApiToolBundle(
            server_url="https://example.com",
            method="get",
            operation_id="op",
            parameters=[],
            author="",
            openapi={},
            streaming=True,
        )
        assert bundle.streaming is True


# ---------------------------------------------------------------------------
# SSE parser
# ---------------------------------------------------------------------------


class TestParseSSEStream:
    def test_openai_format(self):
        tool = _make_api_tool(streaming=True)
        lines = [
            'data: {"choices":[{"delta":{"content":"Hello"}}]}',
            'data: {"choices":[{"delta":{"content":" world"}}]}',
            "data: [DONE]",
        ]
        resp = FakeStreamResponse(200, "text/event-stream", lines=lines)
        messages = list(tool._parse_sse_stream(resp))
        assert len(messages) == 2
        assert _msg_text(messages[0]) == "Hello"
        assert _msg_text(messages[1]) == " world"

    def test_plain_text_sse(self):
        tool = _make_api_tool(streaming=True)
        lines = ["data: chunk1", "data: chunk2", "", "data: [DONE]"]
        resp = FakeStreamResponse(200, "text/event-stream", lines=lines)
        messages = list(tool._parse_sse_stream(resp))
        assert len(messages) == 2
        assert _msg_text(messages[0]) == "chunk1"
        assert _msg_text(messages[1]) == "chunk2"

    def test_common_field_names(self):
        tool = _make_api_tool(streaming=True)
        lines = [
            'data: {"content":"from content"}',
            'data: {"text":"from text"}',
            'data: {"message":"from message"}',
        ]
        resp = FakeStreamResponse(200, "text/event-stream", lines=lines)
        messages = list(tool._parse_sse_stream(resp))
        assert len(messages) == 3
        assert _msg_text(messages[0]) == "from content"
        assert _msg_text(messages[1]) == "from text"
        assert _msg_text(messages[2]) == "from message"

    def test_empty_lines_skipped(self):
        tool = _make_api_tool(streaming=True)
        lines = ["", "", "data: hello", ""]
        resp = FakeStreamResponse(200, "text/event-stream", lines=lines)
        messages = list(tool._parse_sse_stream(resp))
        assert len(messages) == 1

    def test_non_data_lines_skipped(self):
        tool = _make_api_tool(streaming=True)
        lines = ["event: message", "id: 1", "retry: 3000", "data: actual content"]
        resp = FakeStreamResponse(200, "text/event-stream", lines=lines)
        messages = list(tool._parse_sse_stream(resp))
        assert len(messages) == 1
        assert _msg_text(messages[0]) == "actual content"


# ---------------------------------------------------------------------------
# NDJSON parser
# ---------------------------------------------------------------------------


class TestParseNdjsonStream:
    def test_json_with_content_field(self):
        tool = _make_api_tool(streaming=True)
        lines = [json.dumps({"content": "line1"}), json.dumps({"content": "line2"})]
        resp = FakeStreamResponse(200, "application/x-ndjson", lines=lines)
        messages = list(tool._parse_ndjson_stream(resp))
        assert len(messages) == 2
        assert _msg_text(messages[0]) == "line1"

    def test_fallback_to_full_json(self):
        tool = _make_api_tool(streaming=True)
        lines = [json.dumps({"result": 42})]
        resp = FakeStreamResponse(200, "application/x-ndjson", lines=lines)
        messages = list(tool._parse_ndjson_stream(resp))
        assert len(messages) == 1
        assert "42" in _msg_text(messages[0])

    def test_invalid_json_lines(self):
        tool = _make_api_tool(streaming=True)
        lines = ["not json", ""]
        resp = FakeStreamResponse(200, "application/x-ndjson", lines=lines)
        messages = list(tool._parse_ndjson_stream(resp))
        assert len(messages) == 1
        assert _msg_text(messages[0]) == "not json"


# ---------------------------------------------------------------------------
# Text stream parser
# ---------------------------------------------------------------------------


class TestParseTextStream:
    def test_text_chunks(self):
        tool = _make_api_tool(streaming=True)
        resp = FakeStreamResponse(200, "text/plain", chunks=["chunk1", "chunk2", "chunk3"])
        messages = list(tool._parse_text_stream(resp))
        assert len(messages) == 3
        assert _msg_text(messages[0]) == "chunk1"

    def test_empty_chunks_skipped(self):
        tool = _make_api_tool(streaming=True)
        resp = FakeStreamResponse(200, "text/plain", chunks=["", "data", ""])
        messages = list(tool._parse_text_stream(resp))
        assert len(messages) == 1


# ---------------------------------------------------------------------------
# _invoke() streaming branch
# ---------------------------------------------------------------------------


class TestInvokeStreamingBranch:
    @patch.object(ApiTool, "do_http_request_streaming")
    @patch.object(ApiTool, "do_http_request")
    def test_streaming_true_uses_streaming_path(self, mock_non_stream, mock_stream):
        tool = _make_api_tool(streaming=True)
        mock_stream.return_value = iter([tool.create_text_message("streamed")])

        messages = list(tool._invoke(user_id="u1", tool_parameters={}))
        mock_stream.assert_called_once()
        mock_non_stream.assert_not_called()
        assert len(messages) == 1
        assert _msg_text(messages[0]) == "streamed"

    @patch.object(ApiTool, "do_http_request_streaming")
    @patch.object(ApiTool, "do_http_request")
    def test_streaming_false_uses_non_streaming_path(self, mock_non_stream, mock_stream):
        tool = _make_api_tool(streaming=False)
        mock_response = MagicMock(spec=httpx.Response)
        mock_response.status_code = 200
        mock_response.content = b'{"result": "ok"}'
        mock_response.headers = {"content-type": "text/plain"}
        mock_response.text = "ok"
        mock_response.json.side_effect = Exception("not json")
        mock_non_stream.return_value = mock_response

        messages = list(tool._invoke(user_id="u1", tool_parameters={}))
        mock_non_stream.assert_called_once()
        mock_stream.assert_not_called()


# ---------------------------------------------------------------------------
# Error handling
# ---------------------------------------------------------------------------


class TestStreamingErrorHandling:
    def test_http_error_raises(self):
        tool = _make_api_tool(streaming=True)
        error_resp = FakeStreamResponse(500, "text/plain", text="Internal Server Error")

        with patch("core.helper.ssrf_proxy.stream_request", return_value=_fake_stream_ctx(error_resp)):
            with pytest.raises(ToolInvokeError, match="500"):
                list(tool.do_http_request_streaming("https://example.com", "POST", {}, {}))

    def test_stream_error_raises(self):
        tool = _make_api_tool(streaming=True)

        @contextlib.contextmanager
        def _raise_stream_error():
            raise httpx.StreamError("connection reset")
            yield

        with patch("core.helper.ssrf_proxy.stream_request", return_value=_raise_stream_error()):
            with pytest.raises(ToolInvokeError, match="Stream request failed"):
                list(tool.do_http_request_streaming("https://example.com", "POST", {}, {}))

    def test_timeout_raises(self):
        tool = _make_api_tool(streaming=True)

        @contextlib.contextmanager
        def _raise_timeout():
            raise httpx.ReadTimeout("read timed out")
            yield

        with patch("core.helper.ssrf_proxy.stream_request", return_value=_raise_timeout()):
            with pytest.raises(ToolInvokeError, match="Stream request failed"):
                list(tool.do_http_request_streaming("https://example.com", "POST", {}, {}))


# ---------------------------------------------------------------------------
# SSRF Squid proxy detection in streaming
# ---------------------------------------------------------------------------


class _FakeHttpxStreamCM:
    """Mimics the context manager returned by httpx.Client.stream()."""

    def __init__(self, response):
        self.response = response

    def __enter__(self):
        return self.response

    def __exit__(self, *args):
        return False


class TestStreamingSSRFProtection:
    def _make_mock_response(self, status_code: int, extra_headers: dict[str, str] | None = None):
        resp = MagicMock()
        resp.status_code = status_code
        resp.headers = {"content-type": "text/html"}
        if extra_headers:
            resp.headers.update(extra_headers)
        return resp

    def test_squid_403_raises_ssrf_error(self):
        """stream_request should detect Squid proxy 403 and raise ToolSSRFError."""
        fake_resp = self._make_mock_response(403, {"server": "squid/5.7"})
        mock_client = MagicMock()
        mock_client.stream.return_value = _FakeHttpxStreamCM(fake_resp)

        with patch("core.helper.ssrf_proxy._get_ssrf_client", return_value=mock_client):
            with pytest.raises(ToolSSRFError, match="SSRF protection"):
                with ssrf_proxy.stream_request("POST", "https://internal.example.com"):
                    pass

    def test_squid_401_via_header_raises_ssrf_error(self):
        """stream_request should detect Squid in Via header and raise ToolSSRFError."""
        fake_resp = self._make_mock_response(401, {"via": "1.1 squid-proxy"})
        mock_client = MagicMock()
        mock_client.stream.return_value = _FakeHttpxStreamCM(fake_resp)

        with patch("core.helper.ssrf_proxy._get_ssrf_client", return_value=mock_client):
            with pytest.raises(ToolSSRFError, match="SSRF protection"):
                with ssrf_proxy.stream_request("POST", "https://internal.example.com"):
                    pass

    def test_non_squid_403_passes_through(self):
        """403 from non-Squid server should NOT raise ToolSSRFError but be handled by caller."""
        tool = _make_api_tool(streaming=True)
        resp = FakeStreamResponse(403, "text/plain", text="Forbidden")

        with patch("core.helper.ssrf_proxy.stream_request", return_value=_fake_stream_ctx(resp)):
            with pytest.raises(ToolInvokeError, match="403"):
                list(tool.do_http_request_streaming("https://example.com", "POST", {}, {}))


# ---------------------------------------------------------------------------
# Content-type routing
# ---------------------------------------------------------------------------


class TestContentTypeRouting:
    def test_sse_content_type(self):
        tool = _make_api_tool(streaming=True)
        resp = FakeStreamResponse(200, "text/event-stream; charset=utf-8", lines=["data: hello"])

        with patch("core.helper.ssrf_proxy.stream_request", return_value=_fake_stream_ctx(resp)):
            messages = list(tool.do_http_request_streaming("https://example.com", "POST", {}, {}))
        assert len(messages) == 1

    def test_ndjson_content_type(self):
        tool = _make_api_tool(streaming=True)
        resp = FakeStreamResponse(200, "application/x-ndjson", lines=[json.dumps({"text": "hi"})])

        with patch("core.helper.ssrf_proxy.stream_request", return_value=_fake_stream_ctx(resp)):
            messages = list(tool.do_http_request_streaming("https://example.com", "POST", {}, {}))
        assert len(messages) == 1
        assert _msg_text(messages[0]) == "hi"

    def test_jsonl_content_type(self):
        tool = _make_api_tool(streaming=True)
        resp = FakeStreamResponse(200, "application/jsonl", lines=[json.dumps({"content": "hey"})])

        with patch("core.helper.ssrf_proxy.stream_request", return_value=_fake_stream_ctx(resp)):
            messages = list(tool.do_http_request_streaming("https://example.com", "POST", {}, {}))
        assert len(messages) == 1

    def test_fallback_text_stream(self):
        tool = _make_api_tool(streaming=True)
        resp = FakeStreamResponse(200, "application/octet-stream", chunks=["raw data"])

        with patch("core.helper.ssrf_proxy.stream_request", return_value=_fake_stream_ctx(resp)):
            messages = list(tool.do_http_request_streaming("https://example.com", "POST", {}, {}))
        assert len(messages) == 1
        assert _msg_text(messages[0]) == "raw data"


# ---------------------------------------------------------------------------
# OpenAPI parser: x-dify-streaming extraction
# ---------------------------------------------------------------------------


class TestOpenAPIParserStreaming:
    def test_x_dify_streaming_true(self):
        from flask import Flask

        from core.tools.utils.parser import ApiBasedToolSchemaParser

        openapi = {
            "openapi": "3.0.0",
            "info": {"title": "Test", "version": "1.0"},
            "servers": [{"url": "https://api.example.com"}],
            "paths": {
                "/chat": {
                    "post": {
                        "x-dify-streaming": True,
                        "operationId": "chat",
                        "summary": "Chat",
                        "responses": {"200": {"description": "OK"}},
                    }
                }
            },
        }
        app = Flask(__name__)
        with app.test_request_context():
            bundles = ApiBasedToolSchemaParser.parse_openapi_to_tool_bundle(openapi)

        assert len(bundles) == 1
        assert bundles[0].streaming is True

    def test_x_dify_streaming_absent(self):
        from flask import Flask

        from core.tools.utils.parser import ApiBasedToolSchemaParser

        openapi = {
            "openapi": "3.0.0",
            "info": {"title": "Test", "version": "1.0"},
            "servers": [{"url": "https://api.example.com"}],
            "paths": {
                "/query": {
                    "get": {
                        "operationId": "query",
                        "summary": "Query",
                        "responses": {"200": {"description": "OK"}},
                    }
                }
            },
        }
        app = Flask(__name__)
        with app.test_request_context():
            bundles = ApiBasedToolSchemaParser.parse_openapi_to_tool_bundle(openapi)

        assert len(bundles) == 1
        assert bundles[0].streaming is False
