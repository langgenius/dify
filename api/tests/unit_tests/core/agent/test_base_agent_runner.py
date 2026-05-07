import json
from decimal import Decimal
from unittest.mock import MagicMock

import pytest

import core.agent.base_agent_runner as module
from core.agent.base_agent_runner import BaseAgentRunner

# ==========================================================
# Fixtures
# ==========================================================


@pytest.fixture
def mock_db_session(mocker):
    session = mocker.MagicMock()
    mocker.patch.object(module.db, "session", session)
    return session


@pytest.fixture
def runner(mocker, mock_db_session):
    r = BaseAgentRunner.__new__(BaseAgentRunner)
    r.tenant_id = "tenant"
    r.user_id = "user"
    r.agent_thought_count = 0
    r.message = mocker.MagicMock(id="msg_current", conversation_id="conv1")
    r.app_config = mocker.MagicMock()
    r.app_config.app_id = "app1"
    r.app_config.agent = None
    r.dataset_tools = []
    r.application_generate_entity = mocker.MagicMock(invoke_from="test")
    r._current_thoughts = []
    return r


# ==========================================================
# _repack_app_generate_entity
# ==========================================================


class TestRepack:
    def test_sets_empty_if_none(self, runner, mocker):
        entity = mocker.MagicMock()
        entity.app_config.prompt_template.simple_prompt_template = None
        result = runner._repack_app_generate_entity(entity)
        assert result.app_config.prompt_template.simple_prompt_template == ""

    def test_keeps_existing(self, runner, mocker):
        entity = mocker.MagicMock()
        entity.app_config.prompt_template.simple_prompt_template = "abc"
        result = runner._repack_app_generate_entity(entity)
        assert result.app_config.prompt_template.simple_prompt_template == "abc"


# ==========================================================
# update_prompt_message_tool
# ==========================================================


class TestUpdatePromptTool:
    def build_param(self, mocker, **kwargs):
        p = mocker.MagicMock()
        p.form = kwargs.get("form")

        mock_type = mocker.MagicMock()
        mock_type.as_normal_type.return_value = "string"
        p.type = mock_type

        p.name = kwargs.get("name", "p1")
        p.llm_description = "desc"
        p.input_schema = kwargs.get("input_schema")
        p.options = kwargs.get("options")
        p.required = kwargs.get("required", False)
        return p

    def test_skip_non_llm(self, runner, mocker):
        tool = mocker.MagicMock()
        param = self.build_param(mocker, form="NOT_LLM")
        tool.get_runtime_parameters.return_value = [param]

        prompt_tool = mocker.MagicMock()
        prompt_tool.parameters = {"properties": {}, "required": []}

        result = runner.update_prompt_message_tool(tool, prompt_tool)
        assert result.parameters["properties"] == {}

    def test_enum_and_required(self, runner, mocker):
        option = mocker.MagicMock(value="opt1")
        param = self.build_param(
            mocker,
            form=module.ToolParameter.ToolParameterForm.LLM,
            options=[option],
            required=True,
        )

        tool = mocker.MagicMock()
        tool.get_runtime_parameters.return_value = [param]

        prompt_tool = mocker.MagicMock()
        prompt_tool.parameters = {"properties": {}, "required": []}

        result = runner.update_prompt_message_tool(tool, prompt_tool)
        assert "p1" in result.parameters["required"]

    def test_skip_file_type_param(self, runner, mocker):
        tool = mocker.MagicMock()
        param = self.build_param(mocker, form=module.ToolParameter.ToolParameterForm.LLM)
        param.type = module.ToolParameter.ToolParameterType.FILE
        tool.get_runtime_parameters.return_value = [param]

        prompt_tool = mocker.MagicMock()
        prompt_tool.parameters = {"properties": {}, "required": []}

        result = runner.update_prompt_message_tool(tool, prompt_tool)
        assert result.parameters["properties"] == {}

    def test_duplicate_required_not_duplicated(self, runner, mocker):
        tool = mocker.MagicMock()

        param = self.build_param(
            mocker,
            form=module.ToolParameter.ToolParameterForm.LLM,
            required=True,
        )

        tool.get_runtime_parameters.return_value = [param]

        prompt_tool = mocker.MagicMock()
        prompt_tool.parameters = {"properties": {}, "required": ["p1"]}

        result = runner.update_prompt_message_tool(tool, prompt_tool)

        assert result.parameters["required"].count("p1") == 1


