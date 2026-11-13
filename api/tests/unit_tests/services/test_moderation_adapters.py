import json
from collections.abc import Callable, Generator, Iterator
from threading import Thread
from typing import Literal
from uuid import uuid4

import httpx
import pytest
from flask import Flask, request
from sqlalchemy import Engine
from sqlalchemy.orm import sessionmaker
from werkzeug.serving import make_server

from core.app.apps.exc import AppGenerateError
from core.app.llm.quota import ModelQuotaReservationState
from core.plugin.entities.plugin import PluginInstallationSource
from core.plugin.entities.plugin_daemon import PluginModelProviderDeclaration
from core.plugin.impl import base as client_module
from core.plugin.impl.model import PluginModelClient
from enums import DeploymentEdition
from extensions.application_services.moderation import build_llm_moderation_guard, build_moderation_service
from extensions.ext_code_based_extension import code_based_extension
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
from graphon.model_runtime.entities.model_entities import ModelType
from graphon.model_runtime.errors.invoke import InvokeAuthorizationError
from machinery.context import AppRequestContext
from models.api_based_extension import APIBasedExtension
from models.base import TypeBase
from repositories.api_based_extension_repository import APIBasedExtensionRepository
from services.api_based_extension_application_service import APIBasedExtensionInput
from services.moderation_adapters import (
    ExtensionModerationGateway,
    HostedOpenAIModerationGateway,
    LLMModerationGuard,
    VerifiedTenantModerationPluginResolver,
)
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
from tests.helpers.unit.core.model_fixtures import make_model_config
from tests.helpers.unit.core.model_moderation_fixtures import (
    RecordingHostedModerationClient,
    RecordingQuotaModelInstance,
    make_moderated_model,
)

type APIModerationFixture = tuple[
    ModerationService, ModerationRule, AppRequestContext, dict[str, object], list[dict[str, object]]
]


class RecordingTenantPlugins:
    def __init__(self, identifier: str | None) -> None:
        self.identifier = identifier
        self.tenants: list[str] = []

    def resolve(self, tenant_id: str) -> str | None:
        self.tenants.append(tenant_id)
        return self.identifier


class RecordingPluginCatalogue:
    def __init__(self, declarations: list[PluginModelProviderDeclaration], *, verified: bool) -> None:
        self.declarations = declarations
        self.verified = verified
        self.verified_identifiers: list[tuple[str, str]] = []

    def fetch_plugin_model_providers(self, tenant_id: str) -> list[PluginModelProviderDeclaration]:
        assert tenant_id == "tenant-1"
        return self.declarations

    def is_plugin_verified(self, tenant_id: str, plugin_unique_identifier: str) -> bool:
        self.verified_identifiers.append((tenant_id, plugin_unique_identifier))
        return self.verified


@pytest.mark.parametrize("verified", [False, True])
@pytest.mark.parametrize("source", [PluginInstallationSource.Marketplace, PluginInstallationSource.Github])
@pytest.mark.parametrize("provider", ["langgenius/openai/openai", "untrusted/openai/openai"])
@pytest.mark.parametrize("supports_moderation", [False, True])
def test_tenant_resolver_only_accepts_official_verified_marketplace_plugins(
    verified: bool, source: PluginInstallationSource, provider: str, supports_moderation: bool
) -> None:
    schema = make_model_config(
        provider=provider, model="model", mode="chat"
    ).provider_model_bundle.configuration.provider
    declaration = PluginModelProviderDeclaration.model_validate(
        {
            **schema.model_dump(),
            "supported_model_types": [ModelType.MODERATION] if supports_moderation else [ModelType.LLM],
            "plugin_unique_identifier": provider.rsplit("/", 1)[0] + ":1.0.0@checksum",
            "installation_source": source,
        }
    )
    catalogue = RecordingPluginCatalogue([declaration], verified=verified)
    result = VerifiedTenantModerationPluginResolver(catalogue).resolve("tenant-1")

    expected = (
        supports_moderation
        and verified
        and source == PluginInstallationSource.Marketplace
        and provider == "langgenius/openai/openai"
    )
    assert result == (declaration.plugin_unique_identifier if expected else None)
    if (
        not supports_moderation
        or provider != "langgenius/openai/openai"
        or source != PluginInstallationSource.Marketplace
    ):
        assert not catalogue.verified_identifiers


