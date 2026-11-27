"""Plugin tools use JSON identity, prepared schemas and native dispatch."""

import json
import base64

import httpx
import pytest

from dify_agent.layers.dify_plugin import tools_layer
from dify_agent.agent_stub.protocol import file_reference
from dify_agent.layers.dify_plugin.llm_layer import Capability as ModelCapability, Config as ModelConfig
from dify_agent.layers.execution_context.configs import DifyExecutionContextLayerConfig
from dify_agent.runtime.context import Deps, Services
from tests.local.dify_agent.module_support import invoke_native_tool


def identity():
    return DifyExecutionContextLayerConfig(
        tenant_id="tenant",
        user_id="user",
        user_from="account",
        app_id="app",
        agent_mode="agent_app",
        invoke_from="web-app",
    )


async def media_observation(message, handler, *, user_id="user", max_bytes=50 * 1024 * 1024):
    async def transport(request):
        if request.url.path.endswith("/dispatch/tool/invoke"):
            return httpx.Response(200, text="data: " + json.dumps({"code": 0, "message": "", "data": message}) + "\n")
        return handler(request)

    config = tools_layer.Config(
        tools=[
            {
                "plugin_id": "media",
                "provider": "media",
                "tool_name": "generate",
                "credential_type": "unauthorized",
            }
        ]
    )
    async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as client:
        deps = Deps(
            layers={
                "tools": {"config": config.model_dump(mode="json"), "state": {}},
                "execution_context": {
                    "config": identity().model_copy(update={"user_id": user_id}).model_dump(mode="json"),
                    "state": {},
                },
            },
            services=Services(client, client, agent_file_upload_max_bytes=max_bytes),
            run_id="media-test",
        )
        result = await invoke_native_tool(deps, tools_layer.Toolset("tools"), "generate", {})
    return result.output


def media_summary(output):
    return json.loads(output.split(": ", 1)[1].split(" (call")[0])


def reference_payload(reference):
    assert reference.startswith("dify-file-ref:")
    return json.loads(base64.urlsafe_b64decode(reference.removeprefix("dify-file-ref:")))


@pytest.mark.anyio
async def test_plugin_blob_is_persisted_as_a_copyable_file_handle_without_inline_data():
    requests = []
    record_id = "dd22ff99-f8d5-4fde-8cb9-c8ec46556960"
    blob = b"raw-plugin-image-content"

    def handler(request):
        requests.append(request)
        if request.url.path.endswith("/upload-request"):
            payload = json.loads(request.content)
            assert payload["tenant_id"] == "tenant" and payload["user_id"] == "user"
            assert payload["max_size"] == 50 * 1024 * 1024
            return httpx.Response(200, json={"upload_uri": "/files/upload/for-plugin?sign=signed"})
        assert request.url.path == "/files/upload/for-plugin"
        assert request.headers["content-type"].startswith("multipart/form-data")
        assert blob in request.content
        return httpx.Response(201, json={"id": record_id, "reference": file_reference(record_id)})

    output = await media_observation(
        {
            "type": "blob",
            "message": {"blob": base64.b64encode(blob).decode()},
            "meta": {"filename": "chart.png", "mime_type": "image/png"},
        },
        handler,
    )
    assert len(requests) == 2
    summary = media_summary(output)
    assert summary["transfer_method"] == "tool_file"
    assert summary["reference"] == file_reference(record_id)
    assert reference_payload(summary["reference"]) == {"record_id": record_id}
    assert summary["size"] == len(blob)
    assert "read_media" in output
    assert blob.decode() not in output and base64.b64encode(blob).decode() not in output


