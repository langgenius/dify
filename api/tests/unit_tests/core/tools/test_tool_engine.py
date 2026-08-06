from __future__ import annotations

from collections.abc import Generator
from typing import Any
from unittest.mock import Mock, patch
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from core.app.entities.app_invoke_entities import InvokeFrom
from core.tools.__base.tool import Tool
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import (
    ToolEntity,
    ToolIdentity,
    ToolInvokeMessage,
    ToolInvokeMessageBinary,
    ToolInvokeMeta,
    ToolParameter,
    ToolProviderType,
)
from core.tools.errors import (
    ToolEngineInvokeError,
    ToolInvokeError,
    ToolParameterValidationError,
)
from core.tools.tool_engine import ToolEngine
from models.model import AppMode, Message, MessageFile


class _DatabaseBinding:
    engine: Engine

    def __init__(self, engine: Engine) -> None:
        self.engine = engine


def _message() -> Message:
    message = Message(
        app_id=str(uuid4()),
        model_provider="provider",
        model_id="model",
        override_model_configs=None,
        conversation_id=str(uuid4()),
        inputs={},
        query="query",
        message="",
        message_tokens=0,
        message_unit_price=0,
        message_price_unit=0,
        answer="",
        answer_tokens=0,
        answer_unit_price=0,
        answer_price_unit=0,
        parent_message_id=None,
        provider_response_latency=0,
        total_price=0,
        currency="USD",
        invoke_from="debugger",
        from_source="console",
        from_end_user_id=None,
        from_account_id=str(uuid4()),
        app_mode=AppMode.CHAT,
    )
    message.id = str(uuid4())
    return message


