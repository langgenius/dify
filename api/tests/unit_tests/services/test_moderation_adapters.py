from collections.abc import Callable, Generator, Iterable, Iterator
from threading import Thread
from uuid import uuid4

import pytest
from flask import Flask, request
from sqlalchemy import Engine
from sqlalchemy.orm import sessionmaker
from werkzeug.serving import make_server

from core.app.apps.exc import AppGenerateError
from extensions.application_services.moderation import build_llm_moderation_guard, build_moderation_service
from extensions.ext_code_based_extension import code_based_extension
from graphon.file import File, FileTransferMethod, FileType
from graphon.model_runtime.entities.llm_entities import (
    LLMResult,
    LLMResultChunk,
    LLMResultChunkDelta,
    LLMResultChunkWithStructuredOutput,
    LLMResultWithStructuredOutput,
    LLMUsage,
)
from graphon.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    TextPromptMessageContent,
    UserPromptMessage,
)
from graphon.model_runtime.errors.invoke import InvokeAuthorizationError
from machinery.context import AppRequestContext
from models.api_based_extension import APIBasedExtension
from models.base import TypeBase
from repositories.api_based_extension_repository import APIBasedExtensionRepository
from services.api_based_extension_application_service import APIBasedExtensionInput
from services.hosted_moderation_service import HostedModerationUnavailableError
from services.moderation_adapters import ExtensionModerationGateway, LLMModerationGuard
from services.moderation_invocation_errors import (
    ModerationRejectedInvocationError,
    ModerationUnavailableInvocationError,
)
from services.moderation_service import (
    ModerationPhase,
    ModerationRejectedError,
    ModerationRequest,
    ModerationRule,
    ModerationService,
    ModerationVerdict,
)

type APIModerationFixture = tuple[
    ModerationService, ModerationRule, AppRequestContext, dict[str, object], list[dict[str, object]]
]


@pytest.fixture
def keyword_guard(sqlite_engine: Engine) -> LLMModerationGuard:
    code_based_extension.init()
    service = build_moderation_service(database_client=sessionmaker(sqlite_engine))
    rule = ModerationRule(
        type="keywords",
        config={
            "inputs_config": {"enabled": True, "preset_response": "Input blocked"},
            "outputs_config": {"enabled": True, "preset_response": "Output blocked"},
            "keywords": "blocked",
        },
    )
    return build_llm_moderation_guard(AppRequestContext(tenant_id="tenant-1", app_id=""), service=service, rule=rule)


def _result(text: str) -> LLMResult:
    return LLMResult(
        model="model", prompt_messages=[], message=AssistantPromptMessage(content=text), usage=LLMUsage.empty_usage()
    )


def _chunk(text: str) -> LLMResultChunk:
    return LLMResultChunk(
        model="model",
        prompt_messages=[],
        delta=LLMResultChunkDelta(index=0, message=AssistantPromptMessage(content=text)),
    )


def test_keyword_guard_rejects_multimodal_text_before_invocation(keyword_guard: LLMModerationGuard) -> None:
    with pytest.raises(ModerationRejectedError, match="Input blocked"):
        keyword_guard.check_inputs([UserPromptMessage(content=[TextPromptMessageContent(data="BLOCKED")])])


def test_keyword_guard_returns_original_approved_result(keyword_guard: LLMModerationGuard) -> None:
    result = _result("safe")
    keyword_guard.check_inputs([UserPromptMessage(content="safe")])
    assert keyword_guard.check_output(result) is result


def test_keyword_guard_rejects_output(keyword_guard: LLMModerationGuard) -> None:
    with pytest.raises(ModerationRejectedError, match="Output blocked"):
        keyword_guard.check_output(_result("blocked"))


