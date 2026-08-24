"""Tests for LLM generation and database-backed instruction modification."""

import json
from collections.abc import Iterator
from datetime import datetime
from decimal import Decimal
from unittest.mock import MagicMock, Mock, patch
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session, scoped_session, sessionmaker

from core.app.app_config.entities import ModelConfig
from core.llm_generator import llm_generator as llm_generator_module
from core.llm_generator.entities import RuleCodeGeneratePayload, RuleGeneratePayload, RuleStructuredOutputPayload
from core.llm_generator.llm_generator import LLMGenerator
from core.model_manager import ModelInstance, ModelManager
from graphon.enums import WorkflowNodeExecutionStatus
from graphon.model_runtime.entities.llm_entities import LLMMode, LLMResult, LLMUsage
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage
from graphon.model_runtime.entities.model_entities import ModelType
from graphon.model_runtime.errors.invoke import InvokeAuthorizationError, InvokeError
from models.enums import ConversationFromSource, CreatorUserRole
from models.model import App, AppMode, Message
from models.workflow import (
    Workflow,
    WorkflowNodeExecutionModel,
    WorkflowNodeExecutionTriggeredFrom,
)
from services.workflow_service import WorkflowService


@pytest.fixture
def database(sqlite_session: Session, monkeypatch: pytest.MonkeyPatch) -> Iterator[Session]:
    """Bind the shared SQLite session to the generator's scoped-session interface."""

    registry = scoped_session(lambda: sqlite_session)
    monkeypatch.setattr(llm_generator_module.db, "session", registry)
    try:
        yield sqlite_session
    finally:
        registry.remove()


@pytest.fixture
def recording_model_instance(monkeypatch: pytest.MonkeyPatch) -> Mock:
    model_instance = Mock(spec=ModelInstance)
    model_instance.invoke_llm.return_value = _llm_result('{"modified": "workflow"}')
    model_manager = Mock(spec=ModelManager)
    model_manager.get_model_instance.return_value = model_instance
    monkeypatch.setattr(
        llm_generator_module.ModelManager,
        "for_tenant",
        Mock(return_value=model_manager),
    )
    return model_instance


def _llm_result(content: str) -> LLMResult:
    return LLMResult(
        model="test-model",
        message=AssistantPromptMessage(content=content),
        usage=LLMUsage.empty_usage(),
    )


def _persist_app(database: Session, *, tenant_id: str | None = None) -> App:
    app = App(
        id=str(uuid4()),
        tenant_id=tenant_id or str(uuid4()),
        name="Generator app",
        description="",
        mode=AppMode.WORKFLOW,
        icon_type=None,
        icon="",
        icon_background=None,
        enable_site=True,
        enable_api=True,
    )
    database.add(app)
    database.commit()
    return app


def _persist_message(
    database: Session,
    app: App,
    *,
    query: str = "q",
    answer: str = "a",
    created_at: datetime | None = None,
) -> Message:
    message = Message(
        id=str(uuid4()),
        app_id=app.id,
        conversation_id=str(uuid4()),
        _inputs={},
        query=query,
        message={},
        message_unit_price=Decimal(0),
        answer=answer,
        answer_unit_price=Decimal(0),
        currency="USD",
        from_source=ConversationFromSource.API,
        error="e",
        created_at=created_at,
    )
    database.add(message)
    database.commit()
    return message


def _persist_workflow(database: Session, app: App, *, node_type: str | None) -> Workflow:
    nodes = [] if node_type is None else [{"id": "node", "data": {"type": node_type}}]
    workflow = Workflow.new(
        tenant_id=app.tenant_id,
        app_id=app.id,
        type="workflow",
        version=Workflow.VERSION_DRAFT,
        graph=json.dumps({"graph": {"nodes": nodes}}),
        features="{}",
        created_by=str(uuid4()),
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )
    database.add(workflow)
    database.commit()
    return workflow


def _persist_node_execution(
    database: Session,
    app: App,
    workflow: Workflow,
    *,
    agent_log: list[dict[str, object]],
    inputs: dict[str, object] | None = None,
) -> WorkflowNodeExecutionModel:
    execution = WorkflowNodeExecutionModel(
        id=str(uuid4()),
        tenant_id=app.tenant_id,
        app_id=app.id,
        workflow_id=workflow.id,
        triggered_from=WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP,
        workflow_run_id=None,
        index=1,
        predecessor_node_id=None,
        node_execution_id=str(uuid4()),
        node_id="node",
        node_type="llm",
        title="LLM",
        inputs=json.dumps(inputs or {}),
        process_data=None,
        outputs=None,
        status=WorkflowNodeExecutionStatus.SUCCEEDED,
        error="",
        elapsed_time=0.1,
        execution_metadata=json.dumps({"agent_log": agent_log}),
        created_at=datetime(2026, 1, 1),
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=str(uuid4()),
        finished_at=datetime(2026, 1, 1),
    )
    database.add(execution)
    database.commit()
    return execution