# ==========================================================
# create_agent_thought
# ==========================================================


class TestCreateAgentThought:
    def test_with_files(self, runner, mock_db_session, mocker):
        mock_thought = mocker.MagicMock(id=10)
        mocker.patch.object(module, "MessageAgentThought", return_value=mock_thought)

        result = runner.create_agent_thought("m", "msg", "tool", "input", ["f1"])
        assert result == "10"
        assert runner.agent_thought_count == 1

    def test_without_files(self, runner, mock_db_session, mocker):
        mock_thought = mocker.MagicMock(id=11)
        mocker.patch.object(module, "MessageAgentThought", return_value=mock_thought)

        result = runner.create_agent_thought("m", "msg", "tool", "input", [])
        assert result == "11"


# ==========================================================
# save_agent_thought
# ==========================================================


class TestSaveAgentThought:
    def setup_agent(self, mocker):
        agent = mocker.MagicMock()
        agent.tool = "tool1;tool2"
        agent.tool_labels = {}
        agent.thought = ""
        return agent

    def test_not_found(self, runner, mock_db_session):
        mock_db_session.scalar.return_value = None
        with pytest.raises(ValueError):
            runner.save_agent_thought("id", None, None, None, None, None, None, [], None)

    def test_full_update(self, runner, mock_db_session, mocker):
        agent = self.setup_agent(mocker)
        mock_db_session.scalar.return_value = agent

        mock_label = mocker.MagicMock()
        mock_label.to_dict.return_value = {"en_US": "label"}
        mocker.patch.object(module.ToolManager, "get_tool_label", return_value=mock_label)

        usage = mocker.MagicMock(
            prompt_tokens=1,
            prompt_price_unit=Decimal("0.1"),
            prompt_unit_price=Decimal("0.1"),
            completion_tokens=2,
            completion_price_unit=Decimal("0.2"),
            completion_unit_price=Decimal("0.2"),
            total_tokens=3,
            total_price=Decimal("0.3"),
        )

        runner.save_agent_thought(
            "id",
            "tool1;tool2",
            {"a": 1},
            "thought",
            {"b": 2},
            {"meta": 1},
            "answer",
            ["f1"],
            usage,
        )

        assert agent.answer == "answer"
        assert agent.tokens == 3
        assert "tool1" in json.loads(agent.tool_labels_str)

    def test_label_fallback_when_none(self, runner, mock_db_session, mocker):
        agent = self.setup_agent(mocker)
        agent.tool = "unknown_tool"
        mock_db_session.scalar.return_value = agent
        mocker.patch.object(module.ToolManager, "get_tool_label", return_value=None)

        runner.save_agent_thought("id", None, None, None, None, None, None, [], None)
        labels = json.loads(agent.tool_labels_str)
        assert "unknown_tool" in labels

    def test_json_failure_paths(self, runner, mock_db_session, mocker):
        agent = self.setup_agent(mocker)
        mock_db_session.scalar.return_value = agent

        bad_obj = MagicMock()
        bad_obj.__str__.return_value = "bad"

        runner.save_agent_thought(
            "id",
            None,
            bad_obj,
            None,
            bad_obj,
            bad_obj,
            None,
            [],
            None,
        )

        assert mock_db_session.commit.called

    def test_messages_ids_none(self, runner, mock_db_session, mocker):
        agent = self.setup_agent(mocker)
        mock_db_session.scalar.return_value = agent
        runner.save_agent_thought("id", None, None, None, None, None, None, None, None)
        assert mock_db_session.commit.called

    def test_success_dict_serialization(self, runner, mock_db_session, mocker):
        agent = self.setup_agent(mocker)
        mock_db_session.scalar.return_value = agent

        runner.save_agent_thought(
            "id",
            None,
            {"a": 1},
            None,
            {"b": 2},
            None,
            None,
            [],
            None,
        )

        assert isinstance(agent.tool_input, str)
        assert isinstance(agent.observation, str)


