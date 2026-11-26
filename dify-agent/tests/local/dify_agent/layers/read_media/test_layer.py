"""Exercise native tool dispatch, URL-only observations and metadata fallback."""

import json

import httpx
import pytest
from pydantic_ai import Agent
from pydantic_ai.messages import (
    AudioUrl,
    DocumentUrl,
    ImageUrl,
    ModelMessagesTypeAdapter,
    ModelRequest,
    ModelResponse,
    TextPart,
    ToolCallPart,
    ToolReturnPart,
    UserPromptPart,
    VideoUrl,
)
from pydantic_ai.models.function import FunctionModel

from dify_agent.agent_stub.protocol import file_reference
from dify_agent.layers.read_media.layer import Capability
from dify_agent.runtime.context import Deps, Services
from tests.local.dify_agent.shell_support import FakeCommands, completed_shell_command, stub_enabled_shell

FILE = {"transfer_method": "tool_file", "reference": file_reference("tool-file")}


async def run_read(
    arguments,
    *,
    modalities=("vision", "audio", "video", "document"),
    metadata=None,
    status=200,
    error=None,
    shell=None,
    shell_session=None,
):
    requests = []
    next_messages = []
    round_index = 0
    arguments_per_call = arguments if isinstance(arguments, list) else [arguments]

    async def model(messages, info):
        nonlocal round_index
        if round_index < len(arguments_per_call):
            call_arguments = arguments_per_call[round_index]
            round_index += 1
            return ModelResponse(parts=[ToolCallPart("read_media", call_arguments, tool_call_id=f"read-{round_index}")])
        next_messages.extend(messages)
        return ModelResponse(parts=[TextPart("done")])

    def handler(request):
        requests.append(request)
        assert request.method == "POST"
        assert request.url.path == "/inner/api/agent/files/download-request"
        payload = json.loads(request.content)
        assert payload["tenant_id"] == "tenant" and payload["user_id"] == "user"
        assert payload["user_from"] == "account" and payload["invoke_from"] == "debugger"
        assert payload["for_frontend"] is False
        assert set(payload["file"]) <= {"transfer_method", "reference", "url"}
        if error is not None:
            raise error
        return httpx.Response(
            status,
            json=metadata
            if metadata is not None
            else {
                "filename": "chart.png",
                "mime_type": "image/png",
                "size": 100,
                "download_uri": "/files/tools/private.png?sign=never-fetch",
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        deps = Deps(
            layers={
                "read_media": {"config": {"shell": shell}, "state": {}},
                "llm": {
                    "config": {
                        "plugin_id": "test",
                        "model_provider": "test",
                        "model": "model",
                        "supported_modalities": list(modalities),
                    },
                    "state": {},
                },
                "execution_context": {
                    "config": {
                        "tenant_id": "tenant",
                        "user_id": "user",
                        "user_from": "account",
                        "agent_mode": "agent_app",
                        "invoke_from": "debugger",
                    },
                    "state": {},
                },
            },
            services=Services(client, client),
            run_id="read-test",
        )
        if shell_session is not None:
            deps.resources.shells[shell] = shell_session
        result = await Agent(FunctionModel(model), deps_type=Deps, capabilities=[Capability("read_media")]).run(
            "Inspect the media when needed",
            deps=deps,
        )
    assert result.output == "done"
    return result, requests, next_messages


@pytest.mark.anyio
async def test_workspace_path_uploads_through_shell_then_attaches_only_reference():
    def upload(script, cwd, env, timeout):
        return completed_shell_command(json.dumps(FILE))

    async with stub_enabled_shell(FakeCommands(run_handler=upload)) as shell:
        result, requests, messages = await run_read({"path": "./chart.png"}, shell="shell", shell_session=shell)
        assert json.loads(requests[0].content)["file"] == FILE
        assert attachments(messages)[0].url == f"dify-file://tool_file/{FILE['reference']}"
        assert json.loads(observations(result)[0])["locator"] == {"path": "./chart.png"}


def attachments(messages):
    return [
        item
        for message in messages
        if isinstance(message, ModelRequest)
        for part in message.parts
        if isinstance(part, UserPromptPart) and not isinstance(part.content, str)
        for item in part.content
        if isinstance(item, ImageUrl | AudioUrl | VideoUrl | DocumentUrl)
    ]


def observations(result):
    return [
        str(part.content)
        for message in result.all_messages()
        if isinstance(message, ModelRequest)
        for part in message.parts
        if isinstance(part, ToolReturnPart)
    ]


@pytest.mark.anyio
@pytest.mark.parametrize(
    "modality,mime,filename,url_type",
    [
        ("vision", "image/jpg; charset=utf-8", "chart.jpg", ImageUrl),
        ("audio", "audio/x-wav", "voice.wav", AudioUrl),
        ("video", "video/mp4", "movie.mp4", VideoUrl),
        ("document", "application/x-pdf", "report.pdf", DocumentUrl),
        ("document", "text/plain", "report.txt", DocumentUrl),
        ("vision", "application/octet-stream", "chart.png", ImageUrl),
    ],
)
async def test_metadata_authorized_media_becomes_user_content(modality, mime, filename, url_type):
    # Copied summaries are accepted, but MIME and size supplied by the model
    # cannot override authoritative metadata.
    result, requests, messages = await run_read(
        {"file": {**FILE, "filename": "fake", "mime_type": "bad/type", "size": 999_999_999}},
        modalities=[modality],
        metadata={"filename": filename, "mime_type": mime, "size": 23, "download_uri": "/files/never-fetch"},
    )
    assert len(requests) == 1
    media = attachments(messages)
    assert len(media) == 1 and isinstance(media[0], url_type)
    assert media[0].url == f"dify-file://tool_file/{FILE['reference']}"
    assert media[0].format
    assert media[0].vendor_metadata.get("detail") == ("high" if modality == "vision" else None)
    assert json.loads(observations(result)[0])["filename"] == filename
    assert all(
        not isinstance(part.content, list)
        for message in messages
        if isinstance(message, ModelRequest)
        for part in message.parts
        if isinstance(part, ToolReturnPart)
    )
    encoded = ModelMessagesTypeAdapter.dump_json(result.all_messages())
    restored = ModelMessagesTypeAdapter.validate_json(encoded)
    assert len(attachments(restored)) == 1
    assert b"binary" not in encoded and b"base64" not in encoded


@pytest.mark.anyio
async def test_remote_url_remains_original_and_unknown_size_is_allowed():
    url = "https://example.com/chart.png?original=1"
    result, requests, messages = await run_read(
        {"file": {"transfer_method": "remote_url", "url": url}, "detail": "low"},
        metadata={"filename": "chart.png", "mime_type": "image/png", "size": -1, "download_uri": "ignored"},
    )
    assert attachments(messages)[0].url == url
    assert attachments(messages)[0].vendor_metadata["detail"] == "low"
    assert json.loads(observations(result)[0])["size"] is None
    encoded = ModelMessagesTypeAdapter.dump_json(result.all_messages()).decode()
    assert "unknown size" in encoded
    assert "-1 bytes" not in encoded
    assert len(requests) == 1


@pytest.mark.anyio
@pytest.mark.parametrize(
    "arguments,modalities,expected",
    [
        ({}, ["vision"], ("exactly one",)),
        ({"file": FILE, "path": "chart.png"}, ["vision"], ("exactly one",)),
        ({"file": FILE}, [], ("does not support any",)),
        ({"path": "chart.png"}, [], ("does not support any",)),
        ({"path": "chart.png"}, ["vision"], ("workspace is not enabled",)),
        ({"file": {"transfer_method": "wrong"}}, ["vision"], ("ValidationError", "transfer_method", "literal_error")),
        (
            {"file": {"transfer_method": "tool_file", "reference": "raw-id"}},
            ["vision"],
            ("ValidationError", "canonical Dify file reference"),
        ),
        (
            {"file": {"transfer_method": "tool_file", "reference": "dify-file-ref:W10="}},
            ["vision"],
            ("ValidationError", "canonical Dify file reference"),
        ),
        ({"file": {"transfer_method": "remote_url", "url": "file:///tmp/chart.png"}}, ["vision"], ("HTTP(S)",)),
    ],
)
async def test_invalid_locator_and_text_model_short_circuit_without_io(arguments, modalities, expected):
    result, requests, messages = await run_read(arguments, modalities=modalities)
    assert requests == [] and attachments(messages) == []
    assert observations(result)[0].startswith("read_media cannot attach multimodal content:")
    assert all(diagnostic in observations(result)[0] for diagnostic in expected)


@pytest.mark.anyio
@pytest.mark.parametrize(
    "mime,size,modalities,expected",
    [
        ("image/png", 0, ["vision"], "empty"),
        ("image/png", 10 * 1024 * 1024 + 1, ["vision"], "limit"),
        ("audio/mpeg", 25 * 1024 * 1024 + 1, ["audio"], "limit"),
        ("video/mp4", 50 * 1024 * 1024 + 1, ["video"], "limit"),
        ("application/pdf", 20 * 1024 * 1024 + 1, ["document"], "limit"),
        ("image/svg+xml", 100, ["vision"], "unsupported format"),
        ("image/bmp", 100, ["vision"], "unsupported format"),
        ("application/json", 100, ["document"], "unsupported format"),
        ("image/png", 100, ["document"], "requires vision"),
        ("image/png", -1, ["document"], "requires vision"),
        ("image/svg+xml", -1, ["vision"], "unsupported format"),
    ],
)
async def test_unsupported_or_oversized_media_returns_only_text(mime, size, modalities, expected):
    result, requests, messages = await run_read(
        {"file": FILE},
        modalities=modalities,
        metadata={"filename": "media", "mime_type": mime, "size": size, "download_uri": "ignored"},
    )
    assert len(requests) == 1 and attachments(messages) == []
    assert expected in observations(result)[0]
    if size == -1:
        assert "unknown size" in observations(result)[0]
        assert "-1 bytes" not in observations(result)[0]


@pytest.mark.anyio
@pytest.mark.parametrize(
    "status,metadata,error,expected",
    [
        (404, {"code": "file_not_accessible", "message": "not accessible"}, None, ("HTTPStatusError", "404")),
        (500, {"message": "HEAD probe failed"}, None, ("HTTPStatusError", "500")),
        (200, {"filename": "malformed"}, None, ("ValidationError", "size", "download_uri", "Field required")),
        (200, None, httpx.ReadTimeout("metadata timeout"), ("ReadTimeout", "metadata timeout")),
        (200, None, httpx.ConnectError("connection failed"), ("ConnectError", "connection failed")),
    ],
)
async def test_control_plane_errors_are_observations(status, metadata, error, expected):
    result, requests, messages = await run_read({"file": FILE}, status=status, metadata=metadata, error=error)
    assert len(requests) == 1 and attachments(messages) == []
    assert all(diagnostic in observations(result)[0] for diagnostic in expected)


@pytest.mark.anyio
async def test_native_request_hook_keeps_only_latest_four_attachments():
    files = [{"transfer_method": "tool_file", "reference": file_reference(f"tool-{i}")} for i in range(6)]
    result, requests, messages = await run_read([{"file": file} for file in files])
    assert len(requests) == 6
    assert [item.url for item in attachments(messages)] == [
        f"dify-file://tool_file/{file['reference']}" for file in files[2:]
    ]
    omitted = [
        item
        for message in messages
        if isinstance(message, ModelRequest)
        for part in message.parts
        if isinstance(part, UserPromptPart) and not isinstance(part.content, str)
        for item in part.content
        if isinstance(item, str) and "Historical read_media content omitted" in item
    ]
    assert len(omitted) == 2
    for file, placeholder in zip(files[:2], omitted, strict=True):
        assert file["reference"] in placeholder
    assert all(file["reference"] not in placeholder for file in files[2:] for placeholder in omitted)
    encoded = ModelMessagesTypeAdapter.dump_json(result.all_messages()).decode()
    assert encoded.count("Historical read_media content omitted") == 2
    calls = [
        p.tool_call_id
        for m in result.all_messages()
        if isinstance(m, ModelResponse)
        for p in m.parts
        if isinstance(p, ToolCallPart)
    ]
    returns = [
        p.tool_call_id
        for m in result.all_messages()
        if isinstance(m, ModelRequest)
        for p in m.parts
        if isinstance(p, ToolReturnPart)
    ]
    assert calls == returns