@pytest.mark.parametrize("identifier", [None, "langgenius/openai:tenant@checksum"])
@pytest.mark.parametrize("flagged", [False, True])
def test_platform_prefers_tenant_plugin_and_logs_rejection_without_content(
    identifier: str | None, flagged: bool, caplog: pytest.LogCaptureFixture
) -> None:
    client = RecordingHostedModerationClient()
    plugins = RecordingTenantPlugins(identifier)
    fallback = "langgenius/openai:fallback@checksum"
    gateway = HostedOpenAIModerationGateway(
        client=client,
        credentials={"api_key": "platform-key"},
        plugin_unique_identifier=fallback,
        tenant_plugins=plugins,
    )
    rule = ModerationRule(type="openai_moderation", config={"outputs_config": {"enabled": True}})
    text = "private blocked content" if flagged else "private safe content"
    with caplog.at_level("WARNING", logger="services.moderation_adapters"):
        verdict = gateway.check(
            AppRequestContext(tenant_id="tenant-1", app_id="app-1"),
            rule=rule,
            request=ModerationRequest(text=text),
            phase="output",
        )

    assert verdict.flagged is flagged
    assert len(client.calls) == 1
    assert client.calls[0][6] == (identifier or fallback)
    assert client.calls[0][4] == {"api_key": "platform-key"}
    assert client.routes == (["direct"] if identifier is None else ["tenant"])
    assert ("Platform moderation rejected content" in caplog.text) is flagged
    assert text not in caplog.text
    assert "platform-key" not in caplog.text


@pytest.mark.parametrize("text", ["", "safe"])
def test_missing_tenant_plugin_and_fallback_fail_closed(text: str) -> None:
    client = RecordingHostedModerationClient()
    gateway = HostedOpenAIModerationGateway(
        client=client,
        credentials={"api_key": "platform-key"},
        plugin_unique_identifier="",
        tenant_plugins=RecordingTenantPlugins(None),
    )
    rule = ModerationRule(type="openai_moderation", config={"inputs_config": {"enabled": True}})
    with pytest.raises(InvokeAuthorizationError, match="No trusted tenant"):
        gateway.check(
            AppRequestContext(tenant_id="tenant-1", app_id=""),
            rule=rule,
            request=ModerationRequest(text=text),
            phase="input",
        )
    assert not client.calls


def test_tenant_invoke_failure_switches_to_configured_fallback_for_remaining_checks() -> None:
    client = RecordingHostedModerationClient()
    tenant_identifier = "langgenius/openai:tenant@checksum"
    fallback = "langgenius/openai:fallback@checksum"
    client.identifier_errors[tenant_identifier] = RuntimeError("Tenant runtime unavailable")
    plugins = RecordingTenantPlugins(tenant_identifier)
    gateway = HostedOpenAIModerationGateway(
        client=client,
        credentials={"api_key": "platform-key"},
        plugin_unique_identifier=fallback,
        tenant_plugins=plugins,
    )
    rule = ModerationRule(type="openai_moderation", config={"inputs_config": {"enabled": True}})
    context = AppRequestContext(tenant_id="tenant-1", app_id="app-1")

    assert not gateway.check(context, rule=rule, request=ModerationRequest(text="safe"), phase="input").flagged
    assert not gateway.check(context, rule=rule, request=ModerationRequest(text="safe again"), phase="input").flagged
    assert [call[6] for call in client.calls] == [tenant_identifier, fallback, fallback]
    assert client.routes == ["tenant", "direct", "direct"]
    assert plugins.tenants == ["tenant-1"]


def test_trusted_tenant_plugin_does_not_require_a_valid_fallback_identifier() -> None:
    client = RecordingHostedModerationClient()
    tenant_identifier = "langgenius/openai:tenant@checksum"
    gateway = HostedOpenAIModerationGateway(
        client=client,
        credentials={"api_key": "platform-key"},
        plugin_unique_identifier="invalid-fallback",
        tenant_plugins=RecordingTenantPlugins(tenant_identifier),
    )
    rule = ModerationRule(type="openai_moderation", config={"inputs_config": {"enabled": True}})
    assert not gateway.check(
        AppRequestContext(tenant_id="tenant-1", app_id=""),
        rule=rule,
        request=ModerationRequest(text="safe"),
        phase="input",
    ).flagged
    assert client.calls[0][6] == tenant_identifier
    assert client.routes == ["tenant"]


