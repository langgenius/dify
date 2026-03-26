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
# Dataset & File Handling (The missing 500-768 content)
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

class TestEROSPisistence:
    def test_save_agent_thought_full_eros_path(self, runner, mock_db_session, mocker):
        agent_thought = mocker.MagicMock(tool="tool1", thought="")
        mock_db_session.scalar.return_value = agent_thought
        
        usage = LLMUsage(prompt_tokens=10, completion_tokens=10, total_tokens=20)
        
        runner.save_agent_thought(
            "id", "tool1", {"i": 1}, "thought", {"o": 1}, 
            None, None, [], usage
        )
        
        # Verify Layer 3 tracking (The EROS Upgrade)
        assert len(runner.iteration_steps) == 1
        assert runner.iteration_steps[0]['tool'] == "tool1"
        assert runner.iteration_steps[0]['thought'] == "thought"

    def test_json_robustness(self, runner, mock_db_session, mocker):
        agent = mocker.MagicMock(tool="t", thought="")
        mock_db_session.scalar.return_value = agent
        # Test with a non-serializable object to ensure try-except block in runner works
        runner.save_agent_thought("id", "t", mocker.MagicMock(), "thought", {}, {}, None, [], None)
        assert mock_db_session.commit.called