class _DummyTool(Tool):
    result: Any
    raise_error: Exception | None

    def __init__(self, entity: ToolEntity, runtime: ToolRuntime):
        super().__init__(entity=entity, runtime=runtime)
        self.result = [self.create_text_message("ok")]
        self.raise_error = None

    def tool_provider_type(self) -> ToolProviderType:
        return ToolProviderType.BUILT_IN

    def _invoke(
        self,
        session: Any,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        if self.raise_error:
            raise self.raise_error
        if isinstance(self.result, list | Generator):
            yield from self.result
        else:
            yield self.result


def _build_tool(with_llm_parameter: bool = False) -> _DummyTool:
    parameters = []
    if with_llm_parameter:
        parameters = [
            ToolParameter.get_simple_instance(
                name="query",
                llm_description="query",
                typ=ToolParameter.ToolParameterType.STRING,
                required=False,
            )
        ]
    entity = ToolEntity(
        identity=ToolIdentity(author="author", name="tool-a", label=I18nObject(en_US="tool-a"), provider="provider-a"),
        parameters=parameters,
    )
    runtime = ToolRuntime(tenant_id="tenant-1", invoke_from=InvokeFrom.DEBUGGER, runtime_parameters={"rt": 1})
    return _DummyTool(entity=entity, runtime=runtime)


def test_convert_tool_response_to_str_and_extract_binary_messages():
    tool = _build_tool()
    messages = [
        tool.create_text_message("hello"),
        tool.create_link_message("https://example.com"),
        ToolInvokeMessage(
            type=ToolInvokeMessage.MessageType.IMAGE,
            message=ToolInvokeMessage.TextMessage(text="https://example.com/a.png"),
            meta={"mime_type": "image/png"},
        ),
        tool.create_json_message({"a": 1}),
        tool.create_json_message({"a": 1}, suppress_output=True),
    ]
    text = ToolEngine.tool_response_to_str(messages)
    assert "hello" in text
    assert "result link: https://example.com." in text
    assert '"a": 1' in text

    blob_message = ToolInvokeMessage(
        type=ToolInvokeMessage.MessageType.BLOB,
        message=ToolInvokeMessage.TextMessage(text="https://example.com/blob.bin"),
        meta={"mime_type": "application/octet-stream"},
    )
    link_message = ToolInvokeMessage(
        type=ToolInvokeMessage.MessageType.LINK,
        message=ToolInvokeMessage.TextMessage(text="https://example.com/file.pdf"),
        meta={"mime_type": "application/pdf"},
    )
    binaries = list(ToolEngine._extract_tool_response_binary_and_text([messages[2], blob_message, link_message]))
    assert [b.mimetype for b in binaries] == ["image/png", "application/octet-stream", "application/pdf"]

    with pytest.raises(ValueError, match="missing meta data"):
        list(
            ToolEngine._extract_tool_response_binary_and_text(
                [
                    ToolInvokeMessage(
                        type=ToolInvokeMessage.MessageType.IMAGE,
                        message=ToolInvokeMessage.TextMessage(text="x"),
                    )
                ]
            )
        )


@pytest.mark.parametrize("sqlite_session", [(MessageFile,)], indirect=True)
def test_create_message_files_and_invoke_generator(sqlite_engine: Engine, sqlite_session: Session):
    binaries = [
        ToolInvokeMessageBinary(mimetype="image/png", url="https://example.com/abc.png"),
        ToolInvokeMessageBinary(mimetype="audio/wav", url="https://example.com/def.wav"),
    ]
    agent_message = _message()
    with patch("core.tools.tool_engine.db", _DatabaseBinding(sqlite_engine)):
        ids = ToolEngine._create_message_files(
            tool_messages=binaries,
            agent_message=agent_message,
            invoke_from=InvokeFrom.DEBUGGER,
            user_id=str(uuid4()),
        )

    message_files = list(sqlite_session.scalars(select(MessageFile).order_by(MessageFile.created_at)).all())
    assert ids == [message_file.id for message_file in message_files]
    assert len(message_files) == 2
    assert {message_file.message_id for message_file in message_files} == {agent_message.id}

    tool = _build_tool()
    invoked = list(ToolEngine._invoke(sqlite_session, tool, {"a": 1}, user_id="u"))
    assert invoked[0].type == ToolInvokeMessage.MessageType.TEXT
    assert isinstance(invoked[-1], ToolInvokeMeta)
    assert invoked[-1].error is None


@pytest.mark.parametrize("sqlite_session", [()], indirect=True)
def test_generic_invoke_success_and_error_paths(sqlite_session: Session):
    tool = _build_tool()
    callback = Mock()
    callback.on_tool_execution.side_effect = lambda **kwargs: kwargs["tool_outputs"]
    response = list(
        ToolEngine.generic_invoke(
            session=sqlite_session,
            tool=tool,
            tool_parameters={"x": 1},
            user_id="u1",
            workflow_tool_callback=callback,
            workflow_call_depth=0,
            conversation_id="c1",
            app_id="a1",
            message_id="m1",
        )
    )
    assert response[0].message.text == "ok"
    callback.on_tool_start.assert_called_once()
    callback.on_tool_execution.assert_called_once()

    tool.raise_error = RuntimeError("boom")
    error_callback = Mock()
    error_callback.on_tool_execution.side_effect = lambda **kwargs: list(kwargs["tool_outputs"])
    with pytest.raises(RuntimeError, match="boom"):
        list(
            ToolEngine.generic_invoke(
                session=sqlite_session,
                tool=tool,
                tool_parameters={"x": 1},
                user_id="u1",
                workflow_tool_callback=error_callback,
                workflow_call_depth=0,
            )
        )
    error_callback.on_tool_error.assert_called_once()


@pytest.mark.parametrize("sqlite_session", [()], indirect=True)
def test_agent_invoke_success(sqlite_session: Session):
    tool = _build_tool(with_llm_parameter=True)
    callback = Mock()
    message = _message()
    meta = ToolInvokeMeta.empty()

    with patch.object(ToolEngine, "_invoke", return_value=iter([tool.create_text_message("ok"), meta])):
        with patch(
            "core.tools.tool_engine.ToolFileMessageTransformer.transform_tool_invoke_messages",
            side_effect=lambda messages, **kwargs: messages,
        ):
            with patch.object(ToolEngine, "_extract_tool_response_binary_and_text", return_value=iter([])):
                with patch.object(ToolEngine, "_create_message_files", return_value=[]):
                    result_text, message_files, result_meta = ToolEngine.agent_invoke(
                        session=sqlite_session,
                        tool=tool,
                        tool_parameters="hello",
                        user_id="u1",
                        tenant_id="tenant-1",
                        message=message,
                        invoke_from=InvokeFrom.DEBUGGER,
                        agent_tool_callback=callback,
                    )

    assert result_text == "ok"
    assert message_files == []
    assert result_meta.error is None
    callback.on_tool_start.assert_called_once()
    callback.on_tool_end.assert_called_once()


@pytest.mark.parametrize("sqlite_session", [()], indirect=True)
def test_agent_invoke_param_validation_error(sqlite_session: Session):
    tool = _build_tool(with_llm_parameter=True)
    callback = Mock()
    message = _message()

    with patch.object(ToolEngine, "_invoke", side_effect=ToolParameterValidationError("bad-param")):
        error_text, files, error_meta = ToolEngine.agent_invoke(
            session=sqlite_session,
            tool=tool,
            tool_parameters={"a": 1},
            user_id="u1",
            tenant_id="tenant-1",
            message=message,
            invoke_from=InvokeFrom.DEBUGGER,
            agent_tool_callback=callback,
        )

    assert "tool parameters validation error" in error_text
    assert files == []
    assert error_meta.error


@pytest.mark.parametrize("sqlite_session", [()], indirect=True)
def test_agent_invoke_engine_meta_error(sqlite_session: Session):
    tool = _build_tool(with_llm_parameter=True)
    callback = Mock()
    message = _message()
    engine_error = ToolEngineInvokeError(ToolInvokeMeta.error_instance("meta failure"))

    with patch.object(ToolEngine, "_invoke", side_effect=engine_error):
        error_text, files, error_meta = ToolEngine.agent_invoke(
            session=sqlite_session,
            tool=tool,
            tool_parameters={"a": 1},
            user_id="u1",
            tenant_id="tenant-1",
            message=message,
            invoke_from=InvokeFrom.DEBUGGER,
            agent_tool_callback=callback,
        )

    assert "meta failure" in error_text
    assert files == []
    assert error_meta.error == "meta failure"


def test_convert_tool_response_excludes_variable_messages():
    """Regression test for issue #34723.

    WorkflowTool._invoke yields VARIABLE, TEXT, and suppressed-JSON messages.
    tool_response_to_str must skip VARIABLE messages so that the
    returned string contains only the TEXT representation and not a
    duplicated, garbled Pydantic repr of the same data.
    """
    tool = _build_tool()
    outputs = {"reports": "hello"}
    messages = [
        tool.create_variable_message(variable_name="reports", variable_value="hello"),
        tool.create_text_message('{"reports": "hello"}'),
        tool.create_json_message(outputs, suppress_output=True),
    ]

    result = ToolEngine.tool_response_to_str(messages)

    assert result == '{"reports": "hello"}'
    assert "variable_name" not in result


@pytest.mark.parametrize("sqlite_session", [()], indirect=True)
def test_agent_invoke_tool_invoke_error(sqlite_session: Session):
    tool = _build_tool(with_llm_parameter=True)
    callback = Mock()
    message = _message()

    with patch.object(ToolEngine, "_invoke", side_effect=ToolInvokeError("invoke boom")):
        error_text, files, _ = ToolEngine.agent_invoke(
            session=sqlite_session,
            tool=tool,
            tool_parameters={"a": 1},
            user_id="u1",
            tenant_id="tenant-1",
            message=message,
            invoke_from=InvokeFrom.DEBUGGER,
            agent_tool_callback=callback,
        )

    assert "tool invoke error" in error_text
    assert files == []