@pytest.mark.parametrize("tenant_route", ["missing", "available", "unavailable"])
@pytest.mark.parametrize("flagged", [False, True])
@pytest.mark.parametrize("tenant_id", ["tenant-1", "tenant-2"])
def test_hosted_moderation_keeps_tenant_installation_dispatch_separate_from_direct_fallback(
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    tenant_route: Literal["missing", "available", "unavailable"],
    flagged: bool,
    tenant_id: str,
) -> None:
    config_overrides(PLUGIN_DAEMON_KEY="daemon-server-key")
    tenant_identifier = "langgenius/openai:1.0.0@" + "a" * 32
    fallback_identifier = "langgenius/openai:2.0.0@" + "b" * 32
    requests: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        assert request.method == "POST"
        assert request.headers["X-Api-Key"] == "daemon-server-key"
        assert request.headers["X-Plugin-ID"] == "langgenius/openai"
        payload = json.loads(request.content)
        assert payload["data"] == {
            "provider": "openai",
            "model_type": "moderation",
            "model": "omni-moderation-latest",
            "credentials": {"openai_api_key": "platform-key"},
            "text": "content",
        }
        if request.url.path.startswith("/plugin/"):
            assert request.url.path == f"/plugin/{tenant_id}/dispatch/moderation/invoke"
            assert request.headers["X-Plugin-Unique-Identifier"] == tenant_identifier
            if tenant_route != "available":
                return httpx.Response(404, json={"code": -404, "message": "Plugin not installed", "data": None})
        else:
            assert request.url.path == "/v2/invoke/dispatch/moderation/invoke"
            assert request.headers["X-Plugin-Unique-Identifier"] == fallback_identifier
            assert payload["tenant_id"] == tenant_id
            assert "user_id" not in payload
        return httpx.Response(200, text="data: " + json.dumps({"code": 0, "message": "", "data": {"result": flagged}}))

    with httpx.Client(transport=httpx.MockTransport(handle)) as http_client:
        monkeypatch.setattr(client_module, "_httpx_client", http_client)
        gateway = HostedOpenAIModerationGateway(
            client=PluginModelClient(),
            credentials={"openai_api_key": "platform-key"},
            plugin_unique_identifier=fallback_identifier,
            tenant_plugins=RecordingTenantPlugins(None if tenant_route == "missing" else tenant_identifier),
        )
        verdict = gateway.check(
            AppRequestContext(tenant_id=tenant_id, app_id="app-1"),
            rule=ModerationRule(type="openai_moderation", config={"inputs_config": {"enabled": True}}),
            request=ModerationRequest(text="content"),
            phase="input",
        )
    assert verdict.flagged is flagged
    paths = [request.url.path for request in requests]
    tenant_path = f"/plugin/{tenant_id}/dispatch/moderation/invoke"
    direct_path = "/v2/invoke/dispatch/moderation/invoke"
    assert (
        paths
        == {
            "missing": [direct_path],
            "available": [tenant_path],
            "unavailable": [tenant_path, direct_path],
        }[tenant_route]
    )


@pytest.mark.parametrize("status_code", [404, 500])
def test_unavailable_direct_fallback_fails_closed_without_trying_a_tenant_provider(
    monkeypatch: pytest.MonkeyPatch, status_code: int
) -> None:
    requests: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        assert request.url.path == "/v2/invoke/dispatch/moderation/invoke"
        return httpx.Response(status_code, json={"code": -1, "message": "Runtime unavailable", "data": None})

    with httpx.Client(transport=httpx.MockTransport(handle)) as http_client:
        monkeypatch.setattr(client_module, "_httpx_client", http_client)
        guard = build_llm_moderation_guard(
            AppRequestContext(tenant_id="tenant-1", app_id="app-1"),
            service=ModerationService(
                gateway=HostedOpenAIModerationGateway(
                    client=PluginModelClient(),
                    credentials={"openai_api_key": "platform-key"},
                    plugin_unique_identifier="langgenius/openai:1.0.0@" + "a" * 32,
                    tenant_plugins=RecordingTenantPlugins(None),
                )
            ),
            rule=ModerationRule(
                type="openai_moderation",
                config={"inputs_config": {"enabled": True}, "outputs_config": {"enabled": True}},
            ),
            platform=True,
        )
        with pytest.raises(ModerationUnavailableInvocationError) as unavailable:
            guard.check_inputs([UserPromptMessage(content="content")])
    assert str(unavailable.value) == "This message can’t be processed right now. Please try again later."
    assert len(requests) == 1


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
@pytest.mark.parametrize("failure", ["rejected", "authorization", "transport", "malformed_verdict"])
def test_guard_maps_checker_failures_without_delivering_content(mode: str, failure: str) -> None:
    phase: ModerationPhase = "input" if mode == "input" else "output"
    errors: dict[str, Exception] = {
        "rejected": ModerationRejectedError(phase, "Content violates the safety policy."),
        "authorization": InvokeAuthorizationError("Invalid platform key: secret-key"),
        "transport": RuntimeError("Private plugin address: internal-host"),
        "malformed_verdict": ValueError("Invalid verdict: private-payload"),
    }
    original_error = errors[failure]
    events: list[str] = []

    def check(text: str, checked_phase: ModerationPhase) -> None:
        assert text == "content"
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

    def check(text: str, checked_phase: ModerationPhase) -> None:
        assert checked_phase == phase
        checked.append(text)

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

    def check(text: str, phase: ModerationPhase) -> None:
        assert phase == "input"
        checked.append(text)

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

    def check(text: str, phase: ModerationPhase) -> None:
        assert phase == "output"
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

    def check(text: str, phase: ModerationPhase) -> None:
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

    def check(text: str, phase: ModerationPhase) -> None:
        assert phase == "output"
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