class TestLLMGenerator:
    @pytest.fixture
    def mock_model_instance(self):
        with patch("core.llm_generator.llm_generator.ModelManager.for_tenant") as mock_manager:
            instance = MagicMock()
            mock_manager.return_value.get_default_model_instance.return_value = instance
            mock_manager.return_value.get_model_instance.return_value = instance
            yield instance

    @pytest.fixture
    def model_config_entity(self):
        return ModelConfig(provider="openai", name="gpt-4", mode=LLMMode.CHAT, completion_params={"temperature": 0.7})

    def test_generate_conversation_name_success(self, mock_model_instance):
        mock_response = MagicMock()
        mock_response.message.get_text_content.return_value = json.dumps({"Your Output": "Test Conversation Name"})
        mock_model_instance.invoke_llm.return_value = mock_response

        with patch("core.llm_generator.llm_generator.TraceQueueManager") as mock_trace:
            name = LLMGenerator.generate_conversation_name(
                "tenant_id", "test query", "conversation-1", "app-1", message_id="message-1"
            )
            assert name == "Test Conversation Name"
            mock_trace.assert_called_once_with(app_id="app-1")
            trace_task = mock_trace.return_value.add_trace_task.call_args.args[0]
            assert trace_task.message_id == "message-1"

    def test_generate_conversation_name_truncated(self, mock_model_instance):
        long_query = "a" * 2100
        mock_response = MagicMock()
        mock_response.message.get_text_content.return_value = json.dumps({"Your Output": "Short Name"})
        mock_model_instance.invoke_llm.return_value = mock_response

        with patch("core.llm_generator.llm_generator.TraceQueueManager"):
            name = LLMGenerator.generate_conversation_name("tenant_id", long_query)
            assert name == "Short Name"

    def test_generate_conversation_name_empty_answer(self, mock_model_instance):
        mock_response = MagicMock()
        mock_response.message.get_text_content.return_value = ""
        mock_model_instance.invoke_llm.return_value = mock_response

        name = LLMGenerator.generate_conversation_name("tenant_id", "test query")
        assert name == "test query"

    def test_generate_conversation_name_json_repair(self, mock_model_instance):
        mock_response = MagicMock()
        # Invalid JSON that json_repair can fix
        mock_response.message.get_text_content.return_value = "{'Your Output': 'Repaired Name'}"
        mock_model_instance.invoke_llm.return_value = mock_response

        with patch("core.llm_generator.llm_generator.TraceQueueManager"):
            name = LLMGenerator.generate_conversation_name("tenant_id", "test query")
            assert name == "Repaired Name"

    def test_generate_conversation_name_not_dict_result(self, mock_model_instance):
        mock_response = MagicMock()
        mock_response.message.get_text_content.return_value = '["not a dict"]'
        mock_model_instance.invoke_llm.return_value = mock_response
        with patch("core.llm_generator.llm_generator.TraceQueueManager"):
            name = LLMGenerator.generate_conversation_name("tenant_id", "test query")
            assert name == "test query"

    def test_generate_conversation_name_no_output_in_dict(self, mock_model_instance):
        mock_response = MagicMock()
        mock_response.message.get_text_content.return_value = '{"something": "else"}'
        mock_model_instance.invoke_llm.return_value = mock_response
        with patch("core.llm_generator.llm_generator.TraceQueueManager"):
            name = LLMGenerator.generate_conversation_name("tenant_id", "test query")
            assert name == "test query"

    def test_generate_conversation_name_long_output(self, mock_model_instance):
        long_output = "a" * 100
        mock_response = MagicMock()
        mock_response.message.get_text_content.return_value = json.dumps({"Your Output": long_output})
        mock_model_instance.invoke_llm.return_value = mock_response

        with patch("core.llm_generator.llm_generator.TraceQueueManager"):
            name = LLMGenerator.generate_conversation_name("tenant_id", "test query")
            assert len(name) == 78  # 75 + "..."
            assert name.endswith("...")

    def test_generate_suggested_questions_after_answer_success(self, mock_model_instance):
        mock_response = MagicMock()
        mock_response.message.get_text_content.return_value = '["Question 1?", "Question 2?"]'
        mock_model_instance.invoke_llm.return_value = mock_response

        questions = LLMGenerator.generate_suggested_questions_after_answer("tenant_id", "histories")
        assert len(questions) == 2
        assert questions[0] == "Question 1?"
        assert mock_model_instance.invoke_llm.call_args.kwargs["model_parameters"] == {
            "max_tokens": 2560,
            "temperature": 0.0,
        }

    def test_generate_suggested_questions_after_answer_auth_error(self, mock_model_instance):
        with patch("core.llm_generator.llm_generator.ModelManager.for_tenant") as mock_manager:
            mock_manager.return_value.get_default_model_instance.side_effect = InvokeAuthorizationError("Auth failed")
            questions = LLMGenerator.generate_suggested_questions_after_answer("tenant_id", "histories")
            assert questions == []

    def test_generate_suggested_questions_after_answer_invoke_error(self, mock_model_instance):
        mock_model_instance.invoke_llm.side_effect = InvokeError("Invoke failed")
        questions = LLMGenerator.generate_suggested_questions_after_answer("tenant_id", "histories")
        assert questions == []

    def test_generate_suggested_questions_after_answer_exception(self, mock_model_instance):
        mock_model_instance.invoke_llm.side_effect = Exception("Random error")
        questions = LLMGenerator.generate_suggested_questions_after_answer("tenant_id", "histories")
        assert questions == []

    @patch("core.llm_generator.llm_generator.ModelManager.for_tenant")
    def test_generate_suggested_questions_after_answer_with_custom_model_and_prompt(self, mock_for_tenant):
        custom_model_instance = MagicMock()
        custom_response = MagicMock()
        custom_response.message.get_text_content.return_value = '["Question 1?"]'
        custom_model_instance.invoke_llm.return_value = custom_response

        mock_for_tenant.return_value.get_model_instance.return_value = custom_model_instance

        questions = LLMGenerator.generate_suggested_questions_after_answer(
            "tenant_id",
            "histories",
            instruction_prompt="custom prompt",
            model_config={
                "provider": "openai",
                "name": "gpt-4o",
                "completion_params": {"temperature": 0.2},
            },
        )

        assert questions == ["Question 1?"]
        mock_for_tenant.return_value.get_model_instance.assert_called_once_with(
            tenant_id="tenant_id",
            model_type=ModelType.LLM,
            provider="openai",
            model="gpt-4o",
        )

        invoke_kwargs = custom_model_instance.invoke_llm.call_args.kwargs
        assert invoke_kwargs["model_parameters"] == {"temperature": 0.2}
        assert invoke_kwargs["stop"] == []
        assert "custom prompt" in invoke_kwargs["prompt_messages"][0].content

    @patch("core.llm_generator.llm_generator.ModelManager.for_tenant")
    def test_generate_suggested_questions_after_answer_fallback_to_default_model(self, mock_for_tenant):
        default_model_instance = MagicMock()
        default_response = MagicMock()
        default_response.message.get_text_content.return_value = '["Question 1?"]'
        default_model_instance.invoke_llm.return_value = default_response

        mock_for_tenant.return_value.get_model_instance.side_effect = ValueError("invalid configured model")
        mock_for_tenant.return_value.get_default_model_instance.return_value = default_model_instance

        questions = LLMGenerator.generate_suggested_questions_after_answer(
            "tenant_id",
            "histories",
            model_config={
                "provider": "openai",
                "name": "not-found-model",
                "completion_params": {"temperature": 0.2},
            },
        )

        assert questions == ["Question 1?"]
        mock_for_tenant.return_value.get_default_model_instance.assert_called_once_with(
            tenant_id="tenant_id",
            model_type=ModelType.LLM,
        )
        assert default_model_instance.invoke_llm.call_args.kwargs["model_parameters"] == {
            "max_tokens": 2560,
            "temperature": 0.0,
        }
        assert default_model_instance.invoke_llm.call_args.kwargs["stop"] == []

    @patch("core.llm_generator.llm_generator.ModelManager.for_tenant")
    def test_generate_suggested_questions_after_answer_drops_non_positive_max_tokens(self, mock_for_tenant):
        custom_model_instance = MagicMock()
        custom_response = MagicMock()
        custom_response.message.get_text_content.return_value = '["Question 1?"]'
        custom_model_instance.invoke_llm.return_value = custom_response
        mock_for_tenant.return_value.get_model_instance.return_value = custom_model_instance

        questions = LLMGenerator.generate_suggested_questions_after_answer(
            "tenant_id",
            "histories",
            model_config={
                "provider": "openai",
                "name": "gpt-4o",
                "completion_params": {
                    "temperature": 0.2,
                    "max_tokens": 0,
                    "stop": ["END"],
                },
            },
        )

        assert questions == ["Question 1?"]
        invoke_kwargs = custom_model_instance.invoke_llm.call_args.kwargs
        assert invoke_kwargs["model_parameters"] == {"temperature": 0.2}
        assert invoke_kwargs["stop"] == ["END"]

    def test_generate_rule_config_no_variable_success(self, mock_model_instance, model_config_entity):
        payload = RuleGeneratePayload(
            instruction="test instruction", model_config=model_config_entity, no_variable=True
        )
        mock_response = MagicMock()
        mock_response.message.get_text_content.return_value = "Generated Prompt"
        mock_model_instance.invoke_llm.return_value = mock_response

        result = LLMGenerator.generate_rule_config("tenant_id", payload)
        assert result["prompt"] == "Generated Prompt"
        assert result["error"] == ""

    def test_generate_rule_config_no_variable_invoke_error(self, mock_model_instance, model_config_entity):
        payload = RuleGeneratePayload(
            instruction="test instruction", model_config=model_config_entity, no_variable=True
        )
        mock_model_instance.invoke_llm.side_effect = InvokeError("Invoke failed")

        result = LLMGenerator.generate_rule_config("tenant_id", payload)
        assert "Failed to generate rule config" in result["error"]

    def test_generate_rule_config_no_variable_exception(self, mock_model_instance, model_config_entity):
        payload = RuleGeneratePayload(
            instruction="test instruction", model_config=model_config_entity, no_variable=True
        )
        mock_model_instance.invoke_llm.side_effect = Exception("Random error")

        result = LLMGenerator.generate_rule_config("tenant_id", payload)
        assert "Failed to generate rule config" in result["error"]
        assert "Random error" in result["error"]

    def test_generate_rule_config_with_variable_success(self, mock_model_instance, model_config_entity):
        payload = RuleGeneratePayload(
            instruction="test instruction", model_config=model_config_entity, no_variable=False
        )
        # Mocking 3 calls for invoke_llm
        mock_res1 = MagicMock()
        mock_res1.message.get_text_content.return_value = "Step 1 Prompt"

        mock_res2 = MagicMock()
        mock_res2.message.get_text_content.return_value = '"var1", "var2"'

        mock_res3 = MagicMock()
        mock_res3.message.get_text_content.return_value = "Opening Statement"

        mock_model_instance.invoke_llm.side_effect = [mock_res1, mock_res2, mock_res3]

        result = LLMGenerator.generate_rule_config("tenant_id", payload)
        assert result["prompt"] == "Step 1 Prompt"
        assert result["variables"] == ["var1", "var2"]
        assert result["opening_statement"] == "Opening Statement"
        assert result["error"] == ""

    def test_generate_rule_config_with_variable_step1_error(self, mock_model_instance, model_config_entity):
        payload = RuleGeneratePayload(
            instruction="test instruction", model_config=model_config_entity, no_variable=False
        )
        mock_model_instance.invoke_llm.side_effect = InvokeError("Step 1 Failed")

        result = LLMGenerator.generate_rule_config("tenant_id", payload)
        assert "Failed to generate prefix prompt" in result["error"]

    def test_generate_rule_config_with_variable_step2_error(self, mock_model_instance, model_config_entity):
        payload = RuleGeneratePayload(
            instruction="test instruction", model_config=model_config_entity, no_variable=False
        )
        mock_res1 = MagicMock()
        mock_res1.message.get_text_content.return_value = "Step 1 Prompt"

        # Step 2 fails
        mock_model_instance.invoke_llm.side_effect = [mock_res1, InvokeError("Step 2 Failed"), MagicMock()]

        result = LLMGenerator.generate_rule_config("tenant_id", payload)
        assert "Failed to generate variables" in result["error"]

    def test_generate_rule_config_with_variable_step3_error(self, mock_model_instance, model_config_entity):
        payload = RuleGeneratePayload(
            instruction="test instruction", model_config=model_config_entity, no_variable=False
        )
        mock_res1 = MagicMock()
        mock_res1.message.get_text_content.return_value = "Step 1 Prompt"

        mock_res2 = MagicMock()
        mock_res2.message.get_text_content.return_value = '"var1"'

        # Step 3 fails
        mock_model_instance.invoke_llm.side_effect = [mock_res1, mock_res2, InvokeError("Step 3 Failed")]

        result = LLMGenerator.generate_rule_config("tenant_id", payload)
        assert "Failed to generate conversation opener" in result["error"]

    def test_generate_rule_config_with_variable_exception(self, mock_model_instance, model_config_entity):
        payload = RuleGeneratePayload(
            instruction="test instruction", model_config=model_config_entity, no_variable=False
        )
        # Mock any step to throw Exception
        mock_model_instance.invoke_llm.side_effect = Exception("Unexpected multi-step error")

        result = LLMGenerator.generate_rule_config("tenant_id", payload)
        assert "Unexpected multi-step error" in result["error"]

    def test_generate_code_python_success(self, mock_model_instance, model_config_entity):
        payload = RuleCodeGeneratePayload(
            instruction="print hello", code_language="python", model_config=model_config_entity
        )
        mock_response = MagicMock()
        mock_response.message.get_text_content.return_value = "print('hello')"
        mock_model_instance.invoke_llm.return_value = mock_response

        result = LLMGenerator.generate_code("tenant_id", payload)
        assert result["code"] == "print('hello')"
        assert result["language"] == "python"

    def test_generate_code_javascript_success(self, mock_model_instance, model_config_entity):
        payload = RuleCodeGeneratePayload(
            instruction="console log hello", code_language="javascript", model_config=model_config_entity
        )
        mock_response = MagicMock()
        mock_response.message.get_text_content.return_value = "console.log('hello')"
        mock_model_instance.invoke_llm.return_value = mock_response

        result = LLMGenerator.generate_code("tenant_id", payload)
        assert result["code"] == "console.log('hello')"
        assert result["language"] == "javascript"

    def test_generate_code_invoke_error(self, mock_model_instance, model_config_entity):
        payload = RuleCodeGeneratePayload(instruction="error", code_language="python", model_config=model_config_entity)
        mock_model_instance.invoke_llm.side_effect = InvokeError("Invoke failed")

        result = LLMGenerator.generate_code("tenant_id", payload)
        assert "Failed to generate code" in result["error"]

    def test_generate_code_exception(self, mock_model_instance, model_config_entity):
        payload = RuleCodeGeneratePayload(instruction="error", code_language="python", model_config=model_config_entity)
        mock_model_instance.invoke_llm.side_effect = Exception("Random error")

        result = LLMGenerator.generate_code("tenant_id", payload)
        assert "Random error" in result["error"]

    def test_generate_qa_document_success(self, mock_model_instance):
        mock_response = MagicMock(spec=LLMResult)
        mock_response.message = MagicMock()
        mock_response.message.get_text_content.return_value = "QA Document Content"
        mock_model_instance.invoke_llm.return_value = mock_response

        result = LLMGenerator.generate_qa_document("tenant_id", "query", "English")
        assert result == "QA Document Content"

    def test_generate_qa_document_type_error(self, mock_model_instance):
        mock_model_instance.invoke_llm.return_value = "Not an LLMResult"

        with pytest.raises(TypeError, match="Expected LLMResult when stream=False"):
            LLMGenerator.generate_qa_document("tenant_id", "query", "English")

    def test_generate_structured_output_success(self, mock_model_instance, model_config_entity):
        payload = RuleStructuredOutputPayload(instruction="generate schema", model_config=model_config_entity)
        mock_response = MagicMock()
        mock_response.message.get_text_content.return_value = '{"type": "object", "properties": {}}'
        mock_model_instance.invoke_llm.return_value = mock_response

        result = LLMGenerator.generate_structured_output("tenant_id", payload)
        parsed_output = json.loads(result["output"])
        assert parsed_output["type"] == "object"
        assert result["error"] == ""

    def test_generate_structured_output_json_repair(self, mock_model_instance, model_config_entity):
        payload = RuleStructuredOutputPayload(instruction="generate schema", model_config=model_config_entity)
        mock_response = MagicMock()
        mock_response.message.get_text_content.return_value = "{'type': 'object'}"
        mock_model_instance.invoke_llm.return_value = mock_response

        result = LLMGenerator.generate_structured_output("tenant_id", payload)
        parsed_output = json.loads(result["output"])
        assert parsed_output["type"] == "object"

    def test_generate_structured_output_not_dict_or_list(self, mock_model_instance, model_config_entity):
        payload = RuleStructuredOutputPayload(instruction="generate schema", model_config=model_config_entity)
        mock_response = MagicMock()
        mock_response.message.get_text_content.return_value = "true"  # parsed as bool
        mock_model_instance.invoke_llm.return_value = mock_response

        result = LLMGenerator.generate_structured_output("tenant_id", payload)
        assert "Failed to parse structured output" in result["error"]

    def test_generate_structured_output_invoke_error(self, mock_model_instance, model_config_entity):
        payload = RuleStructuredOutputPayload(instruction="error", model_config=model_config_entity)
        mock_model_instance.invoke_llm.side_effect = InvokeError("Invoke failed")

        result = LLMGenerator.generate_structured_output("tenant_id", payload)
        assert "Invoke failed" in result["error"]

    def test_generate_structured_output_exception(self, mock_model_instance, model_config_entity):
        payload = RuleStructuredOutputPayload(instruction="error", model_config=model_config_entity)
        mock_model_instance.invoke_llm.side_effect = Exception("Random error")

        result = LLMGenerator.generate_structured_output("tenant_id", payload)
        assert "Random error" in result["error"]

    def test_instruction_modify_legacy_without_last_run_uses_real_empty_query(
        self,
        database: Session,
        recording_model_instance: Mock,
        model_config_entity: ModelConfig,
    ):
        app = _persist_app(database)
        recording_model_instance.invoke_llm.return_value = _llm_result('{"modified": "prompt"}')

        result = LLMGenerator.instruction_modify_legacy(
            app.tenant_id,
            app.id,
            "current_val",
            "Test {{#last_run#}} and {{#current#}} and {{#error_message#}}",
            model_config_entity,
            "ideal",
        )

        assert result == {"modified": "prompt"}
        user_payload = json.loads(recording_model_instance.invoke_llm.call_args.kwargs["prompt_messages"][1].content)
        assert "null" in user_payload["instruction"]
        assert "current_val" in user_payload["instruction"]

    def test_instruction_modify_legacy_reads_latest_tenant_scoped_message(
        self,
        database: Session,
        recording_model_instance: Mock,
        model_config_entity: ModelConfig,
    ):
        app = _persist_app(database)
        _persist_message(
            database,
            app,
            query="older question",
            answer="older answer",
            created_at=datetime(2026, 1, 1),
        )
        _persist_message(
            database,
            app,
            query="latest question",
            answer="latest answer",
            created_at=datetime(2026, 1, 2),
        )
        other_app = _persist_app(database)
        _persist_message(
            database,
            other_app,
            query="other tenant question",
            created_at=datetime(2026, 1, 3),
        )
        recording_model_instance.invoke_llm.return_value = _llm_result('{"modified": "prompt"}')

        result = LLMGenerator.instruction_modify_legacy(
            app.tenant_id, app.id, "current", "instruction", model_config_entity, "ideal"
        )

        assert result == {"modified": "prompt"}
        user_payload = json.loads(recording_model_instance.invoke_llm.call_args.kwargs["prompt_messages"][1].content)
        assert user_payload["last_run"]["query"] == "latest question"
        assert user_payload["last_run"]["answer"] == "latest answer"
        assert "older question" not in json.dumps(user_payload)
        assert "other tenant question" not in json.dumps(user_payload)

    def test_instruction_modify_workflow_app_not_found(
        self,
        database: Session,
        sqlite_session_factory: sessionmaker[Session],
        model_config_entity: ModelConfig,
    ):
        workflow_service = WorkflowService(sqlite_session_factory)

        with pytest.raises(ValueError, match="App not found"):
            LLMGenerator.instruction_modify_workflow(
                str(uuid4()),
                str(uuid4()),
                "node",
                "current",
                "instruction",
                model_config_entity,
                "ideal",
                workflow_service,
            )

    def test_instruction_modify_workflow_rejects_app_from_another_tenant(
        self,
        database: Session,
        sqlite_session_factory: sessionmaker[Session],
        model_config_entity: ModelConfig,
    ):
        app = _persist_app(database)
        workflow_service = WorkflowService(sqlite_session_factory)

        with pytest.raises(ValueError, match="App not found"):
            LLMGenerator.instruction_modify_workflow(
                str(uuid4()),
                app.id,
                "node",
                "current",
                "instruction",
                model_config_entity,
                "ideal",
                workflow_service,
            )

    def test_instruction_modify_workflow_requires_draft_workflow(
        self,
        database: Session,
        sqlite_session_factory: sessionmaker[Session],
        model_config_entity: ModelConfig,
    ):
        app = _persist_app(database)
        workflow_service = WorkflowService(sqlite_session_factory)

        with pytest.raises(ValueError, match="Workflow not found"):
            LLMGenerator.instruction_modify_workflow(
                app.tenant_id,
                app.id,
                "node",
                "current",
                "instruction",
                model_config_entity,
                "ideal",
                workflow_service,
            )

    def test_instruction_modify_workflow_uses_last_run(
        self,
        database: Session,
        sqlite_session_factory: sessionmaker[Session],
        recording_model_instance: Mock,
        model_config_entity: ModelConfig,
    ):
        app = _persist_app(database)
        workflow = _persist_workflow(database, app, node_type="llm")
        _persist_node_execution(
            database,
            app,
            workflow,
            inputs={"input": "value"},
            agent_log=[{"status": "s", "error": "", "data": {"step": 1}}],
        )
        workflow_service = WorkflowService(sqlite_session_factory)

        result = LLMGenerator.instruction_modify_workflow(
            app.tenant_id,
            app.id,
            "node",
            "current",
            "instruction",
            model_config_entity,
            "ideal",
            workflow_service,
        )

        assert result == {"modified": "workflow"}
        user_payload = json.loads(recording_model_instance.invoke_llm.call_args.kwargs["prompt_messages"][1].content)
        assert user_payload["last_run"]["inputs"] == {"input": "value"}
        assert user_payload["last_run"]["agent_log"][0]["data"] == {"step": 1}

    def test_instruction_modify_workflow_accepts_empty_agent_log(
        self,
        database: Session,
        sqlite_session_factory: sessionmaker[Session],
        recording_model_instance: Mock,
        model_config_entity: ModelConfig,
    ):
        app = _persist_app(database)
        workflow = _persist_workflow(database, app, node_type="llm")
        _persist_node_execution(database, app, workflow, agent_log=[])
        workflow_service = WorkflowService(sqlite_session_factory)

        result = LLMGenerator.instruction_modify_workflow(
            app.tenant_id,
            app.id,
            "node",
            "current",
            "instruction",
            model_config_entity,
            "ideal",
            workflow_service,
        )

        assert result == {"modified": "workflow"}
        user_payload = json.loads(recording_model_instance.invoke_llm.call_args.kwargs["prompt_messages"][1].content)
        assert user_payload["last_run"]["agent_log"] == []

    @pytest.mark.parametrize(
        "node_type",
        [
            "code",
            None,
        ],
    )
    def test_instruction_modify_workflow_falls_back_without_last_run(
        self,
        database: Session,
        sqlite_session_factory: sessionmaker[Session],
        recording_model_instance: Mock,
        model_config_entity: ModelConfig,
        node_type: str | None,
    ):
        app = _persist_app(database)
        _persist_workflow(database, app, node_type=node_type)
        workflow_service = WorkflowService(sqlite_session_factory)
        recording_model_instance.invoke_llm.return_value = _llm_result('{"modified": "fallback"}')

        result = LLMGenerator.instruction_modify_workflow(
            app.tenant_id,
            app.id,
            "node",
            "current",
            "instruction",
            model_config_entity,
            "ideal",
            workflow_service,
        )

        assert result == {"modified": "fallback"}

    def test_instruction_modify_workflow_falls_back_for_unknown_node_type(
        self,
        database: Session,
        sqlite_session_factory: sessionmaker[Session],
        recording_model_instance: Mock,
        model_config_entity: ModelConfig,
    ):
        app = _persist_app(database)
        _persist_workflow(database, app, node_type="unknown")
        workflow_service = WorkflowService(sqlite_session_factory)

        result = LLMGenerator.instruction_modify_workflow(
            app.tenant_id,
            app.id,
            "node",
            "current",
            "instruction",
            model_config_entity,
            "ideal",
            workflow_service,
        )

        assert result == {"modified": "workflow"}
        system_prompt = recording_model_instance.invoke_llm.call_args.kwargs["prompt_messages"][0].content
        assert system_prompt == llm_generator_module.LLM_MODIFY_PROMPT_SYSTEM

    @pytest.mark.parametrize(
        ("raw_output", "error_fragment"),
        [
            ("No braces here", "Could not find a valid JSON object"),
            ("[1, 2, 3]", "Could not find a valid JSON object"),
        ],
    )
    def test_instruction_modify_rejects_invalid_model_output(
        self,
        database: Session,
        mock_model_instance: MagicMock,
        model_config_entity: ModelConfig,
        raw_output: str,
        error_fragment: str,
    ):
        app = _persist_app(database)
        response = MagicMock()
        response.message.get_text_content.return_value = raw_output
        mock_model_instance.invoke_llm.return_value = response

        result = LLMGenerator.instruction_modify_legacy(
            app.tenant_id, app.id, "current", "instruction", model_config_entity, "ideal"
        )

        assert error_fragment in result["error"]

    @pytest.mark.parametrize(
        ("model_error", "error_fragment"),
        [(InvokeError("invoke failed"), "invoke failed"), (RuntimeError("boom"), "boom")],
    )
    def test_instruction_modify_handles_model_errors(
        self,
        database: Session,
        mock_model_instance: MagicMock,
        model_config_entity: ModelConfig,
        model_error: Exception,
        error_fragment: str,
    ):
        app = _persist_app(database)
        mock_model_instance.invoke_llm.side_effect = model_error

        result = LLMGenerator.instruction_modify_legacy(
            app.tenant_id, app.id, "current", "instruction", model_config_entity, "ideal"
        )

        assert error_fragment.lower() in result["error"].lower()


