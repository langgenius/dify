"""Confirmed one-shot dispatch at the actual native PluginTool and transport boundaries.

The real ``PluginTool`` conversion, ``Tool.invoke`` runtime merge and
``ToolEngine.generic_invoke`` merge run unmodified; only the plugin daemon
transport and the consent callbacks are spies. Header values are SYNTHETIC
server-only contract values; they say nothing about deployed daemon support.
"""

from collections.abc import Generator, Iterator, Mapping
from dataclasses import dataclass
from unittest.mock import Mock, patch

import pytest
from sqlalchemy.orm import Session

from core.callback_handler.workflow_tool_callback_handler import DifyWorkflowCallbackHandler
from core.dify_builder.execution_policy import BuilderExecutionPolicyError
from core.dify_builder.gmail_read_policy import normalize_get_message_parameters
from core.plugin.entities.plugin_daemon import CredentialType
from core.plugin.impl.tool import PluginToolManager
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolEntity, ToolIdentity, ToolInvokeMessage, ToolParameter
from core.tools.plugin_tool.tool import PluginTool
from core.tools.tool_engine import ToolEngine

# SYNTHETIC values in the exact proposed contract shape; never a qualified artifact.
SYNTHETIC_HEADERS = {
    "X-Dify-Expected-Plugin-Identifier": "langgenius/dify-gmail:9.9.9@" + "f" * 64,
    "X-Dify-Expected-Installation-ID": "synthetic-installation",
    "X-Dify-Confirmed-Dispatch": "v1",
}
APPROVED = {"message_id": "18cab_1", "include_body": False, "include_attachments": False}
SECRET_SENTINEL = "unit-secret-sentinel-7f3a"


def test_plugin_tool_rejects_after_cast_before_manager_invoke() -> None:
    approved = normalize_get_message_parameters(
        {"message_id": "18cab_1", "include_body": False, "include_attachments": False}
    )

    def check(parameters: Mapping[str, object]) -> None:
        if normalize_get_message_parameters(parameters) != approved:
            raise BuilderExecutionPolicyError("consent_scope_changed")

    guard = Mock()
    guard.before_invoke.side_effect = check
    entity = ToolEntity(
        identity=ToolIdentity(
            author="langgenius",
            name="get_message",
            label=I18nObject(en_US="Get message"),
            provider="langgenius/dify-gmail/dify-gmail",
        ),
        parameters=[
            ToolParameter.get_simple_instance(name=name, llm_description=name, typ=typ, required=True)
            for name, typ in [
                ("message_id", ToolParameter.ToolParameterType.STRING),
                ("include_body", ToolParameter.ToolParameterType.BOOLEAN),
                ("include_attachments", ToolParameter.ToolParameterType.BOOLEAN),
            ]
        ],
    )
    runtime = ToolRuntime(
        tenant_id="tenant",
        credential_type=CredentialType.OAUTH2,
        credentials={"access_token": "unit-token"},
        runtime_parameters={"include_body": True},
    )
    tool = PluginTool(
        entity=entity,
        runtime=runtime,
        tenant_id="tenant",
        icon="",
        plugin_unique_identifier="unit-artifact",
        confirmed_guard=guard,
    )
    with Session() as session, patch("core.tools.plugin_tool.tool.PluginToolManager") as manager:
        with pytest.raises(BuilderExecutionPolicyError, match="consent_scope_changed"):
            list(tool.invoke(session=session, user_id="owner", tool_parameters=approved.model_dump()))
        manager.return_value.invoke.assert_not_called()
    guard.before_invoke.assert_called_once()


# --- shared builders --------------------------------------------------------------------


def _entity() -> ToolEntity:
    return ToolEntity(
        identity=ToolIdentity(
            author="langgenius",
            name="get_message",
            label=I18nObject(en_US="Get message"),
            provider="langgenius/dify-gmail/dify-gmail",
        ),
        parameters=[
            ToolParameter.get_simple_instance(name=name, llm_description=name, typ=typ, required=True)
            for name, typ in [
                ("message_id", ToolParameter.ToolParameterType.STRING),
                ("include_body", ToolParameter.ToolParameterType.BOOLEAN),
                ("include_attachments", ToolParameter.ToolParameterType.BOOLEAN),
            ]
        ],
    )


