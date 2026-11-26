"""Exercise binary outputs through native tools and the HTTP file boundary."""

import base64
import json
import mimetypes

import httpx
import pytest
from pydantic_ai.messages import ModelRequest, ToolReturnPart

from dify_agent.layers.dify_plugin import tools_layer
from dify_agent.layers.execution_context.configs import (
    DifyExecutionContextAgentMode,
    DifyExecutionContextLayerConfig,
)
from dify_agent.layers.execution_context.layer import Capability as ExecutionContextCapability
from dify_agent.runtime.context import Deps, Services
from tests.local.dify_agent.module_support import invoke_native_tool


_FILE_ID = "00000000-0000-4000-8000-000000000001"
_FILE_REFERENCE = "dify-file-ref:eyJyZWNvcmRfaWQiOiIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDEifQ=="
_DEFAULT_READ_MEDIA_SUFFIX = (
    " (call `read_media` with `file` set to this object only if you need to inspect its content).\n"
)
_DELIVERED_BLOB_SUFFIX = (
    " (already delivered to the user as an attachment; call `read_media` with `file` set to this object"
    " only if you need to inspect its content).\n"
)


def _deps(
    client: httpx.AsyncClient,
    *,
    missing_identity: str | None = None,
    max_bytes: int = 1024,
    agent_mode: DifyExecutionContextAgentMode = "agent_app",
) -> Deps:
    context = DifyExecutionContextLayerConfig(
        tenant_id="tenant",
        user_id=None if missing_identity == "user_id" else "user",
        user_from=None if missing_identity == "user_from" else "account",
        conversation_id="conversation",
        app_id="app",
        agent_mode=agent_mode,
        invoke_from="debugger",
    )
    config = tools_layer.Config(
        tools=[{"plugin_id": "files", "provider": "files", "tool_name": "create", "credential_type": "unauthorized"}]
    )
    return Deps(
        layers={
            "tools": {"config": config.model_dump(mode="json"), "state": {}},
            "execution_context": {"config": context.model_dump(mode="json"), "state": {}},
        },
        services=Services(
            client,
            client,
            inner_api_url="http://dify.test",
            inner_api_key="inner-secret",
            agent_file_upload_max_bytes=max_bytes,
        ),
        run_id="test",
    )


def _stream(messages: list[dict[str, object]]) -> httpx.Response:
    return httpx.Response(
        200,
        text="".join(f"data: {json.dumps({'code': 0, 'message': '', 'data': message})}\n" for message in messages),
    )


def _tool_returns(result) -> list[ToolReturnPart]:
    return [
        part
        for message in result.all_messages()
        if isinstance(message, ModelRequest)
        for part in message.parts
        if isinstance(part, ToolReturnPart)
    ]


