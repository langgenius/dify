import json
from decimal import Decimal

import pytest
from pytest_mock import MockerFixture
from sqlalchemy.orm import Session

import core.agent.base_agent_runner as module
from core.agent.base_agent_runner import BaseAgentRunner
from core.agent.entities import AgentEntity, AgentToolEntity
from core.app.app_config.entities import (
    AppAdditionalFeatures,
    DatasetEntity,
    DatasetRetrieveConfigEntity,
    EasyUIBasedAppModelConfigFrom,
    ModelConfigEntity,
    PromptTemplateEntity,
)
from core.app.apps.agent_chat.app_config_manager import AgentChatAppConfig
from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.entities.app_invoke_entities import (
    AgentChatAppGenerateEntity,
    InvokeFrom,
    ModelConfigWithCredentialsEntity,
)
from core.model_manager import ModelInstance
from core.tools.__base.tool import Tool
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import (
    ToolDescription,
    ToolEntity,
    ToolIdentity,
    ToolParameter,
    ToolProviderType,
)
from core.tools.utils.dataset_retriever_tool import DatasetRetrieverTool
from graphon.file import FileTransferMethod, FileType, FileUploadConfig, ImageConfig
from graphon.model_runtime.entities import LLMUsage, PromptMessageTool
from graphon.model_runtime.model_providers.base.large_language_model import LargeLanguageModel
from models.enums import ConversationFromSource, CreatorUserRole, MessageFileBelongsTo
from models.model import AppMode, AppModelConfig, Conversation, Message, MessageAgentThought, MessageFile


def _message(
    *,
    message_id: str = "msg_current",
    conversation_id: str = "conv1",
    query: str = "hello",
    answer: str = "",
) -> Message:
    message = Message(
        id=message_id,
        app_id="app1",
        conversation_id=conversation_id,
        query=query,
        message={"role": "user", "content": query},
        answer=answer,
        message_unit_price=Decimal(0),
        answer_unit_price=Decimal(0),
        currency="USD",
        from_source=ConversationFromSource.CONSOLE,
        from_account_id="user",
    )
    message._inputs = {}
    return message


def _conversation(*, app_model_config_id: str | None = None) -> Conversation:
    conversation = Conversation(
        id="conv1",
        app_id="app1",
        app_model_config_id=app_model_config_id,
        mode=AppMode.AGENT_CHAT,
        name="Conversation",
        from_source=ConversationFromSource.CONSOLE,
        from_account_id="user",
        is_deleted=False,
    )
    conversation._inputs = {}
    return conversation


def _thought(
    *,
    thought_id: str,
    message_id: str = "m1",
    tool: str | None = None,
    tool_input: str | None = None,
    observation: str | None = None,
    thought: str = "thinking",
) -> MessageAgentThought:
    row = MessageAgentThought(
        message_id=message_id,
        position=1,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="user",
        thought=thought,
        tool=tool,
        tool_input=tool_input,
        observation=observation,
        tool_labels_str="{}",
        tool_meta_str="{}",
    )
    row.id = thought_id
    return row


def _persist_history(session: Session, *messages: Message, thoughts: list[MessageAgentThought] | None = None) -> None:
    session.add_all([_conversation(), *messages, *(thoughts or [])])
    session.commit()


def _app_config(
    *,
    simple_prompt_template: str | None = "",
    agent: AgentEntity | None = None,
    dataset: DatasetEntity | None = None,
    additional_features: AppAdditionalFeatures | None = None,
) -> AgentChatAppConfig:
    return AgentChatAppConfig(
        tenant_id="tenant",
        app_id="app1",
        app_mode=AppMode.AGENT_CHAT,
        app_model_config_from=EasyUIBasedAppModelConfigFrom.ARGS,
        app_model_config_dict={},
        model=ModelConfigEntity(provider="provider", model="model"),
        prompt_template=PromptTemplateEntity(
            prompt_type=PromptTemplateEntity.PromptType.SIMPLE,
            simple_prompt_template=simple_prompt_template,
        ),
        agent=agent,
        dataset=dataset,
        additional_features=additional_features,
    )