def test_split_keyword_rejects_before_any_stream_delivery_and_closes_provider(
    keyword_guard: LLMModerationGuard,
) -> None:
    events: list[str] = []

    def stream() -> Generator[LLMResultChunk]:
        try:
            yield _chunk("blo")
            yield _chunk("cked")
        finally:
            events.append("closed")

    response = keyword_guard.check_output(stream())
    assert isinstance(response, Generator)
    with pytest.raises(ModerationRejectedError, match="Output blocked"):
        next(response)
    assert events == ["closed"]


def test_approved_stream_preserves_chunk_identity_and_usage(keyword_guard: LLMModerationGuard) -> None:
    chunks = [_chunk("safe"), _chunk(" answer")]
    chunks[-1].delta.usage = LLMUsage.empty_usage()
    response = keyword_guard.check_output(chunk for chunk in chunks)
    assert isinstance(response, Generator)
    delivered = list(response)
    assert all(actual is expected for actual, expected in zip(delivered, chunks, strict=True))


def test_provider_stream_failure_is_not_converted_to_approval(keyword_guard: LLMModerationGuard) -> None:
    def stream() -> Generator[LLMResultChunk]:
        yield _chunk("safe")
        raise RuntimeError("provider unavailable")

    response = keyword_guard.check_output(stream())
    assert isinstance(response, Generator)
    with pytest.raises(RuntimeError, match="provider unavailable"):
        next(response)


@pytest.mark.parametrize("mode", ["input", "non_stream", "segmented_stream"])
@pytest.mark.parametrize("failure", ["rejected", "authorization", "transport", "malformed_verdict", "unavailable"])
def test_guard_maps_checker_failures_without_delivering_content(mode: str, failure: str) -> None:
    phase: ModerationPhase = "input" if mode == "input" else "output"
    errors: dict[str, Exception] = {
        "rejected": ModerationRejectedError(phase, "Content violates the safety policy."),
        "authorization": InvokeAuthorizationError("Invalid platform key: secret-key"),
        "transport": RuntimeError("Private plugin address: internal-host"),
        "malformed_verdict": ValueError("Invalid verdict: private-payload"),
        "unavailable": HostedModerationUnavailableError("Upstream unavailable"),
    }
    original_error = errors[failure]
    events: list[str] = []

    def check(segments: Iterable[str], checked_phase: ModerationPhase) -> None:
        assert tuple(segments) == ("content",)
        assert checked_phase == phase
        raise original_error

    def response() -> Generator[LLMResultChunk]:
        try:
            yield _chunk("content")
        finally:
            events.append("closed")

    guard = LLMModerationGuard(
        tenant_id="tenant-1",
        check=check,
        check_input=True,
        check_output=True,
        non_stream_segment_size=2000,
        stream_segment_size=4,
    )

    def invoke_guard() -> None:
        if mode == "input":
            guard.check_inputs([UserPromptMessage(content="content")])
        elif mode == "non_stream":
            guard.check_output(_result("content"))
        else:
            stream = guard.check_output(response())
            assert isinstance(stream, Generator)
            next(stream)

    with pytest.raises(AppGenerateError) as caught:
        invoke_guard()

    assert caught.value.__cause__ is original_error
    if failure == "rejected":
        assert isinstance(caught.value, ModerationRejectedInvocationError)
        assert isinstance(caught.value, ModerationRejectedError)
        assert caught.value.phase == phase
        assert str(caught.value) == "Content violates the safety policy."
        assert caught.value.error_code == "moderation_rejected"
    else:
        assert isinstance(caught.value, ModerationUnavailableInvocationError)
        assert str(caught.value) == "This message can’t be processed right now. Please try again later."
        assert caught.value.error_code == "moderation_unavailable"
    assert events == (["closed"] if mode == "segmented_stream" else [])


