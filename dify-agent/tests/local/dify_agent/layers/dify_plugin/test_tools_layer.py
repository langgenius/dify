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
        services=Services(client, client, inner_api_url="http://dify.test", inner_api_key="inner-secret"),
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


@pytest.mark.anyio
@pytest.mark.parametrize("chunked", [False, True])
@pytest.mark.parametrize(
    "meta,filename,mime_type",
    [
        ({"filename": "../chart.png", "mime_type": "image/png; charset=binary"}, "chart.png", "image/png"),
        ({"filename": r"C:\tmp\report.pdf"}, "report.pdf", "application/pdf"),
        ({"filename": "recording", "mime_type": "audio/mpeg"}, "recording.mp3", "audio/mpeg"),
        ({"mime_type": "application/pdf"}, "create_output_1.pdf", "application/pdf"),
        (None, "create_output_1.bin", "application/octet-stream"),
    ],
)
async def test_binary_output_is_uploaded_and_returned_as_reusable_file_metadata(chunked, meta, filename, mime_type):
    blob = b"\x00\xffbinary-output-regression"
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
    file_id = "00000000-0000-4000-8000-000000000001"

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/dispatch/tool/invoke"):
            return _stream([{"type": "text", "message": {"text": "before:"}}, *messages])
        if request.url.path == "/inner/api/agent/files/upload-request":
            assert request.headers["X-Inner-Api-Key"] == "inner-secret"
            allocations.append(json.loads(request.content))
            return httpx.Response(200, json={"upload_uri": "/files/upload/plugin?sign=test"})
        assert str(request.url) == "http://dify.test/files/upload/plugin?sign=test"
        assert "X-Inner-Api-Key" not in request.headers
        uploads.append(request.content)
        return httpx.Response(
            201,
            json={
                "id": file_id,
                "reference": "dify-file-ref:saved",
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
            "max_size": len(blob),
        }
    ]
    assert len(uploads) == 1 and blob in uploads[0]
    assert f'filename="{filename}"'.encode() in uploads[0]
    assert f"Content-Type: {mime_type}".encode() in uploads[0]
    assert result.output.startswith("before:")
    assert filename in result.output and mime_type in result.output and f"{len(blob)} bytes" in result.output
    assert '{"transfer_method": "tool_file", "reference": "dify-file-ref:saved"}' in result.output
    assert "sent to the user already" in result.output
    assert "binary-output-regression" not in result.output and "blob=b" not in result.output
    assert _tool_returns(result)[0].metadata == {"dify_plugin_blob_files": [file_id]}


@pytest.mark.anyio
@pytest.mark.parametrize(
    "failure,diagnostic",
    [
        ("absolute-http", "unsafe or missing upload_uri"),
        ("absolute-https", "unsafe or missing upload_uri"),
        ("network-path", "unsafe or missing upload_uri"),
        ("traversal", "unsafe or missing upload_uri"),
        ("missing-uri", "unsafe or missing upload_uri"),
        ("invalid-json", "failed or returned invalid data"),
        ("request-status", "failed or returned invalid data"),
        ("timeout", "timed out"),
        ("transport", "failed or returned invalid data"),
        ("upload-status", "returned HTTP 500"),
        ("empty-id", "failed or returned invalid data"),
        ("missing-reference", "failed or returned invalid data"),
        ("invalid-upload-json", "failed or returned invalid data"),
        ("user_id", "require user_id and user_from"),
        ("user_from", "require user_id and user_from"),
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
            if failure == "timeout":
                raise httpx.ReadTimeout("timed out", request=request)
            if failure == "transport":
                raise httpx.ConnectError("connection failed", request=request)
            if failure == "request-status":
                return httpx.Response(403)
            if failure == "invalid-json":
                return httpx.Response(200, text="invalid")
            uri = {
                "absolute-http": "http://external.test/files/upload",
                "absolute-https": "https://external.test/files/upload",
                "network-path": "//external.test/files/upload",
                "traversal": "/files/%2e%2e/admin",
                "missing-uri": None,
            }.get(failure, "/files/upload/plugin")
            return httpx.Response(200, json={"upload_uri": uri})
        upload_requests.append(request)
        assert request.url.host == "dify.test" and request.url.path == "/files/upload/plugin"
        if failure == "invalid-upload-json":
            return httpx.Response(201, text="invalid")
        payload = {"id": "saved", "reference": "dify-file-ref:saved", "name": "report.pdf", "size": len(blob)}
        if failure == "empty-id":
            payload["id"] = " "
        if failure == "missing-reference":
            del payload["reference"]
        return httpx.Response(500 if failure == "upload-status" else 201, json=payload)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await invoke_native_tool(
            _deps(client, missing_identity=failure), tools_layer.Toolset("tools"), "create", {}
        )
    assert result.output.startswith("tool text:binary output (report.pdf, application/pdf,")
    assert "could not be saved" in result.output
    assert diagnostic in result.output
    assert "secret-binary-payload" not in result.output and "blob=b" not in result.output
    assert _tool_returns(result)[0].metadata is None
    assert len(allocation_requests) == (0 if failure in {"user_id", "user_from"} else 1)
    assert len(upload_requests) == (
        1 if failure in {"upload-status", "empty-id", "missing-reference", "invalid-upload-json"} else 0
    )


@pytest.mark.anyio
async def test_mixed_binary_success_and_failure_preserves_order_and_successful_file_ids():
    allocations = []
    files = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"]

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
            return httpx.Response(500 if len(allocations) == 2 else 200, json={"upload_uri": "/files/upload/plugin"})
        return httpx.Response(
            201, json={"id": files.pop(0), "reference": "dify-file-ref:saved", "name": allocations[-1], "size": 1}
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await invoke_native_tool(_deps(client), tools_layer.Toolset("tools"), "create", {})
    assert result.output.index("0.pdf") < result.output.index("1.pdf") < result.output.index("2.pdf")
    assert "1.pdf, application/pdf, 1 bytes) could not be saved" in result.output
    assert _tool_returns(result)[0].metadata == {
        "dify_plugin_blob_files": [
            "00000000-0000-4000-8000-000000000001",
            "00000000-0000-4000-8000-000000000002",
        ]
    }


@pytest.mark.anyio
@pytest.mark.parametrize("message_type", ["image", "image_link"])
async def test_url_image_outputs_keep_their_existing_observation_without_upload(message_type):
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/dispatch/tool/invoke")
        return _stream([{"type": message_type, "message": {"text": "https://image.test/image.png"}}])

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await invoke_native_tool(_deps(client), tools_layer.Toolset("tools"), "create", {})
    assert result.output == (
        "image has been created and sent to user already, "
        "you do not need to create it, just tell the user to check it now."
    )
    assert _tool_returns(result)[0].metadata is None