def _app_generate(
    *,
    app_config: AgentChatAppConfig | None = None,
    files: list[str] | None = None,
) -> AgentChatAppGenerateEntity:
    """Build the real generate entity with only the fields used by these unit tests."""

    return AgentChatAppGenerateEntity.model_construct(
        task_id="task",
        app_config=app_config or _app_config(),
        inputs={},
        files=files or [],
        user_id="user",
        stream=False,
        invoke_from=InvokeFrom.DEBUGGER,
    )


def _agent_tool(tool_name: str) -> AgentToolEntity:
    return AgentToolEntity(
        provider_type=ToolProviderType.BUILT_IN,
        provider_id="provider",
        tool_name=tool_name,
    )


def _agent(*tools: AgentToolEntity) -> AgentEntity:
    return AgentEntity(
        provider="provider",
        model="model",
        strategy=AgentEntity.Strategy.FUNCTION_CALLING,
        tools=list(tools),
    )


def _tool_entity(name: str) -> ToolEntity:
    return ToolEntity(
        identity=ToolIdentity(
            author="author",
            name=name,
            label=I18nObject(en_US=name),
            provider="provider",
        ),
        description=ToolDescription(
            human=I18nObject(en_US="Description"),
            llm="desc",
        ),
    )


@pytest.fixture
def database_session(sqlite_session: Session, monkeypatch: pytest.MonkeyPatch) -> Session:
    """Bind legacy global-session writes to a real SQLite Session."""

    monkeypatch.setattr(module.db, "session", sqlite_session)
    return sqlite_session


@pytest.fixture
def runner() -> BaseAgentRunner:
    instance = BaseAgentRunner.__new__(BaseAgentRunner)
    instance.tenant_id = "tenant"
    instance.user_id = "user"
    instance.agent_thought_count = 0
    instance.message = _message()
    instance.app_config = _app_config()
    instance.dataset_tools = []
    instance.application_generate_entity = _app_generate(app_config=instance.app_config)
    instance._current_thoughts = []
    return instance


class TestRepack:
    def test_sets_empty_if_none(self, runner: BaseAgentRunner) -> None:
        entity = _app_generate(app_config=_app_config(simple_prompt_template=None))
        result = runner._repack_app_generate_entity(entity)
        assert result.app_config.prompt_template.simple_prompt_template == ""

    def test_keeps_existing(self, runner: BaseAgentRunner) -> None:
        entity = _app_generate(app_config=_app_config(simple_prompt_template="abc"))
        result = runner._repack_app_generate_entity(entity)
        assert result.app_config.prompt_template.simple_prompt_template == "abc"


def test_update_prompt_tool_replaces_parameters(runner: BaseAgentRunner, mocker: MockerFixture) -> None:
    tool = mocker.Mock(spec=Tool)
    schema = {
        "type": "object",
        "properties": {"p1": {"type": "string", "description": "desc"}},
        "required": ["p1"],
    }
    tool.get_llm_parameters_json_schema.return_value = schema
    prompt_tool = PromptMessageTool(name="tool", description="", parameters={"properties": {}, "required": []})

    result = runner.update_prompt_message_tool(tool, prompt_tool)

    assert result.parameters == schema


@pytest.mark.parametrize(("files", "expected_files"), [(["f1"], '["f1"]'), ([], "")])
def test_create_agent_thought_persists_row(
    runner: BaseAgentRunner,
    database_session: Session,
    files: list[str],
    expected_files: str,
) -> None:
    thought_id = runner.create_agent_thought("message-1", "message", "tool", "input", files)

    stored = database_session.get(MessageAgentThought, thought_id)
    assert stored is not None
    assert stored.message_id == "message-1"
    assert stored.message_files == expected_files
    assert stored.position == 1
    assert runner.agent_thought_count == 1