def _tool(guard: Mock | None, *, runtime_parameters: dict[str, object] | None = None) -> PluginTool:
    runtime = ToolRuntime(
        tenant_id="tenant",
        credential_type=CredentialType.OAUTH2,
        credentials={"access_token": "unit-token"},
        runtime_parameters=runtime_parameters or {},
    )
    if guard is None:
        return PluginTool(
            entity=_entity(), runtime=runtime, tenant_id="tenant", icon="", plugin_unique_identifier="unit-artifact"
        )
    return PluginTool(
        entity=_entity(),
        runtime=runtime,
        tenant_id="tenant",
        icon="",
        plugin_unique_identifier="unit-artifact",
        confirmed_guard=guard,
    )


def _exact_guard() -> Mock:
    """Consent callback spy that admits only the exact approved final envelope."""
    approved = normalize_get_message_parameters(APPROVED)
    guard = Mock()

    def check(parameters: Mapping[str, object]) -> None:
        if normalize_get_message_parameters(parameters) != approved:
            raise BuilderExecutionPolicyError("consent_scope_changed")

    guard.before_invoke.side_effect = check
    guard.dispatch_headers.return_value = dict(SYNTHETIC_HEADERS)
    return guard


def _success_messages() -> list[ToolInvokeMessage]:
    return [
        ToolInvokeMessage(type=ToolInvokeMessage.MessageType.TEXT, message=ToolInvokeMessage.TextMessage(text="ok")),
        ToolInvokeMessage(
            type=ToolInvokeMessage.MessageType.VARIABLE,
            message=ToolInvokeMessage.VariableMessage(variable_name="message_id", variable_value="18cab_1"),
        ),
        ToolInvokeMessage(
            type=ToolInvokeMessage.MessageType.JSON,
            message=ToolInvokeMessage.JsonMessage(json_object={"message": {"id": "18cab_1"}, "message_id": "18cab_1"}),
        ),
    ]


@dataclass(frozen=True)
class Call:
    """One plugin daemon request as the transport received it."""

    path: str
    headers: dict[str, str]
    payload: dict[str, object]


class Transport:
    """Spy for the plugin daemon stream; the only external boundary of ``PluginToolManager.invoke``."""

    def __init__(self, messages: list[ToolInvokeMessage], *, fail_after: int | None = None) -> None:
        self.messages = messages
        self.fail_after = fail_after
        self.calls: list[Call] = []
        self.closed = False
        self.yielded = 0

    def __call__(
        self, method: str, path: str, _type: type, **kwargs: object
    ) -> Generator[ToolInvokeMessage, None, None]:
        assert method == "POST"
        headers, data = kwargs["headers"], kwargs["data"]
        assert isinstance(headers, dict)
        assert isinstance(data, dict)
        payload = data["data"]
        assert isinstance(payload, dict)
        self.calls.append(Call(path=path, headers=dict(headers), payload=dict(payload)))
        return self._stream()

    def _stream(self) -> Generator[ToolInvokeMessage, None, None]:
        try:
            for index, message in enumerate(self.messages):
                if self.fail_after is not None and index == self.fail_after:
                    raise RuntimeError(f"daemon failure {SECRET_SENTINEL}")
                self.yielded += 1
                yield message
        finally:
            self.closed = True


def _invoke(
    tool: PluginTool, transport: Transport, parameters: dict[str, object] | None = None
) -> list[ToolInvokeMessage]:
    with (
        Session() as session,
        patch.object(PluginToolManager, "_request_with_plugin_daemon_response_stream", side_effect=transport),
    ):
        return list(tool.invoke(session=session, user_id="owner", tool_parameters=dict(parameters or APPROVED)))


# --- final envelope through ToolEngine ------------------------------------------------------


def test_tool_engine_merge_is_checked_lazily_before_transport() -> None:
    guard = _exact_guard()
    # An extra runtime value merged by ToolEngine (and Tool.invoke) widens the final envelope.
    tool = _tool(guard, runtime_parameters={"format": "raw"})
    transport = Transport(_success_messages())
    with (
        Session() as session,
        patch.object(PluginToolManager, "_request_with_plugin_daemon_response_stream", side_effect=transport),
    ):
        stream = ToolEngine.generic_invoke(
            session=session,
            tool=tool,
            tool_parameters=dict(APPROVED),
            user_id="owner",
            workflow_tool_callback=DifyWorkflowCallbackHandler(),
            workflow_call_depth=0,
        )
        # Nothing is spent or sent until the native generator is iterated.
        guard.before_invoke.assert_not_called()
        with pytest.raises(BuilderExecutionPolicyError, match="unsupported_tool_parameters"):
            list(stream)
    guard.before_invoke.assert_called_once()
    assert transport.calls == []
    guard.dispatch_headers.assert_not_called()
    guard.finish_stream.assert_not_called()