@pytest.mark.parametrize(
    "meta,filename,mime_type",
    [
        ({"filename": "../chart.png", "mime_type": "image/png; charset=binary"}, "chart.png", "image/png"),
        ({"filename": r"C:\tmp\report.pdf"}, "report.pdf", "application/pdf"),
        ({"filename": "recording", "mime_type": "audio/mpeg"}, "recording.mp3", "audio/mpeg"),
        ({"mime_type": "application/pdf"}, "output.pdf", "application/pdf"),
        ({"filename": "dir/chart.txt", "mime_type": " IMAGE/PNG; charset=binary "}, "chart.png", "image/png"),
        ({"filename": "dir/\x00chart\n\x7f.png", "mime_type": "image/png"}, "chart.png", "image/png"),
        ({"filename": "..\\\x00\n", "mime_type": "application/pdf"}, "output.pdf", "application/pdf"),
        ({"filename": "..", "mime_type": "application/pdf"}, "output.pdf", "application/pdf"),
        ({"filename": "chart.png", "mime_type": 123}, "chart.png", "image/png"),
        ({"filename": "report.pdf", "mime_type": "application/octet-stream"}, "report.pdf", "application/pdf"),
        ({"filename": "archive.gz", "mime_type": "application/octet-stream"}, "archive.gz", "application/gzip"),
        (
            {"filename": "data.parquet", "mime_type": "application/octet-stream"},
            "data.parquet",
            "application/octet-stream",
        ),
        ({"filename": "output", "mime_type": "application/octet-stream"}, "output.bin", "application/octet-stream"),
        ({"filename": "recording.wav", "mime_type": "audio/wav"}, "recording.wav", "audio/wav"),
        ({"filename": "recording", "mime_type": "audio/wav"}, "recording.wav", "audio/wav"),
        ({"filename": "doc.xml", "mime_type": "application/xml"}, "doc.xml", "application/xml"),
        ({"filename": "doc", "mime_type": "application/xml"}, "doc.xml", "application/xml"),
        ({"filename": "photo.jpg", "mime_type": "image/jpg"}, "photo.jpg", "image/jpeg"),
        ({"filename": "audio.mp3", "mime_type": "audio/mp3"}, "audio.mp3", "audio/mpeg"),
        ({"filename": "photo.jpeg", "mime_type": "image/jpg"}, "photo.jpeg", "image/jpeg"),
        ({"filename": "recording.wav", "mime_type": "audio/wave"}, "recording.wav", "audio/wav"),
        ({"filename": "recording", "mime_type": "audio/wave"}, "recording.wav", "audio/wav"),
        ({"filename": "recording.wav", "mime_type": "audio/vnd.wave"}, "recording.wav", "audio/wav"),
        ({"filename": "recording.wav", "mime_type": "application/octet-stream"}, "recording.wav", "audio/wav"),
        ({"filename": "report.pdf", "mime_type": "application/x-pdf"}, "report.pdf", "application/pdf"),
        ({"filename": "report", "mime_type": "application/x-pdf"}, "report.pdf", "application/pdf"),
        ({"filename": "report.pdf.gz", "mime_type": "application/octet-stream"}, "report.pdf.gz", "application/gzip"),
        ({"filename": "dataset.csv.bz2"}, "dataset.csv.bz2", "application/x-bzip2"),
        ({"filename": "archive.gz", "mime_type": "application/gzip"}, "archive.gz", "application/gzip"),
        ({"filename": 123, "mime_type": ["image/png"]}, "output.bin", "application/octet-stream"),
        (None, "output.bin", "application/octet-stream"),
    ],
)
def test_blob_upload_metadata_is_normalized(meta, filename, mime_type):
    assert tools_layer._resolve_blob_file_info(meta) == (filename, mime_type)


