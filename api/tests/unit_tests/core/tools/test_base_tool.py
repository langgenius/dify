from __future__ import annotations

from collections.abc import Generator
from dataclasses import dataclass
from typing import Any, cast

from core.app.entities.app_invoke_entities import InvokeFrom
from core.tools.__base.tool import Tool
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolEntity, ToolIdentity, ToolInvokeMessage, ToolProviderType


class DummyCastType:
    def cast_value(self, value: Any) -> str:
        return f"cast:{value}"


@dataclass
class DummyParameter:
    name: str
    type: DummyCastType
    form: str = "llm"
    required: bool = False
    default: Any = None
    options: list[Any] | None = None
    llm_description: str | None = None


class DummyTool(Tool):
    def __init__(self, entity: ToolEntity, runtime: ToolRuntime):
        super().__init__(entity=entity, runtime=runtime)
        self.result: ToolInvokeMessage | list[ToolInvokeMessage] | Generator[ToolInvokeMessage, None, None] = (
            self.create_text_message("default")
        )
        self.runtime_parameter_overrides: list[Any] | None = None
        self.last_invocation: dict[str, Any] | None = None

    def tool_provider_type(self) -> ToolProviderType:
        return ToolProviderType.BUILT_IN

    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
    ) -> ToolInvokeMessage | list[ToolInvokeMessage] | Generator[ToolInvokeMessage, None, None]:
        self.last_invocation = {
            "user_id": user_id,
            "tool_parameters": tool_parameters,
            "conversation_id": conversation_id,
            "app_id": app_id,
            "message_id": message_id,
        }
        return self.result

    def get_runtime_parameters(
        self,
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
    ):
        if self.runtime_parameter_overrides is not None:
            return self.runtime_parameter_overrides
        return super().get_runtime_parameters(
            conversation_id=conversation_id,
            app_id=app_id,
            message_id=message_id,
        )


def _build_tool(runtime: ToolRuntime | None = None) -> DummyTool:
    entity = ToolEntity(
        identity=ToolIdentity(author="test", name="dummy", label=I18nObject(en_US="dummy"), provider="test"),
        parameters=[],
        description=None,
        has_runtime_parameters=False,
    )
    runtime = runtime or ToolRuntime(tenant_id="tenant-1", invoke_from=InvokeFrom.DEBUGGER, runtime_parameters={})
    return DummyTool(entity=entity, runtime=runtime)


def test_invoke_supports_single_message_and_parameter_casting():
    runtime = ToolRuntime(
        tenant_id="tenant-1",
        invoke_from=InvokeFrom.DEBUGGER,
        runtime_parameters={"from_runtime": "runtime-value"},
    )
    tool = _build_tool(runtime)
    tool.entity.parameters = cast(
        Any,
        [
            DummyParameter(name="unused", type=DummyCastType()),
            DummyParameter(name="age", type=DummyCastType()),
        ],
    )
    tool.result = tool.create_text_message("ok")

    messages = list(
        tool.invoke(
            user_id="user-1",
            tool_parameters={"age": "18", "raw": "keep"},
            conversation_id="conv-1",
            app_id="app-1",
            message_id="msg-1",
        )
    )

    assert len(messages) == 1
    assert messages[0].message.text == "ok"
    assert tool.last_invocation == {
        "user_id": "user-1",
        "tool_parameters": {"age": "cast:18", "raw": "keep", "from_runtime": "runtime-value"},
        "conversation_id": "conv-1",
        "app_id": "app-1",
        "message_id": "msg-1",
    }


def test_invoke_supports_list_and_generator_results():
    tool = _build_tool()
    tool.result = [tool.create_text_message("a"), tool.create_text_message("b")]
    list_messages = list(tool.invoke(user_id="user-1", tool_parameters={}))
    assert [msg.message.text for msg in list_messages] == ["a", "b"]

    def _message_generator() -> Generator[ToolInvokeMessage, None, None]:
        yield tool.create_text_message("g1")
        yield tool.create_text_message("g2")

    tool.result = _message_generator()
    generated_messages = list(tool.invoke(user_id="user-2", tool_parameters={}))
    assert [msg.message.text for msg in generated_messages] == ["g1", "g2"]


def test_fork_tool_runtime_returns_new_tool_with_copied_entity():
    tool = _build_tool()
    new_runtime = ToolRuntime(tenant_id="tenant-2", invoke_from=InvokeFrom.EXPLORE, runtime_parameters={})

    forked = tool.fork_tool_runtime(new_runtime)

    assert isinstance(forked, DummyTool)
    assert forked is not tool
    assert forked.runtime == new_runtime
    assert forked.entity == tool.entity
    assert forked.entity is not tool.entity


def test_get_runtime_parameters_and_merge_runtime_parameters():
    tool = _build_tool()
    original = DummyParameter(name="temperature", type=DummyCastType(), form="schema", required=True, default="0.7")
    tool.entity.parameters = cast(Any, [original])

    default_runtime_parameters = tool.get_runtime_parameters()
    assert default_runtime_parameters == [original]

    override = DummyParameter(name="temperature", type=DummyCastType(), form="llm", required=False, default="0.5")
    appended = DummyParameter(name="new_param", type=DummyCastType(), form="form", required=False, default="x")
    tool.runtime_parameter_overrides = [override, appended]

    merged = tool.get_merged_runtime_parameters()
    assert len(merged) == 2
    assert merged[0].name == "temperature"
    assert merged[0].form == "llm"
    assert merged[0].required is False
    assert merged[0].default == "0.5"
    assert merged[1].name == "new_param"


def test_message_factory_helpers():
    tool = _build_tool()

    image_message = tool.create_image_message("https://example.com/image.png")
    assert image_message.type == ToolInvokeMessage.MessageType.IMAGE
    assert image_message.message.text == "https://example.com/image.png"

    file_obj = object()
    file_message = tool.create_file_message(file_obj)  # type: ignore[arg-type]
    assert file_message.type == ToolInvokeMessage.MessageType.FILE
    assert file_message.message.file_marker == "file_marker"
    assert file_message.meta == {"file": file_obj}

    link_message = tool.create_link_message("https://example.com")
    assert link_message.type == ToolInvokeMessage.MessageType.LINK
    assert link_message.message.text == "https://example.com"

    text_message = tool.create_text_message("hello")
    assert text_message.type == ToolInvokeMessage.MessageType.TEXT
    assert text_message.message.text == "hello"

    blob_message = tool.create_blob_message(b"blob", meta={"source": "unit-test"})
    assert blob_message.type == ToolInvokeMessage.MessageType.BLOB
    assert blob_message.message.blob == b"blob"
    assert blob_message.meta == {"source": "unit-test"}

    json_message = tool.create_json_message({"k": "v"}, suppress_output=True)
    assert json_message.type == ToolInvokeMessage.MessageType.JSON
    assert json_message.message.json_object == {"k": "v"}
    assert json_message.message.suppress_output is True

    variable_message = tool.create_variable_message("answer", 42, stream=False)
    assert variable_message.type == ToolInvokeMessage.MessageType.VARIABLE
    assert variable_message.message.variable_name == "answer"
    assert variable_message.message.variable_value == 42
    assert variable_message.message.stream is False


def test_base_abstract_invoke_placeholder_returns_none():
    tool = _build_tool()
    assert Tool._invoke(tool, user_id="u", tool_parameters={}) is None