def test_tool_engine_exact_envelope_dispatches_once_with_pinned_headers() -> None:
    guard = _exact_guard()
    tool = _tool(guard)
    transport = Transport(_success_messages())
    with (
        Session() as session,
        patch.object(PluginToolManager, "_request_with_plugin_daemon_response_stream", side_effect=transport),
    ):
        messages = list(
            ToolEngine.generic_invoke(
                session=session,
                tool=tool,
                tool_parameters=dict(APPROVED),
                user_id="owner",
                workflow_tool_callback=DifyWorkflowCallbackHandler(),
                workflow_call_depth=0,
            )
        )
    assert [m.type for m in messages] == [m.type for m in _success_messages()]
    guard.before_invoke.assert_called_once_with(APPROVED)
    assert len(transport.calls) == 1
    call = transport.calls[0]
    assert call.path == "plugin/tenant/dispatch/tool/invoke"
    assert call.headers == {
        "X-Plugin-ID": "langgenius/dify-gmail",
        "Content-Type": "application/json",
        **SYNTHETIC_HEADERS,
    }
    assert call.payload["tool_parameters"] == APPROVED
    guard.observe_json.assert_called_once_with({"message": {"id": "18cab_1"}, "message_id": "18cab_1"})
    guard.finish_stream.assert_called_once_with(complete=True, declared_failure=False)


# --- stream classification inputs ---------------------------------------------------------


@pytest.mark.parametrize(
    "unexpected",
    [
        ToolInvokeMessage(type=ToolInvokeMessage.MessageType.BLOB, message=ToolInvokeMessage.BlobMessage(blob=b"x")),
        ToolInvokeMessage(
            type=ToolInvokeMessage.MessageType.IMAGE,
            message=ToolInvokeMessage.TextMessage(text="https://example.invalid/i.png"),
        ),
        ToolInvokeMessage(
            type=ToolInvokeMessage.MessageType.LINK,
            message=ToolInvokeMessage.TextMessage(text="https://example.invalid/"),
        ),
    ],
)
def test_unexpected_output_is_refused_before_it_reaches_file_transformation(unexpected: ToolInvokeMessage) -> None:
    guard = _exact_guard()
    transport = Transport([_success_messages()[0], unexpected, _success_messages()[2]])
    seen: list[ToolInvokeMessage] = []

    def consume(stream: Iterator[ToolInvokeMessage]) -> None:
        for message in stream:
            seen.append(message)

    with (
        Session() as session,
        patch.object(PluginToolManager, "_request_with_plugin_daemon_response_stream", side_effect=transport),
    ):
        stream = _tool(guard).invoke(session=session, user_id="owner", tool_parameters=dict(APPROVED))
        with pytest.raises(BuilderExecutionPolicyError, match="unsupported_tool_output"):
            consume(stream)
    assert [m.type for m in seen] == [ToolInvokeMessage.MessageType.TEXT]
    assert transport.closed is True
    guard.finish_stream.assert_called_once_with(complete=False, declared_failure=False)


def test_consumer_cancellation_finishes_unknown_once_without_reconstruction() -> None:
    guard = _exact_guard()
    transport = Transport(_success_messages())
    with (
        Session() as session,
        patch.object(PluginToolManager, "_request_with_plugin_daemon_response_stream", side_effect=transport),
    ):
        stream = _tool(guard).invoke(session=session, user_id="owner", tool_parameters=dict(APPROVED))
        first = next(stream)
        assert first.type == ToolInvokeMessage.MessageType.TEXT
        stream.close()
        stream.close()
    guard.finish_stream.assert_called_once_with(complete=False, declared_failure=False)
    assert transport.closed is True
    assert len(transport.calls) == 1
    guard.before_invoke.assert_called_once()


def test_native_transport_error_stays_native_and_never_reaches_builder_metadata(
    caplog: pytest.LogCaptureFixture,
) -> None:
    guard = _exact_guard()
    transport = Transport(_success_messages(), fail_after=1)
    with pytest.raises(RuntimeError, match=SECRET_SENTINEL):
        _invoke(_tool(guard), transport)
    guard.finish_stream.assert_called_once_with(complete=False, declared_failure=False)
    # Nothing the guard received, and nothing logged, carries the native error text.
    assert SECRET_SENTINEL not in repr(guard.mock_calls)
    assert SECRET_SENTINEL not in caplog.text