def _persist_thought(session: Session, *, tool: str = "tool1;tool2") -> MessageAgentThought:
    thought = _thought(thought_id="thought-1", tool=tool, thought="")
    session.add(thought)
    session.commit()
    return thought


def test_save_agent_thought_rejects_missing_row(runner: BaseAgentRunner, database_session: Session) -> None:
    assert database_session.get(MessageAgentThought, "missing") is None
    with pytest.raises(ValueError, match="agent thought not found"):
        runner.save_agent_thought("missing", None, None, None, None, None, None, [], None)


def test_save_agent_thought_full_update(
    runner: BaseAgentRunner,
    database_session: Session,
    mocker: MockerFixture,
) -> None:
    thought = _persist_thought(database_session)
    label = I18nObject(en_US="label")
    mocker.patch.object(module.ToolManager, "get_tool_label", return_value=label)
    usage = LLMUsage(
        prompt_tokens=1,
        prompt_price_unit=Decimal("0.1"),
        prompt_unit_price=Decimal("0.1"),
        prompt_price=Decimal("0.1"),
        completion_tokens=2,
        completion_price_unit=Decimal("0.2"),
        completion_unit_price=Decimal("0.2"),
        completion_price=Decimal("0.2"),
        total_tokens=3,
        total_price=Decimal("0.3"),
        currency="USD",
        latency=0,
    )

    runner.save_agent_thought(
        thought.id,
        "tool1;tool2",
        {"a": 1},
        "thought",
        {"b": 2},
        {"meta": 1},
        "answer",
        ["f1"],
        usage,
    )

    stored = database_session.get(MessageAgentThought, thought.id)
    assert stored is not None
    assert stored.answer == "answer"
    assert stored.tokens == 3
    assert stored.tool_input == '{"a": 1}'
    assert stored.observation == '{"b": 2}'
    assert stored.message_files == '["f1"]'
    assert "tool1" in json.loads(stored.tool_labels_str)


def test_save_agent_thought_uses_label_fallback(
    runner: BaseAgentRunner,
    database_session: Session,
    mocker: MockerFixture,
) -> None:
    thought = _persist_thought(database_session, tool="unknown_tool")
    mocker.patch.object(module.ToolManager, "get_tool_label", return_value=None)

    runner.save_agent_thought(thought.id, None, None, None, None, None, None, [], None)

    stored = database_session.get(MessageAgentThought, thought.id)
    assert stored is not None
    assert json.loads(stored.tool_labels_str)["unknown_tool"]["en_US"] == "unknown_tool"


def test_save_agent_thought_preserves_existing_labels(
    runner: BaseAgentRunner,
    database_session: Session,
) -> None:
    thought = _persist_thought(database_session, tool="tool1")
    thought.tool_labels_str = json.dumps({"tool1": {"en_US": "existing"}})
    database_session.commit()

    runner.save_agent_thought(thought.id, None, None, None, None, None, None, [], None)

    stored = database_session.get(MessageAgentThought, thought.id)
    assert stored is not None
    assert json.loads(stored.tool_labels_str)["tool1"]["en_US"] == "existing"


def test_save_agent_thought_serialization_fallbacks(
    runner: BaseAgentRunner,
    database_session: Session,
    mocker: MockerFixture,
) -> None:
    thought = _persist_thought(database_session, tool="tool1;;")
    mocker.patch.object(module.ToolManager, "get_tool_label", return_value=None)
    tool_input = {"a": 1}
    observation = {"b": 2}
    tool_meta = {"c": 3}
    real_dumps = json.dumps

    def dumps_side_effect(value, *args, **kwargs):
        if value in (tool_input, observation, tool_meta) and kwargs.get("ensure_ascii") is False:
            raise TypeError("fail")
        return real_dumps(value, *args, **kwargs)

    mocker.patch.object(module.json, "dumps", side_effect=dumps_side_effect)

    runner.save_agent_thought(
        thought.id,
        "tool1;;",
        tool_input,
        None,
        observation,
        tool_meta,
        None,
        [],
        None,
    )

    stored = database_session.get(MessageAgentThought, thought.id)
    assert stored is not None
    assert isinstance(stored.tool_input, str)
    assert isinstance(stored.observation, str)
    assert isinstance(stored.tool_meta_str, str)
    assert "" not in json.loads(stored.tool_labels_str)