# ==========================================================
# organize_agent_user_prompt
# ==========================================================


class TestOrganizeUserPrompt:
    def test_no_files(self, runner, mock_db_session, mocker):
        mock_db_session.scalars.return_value.all.return_value = []
        msg = mocker.MagicMock(id="1", query="hello", app_model_config=None)
        result = runner.organize_agent_user_prompt(msg)
        assert result.content == "hello"

    def test_with_files_no_config(self, runner, mock_db_session, mocker):
        mock_db_session.scalars.return_value.all.return_value = [mocker.MagicMock()]
        msg = mocker.MagicMock(id="1", query="hello", app_model_config=None)
        result = runner.organize_agent_user_prompt(msg)
        assert result.content == "hello"

    def test_image_detail_low_fallback(self, runner, mock_db_session, mocker):
        mock_db_session.scalars.return_value.all.return_value = [mocker.MagicMock()]
        file_config = mocker.MagicMock()
        file_config.image_config = mocker.MagicMock(detail=None)
        mocker.patch.object(module.FileUploadConfigManager, "convert", return_value=file_config)
        mocker.patch.object(module.file_factory, "build_from_message_files", return_value=[])

        msg = mocker.MagicMock(id="1", query="hello")
        msg.app_model_config.to_dict.return_value = {}

        result = runner.organize_agent_user_prompt(msg)
        assert result.content == "hello"


# ==========================================================
# organize_agent_history
# ==========================================================


class TestOrganizeHistory:
    def test_empty(self, runner, mock_db_session, mocker):
        mock_db_session.execute.return_value.scalars.return_value.all.return_value = []
        mocker.patch.object(module, "extract_thread_messages", return_value=[])
        result = runner.organize_agent_history([])
        assert result == []

    def test_with_answer_only(self, runner, mock_db_session, mocker):
        msg = mocker.MagicMock(id="m1", answer="ans", agent_thoughts=[], app_model_config=None)
        mock_db_session.execute.return_value.scalars.return_value.all.return_value = [msg]
        mocker.patch.object(module, "extract_thread_messages", return_value=[msg])
        result = runner.organize_agent_history([])
        assert any(isinstance(x, module.AssistantPromptMessage) for x in result)

    def test_skip_current_message(self, runner, mock_db_session, mocker):
        msg = mocker.MagicMock(id="msg_current", agent_thoughts=[], answer="ans", app_model_config=None)
        mock_db_session.execute.return_value.scalars.return_value.all.return_value = [msg]
        mocker.patch.object(module, "extract_thread_messages", return_value=[msg])
        result = runner.organize_agent_history([])
        assert result == []

    def test_with_tool_calls_invalid_json(self, runner, mock_db_session, mocker):
        thought = mocker.MagicMock(
            tool="tool1",
            tool_input="invalid",
            observation="invalid",
            thought="thinking",
        )
        msg = mocker.MagicMock(id="m2", agent_thoughts=[thought], answer=None, app_model_config=None)

        mock_db_session.execute.return_value.scalars.return_value.all.return_value = [msg]
        mocker.patch.object(module, "extract_thread_messages", return_value=[msg])
        mocker.patch("uuid.uuid4", return_value="uuid")

        result = runner.organize_agent_history([])
        assert isinstance(result, list)

    def test_empty_tool_name_split(self, runner, mock_db_session, mocker):
        thought = mocker.MagicMock(tool=";", thought="thinking")
        msg = mocker.MagicMock(id="m5", agent_thoughts=[thought], answer=None, app_model_config=None)

        mock_db_session.execute.return_value.scalars.return_value.all.return_value = [msg]
        mocker.patch.object(module, "extract_thread_messages", return_value=[msg])
        result = runner.organize_agent_history([])
        assert isinstance(result, list)

    def test_valid_json_tool_flow(self, runner, mock_db_session, mocker):
        thought = mocker.MagicMock(
            tool="tool1",
            tool_input=json.dumps({"tool1": {"x": 1}}),
            observation=json.dumps({"tool1": "obs"}),
            thought="thinking",
        )

        msg = mocker.MagicMock(
            id="m100",
            agent_thoughts=[thought],
            answer=None,
            app_model_config=None,
        )

        mock_db_session.execute.return_value.scalars.return_value.all.return_value = [msg]
        mocker.patch.object(module, "extract_thread_messages", return_value=[msg])
        mocker.patch("uuid.uuid4", return_value="uuid")

        result = runner.organize_agent_history([])
        assert isinstance(result, list)