@pytest.mark.parametrize("blocked_phase", ["input", "output", "neither"])
def test_platform_moderation_never_reserves_additional_user_credits(
    config_overrides: Callable[..., None], blocked_phase: str
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
    client = RecordingHostedModerationClient()
    plugin_unique_identifier = "langgenius/openai:0.3.0@checksum"

    service = ModerationService(
        gateway=HostedOpenAIModerationGateway(
            client=client,
            credentials={"api_key": "platform-key"},
            plugin_unique_identifier=plugin_unique_identifier,
        )
    )
    rule = ModerationRule(
        type="openai_moderation",
        config={
            "inputs_config": {"enabled": True, "preset_response": "Input blocked"},
            "outputs_config": {"enabled": True, "preset_response": "Output blocked"},
        },
    )
    guard = build_llm_moderation_guard(
        AppRequestContext(tenant_id="test-tenant-id", app_id=""), service=service, rule=rule
    )
    instance, provider = make_moderated_model(
        quota=True, parts=["blocked" if blocked_phase == "output" else "safe"], moderation=guard
    )
    assert isinstance(instance, RecordingQuotaModelInstance)
    prompt = UserPromptMessage(content="a" * 2500 + ("blocked" if blocked_phase == "input" else "safe"))

    if blocked_phase == "neither":
        result = instance.invoke_llm([prompt], stream=False)
        assert result.message.content == "safe"
    else:
        with pytest.raises(ModerationRejectedError, match="blocked"):
            instance.invoke_llm([prompt], stream=False)

    assert provider.invocations == (0 if blocked_phase == "input" else 1)
    assert len(instance.reservations) == (0 if blocked_phase == "input" else 1)
    if instance.reservations:
        assert instance.reservations[0].state == ModelQuotaReservationState.COMMITTED
        assert len(instance.reservations[0].commits) == 1
    assert len(client.calls) == (2 if blocked_phase == "input" else 3)
    assert client.calls[0][5] == "a" * 2000
    if blocked_phase == "output":
        assert client.calls[-1][5] == "blocked"
    assert all(call[4] == {"api_key": "platform-key"} for call in client.calls)
    assert all(call[2:4] == ("langgenius/openai", "openai") for call in client.calls)
    assert all(call[6] == plugin_unique_identifier for call in client.calls)


@pytest.mark.parametrize("failure", ["missing_credentials", "provider_error", "invalid_identifier"])
def test_platform_moderation_fails_closed_without_credential_fallback(failure: str) -> None:
    client = RecordingHostedModerationClient()
    if failure == "provider_error":
        client.error = RuntimeError("moderation unavailable")
    identifier = (
        "untrusted/plugin:1.0.0@checksum" if failure == "invalid_identifier" else "langgenius/openai:1.0.0@checksum"
    )
    if failure == "invalid_identifier":
        gateway = HostedOpenAIModerationGateway(
            client=client,
            credentials={"api_key": "platform-key"},
            plugin_unique_identifier=identifier,
        )
        rule = ModerationRule(
            type="openai_moderation",
            config={"inputs_config": {"enabled": True, "preset_response": "Rejected"}},
        )
        with pytest.raises(ValueError, match="pinned langgenius/openai"):
            gateway.check(
                AppRequestContext(tenant_id="tenant-1", app_id=""),
                rule=rule,
                request=ModerationRequest(text="safe"),
                phase="input",
            )
        assert not client.calls
        return
    gateway = HostedOpenAIModerationGateway(
        client=client,
        credentials=None if failure == "missing_credentials" else {"api_key": "platform-key"},
        plugin_unique_identifier=identifier,
    )
    rule = ModerationRule(
        type="openai_moderation",
        config={"inputs_config": {"enabled": True, "preset_response": "Rejected"}},
    )
    with pytest.raises(InvokeAuthorizationError if failure == "missing_credentials" else RuntimeError):
        gateway.check(
            AppRequestContext(tenant_id="test-tenant-id", app_id=""),
            rule=rule,
            request=ModerationRequest(text="safe"),
            phase="input",
        )
    assert len(client.calls) == (1 if failure == "provider_error" else 0)