@pytest.mark.parametrize("messages_ids", [None, []])
def test_save_agent_thought_accepts_empty_message_ids(
    runner: BaseAgentRunner,
    database_session: Session,
    messages_ids: list[str] | None,
) -> None:
    thought = _persist_thought(database_session)
    runner.save_agent_thought(thought.id, None, None, None, None, "meta_string", None, messages_ids, None)  # type: ignore[arg-type]

    stored = database_session.get(MessageAgentThought, thought.id)
    assert stored is not None
    assert stored.tool_meta_str == "meta_string"


def _message_file(*, message_id: str = "m1") -> MessageFile:
    return MessageFile(
        message_id=message_id,
        type=FileType.IMAGE,
        transfer_method=FileTransferMethod.LOCAL_FILE,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="user",
        belongs_to=MessageFileBelongsTo.ASSISTANT,
        upload_file_id="upload-1",
    )


def test_organize_user_prompt_without_files(runner: BaseAgentRunner, sqlite_session: Session) -> None:
    result = runner.organize_agent_user_prompt(_message(message_id="m1"), session=sqlite_session)
    assert result.content == "hello"


def test_organize_user_prompt_with_files_but_no_config(runner: BaseAgentRunner, sqlite_session: Session) -> None:
    sqlite_session.add(_message_file())
    sqlite_session.commit()

    result = runner.organize_agent_user_prompt(_message(message_id="m1"), session=sqlite_session)

    assert result.content == "hello"


def test_organize_user_prompt_uses_file_config(
    runner: BaseAgentRunner,
    sqlite_session: Session,
    mocker: MockerFixture,
) -> None:
    config = AppModelConfig(app_id="app1")
    sqlite_session.add_all([config, _conversation(app_model_config_id=config.id), _message_file()])
    sqlite_session.commit()
    file_config = FileUploadConfig(image_config=ImageConfig(detail=None))
    mocker.patch.object(AppModelConfig, "to_dict", return_value={})
    mocker.patch.object(module.FileUploadConfigManager, "convert", return_value=file_config)
    mocker.patch.object(module.file_factory, "build_from_message_files", return_value=[])
    load_config = mocker.patch.object(module, "load_annotation_reply_config", return_value={"enabled": False})

    result = runner.organize_agent_user_prompt(
        _message(message_id="m1"),
        session=sqlite_session,
    )

    assert result.content == "hello"
    load_config.assert_called_once_with(sqlite_session, "app1")


def test_organize_user_prompt_builds_file_content(
    runner: BaseAgentRunner,
    sqlite_session: Session,
    mocker: MockerFixture,
) -> None:
    config = AppModelConfig(app_id="app1")
    sqlite_session.add_all([config, _conversation(app_model_config_id=config.id), _message_file()])
    sqlite_session.commit()
    file_config = FileUploadConfig(image_config=ImageConfig(detail=None))
    mocker.patch.object(AppModelConfig, "to_dict", return_value={})
    mocker.patch.object(module.FileUploadConfigManager, "convert", return_value=file_config)
    mocker.patch.object(module.file_factory, "build_from_message_files", return_value=["file1"])
    prompt_content = module.ImagePromptMessageContent(
        url="https://files.example/image.png",
        format="png",
        mime_type="image/png",
    )
    mocker.patch.object(module.file_manager, "to_prompt_message_content", return_value=prompt_content)
    mocker.patch.object(module, "load_annotation_reply_config", return_value={"enabled": False})

    result = runner.organize_agent_user_prompt(
        _message(message_id="m1"),
        session=sqlite_session,
    )

    assert isinstance(result.content, list)
    assert result.content[0] is prompt_content
    assert isinstance(result.content[-1], module.TextPromptMessageContent)