@pytest.mark.parametrize("stream", [False, True])
@pytest.mark.parametrize("arguments", ["", "{}"])
def test_tool_names_are_checked_for_both_streaming_and_blocking_results(
    keyword_guard: LLMModerationGuard, stream: bool, arguments: str
) -> None:
    message = AssistantPromptMessage(
        content="",
        tool_calls=[
            AssistantPromptMessage.ToolCall(
                id="tool-1", type="function", function={"name": "blocked_tool", "arguments": arguments}
            )
        ],
    )
    if stream:
        chunk = LLMResultChunk(model="model", delta=LLMResultChunkDelta(index=0, message=message))
        response = keyword_guard.check_output(item for item in [chunk])
        assert isinstance(response, Generator)
        with pytest.raises(ModerationRejectedError, match="Output blocked"):
            next(response)
    else:
        with pytest.raises(ModerationRejectedError, match="Output blocked"):
            keyword_guard.check_result(LLMResult(model="model", message=message, usage=LLMUsage.empty_usage()))


def test_tool_argument_fragments_are_reassembled_before_moderation(keyword_guard: LLMModerationGuard) -> None:
    chunks = [_chunk(""), _chunk("")]
    for chunk, arguments in zip(chunks, ["blo", "cked"], strict=True):
        chunk.delta.message.tool_calls = [
            AssistantPromptMessage.ToolCall(
                id="tool-1", type="function", function={"name": "search", "arguments": arguments}
            )
        ]
    response = keyword_guard.check_output(chunk for chunk in chunks)
    assert isinstance(response, Generator)
    with pytest.raises(ModerationRejectedError, match="Output blocked"):
        next(response)


def test_native_structured_payload_is_checked_without_message_text(keyword_guard: LLMModerationGuard) -> None:
    result = LLMResultWithStructuredOutput(**_result("").model_dump(), structured_output={"answer": "blocked"})
    with pytest.raises(ModerationRejectedError, match="Output blocked"):
        keyword_guard.check_result(result)

    chunk = LLMResultChunkWithStructuredOutput(**_chunk("").model_dump(), structured_output={"answer": "blocked"})
    response = keyword_guard.check_output(item for item in [chunk])
    assert isinstance(response, Generator)
    with pytest.raises(ModerationRejectedError, match="Output blocked"):
        next(response)


@pytest.mark.parametrize("phase", ["input", "output"])
def test_non_stream_checks_independent_segments(phase: ModerationPhase) -> None:
    checked: list[str] = []

    def check(segments: Iterable[str], checked_phase: ModerationPhase) -> None:
        assert checked_phase == phase
        checked.extend(segments)

    guard = LLMModerationGuard(
        tenant_id="tenant-1",
        check=check,
        check_input=True,
        check_output=True,
        non_stream_segment_size=5,
        stream_segment_size=300,
    )

    if phase == "input":
        guard.check_inputs([UserPromptMessage(content="abcdefghijk")])
    else:
        result = _result("abcdefghijk")
        assert guard.check_output(result) is result
    assert checked == ["abcde", "fghij", "k"]


@pytest.mark.parametrize("platform", [False, True])
def test_only_platform_checks_preserve_message_boundaries_for_sharing(platform: bool) -> None:
    checked: list[str] = []

    def check(segments: Iterable[str], phase: ModerationPhase) -> None:
        assert phase == "input"
        checked.extend(segments)

    guard = LLMModerationGuard(
        tenant_id="tenant-1",
        check=check,
        check_input=True,
        check_output=False,
        platform=platform,
        non_stream_segment_size=2000,
        stream_segment_size=300,
    )
    guard.check_inputs([UserPromptMessage(content="first"), UserPromptMessage(content="second")])
    assert checked == (["first", "second"] if platform else ["first\nsecond"])