# ==========================================================
# _convert_tool_to_prompt_message_tool (new coverage)
# ==========================================================


class TestConvertToolToPromptMessageTool:
    def test_basic_conversion(self, runner, mocker):
        tool = mocker.MagicMock(tool_name="tool1")

        runtime_param = mocker.MagicMock()
        runtime_param.form = module.ToolParameter.ToolParameterForm.LLM
        runtime_param.name = "param1"
        runtime_param.llm_description = "desc"
        runtime_param.required = True
        runtime_param.input_schema = None
        runtime_param.options = None

        mock_type = mocker.MagicMock()
        mock_type.as_normal_type.return_value = "string"
        runtime_param.type = mock_type

        tool_entity = mocker.MagicMock()
        tool_entity.entity.description.llm = "desc"
        tool_entity.get_merged_runtime_parameters.return_value = [runtime_param]

        mocker.patch.object(module.ToolManager, "get_agent_tool_runtime", return_value=tool_entity)
        mocker.patch.object(module, "PromptMessageTool", side_effect=lambda **kw: MagicMock(**kw))

        prompt_tool, entity = runner._convert_tool_to_prompt_message_tool(tool)
        assert entity == tool_entity

    def test_full_conversion_multiple_params(self, runner, mocker):
        tool = mocker.MagicMock(tool_name="tool1")

        # LLM param with input_schema override
        param1 = mocker.MagicMock()
        param1.form = module.ToolParameter.ToolParameterForm.LLM
        param1.name = "p1"
        param1.llm_description = "desc"
        param1.required = True
        param1.input_schema = {"type": "integer"}
        param1.options = None
        param1.type = mocker.MagicMock()

        # SYSTEM_FILES param should be skipped
        param2 = mocker.MagicMock()
        param2.form = module.ToolParameter.ToolParameterForm.LLM
        param2.name = "file_param"
        param2.type = module.ToolParameter.ToolParameterType.SYSTEM_FILES

        tool_entity = mocker.MagicMock()
        tool_entity.entity.description.llm = "desc"
        tool_entity.get_merged_runtime_parameters.return_value = [param1, param2]

        mocker.patch.object(module.ToolManager, "get_agent_tool_runtime", return_value=tool_entity)
        mocker.patch.object(module, "PromptMessageTool", side_effect=lambda **kw: MagicMock(**kw))

        prompt_tool, entity = runner._convert_tool_to_prompt_message_tool(tool)

        assert entity == tool_entity


# ==========================================================
# _init_prompt_tools additional branches
# ==========================================================


class TestInitPromptToolsExtended:
    def test_agent_tool_branch(self, runner, mocker):
        agent_tool = mocker.MagicMock(tool_name="agent_tool")
        runner.app_config.agent = mocker.MagicMock(tools=[agent_tool])
        mocker.patch.object(runner, "_convert_tool_to_prompt_message_tool", return_value=(MagicMock(), "entity"))

        tools, prompts = runner._init_prompt_tools()
        assert "agent_tool" in tools

    def test_exception_in_conversion(self, runner, mocker):
        agent_tool = mocker.MagicMock(tool_name="bad_tool")
        runner.app_config.agent = mocker.MagicMock(tools=[agent_tool])
        mocker.patch.object(runner, "_convert_tool_to_prompt_message_tool", side_effect=Exception)

        tools, prompts = runner._init_prompt_tools()
        assert tools == {}


# ==========================================================
# Additional Coverage Tests (DO NOT MODIFY EXISTING TESTS)
# ==========================================================