def test_dispatch_header_failure_after_business_claim_is_unknown_not_retried() -> None:
    guard = _exact_guard()
    guard.dispatch_headers.return_value = {**SYNTHETIC_HEADERS, "X-Dify-Confirmed-Dispatch": "v2"}
    transport = Transport(_success_messages())
    with pytest.raises(BuilderExecutionPolicyError, match="confirmed_dispatch_headers_invalid"):
        _invoke(_tool(guard), transport)
    assert transport.calls == []
    guard.before_invoke.assert_called_once()
    guard.finish_stream.assert_called_once_with(complete=False, declared_failure=False)


# --- guard lifecycle and ordinary compatibility -------------------------------------------


def test_fork_preserves_guard_outside_runtime_and_serialization() -> None:
    guard = _exact_guard()
    tool = _tool(guard)
    forked = tool.fork_tool_runtime(ToolRuntime(tenant_id="tenant", credentials={"access_token": "unit-token"}))
    assert isinstance(forked, PluginTool)
    assert forked.confirmed_guard is guard
    assert guard not in forked.runtime.credentials.values()
    dumped = repr(forked.runtime.model_dump()) + repr(forked.entity.model_dump())
    assert "Mock" not in dumped
    assert "confirmed_guard" not in dumped


def test_ordinary_plugin_tool_has_no_guard_and_unchanged_dispatch() -> None:
    tool = _tool(None, runtime_parameters={"include_body": True})
    assert tool.confirmed_guard is None
    assert tool.fork_tool_runtime(ToolRuntime(tenant_id="tenant")).confirmed_guard is None
    transport = Transport(
        [ToolInvokeMessage(type=ToolInvokeMessage.MessageType.BLOB, message=ToolInvokeMessage.BlobMessage(blob=b"x"))]
    )
    messages = _invoke(tool, transport)
    # Ordinary native behavior: runtime merge wins, any message type flows, native headers only.
    assert [m.type for m in messages] == [ToolInvokeMessage.MessageType.BLOB]
    assert transport.calls[0].headers == {"X-Plugin-ID": "langgenius/dify-gmail", "Content-Type": "application/json"}
    assert transport.calls[0].payload["tool_parameters"] == {**APPROVED, "include_body": True}


# --- PluginToolManager.invoke header contract ----------------------------------------------


def _manager_invoke(headers: Mapping[str, str] | None, transport: Transport) -> None:
    with patch.object(PluginToolManager, "_request_with_plugin_daemon_response_stream", side_effect=transport):
        list(
            PluginToolManager().invoke(
                tenant_id="tenant",
                user_id="owner",
                tool_provider="langgenius/dify-gmail/dify-gmail",
                tool_name="get_message",
                credentials={"access_token": "unit-token"},
                credential_type=CredentialType.OAUTH2,
                tool_parameters=dict(APPROVED),
                confirmed_dispatch_headers=headers,
            )
        )


def test_manager_merges_exactly_the_three_confirmed_headers() -> None:
    transport = Transport([])
    _manager_invoke(dict(SYNTHETIC_HEADERS), transport)
    assert transport.calls[0].path == "plugin/tenant/dispatch/tool/invoke"
    assert transport.calls[0].headers == {
        "X-Plugin-ID": "langgenius/dify-gmail",
        "Content-Type": "application/json",
        **SYNTHETIC_HEADERS,
    }


@pytest.mark.parametrize(
    "headers",
    [
        {},
        {k: v for k, v in SYNTHETIC_HEADERS.items() if k != "X-Dify-Expected-Installation-ID"},
        {**SYNTHETIC_HEADERS, "X-Dify-Confirmed-Dispatch": "v2"},
        {**SYNTHETIC_HEADERS, "X-Plugin-ID": "attacker/plugin"},
        {**SYNTHETIC_HEADERS, "X-Dify-Expected-Plugin-Identifier": ""},
        {**SYNTHETIC_HEADERS, "X-Dify-Expected-Installation-ID": "a\r\nX-Injected: 1"},
        {**SYNTHETIC_HEADERS, "x-dify-confirmed-dispatch": "v1"},
    ],
)
def test_manager_refuses_any_other_confirmed_header_set_before_transport(headers: dict[str, str]) -> None:
    transport = Transport([])
    with pytest.raises(BuilderExecutionPolicyError, match="confirmed_dispatch_headers_invalid"):
        _manager_invoke(headers, transport)
    assert transport.calls == []