def test_streaming_releases_only_checked_segments() -> None:
    events: list[str] = []

    def check(segments: Iterable[str], phase: ModerationPhase) -> None:
        assert phase == "output"
        (text,) = segments
        events.append(f"check:{text}")

    def response() -> Generator[LLMResultChunk]:
        events.append("provider:aa")
        yield _chunk("aa")
        events.append("provider:bb")
        yield _chunk("bb")
        events.append("provider:cc")
        yield _chunk("cc")
        events.append("provider:dd")
        yield _chunk("dd")

    guard = LLMModerationGuard(
        tenant_id="tenant-1",
        check=check,
        check_input=False,
        check_output=True,
        stream_segment_size=4,
        non_stream_segment_size=2000,
    )
    stream = guard.check_output(response())
    assert isinstance(stream, Generator)

    assert next(stream).delta.message.content == "aa"
    assert events == ["provider:aa", "provider:bb", "check:aabb"]

    rest = [chunk.delta.message.content for chunk in stream]
    assert rest == ["bb", "cc", "dd"]
    assert events == ["provider:aa", "provider:bb", "check:aabb", "provider:cc", "provider:dd", "check:ccdd"]


@pytest.mark.parametrize("segment_size", [4, 10])
def test_streaming_rejection_withholds_current_segment_and_closes_provider(segment_size: int) -> None:
    events: list[str] = []

    def check(segments: Iterable[str], phase: ModerationPhase) -> None:
        (text,) = segments
        events.append(f"check:{text}")
        if "blocked" in text:
            raise ModerationRejectedError(phase, "Output blocked")

    def response() -> Generator[LLMResultChunk]:
        try:
            yield _chunk("a" * segment_size)
            yield _chunk("blocked")
        finally:
            events.append("closed")

    guard = LLMModerationGuard(
        tenant_id="tenant-1",
        check=check,
        check_input=False,
        check_output=True,
        stream_segment_size=segment_size,
        non_stream_segment_size=2000,
    )
    stream = guard.check_output(response())
    assert isinstance(stream, Generator)

    assert next(stream).delta.message.content == "a" * segment_size
    with pytest.raises(ModerationRejectedError, match="Output blocked"):
        next(stream)
    assert [event for event in events if event != "closed"] == [f"check:{'a' * segment_size}", "check:blocked"]
    assert events.count("closed") == 1


def test_streaming_checks_segments_without_cross_segment_context() -> None:
    checked: list[str] = []

    def check(segments: Iterable[str], phase: ModerationPhase) -> None:
        assert phase == "output"
        (text,) = segments
        checked.append(text)
        if "blocked" in text:
            raise ModerationRejectedError(phase, "Output blocked")

    guard = LLMModerationGuard(
        tenant_id="tenant-1",
        check=check,
        check_input=False,
        check_output=True,
        stream_segment_size=4,
        non_stream_segment_size=2000,
    )
    chunks = [_chunk("xxbl"), _chunk("ocked")]
    stream = guard.check_output(chunk for chunk in chunks)
    assert isinstance(stream, Generator)

    assert list(stream) == chunks
    assert checked == ["xxbl", "ocked"]


def test_bound_guard_uses_configured_nonstream_and_stream_segment_sizes(
    config_overrides: Callable[..., None],
) -> None:
    calls: list[tuple[str, ModerationPhase]] = []

    class RecordingGateway:
        def check(
            self,
            context: AppRequestContext,
            *,
            rule: ModerationRule,
            request: ModerationRequest,
            phase: ModerationPhase,
        ) -> ModerationVerdict:
            del context, rule
            calls.append((request.text, phase))
            return ModerationVerdict(flagged=False, message="")

    config_overrides(
        MODERATION_NON_STREAM_SEGMENT_SIZE=5,
        MODERATION_BUFFER_SIZE=4,
    )
    guard = build_llm_moderation_guard(
        AppRequestContext(tenant_id="tenant-1", app_id=""),
        service=ModerationService(gateway=RecordingGateway()),
        rule=ModerationRule(
            type="openai_moderation",
            config={
                "inputs_config": {"enabled": False},
                "outputs_config": {"enabled": True},
            },
        ),
    )

    guard.check_result(_result("abcdefghij"))
    assert calls == [("abcde", "output"), ("fghij", "output")]

    calls.clear()
    stream = guard.check_output(item for item in [_chunk("aa"), _chunk("bb"), _chunk("cc"), _chunk("dd")])
    assert isinstance(stream, Generator)
    assert next(stream).delta.message.content == "aa"
    assert calls == [("aabb", "output")]
    assert [chunk.delta.message.content for chunk in stream] == ["bb", "cc", "dd"]
    assert calls == [("aabb", "output"), ("ccdd", "output")]