class TestAdditionalCoverage:
    def test_update_prompt_with_input_schema(self, runner, mocker):
        tool = mocker.MagicMock()

        param = mocker.MagicMock()
        param.form = module.ToolParameter.ToolParameterForm.LLM
        param.name = "p1"
        param.required = False
        param.llm_description = "desc"
        param.options = None
        param.input_schema = {"type": "number"}

        mock_type = mocker.MagicMock()
        mock_type.as_normal_type.return_value = "string"
        param.type = mock_type

        tool.get_runtime_parameters.return_value = [param]

        prompt_tool = mocker.MagicMock()
        prompt_tool.parameters = {"properties": {}, "required": []}

        result = runner.update_prompt_message_tool(tool, prompt_tool)
        assert result.parameters["properties"]["p1"]["type"] == "number"

    def test_save_agent_thought_existing_labels(self, runner, mock_db_session, mocker):
        agent = mocker.MagicMock()
        agent.tool = "tool1"
        agent.tool_labels = {"tool1": {"en_US": "existing"}}
        agent.thought = ""
        mock_db_session.scalar.return_value = agent

        runner.save_agent_thought("id", None, None, None, None, None, None, [], None)
        labels = json.loads(agent.tool_labels_str)
        assert labels["tool1"]["en_US"] == "existing"

    def test_save_agent_thought_tool_meta_string(self, runner, mock_db_session, mocker):
        agent = mocker.MagicMock()
        agent.tool = "tool1"
        agent.tool_labels = {}
        agent.thought = ""
        mock_db_session.scalar.return_value = agent

        runner.save_agent_thought("id", None, None, None, None, "meta_string", None, [], None)
        assert agent.tool_meta_str == "meta_string"

    def test_convert_dataset_retriever_tool(self, runner, mocker):
        ds_tool = mocker.MagicMock()
        ds_tool.entity.identity.name = "ds"
        ds_tool.entity.description.llm = "desc"

        param = mocker.MagicMock()
        param.name = "query"
        param.llm_description = "desc"
        param.required = True

        ds_tool.get_runtime_parameters.return_value = [param]

        mocker.patch.object(module, "PromptMessageTool", side_effect=lambda **kw: MagicMock(**kw))

        prompt = runner._convert_dataset_retriever_tool_to_prompt_message_tool(ds_tool)
        assert prompt is not None

    def test_organize_user_prompt_with_file_objects(self, runner, mock_db_session, mocker):
        mock_db_session.scalars.return_value.all.return_value = [mocker.MagicMock()]

        file_config = mocker.MagicMock()
        file_config.image_config = mocker.MagicMock(detail=None)

        mocker.patch.object(module.FileUploadConfigManager, "convert", return_value=file_config)
        mocker.patch.object(module.file_factory, "build_from_message_files", return_value=["file1"])
        mocker.patch.object(module.file_manager, "to_prompt_message_content", return_value=mocker.MagicMock())

        mocker.patch.object(module, "UserPromptMessage", side_effect=lambda **kw: MagicMock(**kw))
        mocker.patch.object(module, "TextPromptMessageContent", side_effect=lambda **kw: MagicMock(**kw))

        msg = mocker.MagicMock(id="1", query="hello")
        msg.app_model_config.to_dict.return_value = {}

        result = runner.organize_agent_user_prompt(msg)
        assert result is not None

    def test_organize_history_without_tool_names(self, runner, mock_db_session, mocker):
        thought = mocker.MagicMock(tool=None, thought="thinking")
        msg = mocker.MagicMock(id="m3", agent_thoughts=[thought], answer=None, app_model_config=None)

        mock_db_session.execute.return_value.scalars.return_value.all.return_value = [msg]
        mocker.patch.object(module, "extract_thread_messages", return_value=[msg])

        result = runner.organize_agent_history([])
        assert isinstance(result, list)

    def test_organize_history_multiple_tools_split(self, runner, mock_db_session, mocker):
        thought = mocker.MagicMock(
            tool="tool1;tool2",
            tool_input=json.dumps({"tool1": {}, "tool2": {}}),
            observation=json.dumps({"tool1": "o1", "tool2": "o2"}),
            thought="thinking",
        )
        msg = mocker.MagicMock(id="m4", agent_thoughts=[thought], answer=None, app_model_config=None)

        mock_db_session.execute.return_value.scalars.return_value.all.return_value = [msg]
        mocker.patch.object(module, "extract_thread_messages", return_value=[msg])
        mocker.patch("uuid.uuid4", return_value="uuid")

        result = runner.organize_agent_history([])
        assert isinstance(result, list)

    # ================= Additional Surgical Coverage =================

    def test_convert_tool_select_enum_branch(self, runner, mocker):
        tool = mocker.MagicMock(tool_name="tool1")

        param = mocker.MagicMock()
        param.form = module.ToolParameter.ToolParameterForm.LLM
        param.name = "select_param"
        param.required = True
        param.llm_description = "desc"
        param.input_schema = None

        option1 = mocker.MagicMock(value="A")
        option2 = mocker.MagicMock(value="B")
        param.options = [option1, option2]
        param.type = module.ToolParameter.ToolParameterType.SELECT

        tool_entity = mocker.MagicMock()
        tool_entity.entity.description.llm = "desc"
        tool_entity.get_merged_runtime_parameters.return_value = [param]

        mocker.patch.object(module.ToolManager, "get_agent_tool_runtime", return_value=tool_entity)
        mocker.patch.object(module, "PromptMessageTool", side_effect=lambda **kw: MagicMock(**kw))

        prompt_tool, _ = runner._convert_tool_to_prompt_message_tool(tool)
        assert prompt_tool is not None