@pytest.mark.anyio
@pytest.mark.parametrize(
    "failure,diagnostic,request_count",
    [
        ("missing-user", "requires execution context user_id", 0),
        ("oversized", "exceeds upload limit", 0),
        ("http-error", "503", 1),
        ("non-object", "file upload returned a non-object response", 2),
        ("missing-reference", "reference is required for non-remote file mappings", 2),
        ("invalid-reference", "canonical Dify file reference", 2),
    ],
)
async def test_plugin_blob_upload_failures_never_stringify_file_content(failure, diagnostic, request_count):
    requests = []

    def handler(request):
        requests.append(request)
        if failure == "http-error":
            return httpx.Response(503, json={"message": "storage unavailable"})
        if request.url.path.endswith("/upload-request"):
            return httpx.Response(200, json={"upload_uri": "/files/upload/for-plugin?sign=signed"})
        responses = {
            "non-object": [],
            "missing-reference": {"id": "dd22ff99-f8d5-4fde-8cb9-c8ec46556960"},
            "invalid-reference": {"reference": "dify-file-ref:W10="},
        }
        return httpx.Response(201, json=responses[failure])

    output = await media_observation(
        {
            "type": "blob",
            "message": {"blob": base64.b64encode(b"secret-blob").decode()},
            "meta": {"filename": "chart.png", "mime_type": "image/png"},
        },
        handler,
        user_id=None if failure == "missing-user" else "user",
        max_bytes=1 if failure == "oversized" else 100,
    )
    assert "Tool media unavailable" in output and "chart.png" in output and "11 bytes" in output
    assert "secret-blob" not in output and "c2VjcmV0LWJsb2I=" not in output
    assert diagnostic in output
    assert len(requests) == request_count


@pytest.mark.anyio
@pytest.mark.parametrize(
    "kind,url,expected",
    [
        ("image", "https://example.com/chart.png?key=original", "remote_url"),
        ("image_link", "/files/tools/dd22ff99-f8d5-4fde-8cb9-c8ec46556960.png?sign=x", "tool_file"),
        ("binary_link", "https://example.com/audio.mp3?key=original", "remote_url"),
    ],
)
async def test_plugin_media_links_return_handles_without_fetching_them(kind, url, expected):
    def unexpected_request(request):
        raise AssertionError(f"link output should not fetch {request.url}")

    output = await media_observation({"type": kind, "message": {"text": url}}, unexpected_request)
    summary = media_summary(output)
    assert summary["transfer_method"] == expected
    assert "read_media" in output
    if expected == "tool_file":
        assert reference_payload(summary["reference"]) == {"record_id": "dd22ff99-f8d5-4fde-8cb9-c8ec46556960"}
        assert "sign=x" not in output
    else:
        assert summary["url"] == url


@pytest.mark.anyio
@pytest.mark.parametrize("remote", [False, True])
async def test_plugin_file_message_keeps_an_existing_file_locator(remote):
    mapping = (
        {"transfer_method": "remote_url", "remote_url": "https://example.com/chart.png?key=original"}
        if remote
        else {"transfer_method": "local_file", "reference": file_reference("upload-file")}
    )

    def unexpected_request(request):
        raise AssertionError(f"file output should not fetch {request.url}")

    output = await media_observation(
        {
            "type": "file",
            "message": {"file_marker": "file"},
            "meta": {"file": {**mapping, "filename": "chart.png", "mime_type": "image/png"}},
        },
        unexpected_request,
    )
    summary = media_summary(output)
    assert summary["transfer_method"] == mapping["transfer_method"]
    if remote:
        assert summary["url"] == mapping["remote_url"]
    else:
        assert reference_payload(summary["reference"]) == {"record_id": "upload-file"}


@pytest.mark.anyio
@pytest.mark.parametrize("source", ["file", "meta"])
@pytest.mark.parametrize("size", [True, "25", None])
async def test_plugin_file_observations_omit_invalid_optional_metadata(source, size):
    file = {"transfer_method": "remote_url", "url": "https://example.com/chart.png?key=original"}
    optional_metadata = {"filename": 123, "mime_type": ["image/png"], "size": size}
    meta = {"file": {**file, **optional_metadata}} if source == "file" else {"file": file, **optional_metadata}

    def unexpected_request(request):
        raise AssertionError(f"file output should not fetch {request.url}")

    output = await media_observation(
        {"type": "file", "message": {"file_marker": "file"}, "meta": meta}, unexpected_request
    )
    assert media_summary(output) == file


