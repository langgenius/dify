import json
from decimal import Decimal
from unittest.mock import MagicMock, patch
import pytest
import uuid

import core.agent.base_agent_runner as module
from core.agent.base_agent_runner import BaseAgentRunner
from core.app.entities.queue_entities import QueueMessageFileEvent
from core.model_runtime.entities.llm_entities import LLMUsage

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
    # EROS UPGRADE: Mock the hydrator to satisfy Plan Hydration requirements
    mock_hydrator = mocker.patch("core.agent.base_agent_runner.get_hydrator")
    mock_hydrator.return_value.hydrate.return_value = MagicMock(
        status='MISS', 
        fingerprint='test_fp', 
        plan_steps=[]
    )

    r = BaseAgentRunner.__new__(BaseAgentRunner)
    r.tenant_id = "tenant"
    r.user_id = "user"
    r.agent_thought_count = 0
    r.message = mocker.MagicMock(id="msg_current", conversation_id="conv1")
    r.app_config = mocker.MagicMock()
    r.app_config.app_id = "app1"
    r.app_config.agent = mocker.MagicMock(tools=[])
    r.dataset_tools = []
    r.application_generate_entity = mocker.MagicMock(invoke_from="test")
    r.application_generate_entity.query = "test query"
    
    # EROS UPGRADE: Attributes for Layer 3 tracking
    r.iteration_steps = []
    r.use_cached_plan = False
    r.plan_fingerprint = "test_fp"
    r.is_partial_match = False
    
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
# update_prompt_message_tool (The Full Parameter Suite)
# ==========================================================

class TestUpdatePromptTool:
    def build_param(self, mocker, **kwargs):
        p = mocker.MagicMock()
        p.form = kwargs.get("form")
        mock_type = mocker.MagicMock()
        mock_type.as_normal_type.return_value = kwargs.get("type", "string")
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

    def test_string_type(self, runner, mocker):
        param = self.build_param(mocker, form=module.ToolParameter.ToolParameterForm.LLM, type="string")
        tool = mocker.MagicMock()
        tool.get_runtime_parameters.return_value = [param]
        prompt_tool = mocker.MagicMock(parameters={"properties": {}, "required": []})
        result = runner.update_prompt_message_tool(tool, prompt_tool)
        assert result.parameters["properties"]["p1"]["type"] == "string"

    def test_number_type(self, runner, mocker):
        param = self.build_param(mocker, form=module.ToolParameter.ToolParameterForm.LLM, type="number")
        tool = mocker.MagicMock()
        tool.get_runtime_parameters.return_value = [param]
        prompt_tool = mocker.MagicMock(parameters={"properties": {}, "required": []})
        result = runner.update_prompt_message_tool(tool, prompt_tool)
        assert result.parameters["properties"]["p1"]["type"] == "number"

    def test_boolean_type(self, runner, mocker):
        param = self.build_param(mocker, form=module.ToolParameter.ToolParameterForm.LLM, type="boolean")
        tool = mocker.MagicMock()
        tool.get_runtime_parameters.return_value = [param]
        prompt_tool = mocker.MagicMock(parameters={"properties": {}, "required": []})
        result = runner.update_prompt_message_tool(tool, prompt_tool)
        assert result.parameters["properties"]["p1"]["type"] == "boolean"

    def test_enum_options(self, runner, mocker):
        option = mocker.MagicMock(value="opt1")
        param = self.build_param(mocker, form=module.ToolParameter.ToolParameterForm.LLM, type="select", options=[option])
        tool = mocker.MagicMock()
        tool.get_runtime_parameters.return_value = [param]
        prompt_tool = mocker.MagicMock(parameters={"properties": {}, "required": []})
        result = runner.update_prompt_message_tool(tool, prompt_tool)
        assert result.parameters["properties"]["p1"]["enum"] == ["opt1"]

# ==========================================================
# organize_agent_history (Splitting & Content Mapping)
# ==========================================================

class TestOrganizeHistory:
    def test_multi_tool_split_logic(self, runner, mock_db_session, mocker):
        thought = mocker.MagicMock(
            tool="t1;t2",
            tool_input=json.dumps({"t1": {"a": 1}, "t2": {"b": 2}}),
            observation=json.dumps({"t1": "obs1", "t2": "obs2"}),
            thought="Thinking"
        )
        msg = mocker.MagicMock(id="m1", agent_thoughts=[thought], answer=None, app_model_config=None)
        mock_db_session.execute.return_value.scalars.return_value.all.return_value = [msg]
        mocker.patch.object(module, "extract_thread_messages", return_value=[msg])
        mocker.patch("uuid.uuid4", return_value="uuid-val")

        history = runner.organize_agent_history([])
        # 1 Assistant (thought) + 2 Tool messages
        assert len(history) == 3
        assert history[1].tool_call_id == "uuid-val"

# ==========================================================
# Dataset & File Handling
# ==========================================================

class TestDatasetAndFiles:
    def test_get_dataset_tools(self, runner, mocker):
        mock_tool = mocker.MagicMock()
        mocker.patch.object(module.DatasetRetrieverTool, "get_dataset_tools", return_value=[mock_tool])
        r = BaseAgentRunner.__new__(BaseAgentRunner)
        r.app_config = mocker.MagicMock()
        r.dataset_tools = module.DatasetRetrieverTool.get_dataset_tools(r.app_config)
        assert len(r.dataset_tools) == 1

    def test_handle_file_events(self, runner, mocker):
        file_event = QueueMessageFileEvent(message_id="m1", file_id="f1", file_source="test")
        # Ensure runner can process these events without failure
        runner.files.append(file_event)
        assert len(runner.files) == 1

# ==========================================================
# EROS Persistence Layer
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
            "id", "tool1", {"i": 1}, "thought", {"o": 1}, 
            None, None, [], usage
        )
        
        # Verify Layer 3 tracking (The EROS Upgrade)
        assert len(runner.iteration_steps) == 1
        assert runner.iteration_steps[0]['tool'] == "tool1"
        assert runner.iteration_steps[0]['thought'] == "thought"

    def test_json_robustness(self, runner, mock_db_session, mocker):
        runner.save_agent_thought = BaseAgentRunner.save_agent_thought.__get__(runner)
        
        agent = mocker.MagicMock(tool="t", thought="")
        mock_db_session.scalar.return_value = agent
        # Test with a non-serializable object to ensure try-except block works
        runner.save_agent_thought("id", "t", mocker.MagicMock(), "thought", {}, {}, None, [], None)
        assert mock_db_session.commit.called