# ---------------------------------------------------------------------------
# Prompt-generation telemetry emit-site tests
# ---------------------------------------------------------------------------


class TestPromptGenerationTelemetryEmit:
    """Verify that LLM generator methods call telemetry_emit with a
    PromptGenerationEvent so the metric pipeline is not accidentally broken."""

    @pytest.fixture(autouse=True)
    def _setup(self, recording_model_instance: Mock) -> None:
        self.model_instance = recording_model_instance

    @patch("core.llm_generator.llm_generator.telemetry_emit")
    def test_generate_code_emits_on_success(self, mock_emit: MagicMock) -> None:
        self.model_instance.invoke_llm.return_value = _llm_result("print('hello')")
        model_cfg = ModelConfig(provider="openai", name="gpt-4", mode="chat", completion_params={})
        args = RuleCodeGeneratePayload(instruction="write hello world", model_config=model_cfg, code_language="python")

        LLMGenerator.generate_code(tenant_id="t-1", args=args, app_id="app-1")

        mock_emit.assert_called_once()
        event = mock_emit.call_args[0][0]
        assert type(event).__name__ == "PromptGenerationEvent"
        assert event.payload["operation_type"] == "code_generate"
        assert event.payload["model_provider"] == "openai"
        assert event.payload["model_name"] == "gpt-4"
        assert event.context.tenant_id == "t-1"
        assert event.context.app_id == "app-1"
        assert event.payload["error"] is None

    @patch("core.llm_generator.llm_generator.telemetry_emit")
    def test_generate_code_emits_on_failure(self, mock_emit: MagicMock) -> None:
        self.model_instance.invoke_llm.side_effect = InvokeError("model down")
        model_cfg = ModelConfig(provider="openai", name="gpt-4", mode="chat", completion_params={})
        args = RuleCodeGeneratePayload(instruction="write hello world", model_config=model_cfg, code_language="python")

        result = LLMGenerator.generate_code(tenant_id="t-1", args=args)

        mock_emit.assert_called_once()
        event = mock_emit.call_args[0][0]
        assert event.payload["error"] == "model down"
        assert "Failed to generate code" in result["error"]

    @patch("core.llm_generator.llm_generator.telemetry_emit")
    def test_generate_rule_config_no_variable_emits(self, mock_emit: MagicMock) -> None:
        self.model_instance.invoke_llm.return_value = _llm_result("generated prompt")
        model_cfg = ModelConfig(provider="anthropic", name="claude-3", mode="chat", completion_params={})
        args = RuleGeneratePayload(instruction="be helpful", model_config=model_cfg, no_variable=True)

        LLMGenerator.generate_rule_config(tenant_id="t-1", args=args, app_id="app-2")

        mock_emit.assert_called_once()
        event = mock_emit.call_args[0][0]
        assert event.payload["operation_type"] == "rule_generate"
        assert event.payload["model_provider"] == "anthropic"
        assert event.context.app_id == "app-2"

    @patch("core.llm_generator.llm_generator.telemetry_emit")
    def test_generate_rule_config_no_variable_emits_on_failure(self, mock_emit: MagicMock) -> None:
        self.model_instance.invoke_llm.side_effect = InvokeError("auth fail")
        model_cfg = ModelConfig(provider="anthropic", name="claude-3", mode="chat", completion_params={})
        args = RuleGeneratePayload(instruction="be helpful", model_config=model_cfg, no_variable=True)

        result = LLMGenerator.generate_rule_config(tenant_id="t-1", args=args)

        mock_emit.assert_called_once()
        event = mock_emit.call_args[0][0]
        assert event.payload["error"] == "auth fail"
        assert "error" in result
