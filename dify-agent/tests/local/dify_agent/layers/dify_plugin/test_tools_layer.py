"""Exercise binary outputs through native tools and the HTTP file boundary."""

import base64
import json

import httpx
import pytest
from pydantic_ai.messages import ModelRequest, ToolReturnPart

from dify_agent.layers.dify_plugin import tools_layer
from dify_agent.layers.execution_context.configs import DifyExecutionContextLayerConfig
from dify_agent.runtime.context import Deps, Services
from tests.local.dify_agent.module_support import invoke_native_tool


_FILE_ID = "00000000-0000-4000-8000-000000000001"
_FILE_REFERENCE = "dify-file-ref:eyJyZWNvcmRfaWQiOiIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDEifQ=="


def _deps(client: httpx.AsyncClient, *, missing_identity: str | None = None) -> Deps:
    context = DifyExecutionContextLayerConfig(
        tenant_id="tenant",
        user_id=None if missing_identity == "user_id" else "user",
        user_from=None if missing_identity == "user_from" else "account",
        conversation_id="conversation",
        app_id="app",
        agent_mode="agent_app",
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
            agent_file_upload_max_bytes=1024,
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
        ({"filename": 123, "mime_type": ["image/png"]}, "output.bin", "application/octet-stream"),
        (None, "output.bin", "application/octet-stream"),
    ],
)
def test_blob_upload_metadata_is_normalized(meta, filename, mime_type):
    assert tools_layer._resolve_blob_file_info(meta or {}) == (filename, mime_type)


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
    suffix = " (call `read_media` with `file` set to this object only if you need to inspect its content).\n"
    assert result.output.startswith(prefix) and result.output.endswith(suffix)
    assert json.loads(result.output[len(prefix) : -len(suffix)]) == {
        "transfer_method": "tool_file",
        "reference": _FILE_REFERENCE,
        "filename": "chart.png",
        "mime_type": "image/png",
        "size": len(blob),
    }
    assert "binary-output-regression" not in result.output and "blob=b" not in result.output
    assert _tool_returns(result)[0].metadata == {"dify_plugin_blob_files": [_FILE_ID]}


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
        suffix = " (call `read_media` with `file` set to this object only if you need to inspect its content).\n"
        assert result.output.startswith(prefix) and result.output.endswith(suffix)
        locator = (
            {"transfer_method": "tool_file", "reference": _FILE_REFERENCE}
            if message_type == "file"
            else {"transfer_method": "remote_url", "url": url}
        )
        assert json.loads(result.output[len(prefix) : -len(suffix)]) == {
            **locator,
            "filename": "image.png",
            "mime_type": "image/png",
        }
    assert _tool_returns(result)[0].metadata is None