class ScopedCipher:
    def encrypt(self, workspace_id: str, value: str) -> str:
        return f"{workspace_id}:{value}"

    def decrypt(self, workspace_id: str, value: str) -> str:
        prefix = f"{workspace_id}:"
        if not value.startswith(prefix):
            raise ValueError("Wrong workspace")
        return value[len(prefix) :]


@pytest.fixture
def api_moderation(sqlite_engine: Engine, config_overrides: Callable[..., None]) -> Iterator[APIModerationFixture]:
    config_overrides(SSRF_PROXY_HTTP_URL="", SSRF_PROXY_HTTPS_URL="")
    response: dict[str, object] = {"flagged": True, "action": "overridden", "preset_response": "Blocked"}
    requests: list[dict[str, object]] = []
    app = Flask(__name__)

    @app.post("/")
    def moderate() -> dict[str, object]:
        assert request.headers["Authorization"] == "Bearer secret"
        requests.append(request.get_json())
        return response

    server = make_server("127.0.0.1", 0, app, threaded=True)
    thread = Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
    thread.start()
    try:
        TypeBase.metadata.create_all(sqlite_engine, tables=[TypeBase.metadata.tables[APIBasedExtension.__tablename__]])
        repository = APIBasedExtensionRepository(session_factory=sessionmaker(sqlite_engine))
        tenant_id = str(uuid4())
        cipher = ScopedCipher()
        extension = repository.create_extension(
            tenant_id,
            APIBasedExtensionInput(
                name="Moderation",
                api_endpoint=f"http://127.0.0.1:{server.server_port}/",
                api_key=cipher.encrypt(tenant_id, "secret"),
            ),
        )
        service = ModerationService(gateway=ExtensionModerationGateway(extensions=repository, cipher=cipher))
        rule = ModerationRule(
            type="api",
            config={
                "inputs_config": {"enabled": True},
                "outputs_config": {"enabled": True},
                "api_based_extension_id": extension.id,
            },
        )
        yield service, rule, AppRequestContext(tenant_id=tenant_id, app_id="app-1"), response, requests
    finally:
        server.shutdown()
        thread.join()
        server.server_close()


@pytest.mark.parametrize("phase", ["input", "output"])
def test_api_override_verdict_rejects_original_content(
    api_moderation: APIModerationFixture, phase: ModerationPhase
) -> None:
    service, rule, context, _, requests = api_moderation
    with pytest.raises(ModerationRejectedError, match="Blocked"):
        service.check(context, rule=rule, text="content", phase=phase)
    assert requests == [
        {
            "point": f"app.moderation.{phase}",
            "params": {"app_id": "app-1", "inputs": {}, "query": "content"}
            if phase == "input"
            else {"app_id": "app-1", "text": "content"},
        }
    ]


def test_api_evaluate_preserves_app_inputs_and_replacement(api_moderation: APIModerationFixture) -> None:
    service, rule, context, _, requests = api_moderation

    verdict = service.evaluate(
        context,
        rule=rule,
        request=ModerationRequest(text="", inputs={"input_key": "value"}, query="query"),
        phase="input",
    )

    assert verdict.flagged is True
    assert verdict.replacement is not None
    assert verdict.replacement.action == "overridden"
    assert requests == [
        {
            "point": "app.moderation.input",
            "params": {"app_id": "app-1", "inputs": {"input_key": "value"}, "query": "query"},
        }
    ]