def test_organize_history_empty_preserves_system_prompt(runner: BaseAgentRunner, sqlite_session: Session) -> None:
    system_message = module.SystemPromptMessage(content="sys")
    result = runner.organize_agent_history([system_message], session=sqlite_session)
    assert result == [system_message]


def test_organize_history_with_answer_only(runner: BaseAgentRunner, sqlite_session: Session) -> None:
    _persist_history(sqlite_session, _message(message_id="m1", answer="answer"))
    result = runner.organize_agent_history([], session=sqlite_session)
    assert any(isinstance(item, module.AssistantPromptMessage) and item.content == "answer" for item in result)


def test_organize_history_skips_current_message(runner: BaseAgentRunner, sqlite_session: Session) -> None:
    _persist_history(sqlite_session, _message(message_id="msg_current", answer="answer"))
    result = runner.organize_agent_history([], session=sqlite_session)
    assert result == []


@pytest.mark.parametrize(
    ("tool", "tool_input", "observation"),
    [
        ("tool1", "invalid", "invalid"),
        (";", None, None),
        ("tool1", None, None),
        ("tool1;tool2", json.dumps({"tool1": {}, "tool2": {}}), json.dumps({"tool1": "o1", "tool2": "o2"})),
    ],
)
def test_organize_history_reconstructs_tool_flows(
    runner: BaseAgentRunner,
    sqlite_session: Session,
    mocker: MockerFixture,
    tool: str,
    tool_input: str | None,
    observation: str | None,
) -> None:
    message = _message(message_id="m2")
    thought = _thought(
        thought_id="thought-1",
        message_id=message.id,
        tool=tool,
        tool_input=tool_input,
        observation=observation,
    )
    _persist_history(sqlite_session, message, thoughts=[thought])
    mocker.patch("uuid.uuid4", return_value="uuid")

    result = runner.organize_agent_history([], session=sqlite_session)

    assert isinstance(result, list)
    assert any(isinstance(item, module.AssistantPromptMessage) for item in result)


def test_organize_history_without_tool_name(runner: BaseAgentRunner, sqlite_session: Session) -> None:
    message = _message(message_id="m3")
    thought = _thought(thought_id="thought-1", message_id=message.id, tool=None)
    _persist_history(sqlite_session, message, thoughts=[thought])

    result = runner.organize_agent_history([], session=sqlite_session)

    assert any(isinstance(item, module.AssistantPromptMessage) and item.content == "thinking" for item in result)


def test_convert_tool_to_prompt_message_tool(runner: BaseAgentRunner, mocker: MockerFixture) -> None:
    tool = _agent_tool("tool1")
    tool_entity = mocker.Mock(spec=Tool, entity=_tool_entity("tool1"))
    schema = {
        "type": "object",
        "properties": {"param1": {"type": "string", "description": "desc"}},
        "required": ["param1"],
    }
    tool_entity.get_llm_parameters_json_schema.return_value = schema
    mocker.patch.object(module.ToolManager, "get_agent_tool_runtime", return_value=tool_entity)

    prompt_tool, entity = runner._convert_tool_to_prompt_message_tool(tool)

    assert entity is tool_entity
    assert prompt_tool.parameters == schema


def test_convert_dataset_retriever_tool(runner: BaseAgentRunner, mocker: MockerFixture) -> None:
    dataset_tool = mocker.Mock(spec=DatasetRetrieverTool, entity=_tool_entity("ds"))
    parameter = ToolParameter(
        name="query",
        label=I18nObject(en_US="Query"),
        type=ToolParameter.ToolParameterType.STRING,
        form=ToolParameter.ToolParameterForm.LLM,
        llm_description="desc",
        required=True,
    )
    dataset_tool.get_runtime_parameters.return_value = [parameter]

    prompt = runner._convert_dataset_retriever_tool_to_prompt_message_tool(dataset_tool)

    assert prompt.name == "ds"
    assert prompt.parameters["required"] == ["query"]