class TestConvertDatasetRetrieverTool:
    def test_required_param_added(self, runner, mocker):
        ds_tool = mocker.MagicMock()
        ds_tool.entity.identity.name = "ds"
        ds_tool.entity.description.llm = "desc"

        param = mocker.MagicMock()
        param.name = "query"
        param.llm_description = "desc"
        param.required = True

        ds_tool.get_runtime_parameters.return_value = [param]

        mocker.patch.object(module, "PromptMessageTool", side_effect=lambda **kw: MagicMock(**kw))

        prompt = runner._convert_dataset_retriever_tool_to_prompt_message_tool(ds_tool)

        assert prompt is not None


class TestBaseAgentRunnerInit:
    def test_init_sets_stream_tool_call_and_files(self, mocker):
        session = mocker.MagicMock()
        session.scalar.return_value = 2
        mocker.patch.object(module.db, "session", session)

        mocker.patch.object(BaseAgentRunner, "organize_agent_history", return_value=[])
        mocker.patch.object(module.DatasetRetrieverTool, "get_dataset_tools", return_value=["ds_tool"])

        llm = mocker.MagicMock()
        llm.get_model_schema.return_value = mocker.MagicMock(
            features=[module.ModelFeature.STREAM_TOOL_CALL, module.ModelFeature.VISION]
        )
        model_instance = mocker.MagicMock(model_type_instance=llm, model="m", credentials="c")

        app_config = mocker.MagicMock()
        app_config.app_id = "app1"
        app_config.agent = None
        app_config.dataset = mocker.MagicMock(dataset_ids=["d1"], retrieve_config={"k": "v"})
        app_config.additional_features = mocker.MagicMock(show_retrieve_source=True)

        app_generate = mocker.MagicMock(invoke_from="test", inputs={}, files=["file1"])
        message = mocker.MagicMock(id="msg1", conversation_id="conv1")

        runner = BaseAgentRunner(
            tenant_id="tenant",
            application_generate_entity=app_generate,
            conversation=mocker.MagicMock(),
            app_config=app_config,
            model_config=mocker.MagicMock(),
            config=mocker.MagicMock(),
            queue_manager=mocker.MagicMock(),
            message=message,
            user_id="user",
            model_instance=model_instance,
        )

        assert runner.stream_tool_call is True
        assert runner.files == ["file1"]
        assert runner.dataset_tools == ["ds_tool"]
        assert runner.agent_thought_count == 2