@pytest.fixture
def moderation_input_file() -> File:
    return File(
        file_id=str(uuid4()),
        file_type=FileType.DOCUMENT,
        transfer_method=FileTransferMethod.REMOTE_URL,
        remote_url="https://example.test/blocked.pdf",
        filename="blocked.pdf",
        extension=".pdf",
        mime_type="application/pdf",
        size=12,
    )


@pytest.mark.parametrize("action", ["approved", "overridden", "direct_output"])
def test_api_input_checks_text_without_sending_or_replacing_files(
    api_moderation: APIModerationFixture, moderation_input_file: File, action: str
) -> None:
    """Real HTTP receives text only; an API verdict cannot replace the caller's file inputs."""
    service, rule, context, response, requests = api_moderation
    files = [moderation_input_file]
    inputs = {"text": "original", "file": moderation_input_file, "files": files}
    response.update(
        flagged=action != "approved",
        action="overridden" if action == "overridden" else "direct_output",
        inputs={"text": "rewritten", "file": "untrusted replacement", "files": []},
        query="safe query",
    )

    verdict = service.evaluate(
        context,
        rule=rule,
        request=ModerationRequest(text="", inputs=inputs, query="query"),
        phase="input",
    )

    assert requests == [
        {
            "point": "app.moderation.input",
            "params": {"app_id": "app-1", "inputs": {"text": "original"}, "query": "query"},
        }
    ]
    assert verdict.flagged is (action != "approved")
    assert verdict.replacement is not None
    if action == "overridden":
        assert verdict.replacement.inputs == {"text": "rewritten", "file": moderation_input_file, "files": files}
        assert verdict.replacement.inputs["file"] is moderation_input_file
        assert verdict.replacement.inputs["files"] is files
        assert verdict.replacement.query == "safe query"
    else:
        assert verdict.replacement.action == "direct_output"
    assert inputs == {"text": "original", "file": moderation_input_file, "files": files}
    assert inputs["file"] is moderation_input_file
    assert inputs["files"] is files


@pytest.mark.parametrize("blocked_field", ["neither", "text", "query"])
def test_keyword_input_ignores_file_metadata_but_still_checks_text(
    sqlite_engine: Engine, moderation_input_file: File, blocked_field: str
) -> None:
    """File names and URLs never cause rejection, but string variables and queries still do."""
    code_based_extension.init()
    service = build_moderation_service(database_client=sessionmaker(sqlite_engine))
    rule = ModerationRule(
        type="keywords",
        config={
            "inputs_config": {"enabled": True, "preset_response": "Input blocked"},
            "outputs_config": {"enabled": False},
            "keywords": "blocked",
        },
    )
    inputs = {
        "text": "blocked" if blocked_field == "text" else "safe",
        "file": moderation_input_file,
        "files": [moderation_input_file],
    }

    verdict = service.evaluate(
        AppRequestContext(tenant_id="tenant-1", app_id="app-1"),
        rule=rule,
        request=ModerationRequest(text="", inputs=inputs, query="blocked" if blocked_field == "query" else "safe"),
        phase="input",
    )

    assert verdict.flagged is (blocked_field != "neither")
    assert inputs["file"] is moderation_input_file


@pytest.mark.parametrize("verdict", [None, "false", 0])
def test_api_malformed_verdict_fails_closed(api_moderation: APIModerationFixture, verdict: str | int | None) -> None:
    service, rule, context, response, _ = api_moderation
    if verdict is None:
        response.pop("flagged")
    else:
        response["flagged"] = verdict
    with pytest.raises(ValueError, match="flagged"):
        service.check(context, rule=rule, text="content", phase="input")


def test_api_extension_cannot_be_used_across_tenants(api_moderation: APIModerationFixture) -> None:
    service, rule, _, _, requests = api_moderation
    with pytest.raises(ValueError, match="Extension not found"):
        service.check(
            AppRequestContext(tenant_id=str(uuid4()), app_id="app-1"), rule=rule, text="content", phase="input"
        )
    assert not requests