def test_init_prompt_tools_adds_agent_and_dataset_tools(runner: BaseAgentRunner, mocker: MockerFixture) -> None:
    agent_tool = _agent_tool("agent_tool")
    dataset_tool = mocker.Mock(spec=DatasetRetrieverTool, entity=_tool_entity("dataset_tool"))
    runner.app_config.agent = _agent(agent_tool)
    runner.dataset_tools = [dataset_tool]
    prompt_tool = PromptMessageTool(name="tool", description="", parameters={})
    mocker.patch.object(runner, "_convert_tool_to_prompt_message_tool", return_value=(prompt_tool, "agent-entity"))
    mocker.patch.object(
        runner,
        "_convert_dataset_retriever_tool_to_prompt_message_tool",
        return_value=prompt_tool,
    )

    tools, prompts = runner._init_prompt_tools()

    assert tools == {"agent_tool": "agent-entity", "dataset_tool": dataset_tool}
    assert len(prompts) == 2


def test_init_prompt_tools_skips_deleted_agent_tool(runner: BaseAgentRunner, mocker: MockerFixture) -> None:
    agent_tool = _agent_tool("bad_tool")
    runner.app_config.agent = _agent(agent_tool)
    mocker.patch.object(runner, "_convert_tool_to_prompt_message_tool", side_effect=Exception)

    tools, prompts = runner._init_prompt_tools()

    assert tools == {}
    assert prompts == []


def test_init_uses_real_session_for_count_and_dependencies(
    sqlite_session: Session,
    mocker: MockerFixture,
) -> None:
    sqlite_session.add_all(
        [
            _thought(thought_id="thought-1", message_id="msg1"),
            _thought(thought_id="thought-2", message_id="msg1"),
            _thought(thought_id="decoy-thought", message_id="other-message"),
        ]
    )
    sqlite_session.commit()
    organize_history = mocker.patch.object(BaseAgentRunner, "organize_agent_history", return_value=[])
    get_dataset_tools = mocker.patch.object(
        module.DatasetRetrieverTool,
        "get_dataset_tools",
        return_value=["ds_tool"],
    )
    llm = mocker.Mock(spec=LargeLanguageModel)
    llm.get_model_schema.return_value = mocker.Mock(
        features=[module.ModelFeature.STREAM_TOOL_CALL, module.ModelFeature.VISION]
    )
    model_instance = mocker.Mock(
        spec=ModelInstance,
        model_type_instance=llm,
        model_name="m",
        credentials="c",
    )
    app_config = _app_config(
        dataset=DatasetEntity(
            dataset_ids=["d1"],
            retrieve_config=DatasetRetrieveConfigEntity(
                retrieve_strategy=DatasetRetrieveConfigEntity.RetrieveStrategy.MULTIPLE,
            ),
        ),
        additional_features=AppAdditionalFeatures(show_retrieve_source=True),
    )
    app_generate = _app_generate(app_config=app_config, files=["file1"])
    message = _message(message_id="msg1")

    initialized = BaseAgentRunner(
        session=sqlite_session,
        tenant_id="tenant",
        application_generate_entity=app_generate,
        conversation=_conversation(),
        app_config=app_config,
        model_config=ModelConfigWithCredentialsEntity.model_construct(),
        config=_agent(),
        queue_manager=mocker.Mock(spec=AppQueueManager),
        message=message,
        user_id="user",
        model_instance=model_instance,
    )

    assert initialized.stream_tool_call is True
    assert initialized.files == ["file1"]
    assert initialized.dataset_tools == ["ds_tool"]
    assert initialized.agent_thought_count == 2
    organize_history.assert_called_once_with(session=sqlite_session, prompt_messages=[])
    assert get_dataset_tools.call_args.kwargs["session"] is sqlite_session