class TestBaseAgentRunnerCoverage:
    def test_convert_tool_skips_non_llm_param(self, runner, mocker):
        tool = mocker.MagicMock(tool_name="tool1")

        param = mocker.MagicMock()
        param.form = "NOT_LLM"
        param.type = mocker.MagicMock()

        tool_entity = mocker.MagicMock()
        tool_entity.entity.description.llm = "desc"
        tool_entity.get_merged_runtime_parameters.return_value = [param]

        mocker.patch.object(module.ToolManager, "get_agent_tool_runtime", return_value=tool_entity)
        mocker.patch.object(module, "PromptMessageTool", side_effect=lambda **kw: MagicMock(**kw))

        prompt_tool, _ = runner._convert_tool_to_prompt_message_tool(tool)

        assert prompt_tool.parameters["properties"] == {}

    def test_init_prompt_tools_adds_dataset_tools(self, runner, mocker):
        dataset_tool = mocker.MagicMock()
        dataset_tool.entity.identity.name = "ds"
        runner.dataset_tools = [dataset_tool]

        mocker.patch.object(runner, "_convert_dataset_retriever_tool_to_prompt_message_tool", return_value=MagicMock())

        tools, prompt_tools = runner._init_prompt_tools()

        assert tools["ds"] == dataset_tool
        assert len(prompt_tools) == 1

    def test_update_prompt_message_tool_select_enum(self, runner, mocker):
        tool = mocker.MagicMock()

        option1 = mocker.MagicMock(value="A")
        option2 = mocker.MagicMock(value="B")

        param = mocker.MagicMock()
        param.form = module.ToolParameter.ToolParameterForm.LLM
        param.name = "select_param"
        param.required = False
        param.llm_description = "desc"
        param.input_schema = None
        param.options = [option1, option2]
        param.type = module.ToolParameter.ToolParameterType.SELECT

        tool.get_runtime_parameters.return_value = [param]

        prompt_tool = mocker.MagicMock()
        prompt_tool.parameters = {"properties": {}, "required": []}

        result = runner.update_prompt_message_tool(tool, prompt_tool)

        assert result.parameters["properties"]["select_param"]["enum"] == ["A", "B"]

    def test_save_agent_thought_json_dumps_fallbacks(self, runner, mock_db_session, mocker):
        agent = mocker.MagicMock()
        agent.tool = "tool1"
        agent.tool_labels = {}
        agent.thought = ""
        mock_db_session.scalar.return_value = agent

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
            "id",
            "tool1",
            tool_input,
            None,
            observation,
            tool_meta,
            None,
            [],
            None,
        )

        assert isinstance(agent.tool_input, str)
        assert isinstance(agent.observation, str)
        assert isinstance(agent.tool_meta_str, str)

    def test_save_agent_thought_skips_empty_tool_name(self, runner, mock_db_session, mocker):
        agent = mocker.MagicMock()
        agent.tool = "tool1;;"
        agent.tool_labels = {}
        agent.thought = ""
        mock_db_session.scalar.return_value = agent

        mocker.patch.object(module.ToolManager, "get_tool_label", return_value=None)

        runner.save_agent_thought("id", None, None, None, None, None, None, [], None)

        labels = json.loads(agent.tool_labels_str)
        assert "" not in labels

    def test_organize_history_includes_system_prompt(self, runner, mock_db_session, mocker):
        mock_db_session.execute.return_value.scalars.return_value.all.return_value = []
        mocker.patch.object(module, "extract_thread_messages", return_value=[])

        system_message = module.SystemPromptMessage(content="sys")

        result = runner.organize_agent_history([system_message])

        assert system_message in result

    def test_organize_history_tool_inputs_and_observation_none(self, runner, mock_db_session, mocker):
        thought = mocker.MagicMock(
            tool="tool1",
            tool_input=None,
            observation=None,
            thought="thinking",
        )
        msg = mocker.MagicMock(id="m6", agent_thoughts=[thought], answer=None, app_model_config=None)

        mock_db_session.execute.return_value.scalars.return_value.all.return_value = [msg]
        mocker.patch.object(module, "extract_thread_messages", return_value=[msg])
        mocker.patch("uuid.uuid4", return_value="uuid")

        mocker.patch.object(
            runner,
            "organize_agent_user_prompt",
            return_value=module.UserPromptMessage(content="user"),
        )

        result = runner.organize_agent_history([])

        assert any(isinstance(item, module.ToolPromptMessage) for item in result)
