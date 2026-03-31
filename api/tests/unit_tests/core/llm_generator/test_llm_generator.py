import json
from unittest.mock import MagicMock, patch

import pytest
from graphon.model_runtime.entities.llm_entities import LLMMode, LLMResult
from graphon.model_runtime.errors.invoke import InvokeAuthorizationError, InvokeError

from core.app.app_config.entities import ModelConfig
from core.llm_generator.entities import RuleCodeGeneratePayload, RuleGeneratePayload, RuleStructuredOutputPayload
from core.llm_generator.llm_generator import LLMGenerator


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
            name = LLMGenerator.generate_conversation_name("tenant_id", "test query")
            assert name == "Test Conversation Name"
            mock_trace.assert_called_once()

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
        assert name == ""

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
        assert "Failed to handle unexpected exception" in result["error"]
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
        assert "An unexpected error occurred" in result["error"]

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
        assert "An unexpected error occurred" in result["error"]
        assert "Failed to parse structured output" in result["error"]

    def test_generate_structured_output_invoke_error(self, mock_model_instance, model_config_entity):
        payload = RuleStructuredOutputPayload(instruction="error", model_config=model_config_entity)
        mock_model_instance.invoke_llm.side_effect = InvokeError("Invoke failed")

        result = LLMGenerator.generate_structured_output("tenant_id", payload)
        assert "Failed to generate JSON Schema" in result["error"]

    def test_generate_structured_output_exception(self, mock_model_instance, model_config_entity):
        payload = RuleStructuredOutputPayload(instruction="error", model_config=model_config_entity)
        mock_model_instance.invoke_llm.side_effect = Exception("Random error")

        result = LLMGenerator.generate_structured_output("tenant_id", payload)
        assert "An unexpected error occurred" in result["error"]

    def test_instruction_modify_legacy_no_last_run(self, mock_model_instance, model_config_entity):
        with patch("extensions.ext_database.db.session.scalar") as mock_scalar:
            mock_scalar.return_value = None

            # Mock __instruction_modify_common call via invoke_llm
            mock_response = MagicMock()
            mock_response.message.get_text_content.return_value = '{"modified": "prompt"}'
            mock_model_instance.invoke_llm.return_value = mock_response

            result = LLMGenerator.instruction_modify_legacy(
                "tenant_id", "flow_id", "current", "instruction", model_config_entity, "ideal"
            )
            assert result == {"modified": "prompt"}

    def test_instruction_modify_legacy_with_last_run(self, mock_model_instance, model_config_entity):
        with patch("extensions.ext_database.db.session.scalar") as mock_scalar:
            last_run = MagicMock()
            last_run.query = "q"
            last_run.answer = "a"
            last_run.error = "e"
            mock_scalar.return_value = last_run

            mock_response = MagicMock()
            mock_response.message.get_text_content.return_value = '{"modified": "prompt"}'
            mock_model_instance.invoke_llm.return_value = mock_response

            result = LLMGenerator.instruction_modify_legacy(
                "tenant_id", "flow_id", "current", "instruction", model_config_entity, "ideal"
            )
            assert result == {"modified": "prompt"}

    def test_instruction_modify_workflow_app_not_found(self):
        with patch("extensions.ext_database.db.session") as mock_session:
            mock_session.return_value.query.return_value.where.return_value.first.return_value = None
            with pytest.raises(ValueError, match="App not found."):
                LLMGenerator.instruction_modify_workflow("t", "f", "n", "c", "i", MagicMock(), "o", MagicMock())

    def test_instruction_modify_workflow_no_workflow(self):
        with patch("extensions.ext_database.db.session") as mock_session:
            mock_session.return_value.query.return_value.where.return_value.first.return_value = MagicMock()
            workflow_service = MagicMock()
            workflow_service.get_draft_workflow.return_value = None
            with pytest.raises(ValueError, match="Workflow not found for the given app model."):
                LLMGenerator.instruction_modify_workflow("t", "f", "n", "c", "i", MagicMock(), "o", workflow_service)

    def test_instruction_modify_workflow_success(self, mock_model_instance, model_config_entity):
        with patch("extensions.ext_database.db.session") as mock_session:
            mock_session.return_value.query.return_value.where.return_value.first.return_value = MagicMock()
            workflow = MagicMock()
            workflow.graph_dict = {"graph": {"nodes": [{"id": "node_id", "data": {"type": "llm"}}]}}

            workflow_service = MagicMock()
            workflow_service.get_draft_workflow.return_value = workflow

            last_run = MagicMock()
            last_run.node_type = "llm"
            last_run.status = "s"
            last_run.error = "e"
            # Return regular values, not Mocks
            last_run.execution_metadata_dict = {"agent_log": [{"status": "s", "error": "e", "data": {}}]}
            last_run.load_full_inputs.return_value = {"in": "val"}

            workflow_service.get_node_last_run.return_value = last_run

            mock_response = MagicMock()
            mock_response.message.get_text_content.return_value = '{"modified": "workflow"}'
            mock_model_instance.invoke_llm.return_value = mock_response

            result = LLMGenerator.instruction_modify_workflow(
                "tenant_id",
                "flow_id",
                "node_id",
                "current",
                "instruction",
                model_config_entity,
                "ideal",
                workflow_service,
            )
            assert result == {"modified": "workflow"}

    def test_instruction_modify_workflow_no_last_run_fallback(self, mock_model_instance, model_config_entity):
        with patch("extensions.ext_database.db.session") as mock_session:
            mock_session.return_value.query.return_value.where.return_value.first.return_value = MagicMock()
            workflow = MagicMock()
            workflow.graph_dict = {"graph": {"nodes": [{"id": "node_id", "data": {"type": "code"}}]}}

            workflow_service = MagicMock()
            workflow_service.get_draft_workflow.return_value = workflow
            workflow_service.get_node_last_run.return_value = None

            mock_response = MagicMock()
            mock_response.message.get_text_content.return_value = '{"modified": "fallback"}'
            mock_model_instance.invoke_llm.return_value = mock_response

            result = LLMGenerator.instruction_modify_workflow(
                "tenant_id",
                "flow_id",
                "node_id",
                "current",
                "instruction",
                model_config_entity,
                "ideal",
                workflow_service,
            )
            assert result == {"modified": "fallback"}

    def test_instruction_modify_workflow_node_type_fallback(self, mock_model_instance, model_config_entity):
        with patch("extensions.ext_database.db.session") as mock_session:
            mock_session.return_value.query.return_value.where.return_value.first.return_value = MagicMock()
            workflow = MagicMock()
            # Cause exception in node_type logic
            workflow.graph_dict = {"graph": {"nodes": []}}

            workflow_service = MagicMock()
            workflow_service.get_draft_workflow.return_value = workflow
            workflow_service.get_node_last_run.return_value = None

            mock_response = MagicMock()
            mock_response.message.get_text_content.return_value = '{"modified": "fallback"}'
            mock_model_instance.invoke_llm.return_value = mock_response

            result = LLMGenerator.instruction_modify_workflow(
                "tenant_id",
                "flow_id",
                "node_id",
                "current",
                "instruction",
                model_config_entity,
                "ideal",
                workflow_service,
            )
            assert result == {"modified": "fallback"}

    def test_instruction_modify_workflow_empty_agent_log(self, mock_model_instance, model_config_entity):
        with patch("extensions.ext_database.db.session") as mock_session:
            mock_session.return_value.query.return_value.where.return_value.first.return_value = MagicMock()
            workflow = MagicMock()
            workflow.graph_dict = {"graph": {"nodes": [{"id": "node_id", "data": {"type": "llm"}}]}}

            workflow_service = MagicMock()
            workflow_service.get_draft_workflow.return_value = workflow

            last_run = MagicMock()
            last_run.node_type = "llm"
            last_run.status = "s"
            last_run.error = "e"
            # Return regular empty list, not a Mock
            last_run.execution_metadata_dict = {"agent_log": []}
            last_run.load_full_inputs.return_value = {}

            workflow_service.get_node_last_run.return_value = last_run

            mock_response = MagicMock()
            mock_response.message.get_text_content.return_value = '{"modified": "workflow"}'
            mock_model_instance.invoke_llm.return_value = mock_response

            result = LLMGenerator.instruction_modify_workflow(
                "tenant_id",
                "flow_id",
                "node_id",
                "current",
                "instruction",
                model_config_entity,
                "ideal",
                workflow_service,
            )
            assert result == {"modified": "workflow"}

    def test_instruction_modify_common_placeholders(self, mock_model_instance, model_config_entity):
        # Testing placeholders replacement via instruction_modify_legacy for convenience
        with patch("extensions.ext_database.db.session.scalar") as mock_scalar:
            mock_scalar.return_value = None

            mock_response = MagicMock()
            mock_response.message.get_text_content.return_value = '{"ok": true}'
            mock_model_instance.invoke_llm.return_value = mock_response

            instruction = "Test {{#last_run#}} and {{#current#}} and {{#error_message#}}"
            LLMGenerator.instruction_modify_legacy(
                "tenant_id", "flow_id", "current_val", instruction, model_config_entity, "ideal"
            )

            # Verify the call to invoke_llm contains replaced instruction
            args, kwargs = mock_model_instance.invoke_llm.call_args
            prompt_messages = kwargs["prompt_messages"]
            user_msg = prompt_messages[1].content
            user_msg_dict = json.loads(user_msg)
            assert "null" in user_msg_dict["instruction"]  # because last_run is None and current is current_val etc.
            assert "current_val" in user_msg_dict["instruction"]

    def test_instruction_modify_common_no_braces(self, mock_model_instance, model_config_entity):
        with patch("extensions.ext_database.db.session.scalar") as mock_scalar:
            mock_scalar.return_value = None
            mock_response = MagicMock()
            mock_response.message.get_text_content.return_value = "No braces here"
            mock_model_instance.invoke_llm.return_value = mock_response
            result = LLMGenerator.instruction_modify_legacy(
                "tenant_id", "flow_id", "current", "instruction", model_config_entity, "ideal"
            )
            assert "An unexpected error occurred" in result["error"]
            assert "Could not find a valid JSON object" in result["error"]

    def test_instruction_modify_common_not_dict(self, mock_model_instance, model_config_entity):
        with patch("extensions.ext_database.db.session.scalar") as mock_scalar:
            mock_scalar.return_value = None
            mock_response = MagicMock()
            mock_response.message.get_text_content.return_value = "[1, 2, 3]"
            mock_model_instance.invoke_llm.return_value = mock_response
            result = LLMGenerator.instruction_modify_legacy(
                "tenant_id", "flow_id", "current", "instruction", model_config_entity, "ideal"
            )
            # The exception message is "Expected a JSON object, but got list"
            assert "An unexpected error occurred" in result["error"]

    def test_instruction_modify_common_other_node_type(self, mock_model_instance, model_config_entity):
        with patch("core.llm_generator.llm_generator.ModelManager.for_tenant") as mock_manager:
            instance = MagicMock()
            mock_manager.return_value.get_model_instance.return_value = instance
            mock_response = MagicMock()
            mock_response.message.get_text_content.return_value = '{"ok": true}'
            instance.invoke_llm.return_value = mock_response

            with patch("extensions.ext_database.db.session") as mock_session:
                mock_session.return_value.query.return_value.where.return_value.first.return_value = MagicMock()
                workflow = MagicMock()
                workflow.graph_dict = {"graph": {"nodes": [{"id": "node_id", "data": {"type": "other"}}]}}

                workflow_service = MagicMock()
                workflow_service.get_draft_workflow.return_value = workflow
                workflow_service.get_node_last_run.return_value = None

                LLMGenerator.instruction_modify_workflow(
                    "tenant_id",
                    "flow_id",
                    "node_id",
                    "current",
                    "instruction",
                    model_config_entity,
                    "ideal",
                    workflow_service,
                )

    def test_instruction_modify_common_invoke_error(self, mock_model_instance, model_config_entity):
        with patch("extensions.ext_database.db.session.scalar") as mock_scalar:
            mock_scalar.return_value = None
            mock_model_instance.invoke_llm.side_effect = InvokeError("Invoke Failed")

            result = LLMGenerator.instruction_modify_legacy(
                "tenant_id", "flow_id", "current", "instruction", model_config_entity, "ideal"
            )
            assert "Failed to generate code" in result["error"]

    def test_instruction_modify_common_exception(self, mock_model_instance, model_config_entity):
        with patch("extensions.ext_database.db.session.scalar") as mock_scalar:
            mock_scalar.return_value = None
            mock_model_instance.invoke_llm.side_effect = Exception("Random error")

            result = LLMGenerator.instruction_modify_legacy(
                "tenant_id", "flow_id", "current", "instruction", model_config_entity, "ideal"
            )
            assert "An unexpected error occurred" in result["error"]

    def test_instruction_modify_common_json_error(self, mock_model_instance, model_config_entity):
        with patch("extensions.ext_database.db.session.scalar") as mock_scalar:
            mock_scalar.return_value = None

            mock_response = MagicMock()
            mock_response.message.get_text_content.return_value = "No JSON here"
            mock_model_instance.invoke_llm.return_value = mock_response

            result = LLMGenerator.instruction_modify_legacy(
                "tenant_id", "flow_id", "current", "instruction", model_config_entity, "ideal"
            )
            assert "An unexpected error occurred" in result["error"]