@pytest.mark.anyio
@pytest.mark.parametrize("legacy_first", [False, True])
async def test_tools_with_different_package_bindings_do_not_share_a_daemon_client(legacy_first):
    identifiers: list[str | None] = [f"langgenius/search:{version}.0.0@{'a' * 32}" for version in (1, 2)]
    if legacy_first:
        identifiers[0] = None
    config = tools_layer.Config(
        tools=[
            {
                "plugin_id": "langgenius/search",
                **({"plugin_unique_identifier": identifier} if identifier is not None else {}),
                "provider": "search",
                "tool_name": "search",
                "name": name,
                "credential_type": "unauthorized",
            }
            for identifier, name in zip(identifiers, ("old_search", "new_search"), strict=True)
        ]
    )
    seen = []

    def handler(request):
        seen.append(request.headers.get("X-Plugin-Unique-Identifier"))
        return httpx.Response(
            200,
            text='data: {"code":0,"message":"","data":{"type":"text","message":{"text":"ok"}}}\n',
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        deps = Deps(
            layers={
                "tools": {"config": config.model_dump(mode="json"), "state": {}},
                "execution_context": {"config": identity().model_dump(mode="json"), "state": {}},
            },
            services=Services(client, client, plugin_daemon_api_key="daemon-secret"),
            run_id="test",
        )
        toolset = tools_layer.Toolset("tools")
        await invoke_native_tool(deps, toolset, "old_search", {})
        await invoke_native_tool(deps, toolset, "new_search", {})

    assert seen == identifiers


@pytest.mark.anyio
async def test_native_plugin_tool_prepares_schema_merges_hidden_parameters_and_decodes_stream():
    schema = {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}
    config = tools_layer.Config(
        tools=[
            {
                "plugin_id": "langgenius/search",
                "provider": "search",
                "tool_name": "web_search",
                "name": "search",
                "credential_type": "api-key",
                "credentials": {"api_key": "tool-secret"},
                "runtime_parameters": {"scope": "workspace"},
                "parameters_json_schema": schema,
                "parameters": [
                    {"name": "query", "type": "string", "form": "llm", "required": True},
                    {"name": "scope", "type": "string", "form": "form", "required": True},
                    {"name": "region", "type": "string", "form": "form", "default": "global"},
                ],
                "plugin_unique_identifier": "langgenius/search:1.0.0@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            }
        ]
    )
    seen = []

    def handler(request):
        assert request.url.path == "/plugin/tenant/dispatch/tool/invoke"
        assert request.headers["X-Plugin-ID"] == "langgenius/search"
        assert request.headers["X-Plugin-Unique-Identifier"] == config.tools[0].plugin_unique_identifier
        assert request.headers["X-Api-Key"] == "daemon-secret"
        seen.append(json.loads(request.content))
        return httpx.Response(
            200,
            text="data: "
            + json.dumps({"code": 0, "message": "ok", "data": {"type": "text", "message": {"text": "found"}}})
            + "\n",
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        deps = Deps(
            layers={
                "tools": {"config": config.model_dump(mode="json"), "state": {}},
                "execution_context": {"config": identity().model_dump(mode="json"), "state": {}},
            },
            services=Services(client, client, plugin_daemon_api_key="daemon-secret"),
            run_id="test",
        )

        def inspect(info):
            assert info.function_tools[0].name == "search"
            assert info.function_tools[0].parameters_json_schema == schema

        result = await invoke_native_tool(
            deps, tools_layer.Toolset("tools"), "search", {"query": "dify"}, inspect=inspect
        )
        assert result.output == "found"
        assert seen[0]["user_id"] == "user"
        assert seen[0]["data"]["tool_parameters"] == {"query": "dify", "scope": "workspace", "region": "global"}
        assert not client.is_closed


@pytest.mark.anyio
@pytest.mark.parametrize("parameter_type", ["select", "dynamic-select"])
@pytest.mark.parametrize("source", ["llm", "runtime", "default"])
async def test_native_plugin_tool_preserves_multiple_select_arrays(parameter_type, source):
    selected = ["apac,east", "emea"]
    parameter = {
        "name": "regions",
        "type": parameter_type,
        "form": "llm" if source == "llm" else "form",
        "multiple": True,
    }
    if source == "default":
        parameter["default"] = selected
    properties = {"primary": {"type": "string"}}
    if source == "llm":
        properties["regions"] = {"type": "array", "items": {"type": "string"}}
    config = tools_layer.Config(
        tools=[
            {
                "plugin_id": "search",
                "provider": "search",
                "tool_name": "search",
                "credential_type": "unauthorized",
                "parameters": [parameter, {"name": "primary", "type": parameter_type, "form": "llm"}],
                "parameters_json_schema": {"type": "object", "properties": properties},
                "runtime_parameters": {"regions": selected} if source == "runtime" else {},
            }
        ]
    )
    # Prepared declarations cross the API/runtime boundary as JSON.
    config = tools_layer.Config.model_validate_json(config.model_dump_json())
    sent = []

    def handler(request):
        sent.append(json.loads(request.content)["data"]["tool_parameters"])
        return httpx.Response(
            200, text='data: {"code":0,"message":"","data":{"type":"text","message":{"text":"ok"}}}\n'
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        deps = Deps(
            layers={
                "tools": {"config": config.model_dump(mode="json"), "state": {}},
                "execution_context": {"config": identity().model_dump(mode="json"), "state": {}},
            },
            services=Services(client, client, plugin_daemon_api_key="daemon-secret"),
            run_id="test",
        )
        arguments = {"primary": "emea", **({"regions": selected} if source == "llm" else {})}
        result = await invoke_native_tool(deps, tools_layer.Toolset("tools"), "search", arguments)
        assert result.output == "ok"
    assert sent == [{"primary": "emea", "regions": selected}]


@pytest.mark.anyio
@pytest.mark.parametrize(
    "value,download_uri,expected_url",
    [
        (
            {"transfer_method": "tool_file", "reference": file_reference("file-1")},
            "https://example.com/file.pdf",
            "https://example.com/file.pdf",
        ),
        (
            {
                "transfer_method": "tool_file",
                "reference": file_reference("file-1"),
                "filename": "untrusted.exe",
                "mime_type": "untrusted/type",
                "size": 999_999,
            },
            "/files/tools/file-1.pdf?timestamp=1&nonce=n&sign=s",
            "http://dify-api/files/tools/file-1.pdf?timestamp=1&nonce=n&sign=s",
        ),
        (
            {
                "transfer_method": "remote_url",
                "url": "https://example.com/file.pdf",
                "filename": "untrusted.exe",
                "mime_type": "untrusted/type",
                "size": 999_999,
            },
            None,
            "https://example.com/file.pdf",
        ),
        ("https://example.com/file.pdf", None, "https://example.com/file.pdf"),
    ],
)
async def test_native_plugin_tool_converts_file_inputs(value, download_uri, expected_url):
    config = tools_layer.Config(
        tools=[
            {
                "plugin_id": "files",
                "provider": "file",
                "tool_name": "read",
                "credential_type": "unauthorized",
                "parameters": [{"name": "source", "type": "file", "form": "llm", "required": True}],
                "parameters_json_schema": {"type": "object", "properties": {"source": {}}, "required": ["source"]},
                "plugin_unique_identifier": "files:1.0.0@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            }
        ]
    )
    sent = []

    def handler(request):
        payload = json.loads(request.content)
        if request.url.path.endswith("/agent/files/download-request"):
            assert download_uri is not None
            assert payload["file"] == {"transfer_method": "tool_file", "reference": file_reference("file-1")}
            assert payload["for_frontend"] is False
            return httpx.Response(
                200,
                json={
                    "download_uri": download_uri,
                    "filename": "file.pdf",
                    "mime_type": "application/pdf",
                    "size": 10,
                },
            )
        sent.append(payload["data"]["tool_parameters"]["source"])
        return httpx.Response(
            200, text='data: {"code":0,"message":"ok","data":{"type":"text","message":{"text":"read"}}}\n'
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        deps = Deps(
            layers={
                "tools": {"config": config.model_dump(mode="json"), "state": {}},
                "execution_context": {"config": identity().model_dump(mode="json"), "state": {}},
            },
            services=Services(client, client, inner_api_url="http://dify-api/"),
            run_id="test",
        )
        result = await invoke_native_tool(deps, tools_layer.Toolset("tools"), "read", {"source": value})
        assert result.output == "read"
        assert sent[0]["url"] == expected_url
        assert sent[0]["filename"] == "file.pdf"
        assert sent[0]["mime_type"] == "application/pdf"
        assert sent[0]["size"] == (10 if download_uri is not None else -1)


@pytest.mark.anyio
async def test_model_assembly_reads_config_reference_and_borrows_shared_client():
    config = ModelConfig(
        plugin_id="langgenius/openai", model_provider="openai", model="demo", execution_context="renamed"
    )
    async with httpx.AsyncClient() as client:
        deps = Deps(
            layers={
                "llm": {"config": config.model_dump(mode="json"), "state": {}},
                "renamed": {"config": identity().model_dump(mode="json"), "state": {}},
            },
            services=Services(client, client),
            run_id="test",
        )
        model = ModelCapability("llm").build_model(deps)
        assert model.model_name == "demo"
        assert model.provider.client.http_client is client
        assert model.provider.name == "DifyAPI/langgenius/openai"


def _single_tool_config() -> tools_layer.Config:
    return tools_layer.Config(
        tools=[
            {
                "plugin_id": "langgenius/swagger",
                "provider": "swagger",
                "tool_name": "get_item",
                "name": "get_item",
                "credential_type": "unauthorized",
            }
        ]
    )


def _daemon_stream(*frames: dict) -> str:
    return "".join("data: " + json.dumps(frame) + "\n" for frame in frames)


def _text_frame(text: str) -> dict:
    return {"code": 0, "message": "ok", "data": {"type": "text", "message": {"text": text}}}


def _json_frame(json_object: dict | list) -> dict:
    return {"code": 0, "message": "ok", "data": {"type": "json", "message": {"json_object": json_object}}}


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("text", "json_object"),
    [
        ('{"a":1,"b":2}', {"a": 1, "b": 2}),
        (' \n{ "a": 1, "b": 2 }\t', {"a": 1, "b": 2}),
        ('{"b": 2, "a": 1}', {"a": 1, "b": 2}),
        ('{"items":[{"b":2,"a":1}]}', {"items": [{"a": 1, "b": 2}]}),
        (r'{"\u540d\u79f0":"\u4e2d\u6587"}', {"名称": "中文"}),
        ('[{"b":2,"a":1},null]', [{"a": 1, "b": 2}, None]),
    ],
)
async def test_native_plugin_tool_deduplicates_json_output_that_arrived_as_equivalent_text(text, json_object):
    def handler(request):
        return httpx.Response(200, text=_daemon_stream(_text_frame(text), _json_frame(json_object)))

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        deps = Deps(
            layers={
                "tools": {"config": _single_tool_config().model_dump(mode="json"), "state": {}},
                "execution_context": {"config": identity().model_dump(mode="json"), "state": {}},
            },
            services=Services(client, client, plugin_daemon_api_key="daemon-secret"),
            run_id="test",
        )
        result = await invoke_native_tool(deps, tools_layer.Toolset("tools"), "get_item", {})

    assert result.output == text


@pytest.mark.anyio
async def test_native_plugin_tool_keeps_json_output_that_differs_from_the_text():
    def handler(request):
        return httpx.Response(
            200,
            text=_daemon_stream(_text_frame("summary"), _json_frame({"a": 1})),
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        deps = Deps(
            layers={
                "tools": {"config": _single_tool_config().model_dump(mode="json"), "state": {}},
                "execution_context": {"config": identity().model_dump(mode="json"), "state": {}},
            },
            services=Services(client, client, plugin_daemon_api_key="daemon-secret"),
            run_id="test",
        )
        result = await invoke_native_tool(deps, tools_layer.Toolset("tools"), "get_item", {})

    assert result.output == 'summary{"a": 1}'