def test_blob_upload_metadata_works_without_system_mime_types(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(tools_layer, "mimetypes", mimetypes.MimeTypes(filenames=()))
    assert tools_layer._resolve_blob_file_info({"filename": "doc", "mime_type": "application/xml"}) == (
        "doc.xml",
        "application/xml",
    )
    assert tools_layer._resolve_blob_file_info({"filename": "doc.xml", "mime_type": "application/xml"}) == (
        "doc.xml",
        "application/xml",
    )
    assert tools_layer._resolve_blob_file_info({"filename": "recording", "mime_type": "audio/wave"}) == (
        "recording.wav",
        "audio/wav",
    )
    assert tools_layer._resolve_blob_file_info(
        {"filename": "recording.wav", "mime_type": "application/octet-stream"}
    ) == (
        "recording.wav",
        "audio/wav",
    )
    assert tools_layer._resolve_blob_file_info({"filename": "archive", "mime_type": "application/gzip"}) == (
        "archive.gz",
        "application/gzip",
    )
    assert tools_layer._resolve_blob_file_info({"filename": "dataset", "mime_type": "application/x-bzip2"}) == (
        "dataset.bz2",
        "application/x-bzip2",
    )
    assert tools_layer._resolve_blob_file_info({"filename": "dataset.bz2", "mime_type": "application/x-bzip2"}) == (
        "dataset.bz2",
        "application/x-bzip2",
    )
    assert tools_layer._resolve_blob_file_info({"filename": "report", "mime_type": "application/x-pdf"}) == (
        "report.pdf",
        "application/pdf",
    )


def test_unnamed_blob_defaults_use_sanitized_tool_name_and_index():
    assert tools_layer._resolve_blob_file_info(None, tool_name="../charts.render\x00.", blob_index=1) == (
        "charts.render_output_1.bin",
        "application/octet-stream",
    )
    assert tools_layer._resolve_blob_file_info(
        {"mime_type": "application/x-pdf"},
        tool_name="charts.render",
        blob_index=2,
    ) == ("charts.render_output_2.pdf", "application/pdf")
    assert tools_layer._resolve_blob_file_info({"mime_type": "application/pdf"}, tool_name="..", blob_index=2) == (
        "output_2.pdf",
        "application/pdf",
    )


@pytest.mark.anyio
@pytest.mark.parametrize("chunked", [False, True])
async def test_binary_output_is_uploaded_and_returned_as_reusable_file_metadata(chunked):
    blob = b"\x00\xffbinary-output-regression"
    meta = {"filename": "../chart.png", "mime_type": "image/png; charset=binary"}
    filename, mime_type = "chart.png", "image/png"
    encoded = base64.b64encode(blob).decode()
    messages = [{"type": "blob", "message": {"blob": encoded}, "meta": meta}]
    if chunked:
        messages = [
            {
                "type": "blob_chunk",
                "message": {"id": "chunk", "sequence": index, "total_length": len(blob), "blob": data, "end": end},
                "meta": meta if index == 0 else None,
            }
            for index, data, end in [(0, encoded, False), (1, "", True)]
        ]
    allocations = []
    uploads = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/dispatch/tool/invoke"):
            return _stream([{"type": "text", "message": {"text": "before:"}}, *messages])
        if request.url.path == "/inner/api/agent/files/upload-request":
            assert request.headers["X-Inner-Api-Key"] == "inner-secret"
            allocations.append(json.loads(request.content))
            return httpx.Response(200, json={"upload_uri": "/files/upload/for-plugin?sign=test"})
        assert str(request.url) == "http://dify.test/files/upload/for-plugin?sign=test"
        assert "X-Inner-Api-Key" not in request.headers
        uploads.append(request.content)
        return httpx.Response(
            201,
            json={
                "id": _FILE_ID,
                "reference": _FILE_REFERENCE,
                "name": filename,
                "size": len(blob),
                "mime_type": mime_type,
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await invoke_native_tool(_deps(client), tools_layer.Toolset("tools"), "create", {})
        assert not client.is_closed
    assert allocations == [
        {
            "tenant_id": "tenant",
            "user_id": "user",
            "user_from": "account",
            "conversation_id": "conversation",
            "filename": filename,
            "mimetype": mime_type,
            "max_size": 1024,
        }
    ]
    assert len(uploads) == 1 and blob in uploads[0]
    assert f'filename="{filename}"'.encode() in uploads[0]
    assert f"Content-Type: {mime_type}".encode() in uploads[0]
    prefix = "before:\nTool generated media file: "
    assert result.output.startswith(prefix) and result.output.endswith(_DELIVERED_BLOB_SUFFIX)
    assert json.loads(result.output[len(prefix) : -len(_DELIVERED_BLOB_SUFFIX)]) == {
        "transfer_method": "tool_file",
        "reference": _FILE_REFERENCE,
        "filename": "chart.png",
        "mime_type": "image/png",
        "size": len(blob),
    }
    assert "binary-output-regression" not in result.output and "blob=b" not in result.output
    assert _tool_returns(result)[0].metadata == {"dify_plugin_blob_files": [_FILE_ID]}


@pytest.mark.anyio
async def test_workflow_run_blob_observation_keeps_default_read_media_hint():
    blob = b"workflow-report"

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/dispatch/tool/invoke"):
            return _stream(
                [
                    {
                        "type": "blob",
                        "message": {"blob": base64.b64encode(blob).decode()},
                        "meta": {"filename": "report.pdf", "mime_type": "application/pdf"},
                    }
                ]
            )
        if request.url.path == "/inner/api/agent/files/upload-request":
            return httpx.Response(200, json={"upload_uri": "/files/upload/for-plugin?sign=test"})
        return httpx.Response(201, json={"reference": _FILE_REFERENCE})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await invoke_native_tool(
            _deps(client, agent_mode="workflow_run"),
            tools_layer.Toolset("tools"),
            "create",
            {},
        )

    prefix = "\nTool generated media file: "
    assert result.output.startswith(prefix) and result.output.endswith(_DEFAULT_READ_MEDIA_SUFFIX)
    assert "already delivered to the user as an attachment" not in result.output
    assert json.loads(result.output[len(prefix) : -len(_DEFAULT_READ_MEDIA_SUFFIX)]) == {
        "transfer_method": "tool_file",
        "reference": _FILE_REFERENCE,
        "filename": "report.pdf",
        "mime_type": "application/pdf",
        "size": len(blob),
    }


@pytest.mark.anyio
@pytest.mark.parametrize(
    "failure,diagnostic",
    [
        ("fragment", "invalid upload_uri"),
        ("missing-uri", "invalid upload_uri"),
        ("old-upload-path", "invalid upload_uri"),
        ("invalid-json", "Expecting value"),
        ("non-object-allocation", "file control plane returned a non-object response"),
        ("transport", "connection failed"),
        ("upload-status", "500"),
        ("user_from", "requires execution context user_from"),
    ],
)
async def test_upload_failure_never_exposes_binary_or_success_metadata(failure: str, diagnostic: str):
    blob = b"\x00secret-binary-payload\xff"
    allocation_requests = []
    upload_requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/dispatch/tool/invoke"):
            return _stream(
                [
                    {"type": "text", "message": {"text": "tool text:"}},
                    {
                        "type": "blob",
                        "message": {"blob": base64.b64encode(blob).decode()},
                        "meta": {"filename": "report.pdf"},
                    },
                ]
            )
        if request.url.path == "/inner/api/agent/files/upload-request":
            allocation_requests.append(request)
            if failure == "transport":
                raise httpx.ConnectError("connection failed", request=request)
            if failure == "invalid-json":
                return httpx.Response(200, text="invalid")
            if failure == "non-object-allocation":
                return httpx.Response(200, json=[])
            uri = {
                "fragment": "/files/upload/for-plugin?sign=test#fragment",
                "missing-uri": None,
                "old-upload-path": "/files/upload/plugin?sign=test",
            }.get(failure, "/files/upload/for-plugin?sign=test")
            return httpx.Response(200, json={"upload_uri": uri})
        upload_requests.append(request)
        assert request.url.host == "dify.test" and request.url.path == "/files/upload/for-plugin"
        assert failure == "upload-status"
        return httpx.Response(500)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await invoke_native_tool(
            _deps(client, missing_identity=failure),
            tools_layer.Toolset("tools"),
            "create",
            {},
        )
    assert result.output.startswith(
        f"tool text:\nTool media unavailable (report.pdf, application/pdf, {len(blob)} bytes): "
    )
    assert result.output.endswith(".\n")
    assert diagnostic in result.output
    assert "secret-binary-payload" not in result.output and "blob=b" not in result.output
    assert _tool_returns(result)[0].metadata is None
    assert len(allocation_requests) == (0 if failure == "user_from" else 1)
    assert len(upload_requests) == (1 if failure == "upload-status" else 0)


@pytest.mark.anyio
async def test_mixed_binary_success_and_failure_preserves_order_and_successful_file_ids():
    allocations = []
    references = [
        _FILE_REFERENCE,
        "dify-file-ref:eyJyZWNvcmRfaWQiOiIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDIifQ==",
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/dispatch/tool/invoke"):
            return _stream(
                [
                    {"type": "blob", "message": {"blob": "YQ=="}, "meta": {"filename": f"{index}.pdf"}}
                    for index in range(3)
                ]
            )
        if request.url.path == "/inner/api/agent/files/upload-request":
            allocations.append(json.loads(request.content)["filename"])
            return httpx.Response(
                500 if len(allocations) == 2 else 200, json={"upload_uri": "/files/upload/for-plugin?sign=test"}
            )
        # The shared upload contract only needs the canonical reference; the
        # attachment ID must come from it even if no separate id is returned.
        return httpx.Response(201, json={"reference": references.pop(0)})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await invoke_native_tool(_deps(client), tools_layer.Toolset("tools"), "create", {})
    assert result.output.index("0.pdf") < result.output.index("1.pdf") < result.output.index("2.pdf")
    assert "Tool media unavailable (1.pdf, application/pdf, 1 bytes):" in result.output
    assert _tool_returns(result)[0].metadata == {
        "dify_plugin_blob_files": [
            "00000000-0000-4000-8000-000000000001",
            "00000000-0000-4000-8000-000000000002",
        ]
    }


@pytest.mark.anyio
@pytest.mark.parametrize("message_type", ["image", "image_link", "binary_link", "file", "text"])
async def test_non_blob_outputs_keep_plain_observations_without_attachment_metadata(message_type):
    url = "https://image.test/image.png"
    message = {"type": message_type, "message": {"text": url}}
    if message_type == "file":
        message = {
            "type": "file",
            "message": {"file_marker": "file"},
            "meta": {
                "file": {
                    "transfer_method": "tool_file",
                    "reference": _FILE_REFERENCE,
                    "filename": "image.png",
                    "mime_type": "image/png",
                }
            },
        }

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/dispatch/tool/invoke")
        return _stream([message])

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await invoke_native_tool(_deps(client), tools_layer.Toolset("tools"), "create", {})
    if message_type == "text":
        assert result.output == url
    else:
        prefix = "\nTool generated media file: " if message_type == "file" else "\nTool generated media link: "
        assert result.output.startswith(prefix) and result.output.endswith(_DEFAULT_READ_MEDIA_SUFFIX)
        locator = (
            {"transfer_method": "tool_file", "reference": _FILE_REFERENCE}
            if message_type == "file"
            else {"transfer_method": "remote_url", "url": url}
        )
        assert json.loads(result.output[len(prefix) : -len(_DEFAULT_READ_MEDIA_SUFFIX)]) == {
            **locator,
            "filename": "image.png",
            "mime_type": "image/png",
        }
    assert _tool_returns(result)[0].metadata is None


@pytest.mark.anyio
async def test_multiple_unnamed_blobs_get_distinct_ordered_default_filenames_and_normalized_mime():
    allocations = []
    references = [
        _FILE_REFERENCE,
        "dify-file-ref:eyJyZWNvcmRfaWQiOiIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDIifQ==",
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/dispatch/tool/invoke"):
            return _stream(
                [
                    {"type": "blob", "message": {"blob": "YQ=="}, "meta": {"mime_type": "application/x-pdf"}},
                    {"type": "blob", "message": {"blob": "Yg=="}, "meta": {"mime_type": "application/pdf"}},
                ]
            )
        if request.url.path == "/inner/api/agent/files/upload-request":
            body = json.loads(request.content)
            allocations.append((body["filename"], body["mimetype"]))
            return httpx.Response(200, json={"upload_uri": "/files/upload/for-plugin?sign=test"})
        return httpx.Response(201, json={"reference": references.pop(0)})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await invoke_native_tool(_deps(client), tools_layer.Toolset("tools"), "create", {})

    assert allocations == [
        ("create_output_1.pdf", "application/pdf"),
        ("create_output_2.pdf", "application/pdf"),
    ]
    assert _tool_returns(result)[0].metadata == {
        "dify_plugin_blob_files": [
            "00000000-0000-4000-8000-000000000001",
            "00000000-0000-4000-8000-000000000002",
        ]
    }


@pytest.mark.anyio
async def test_blob_chunk_limit_aligns_with_agent_file_upload_max_bytes_and_reports_media_unavailable():
    max_bytes = 2048
    chunk_a = b"a" * 800
    chunk_b = b"b" * 700
    allocations = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/dispatch/tool/invoke"):
            return _stream(
                [
                    {
                        "type": "blob_chunk",
                        "message": {
                            "id": "ok-file",
                            "sequence": 0,
                            "total_length": len(chunk_a) + len(chunk_b),
                            "blob": base64.b64encode(chunk_a).decode(),
                            "end": False,
                        },
                        "meta": {"filename": "chunked.pdf", "mime_type": "application/x-pdf"},
                    },
                    {
                        "type": "blob_chunk",
                        "message": {
                            "id": "ok-file",
                            "sequence": 1,
                            "total_length": len(chunk_a) + len(chunk_b),
                            "blob": base64.b64encode(chunk_b).decode(),
                            "end": True,
                        },
                    },
                ]
            )
        if request.url.path == "/inner/api/agent/files/upload-request":
            allocations.append(json.loads(request.content))
            return httpx.Response(200, json={"upload_uri": "/files/upload/for-plugin?sign=test"})
        return httpx.Response(201, json={"reference": _FILE_REFERENCE})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        deps_50m = _deps(client, max_bytes=50 * 1024 * 1024)
        wired_client = ExecutionContextCapability.create_tool_client(
            deps_50m,
            "execution_context",
            plugin_id="files",
            http_client=client,
        )
        assert wired_client.max_file_size == 50 * 1024 * 1024

        ok_result = await invoke_native_tool(
            _deps(client, max_bytes=max_bytes), tools_layer.Toolset("tools"), "create", {}
        )
    assert len(allocations) == 1
    assert allocations[0]["filename"] == "chunked.pdf"
    assert allocations[0]["mimetype"] == "application/pdf"
    assert _tool_returns(ok_result)[0].metadata == {"dify_plugin_blob_files": [_FILE_ID]}

    oversized_allocations = []

    def oversized_handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/dispatch/tool/invoke"):
            return _stream(
                [
                    {
                        "type": "blob_chunk",
                        "message": {
                            "id": "too-large",
                            "sequence": 0,
                            "total_length": 1025,
                            "blob": base64.b64encode(b"x").decode(),
                            "end": False,
                        },
                    }
                ]
            )
        oversized_allocations.append(request)
        raise AssertionError("upload-request must not be called for oversized chunks")

    async with httpx.AsyncClient(transport=httpx.MockTransport(oversized_handler)) as client:
        oversized_result = await invoke_native_tool(
            _deps(client, max_bytes=1024), tools_layer.Toolset("tools"), "create", {}
        )

    assert "Tool media unavailable" in oversized_result.output
    assert "File is too large" in oversized_result.output
    assert "tool parameters validation error" not in oversized_result.output
    assert oversized_allocations == []
    assert _tool_returns(oversized_result)[0].metadata is None


@pytest.mark.anyio
async def test_mixed_stream_isolates_oversized_blob_chunk_and_preserves_sibling_outputs():
    allocations = []
    references = [
        _FILE_REFERENCE,
        "dify-file-ref:eyJyZWNvcmRfaWQiOiIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDIifQ==",
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/dispatch/tool/invoke"):
            return _stream(
                [
                    {"type": "text", "message": {"text": "summary text:"}},
                    {
                        "type": "blob",
                        "message": {"blob": base64.b64encode(b"small-blob").decode()},
                        "meta": {"filename": "small.png", "mime_type": "image/png"},
                    },
                    {
                        "type": "blob_chunk",
                        "message": {
                            "id": "oversized",
                            "sequence": 0,
                            "total_length": 2048,
                            "blob": base64.b64encode(b"x").decode(),
                            "end": False,
                        },
                        "meta": {"filename": "huge.pdf", "mime_type": "application/pdf"},
                    },
                    {
                        "type": "blob_chunk",
                        "message": {
                            "id": "oversized",
                            "sequence": 1,
                            "total_length": 2048,
                            "blob": base64.b64encode(b"y").decode(),
                            "end": True,
                        },
                    },
                    {
                        "type": "blob_chunk",
                        "message": {
                            "id": "valid-chunked",
                            "sequence": 0,
                            "total_length": 10,
                            "blob": base64.b64encode(b"hello").decode(),
                            "end": False,
                        },
                        "meta": {"filename": "ok.pdf", "mime_type": "application/pdf"},
                    },
                    {
                        "type": "blob_chunk",
                        "message": {
                            "id": "valid-chunked",
                            "sequence": 1,
                            "total_length": 10,
                            "blob": base64.b64encode(b"world").decode(),
                            "end": True,
                        },
                    },
                ]
            )
        if request.url.path == "/inner/api/agent/files/upload-request":
            body = json.loads(request.content)
            allocations.append(body["filename"])
            return httpx.Response(200, json={"upload_uri": "/files/upload/for-plugin?sign=test"})
        return httpx.Response(201, json={"reference": references.pop(0)})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await invoke_native_tool(_deps(client, max_bytes=1024), tools_layer.Toolset("tools"), "create", {})

    assert allocations == ["small.png", "ok.pdf"]
    assert result.output.startswith("summary text:\nTool generated media file: ")
    assert result.output.count("Tool media unavailable") == 1
    assert "Tool media unavailable (huge.pdf, application/pdf, 2048 bytes): File is too large" in result.output
    assert "small.png" in result.output and "ok.pdf" in result.output
    assert "tool parameters validation error" not in result.output
    assert _tool_returns(result)[0].metadata == {
        "dify_plugin_blob_files": [
            "00000000-0000-4000-8000-000000000001",
            "00000000-0000-4000-8000-000000000002",
        ]
    }


@pytest.mark.anyio
async def test_truncated_blob_chunk_is_not_uploaded_while_sibling_outputs_succeed():
    allocations = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/dispatch/tool/invoke"):
            return _stream(
                [
                    {"type": "text", "message": {"text": "done:"}},
                    {
                        "type": "blob_chunk",
                        "message": {
                            "id": "truncated",
                            "sequence": 0,
                            "total_length": 6,
                            "blob": base64.b64encode(b"abc").decode(),
                            "end": True,
                        },
                        "meta": {"filename": "broken.pdf", "mime_type": "application/pdf"},
                    },
                    {
                        "type": "blob",
                        "message": {"blob": base64.b64encode(b"complete").decode()},
                        "meta": {"filename": "good.png", "mime_type": "image/png"},
                    },
                ]
            )
        if request.url.path == "/inner/api/agent/files/upload-request":
            allocations.append(json.loads(request.content)["filename"])
            return httpx.Response(200, json={"upload_uri": "/files/upload/for-plugin?sign=test"})
        return httpx.Response(201, json={"reference": _FILE_REFERENCE})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await invoke_native_tool(_deps(client, max_bytes=1024), tools_layer.Toolset("tools"), "create", {})

    assert allocations == ["good.png"]
    assert result.output.startswith("done:")
    assert (
        "\nTool media unavailable (broken.pdf, application/pdf, 6 bytes):"
        " Plugin file chunks have an invalid sequence or length.\n"
    ) in result.output
    assert result.output.count("already delivered to the user as an attachment") == 1
    assert '"filename":"good.png"' in result.output
    assert '"filename":"broken.pdf"' not in result.output
    assert _tool_returns(result)[0].metadata == {"dify_plugin_blob_files": [_FILE_ID]}


@pytest.mark.anyio
async def test_invalid_base64_blob_and_blob_chunk_are_isolated_without_uploading():
    allocations = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/dispatch/tool/invoke"):
            return _stream(
                [
                    {"type": "text", "message": {"text": "partial:"}},
                    {
                        "type": "blob",
                        "message": {"blob": "bad!"},
                        "meta": {"filename": "corrupt-single.pdf", "mime_type": "application/pdf"},
                    },
                    {
                        "type": "blob",
                        "message": {"blob": "abc"},
                        "meta": {"filename": "bad-padding.png", "mime_type": "image/png"},
                    },
                    {
                        "type": "blob_chunk",
                        "message": {
                            "id": "corrupt-chunked",
                            "sequence": 0,
                            "total_length": 6,
                            "blob": base64.b64encode(b"ab").decode(),
                            "end": False,
                        },
                        "meta": {"filename": "corrupt-chunked.pdf", "mime_type": "application/pdf"},
                    },
                    {
                        "type": "blob_chunk",
                        "message": {
                            "id": "corrupt-chunked",
                            "sequence": 1,
                            "total_length": 6,
                            "blob": "bad!",
                            "end": False,
                        },
                    },
                    {
                        "type": "blob_chunk",
                        "message": {
                            "id": "corrupt-chunked",
                            "sequence": 2,
                            "total_length": 6,
                            "blob": base64.b64encode(b"ef").decode(),
                            "end": True,
                        },
                    },
                    {
                        "type": "blob",
                        "message": {"blob": base64.b64encode(b"healthy").decode()},
                        "meta": {"filename": "healthy.png", "mime_type": "image/png"},
                    },
                ]
            )
        if request.url.path == "/inner/api/agent/files/upload-request":
            allocations.append(json.loads(request.content)["filename"])
            return httpx.Response(200, json={"upload_uri": "/files/upload/for-plugin?sign=test"})
        return httpx.Response(201, json={"reference": _FILE_REFERENCE})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await invoke_native_tool(_deps(client, max_bytes=1024), tools_layer.Toolset("tools"), "create", {})

    assert allocations == ["healthy.png"]
    assert result.output.startswith("partial:")
    assert result.output.count("Tool media unavailable") == 3
    assert (
        "\nTool media unavailable (corrupt-single.pdf, application/pdf, None bytes):"
        " Invalid base64-encoded blob payload.\n"
    ) in result.output
    assert (
        "\nTool media unavailable (bad-padding.png, image/png, None bytes): Invalid base64-encoded blob payload.\n"
    ) in result.output
    assert (
        "\nTool media unavailable (corrupt-chunked.pdf, application/pdf, 6 bytes):"
        " Invalid base64-encoded blob payload.\n"
    ) in result.output
    assert '"filename":"healthy.png"' in result.output
    assert '"filename":"corrupt-single.pdf"' not in result.output
    assert '"filename":"bad-padding.png"' not in result.output
    assert '"filename":"corrupt-chunked.pdf"' not in result.output
    assert _tool_returns(result)[0].metadata == {"dify_plugin_blob_files": [_FILE_ID]}


@pytest.mark.anyio
@pytest.mark.parametrize(
    "stream_body",
    [
        "data: {not-valid-json\n",
        f"data: {json.dumps({'code': 0, 'message': '', 'data': {'type': 'text', 'message': {}}})}\n",
    ],
)
async def test_invalid_daemon_stream_frame_returns_tool_invoke_error_text(stream_body: str):
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text=stream_body)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await invoke_native_tool(_deps(client), tools_layer.Toolset("tools"), "create", {})

    assert result.output.startswith("tool invoke error:")
    assert "tool parameters validation error" not in result.output
    assert _tool_returns(result)[0].metadata is None
