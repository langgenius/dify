import json
import logging
import re
from collections.abc import Callable, Mapping, Sequence
from typing import Any, Protocol, cast

import json_repair

from core.llm_generator.output_parser.rule_config_generator import RuleConfigGeneratorOutputParser
from core.llm_generator.output_parser.suggested_questions_after_answer import SuggestedQuestionsAfterAnswerOutputParser
from core.llm_generator.prompts import (
    CONVERSATION_TITLE_PROMPT,
    GENERATOR_QA_PROMPT,
    JAVASCRIPT_CODE_GENERATOR_PROMPT_TEMPLATE,
    LLM_MODIFY_CODE_SYSTEM,
    LLM_MODIFY_PROMPT_SYSTEM,
    MEMORY_INSTRUCTION_EDIT_SYSTEM_PROMPT,
    MEMORY_INSTRUCTION_GENERATION_SYSTEM_PROMPT,
    MEMORY_TEMPLATE_EDIT_SYSTEM_PROMPT,
    MEMORY_TEMPLATE_GENERATION_SYSTEM_PROMPT,
    MEMORY_UPDATE_PROMPT,
    PYTHON_CODE_GENERATOR_PROMPT_TEMPLATE,
    SYSTEM_STRUCTURED_OUTPUT_GENERATE,
    WORKFLOW_RULE_CONFIG_PROMPT_GENERATE_TEMPLATE,
)
from core.memory.entities import MemoryBlock, MemoryBlockSpec
from core.model_manager import ModelManager
from core.model_runtime.entities.llm_entities import LLMResult
from core.model_runtime.entities.message_entities import PromptMessage, SystemPromptMessage, UserPromptMessage
from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.errors.invoke import InvokeAuthorizationError, InvokeError
from core.ops.entities.trace_entity import TraceTaskName
from core.ops.ops_trace_manager import TraceQueueManager, TraceTask
from core.ops.utils import measure_time
from core.prompt.utils.prompt_template_parser import PromptTemplateParser
from core.workflow.entities.workflow_node_execution import WorkflowNodeExecutionMetadataKey
from core.workflow.runtime import VariablePool
from extensions.ext_database import db
from extensions.ext_storage import storage
from models import App, Message, WorkflowNodeExecutionModel
from models.workflow import Workflow

logger = logging.getLogger(__name__)


class WorkflowServiceInterface(Protocol):
    def get_draft_workflow(self, app_model: App, workflow_id: str | None = None) -> Workflow | None:
        pass

    def get_node_last_run(self, app_model: App, workflow: Workflow, node_id: str) -> WorkflowNodeExecutionModel | None:
        pass


class LLMGenerator:
    @classmethod
    def generate_conversation_name(
        cls, tenant_id: str, query, conversation_id: str | None = None, app_id: str | None = None
    ):
        prompt = CONVERSATION_TITLE_PROMPT

        if len(query) > 2000:
            query = query[:300] + "...[TRUNCATED]..." + query[-300:]

        query = query.replace("\n", " ")

        prompt += query + "\n"

        model_manager = ModelManager()
        model_instance = model_manager.get_default_model_instance(
            tenant_id=tenant_id,
            model_type=ModelType.LLM,
        )
        prompts = [UserPromptMessage(content=prompt)]

        with measure_time() as timer:
            response: LLMResult = model_instance.invoke_llm(
                prompt_messages=list(prompts), model_parameters={"max_tokens": 500, "temperature": 1}, stream=False
            )
        answer = cast(str, response.message.content)
        cleaned_answer = re.sub(r"^.*(\{.*\}).*$", r"\1", answer, flags=re.DOTALL)
        if cleaned_answer is None:
            return ""
        try:
            result_dict = json.loads(cleaned_answer)
            answer = result_dict["Your Output"]
        except json.JSONDecodeError:
            logger.exception("Failed to generate name after answer, use query instead")
            answer = query
        name = answer.strip()

        if len(name) > 75:
            name = name[:75] + "..."

        # get tracing instance
        trace_manager = TraceQueueManager(app_id=app_id)
        trace_manager.add_trace_task(
            TraceTask(
                TraceTaskName.GENERATE_NAME_TRACE,
                conversation_id=conversation_id,
                generate_conversation_name=name,
                inputs=prompt,
                timer=timer,
                tenant_id=tenant_id,
            )
        )

        return name

    @classmethod
    def generate_suggested_questions_after_answer(cls, tenant_id: str, histories: str) -> Sequence[str]:
        output_parser = SuggestedQuestionsAfterAnswerOutputParser()
        format_instructions = output_parser.get_format_instructions()

        prompt_template = PromptTemplateParser(template="{{histories}}\n{{format_instructions}}\nquestions:\n")

        prompt = prompt_template.format({"histories": histories, "format_instructions": format_instructions})

        try:
            model_manager = ModelManager()
            model_instance = model_manager.get_default_model_instance(
                tenant_id=tenant_id,
                model_type=ModelType.LLM,
            )
        except InvokeAuthorizationError:
            return []

        prompt_messages = [UserPromptMessage(content=prompt)]

        questions: Sequence[str] = []

        try:
            response: LLMResult = model_instance.invoke_llm(
                prompt_messages=list(prompt_messages),
                model_parameters={"max_tokens": 256, "temperature": 0},
                stream=False,
            )

            text_content = response.message.get_text_content()
            questions = output_parser.parse(text_content) if text_content else []
        except InvokeError:
            questions = []
        except Exception:
            logger.exception("Failed to generate suggested questions after answer")
            questions = []

        return questions

    @classmethod
    def generate_rule_config(cls, tenant_id: str, instruction: str, model_config: dict, no_variable: bool):
        output_parser = RuleConfigGeneratorOutputParser()

        error = ""
        error_step = ""
        rule_config = {"prompt": "", "variables": [], "opening_statement": "", "error": ""}
        model_parameters = model_config.get("completion_params", {})
        if no_variable:
            prompt_template = PromptTemplateParser(WORKFLOW_RULE_CONFIG_PROMPT_GENERATE_TEMPLATE)

            prompt_generate = prompt_template.format(
                inputs={
                    "TASK_DESCRIPTION": instruction,
                },
                remove_template_variables=False,
            )

            prompt_messages = [UserPromptMessage(content=prompt_generate)]

            model_manager = ModelManager()

            model_instance = model_manager.get_model_instance(
                tenant_id=tenant_id,
                model_type=ModelType.LLM,
                provider=model_config.get("provider", ""),
                model=model_config.get("name", ""),
            )

            try:
                response: LLMResult = model_instance.invoke_llm(
                    prompt_messages=list(prompt_messages), model_parameters=model_parameters, stream=False
                )

                rule_config["prompt"] = cast(str, response.message.content)

            except InvokeError as e:
                error = str(e)
                error_step = "generate rule config"
            except Exception as e:
                logger.exception("Failed to generate rule config, model: %s", model_config.get("name"))
                rule_config["error"] = str(e)

            rule_config["error"] = f"Failed to {error_step}. Error: {error}" if error else ""

            return rule_config

        # get rule config prompt, parameter and statement
        prompt_generate, parameter_generate, statement_generate = output_parser.get_format_instructions()

        prompt_template = PromptTemplateParser(prompt_generate)

        parameter_template = PromptTemplateParser(parameter_generate)

        statement_template = PromptTemplateParser(statement_generate)

        # format the prompt_generate_prompt
        prompt_generate_prompt = prompt_template.format(
            inputs={
                "TASK_DESCRIPTION": instruction,
            },
            remove_template_variables=False,
        )
        prompt_messages = [UserPromptMessage(content=prompt_generate_prompt)]

        # get model instance
        model_manager = ModelManager()
        model_instance = model_manager.get_model_instance(
            tenant_id=tenant_id,
            model_type=ModelType.LLM,
            provider=model_config.get("provider", ""),
            model=model_config.get("name", ""),
        )

        try:
            try:
                # the first step to generate the task prompt
                prompt_content: LLMResult = model_instance.invoke_llm(
                    prompt_messages=list(prompt_messages), model_parameters=model_parameters, stream=False
                )
            except InvokeError as e:
                error = str(e)
                error_step = "generate prefix prompt"
                rule_config["error"] = f"Failed to {error_step}. Error: {error}" if error else ""

                return rule_config

            rule_config["prompt"] = cast(str, prompt_content.message.content)

            if not isinstance(prompt_content.message.content, str):
                raise NotImplementedError("prompt content is not a string")
            parameter_generate_prompt = parameter_template.format(
                inputs={
                    "INPUT_TEXT": prompt_content.message.content,
                },
                remove_template_variables=False,
            )
            parameter_messages = [UserPromptMessage(content=parameter_generate_prompt)]

            # the second step to generate the task_parameter and task_statement
            statement_generate_prompt = statement_template.format(
                inputs={
                    "TASK_DESCRIPTION": instruction,
                    "INPUT_TEXT": prompt_content.message.content,
                },
                remove_template_variables=False,
            )
            statement_messages = [UserPromptMessage(content=statement_generate_prompt)]

            try:
                parameter_content: LLMResult = model_instance.invoke_llm(
                    prompt_messages=list(parameter_messages), model_parameters=model_parameters, stream=False
                )
                rule_config["variables"] = re.findall(r'"\s*([^"]+)\s*"', cast(str, parameter_content.message.content))
            except InvokeError as e:
                error = str(e)
                error_step = "generate variables"

            try:
                statement_content: LLMResult = model_instance.invoke_llm(
                    prompt_messages=list(statement_messages), model_parameters=model_parameters, stream=False
                )
                rule_config["opening_statement"] = cast(str, statement_content.message.content)
            except InvokeError as e:
                error = str(e)
                error_step = "generate conversation opener"

        except Exception as e:
            logger.exception("Failed to generate rule config, model: %s", model_config.get("name"))
            rule_config["error"] = str(e)

        rule_config["error"] = f"Failed to {error_step}. Error: {error}" if error else ""

        return rule_config

    @classmethod
    def generate_code(cls, tenant_id: str, instruction: str, model_config: dict, code_language: str = "javascript"):
        if code_language == "python":
            prompt_template = PromptTemplateParser(PYTHON_CODE_GENERATOR_PROMPT_TEMPLATE)
        else:
            prompt_template = PromptTemplateParser(JAVASCRIPT_CODE_GENERATOR_PROMPT_TEMPLATE)

        prompt = prompt_template.format(
            inputs={
                "INSTRUCTION": instruction,
                "CODE_LANGUAGE": code_language,
            },
            remove_template_variables=False,
        )

        model_manager = ModelManager()
        model_instance = model_manager.get_model_instance(
            tenant_id=tenant_id,
            model_type=ModelType.LLM,
            provider=model_config.get("provider", ""),
            model=model_config.get("name", ""),
        )

        prompt_messages = [UserPromptMessage(content=prompt)]
        model_parameters = model_config.get("completion_params", {})
        try:
            response: LLMResult = model_instance.invoke_llm(
                prompt_messages=list(prompt_messages), model_parameters=model_parameters, stream=False
            )

            generated_code = cast(str, response.message.content)
            return {"code": generated_code, "language": code_language, "error": ""}

        except InvokeError as e:
            error = str(e)
            return {"code": "", "language": code_language, "error": f"Failed to generate code. Error: {error}"}
        except Exception as e:
            logger.exception(
                "Failed to invoke LLM model, model: %s, language: %s", model_config.get("name"), code_language
            )
            return {"code": "", "language": code_language, "error": f"An unexpected error occurred: {str(e)}"}

    @classmethod
    def generate_qa_document(cls, tenant_id: str, query, document_language: str):
        prompt = GENERATOR_QA_PROMPT.format(language=document_language)

        model_manager = ModelManager()
        model_instance = model_manager.get_default_model_instance(
            tenant_id=tenant_id,
            model_type=ModelType.LLM,
        )

        prompt_messages: list[PromptMessage] = [SystemPromptMessage(content=prompt), UserPromptMessage(content=query)]

        # Explicitly use the non-streaming overload
        result = model_instance.invoke_llm(
            prompt_messages=prompt_messages,
            model_parameters={"temperature": 0.01, "max_tokens": 2000},
            stream=False,
        )

        # Runtime type check since pyright has issues with the overload
        if not isinstance(result, LLMResult):
            raise TypeError("Expected LLMResult when stream=False")
        response = result

        answer = cast(str, response.message.content)
        return answer.strip()

    @classmethod
    def generate_structured_output(cls, tenant_id: str, instruction: str, model_config: dict):
        model_manager = ModelManager()
        model_instance = model_manager.get_model_instance(
            tenant_id=tenant_id,
            model_type=ModelType.LLM,
            provider=model_config.get("provider", ""),
            model=model_config.get("name", ""),
        )

        prompt_messages = [
            SystemPromptMessage(content=SYSTEM_STRUCTURED_OUTPUT_GENERATE),
            UserPromptMessage(content=instruction),
        ]
        model_parameters = model_config.get("model_parameters", {})

        try:
            response: LLMResult = model_instance.invoke_llm(
                prompt_messages=list(prompt_messages), model_parameters=model_parameters, stream=False
            )

            raw_content = response.message.content

            if not isinstance(raw_content, str):
                raise ValueError(f"LLM response content must be a string, got: {type(raw_content)}")

            try:
                parsed_content = json.loads(raw_content)
            except json.JSONDecodeError:
                parsed_content = json_repair.loads(raw_content)

            if not isinstance(parsed_content, dict | list):
                raise ValueError(f"Failed to parse structured output from llm: {raw_content}")

            generated_json_schema = json.dumps(parsed_content, indent=2, ensure_ascii=False)
            return {"output": generated_json_schema, "error": ""}

        except InvokeError as e:
            error = str(e)
            return {"output": "", "error": f"Failed to generate JSON Schema. Error: {error}"}
        except Exception as e:
            logger.exception("Failed to invoke LLM model, model: %s", model_config.get("name"))
            return {"output": "", "error": f"An unexpected error occurred: {str(e)}"}

    @staticmethod
    def instruction_modify_legacy(
        tenant_id: str, flow_id: str, current: str, instruction: str, model_config: dict, ideal_output: str | None
    ):
        last_run: Message | None = (
            db.session.query(Message).where(Message.app_id == flow_id).order_by(Message.created_at.desc()).first()
        )
        if not last_run:
            return LLMGenerator.__instruction_modify_common(
                tenant_id=tenant_id,
                model_config=model_config,
                last_run=None,
                current=current,
                error_message="",
                instruction=instruction,
                node_type="llm",
                ideal_output=ideal_output,
            )
        last_run_dict = {
            "query": last_run.query,
            "answer": last_run.answer,
            "error": last_run.error,
        }
        return LLMGenerator.__instruction_modify_common(
            tenant_id=tenant_id,
            model_config=model_config,
            last_run=last_run_dict,
            current=current,
            error_message=str(last_run.error),
            instruction=instruction,
            node_type="llm",
            ideal_output=ideal_output,
        )

    @staticmethod
    def instruction_modify_workflow(
        tenant_id: str,
        flow_id: str,
        node_id: str,
        current: str,
        instruction: str,
        model_config: dict,
        ideal_output: str | None,
        workflow_service: WorkflowServiceInterface,
    ):
        session = db.session()

        app: App | None = session.query(App).where(App.id == flow_id).first()
        if not app:
            raise ValueError("App not found.")
        workflow = workflow_service.get_draft_workflow(app_model=app)
        if not workflow:
            raise ValueError("Workflow not found for the given app model.")
        last_run = workflow_service.get_node_last_run(app_model=app, workflow=workflow, node_id=node_id)
        try:
            node_type = cast(WorkflowNodeExecutionModel, last_run).node_type
        except Exception:
            try:
                node_type = [it for it in workflow.graph_dict["graph"]["nodes"] if it["id"] == node_id][0]["data"][
                    "type"
                ]
            except Exception:
                node_type = "llm"

        if not last_run:  # Node is not executed yet
            return LLMGenerator.__instruction_modify_common(
                tenant_id=tenant_id,
                model_config=model_config,
                last_run=None,
                current=current,
                error_message="",
                instruction=instruction,
                node_type=node_type,
                ideal_output=ideal_output,
            )

        def agent_log_of(node_execution: WorkflowNodeExecutionModel) -> Sequence:
            raw_agent_log = node_execution.execution_metadata_dict.get(WorkflowNodeExecutionMetadataKey.AGENT_LOG, [])
            if not raw_agent_log:
                return []

            return [
                {
                    "status": event["status"],
                    "error": event["error"],
                    "data": event["data"],
                }
                for event in raw_agent_log
            ]

        inputs = last_run.load_full_inputs(session, storage)
        last_run_dict = {
            "inputs": inputs,
            "status": last_run.status,
            "error": last_run.error,
            "agent_log": agent_log_of(last_run),
        }

        return LLMGenerator.__instruction_modify_common(
            tenant_id=tenant_id,
            model_config=model_config,
            last_run=last_run_dict,
            current=current,
            error_message=last_run.error,
            instruction=instruction,
            node_type=last_run.node_type,
            ideal_output=ideal_output,
        )

    @staticmethod
    def __instruction_modify_common(
        tenant_id: str,
        model_config: dict,
        last_run: dict | None,
        current: str | None,
        error_message: str | None,
        instruction: str,
        node_type: str,
        ideal_output: str | None,
    ):
        # Use unified variable injector
        variable_providers = {
            "last_run": lambda: json.dumps(last_run) if last_run else "null",
            "current": lambda: current or "null",
            "error_message": lambda: error_message or "null",
        }

        injected_instruction = LLMGenerator.__inject_variables(
            instruction=instruction,
            variable_providers=variable_providers
        )
        model_instance = ModelManager().get_model_instance(
            tenant_id=tenant_id,
            model_type=ModelType.LLM,
            provider=model_config.get("provider", ""),
            model=model_config.get("name", ""),
        )
        match node_type:
            case "llm" | "agent":
                system_prompt = LLM_MODIFY_PROMPT_SYSTEM
            case "code":
                system_prompt = LLM_MODIFY_CODE_SYSTEM
            case _:
                system_prompt = LLM_MODIFY_PROMPT_SYSTEM
        prompt_messages = [
            SystemPromptMessage(content=system_prompt),
            UserPromptMessage(
                content=json.dumps(
                    {
                        "current": current,
                        "last_run": last_run,
                        "instruction": injected_instruction,
                        "ideal_output": ideal_output,
                    }
                )
            ),
        ]
        model_parameters = {"temperature": 0.4}

        try:
            response: LLMResult = model_instance.invoke_llm(
                prompt_messages=list(prompt_messages), model_parameters=model_parameters, stream=False
            )

            generated_raw = cast(str, response.message.content)
            first_brace = generated_raw.find("{")
            last_brace = generated_raw.rfind("}")
            return {**json.loads(generated_raw[first_brace : last_brace + 1])}

        except InvokeError as e:
            error = str(e)
            return {"error": f"Failed to generate code. Error: {error}"}
        except Exception as e:
            logger.exception(
                "Failed to invoke LLM model, model: %s", json.dumps(model_config.get("name")), exc_info=True
            )
            return {"error": f"An unexpected error occurred: {str(e)}"}

    @staticmethod
    def update_memory_block(
        tenant_id: str,
        visible_history: Sequence[tuple[str, str]],
        variable_pool: VariablePool,
        memory_block: MemoryBlock,
        memory_spec: MemoryBlockSpec
    ) -> str:
        model_instance = ModelManager().get_model_instance(
            tenant_id=tenant_id,
            provider=memory_spec.model.provider,
            model=memory_spec.model.name,
            model_type=ModelType.LLM,
        )
        formatted_history = ""
        for sender, message in visible_history:
            formatted_history += f"{sender}: {message}\n"
        filled_instruction = variable_pool.convert_template(memory_spec.instruction).text
        formatted_prompt = PromptTemplateParser(MEMORY_UPDATE_PROMPT).format(
            inputs={
                "formatted_history": formatted_history,
                "current_value": memory_block.value,
                "instruction": filled_instruction,
            }
        )
        llm_result = model_instance.invoke_llm(
            prompt_messages=[UserPromptMessage(content=formatted_prompt)],
            model_parameters=memory_spec.model.completion_params,
            stream=False,
        )
        return llm_result.message.get_text_content()

    @staticmethod
    def generate_memory_template(
        tenant_id: str,
        instruction: str,
        model_config: dict,
    ) -> dict:
        """
        Generate Memory Template

        Uses MEMORY_TEMPLATE_GENERATION_SYSTEM_PROMPT
        """
        model_instance = ModelManager().get_model_instance(
            tenant_id=tenant_id,
            model_type=ModelType.LLM,
            provider=model_config.get("provider", ""),
            model=model_config.get("name", ""),
        )

        prompt_messages: list[PromptMessage] = [
            SystemPromptMessage(content=MEMORY_TEMPLATE_GENERATION_SYSTEM_PROMPT),
            UserPromptMessage(content=instruction),
        ]

        try:
            response = model_instance.invoke_llm(
                prompt_messages=prompt_messages,
                model_parameters={"temperature": 0.7},
                stream=False,
            )

            generated_template = response.message.get_text_content()
            return {"template": generated_template}

        except Exception as e:
            logger.exception("Failed to generate memory template")
            return {"error": f"Failed to generate memory template: {str(e)}"}

    @staticmethod
    def generate_memory_instruction(
        tenant_id: str,
        instruction: str,
        model_config: dict,
    ) -> dict:
        """
        Generate Memory Instruction

        Uses MEMORY_INSTRUCTION_GENERATION_SYSTEM_PROMPT
        """
        model_instance = ModelManager().get_model_instance(
            tenant_id=tenant_id,
            model_type=ModelType.LLM,
            provider=model_config.get("provider", ""),
            model=model_config.get("name", ""),
        )

        prompt_messages: list[PromptMessage] = [
            SystemPromptMessage(content=MEMORY_INSTRUCTION_GENERATION_SYSTEM_PROMPT),
            UserPromptMessage(content=instruction),
        ]

        try:
            response = model_instance.invoke_llm(
                prompt_messages=prompt_messages,
                model_parameters={"temperature": 0.7},
                stream=False,
            )

            generated_instruction = response.message.get_text_content()
            return {"instruction": generated_instruction}

        except Exception as e:
            logger.exception("Failed to generate memory instruction")
            return {"error": f"Failed to generate memory instruction: {str(e)}"}

    @staticmethod
    def edit_memory_template(
        tenant_id: str,
        flow_id: str,
        node_id: str | None,
        current: str,
        instruction: str,
        model_config: dict,
        ideal_output: str | None = None,
    ) -> dict:
        """
        Edit Memory Template

        Supports variable references: {{#history#}}, {{#system_prompt#}}
        """
        # Use unified variable injector
        variable_providers = {
            "history": lambda: LLMGenerator.__get_history_json(flow_id, node_id, tenant_id),
            "system_prompt": lambda: json.dumps(
                LLMGenerator.__get_system_prompt(flow_id, node_id, tenant_id),
                ensure_ascii=False
            ),
        }

        injected_instruction = LLMGenerator.__inject_variables(
            instruction=instruction,
            variable_providers=variable_providers
        )

        model_instance = ModelManager().get_model_instance(
            tenant_id=tenant_id,
            model_type=ModelType.LLM,
            provider=model_config.get("provider", ""),
            model=model_config.get("name", ""),
        )

        system_prompt = MEMORY_TEMPLATE_EDIT_SYSTEM_PROMPT
        user_content = json.dumps({
            "current_template": current,
            "instruction": injected_instruction,
            "ideal_output": ideal_output,
        })

        prompt_messages: list[PromptMessage] = [
            SystemPromptMessage(content=system_prompt),
            UserPromptMessage(content=user_content),
        ]

        try:
            response = model_instance.invoke_llm(
                prompt_messages=prompt_messages,
                model_parameters={"temperature": 0.4},
                stream=False,
            )

            generated_raw = response.message.get_text_content()
            # Extract JSON
            first_brace = generated_raw.find("{")
            last_brace = generated_raw.rfind("}")
            result = json.loads(generated_raw[first_brace : last_brace + 1])

            return {
                "modified": result.get("modified", ""),
                "message": result.get("message", "Template updated successfully"),
            }

        except Exception as e:
            logger.exception("Failed to edit memory template")
            return {"error": f"Failed to edit memory template: {str(e)}"}

    @staticmethod
    def edit_memory_instruction(
        tenant_id: str,
        flow_id: str,
        node_id: str | None,
        current: str,
        instruction: str,
        model_config: dict,
        ideal_output: str | None = None,
    ) -> dict:
        """
        Edit Memory Instruction

        Supports variable references: {{#history#}}, {{#system_prompt#}}
        """
        # Use unified variable injector
        variable_providers = {
            "history": lambda: LLMGenerator.__get_history_json(flow_id, node_id, tenant_id),
            "system_prompt": lambda: json.dumps(
                LLMGenerator.__get_system_prompt(flow_id, node_id, tenant_id),
                ensure_ascii=False
            ),
        }

        injected_instruction = LLMGenerator.__inject_variables(
            instruction=instruction,
            variable_providers=variable_providers
        )

        model_instance = ModelManager().get_model_instance(
            tenant_id=tenant_id,
            model_type=ModelType.LLM,
            provider=model_config.get("provider", ""),
            model=model_config.get("name", ""),
        )

        system_prompt = MEMORY_INSTRUCTION_EDIT_SYSTEM_PROMPT
        user_content = json.dumps({
            "current_instruction": current,
            "instruction": injected_instruction,
            "ideal_output": ideal_output,
        })

        prompt_messages: list[PromptMessage] = [
            SystemPromptMessage(content=system_prompt),
            UserPromptMessage(content=user_content),
        ]

        try:
            response = model_instance.invoke_llm(
                prompt_messages=prompt_messages,
                model_parameters={"temperature": 0.4},
                stream=False,
            )

            generated_raw = response.message.get_text_content()
            # Extract JSON
            first_brace = generated_raw.find("{")
            last_brace = generated_raw.rfind("}")
            result = json.loads(generated_raw[first_brace : last_brace + 1])

            return {
                "modified": result.get("modified", ""),
                "message": result.get("message", "Instruction updated successfully"),
            }

        except Exception as e:
            logger.exception("Failed to edit memory instruction")
            return {"error": f"Failed to edit memory instruction: {str(e)}"}

    # ==================== Unified variable injector (private method) ====================

    @staticmethod
    def __inject_variables(
        instruction: str,
        variable_providers: Mapping[str, Callable[[], str]]
    ) -> str:
        """
        Unified variable injector (private method)

        Replaces variable placeholders {{#variable_name#}} in instruction with actual values

        Args:
            instruction: User's original instruction
            variable_providers: Mapping of variable name -> getter function
                Example: {"last_run": lambda: json.dumps(data), "history": lambda: get_history()}

        Returns:
            Instruction with injected variables

        Features:
        1. Lazy loading: Only calls getter function when placeholder is present
        2. Fault tolerance: Failure of one variable doesn't affect others
        3. Extensible: New variables can be added through variable_providers parameter
        """
        injected = instruction

        for var_name, provider_func in variable_providers.items():
            placeholder = f"{{{{#{var_name}#}}}}"

            if placeholder in injected:
                try:
                    # Lazy loading: only call when needed
                    value = provider_func()
                    injected = injected.replace(placeholder, value)
                except Exception as e:
                    logger.warning("Failed to inject variable '%s': %s", var_name, e)
                    # Use default value on failure, don't block the request
                    default_value = "[]" if var_name == "history" else '""'
                    injected = injected.replace(placeholder, default_value)

        return injected

    @staticmethod
    def __get_history_json(
        flow_id: str,
        node_id: str | None,
        tenant_id: str
    ) -> str:
        """
        Get conversation history as JSON string (private method)

        Args:
            flow_id: Application ID
            node_id: Node ID (optional, None indicates APP level)
            tenant_id: Tenant ID

        Returns:
            JSON array string in format: [{"role": "user", "content": "..."}, ...]
            Returns "[]" if no history exists
        """
        from services.chatflow_history_service import ChatflowHistoryService

        app = db.session.query(App).filter_by(id=flow_id).first()
        if not app:
            return "[]"

        visible_messages = ChatflowHistoryService.get_latest_chat_history_for_app(
            app_id=app.id,
            tenant_id=tenant_id,
            node_id=node_id or None
        )

        history_json = [
            {"role": msg.role.value, "content": msg.content}
            for msg in visible_messages
        ]

        return json.dumps(history_json, ensure_ascii=False)

    @staticmethod
    def __get_system_prompt(
        flow_id: str,
        node_id: str | None,
        tenant_id: str
    ) -> str:
        """
        Get system prompt (private method)

        Args:
            flow_id: Application ID
            node_id: Node ID (optional)
            tenant_id: Tenant ID

        Returns:
            System prompt string, returns "" if none exists
        """
        from services.workflow_service import WorkflowService

        app = db.session.query(App).filter_by(id=flow_id).first()
        if not app:
            return ""

        # Legacy app
        if app.mode in {"chat", "completion"}:
            try:
                app_model_config = app.app_model_config_dict
                return app_model_config.get("pre_prompt", "")
            except Exception:
                return ""

        # Workflow app
        try:
            workflow = WorkflowService().get_draft_workflow(app_model=app)
            if not workflow:
                return ""

            nodes = workflow.graph_dict.get("nodes", [])

            if node_id:
                # Get system prompt for specified node
                node = next((n for n in nodes if n["id"] == node_id), None)
                if not node or node["data"]["type"] not in ["llm", "agent"]:
                    return ""

                prompt_template = node["data"].get("prompt_template")
                return LLMGenerator.__extract_system_prompt_from_template(prompt_template)
            else:
                # APP level: find the main LLM node (connected to END node)
                edges = workflow.graph_dict.get("edges", [])
                llm_nodes = [n for n in nodes if n["data"]["type"] in ["llm", "agent"]]

                for edge in edges:
                    if edge.get("target") == "end":
                        source_node = next((n for n in llm_nodes if n["id"] == edge.get("source")), None)
                        if source_node:
                            prompt_template = source_node["data"].get("prompt_template")
                            system_prompt = LLMGenerator.__extract_system_prompt_from_template(prompt_template)
                            if system_prompt:
                                return system_prompt

                # Fallback: return system prompt from first LLM node
                if llm_nodes:
                    prompt_template = llm_nodes[0]["data"].get("prompt_template")
                    return LLMGenerator.__extract_system_prompt_from_template(prompt_template)

                return ""
        except Exception as e:
            logger.warning("Failed to get system prompt: %s", e)
            return ""

    @staticmethod
    def __extract_system_prompt_from_template(prompt_template: Any) -> str:
        """
        Extract system prompt from prompt_template (private method)

        Args:
            prompt_template: LLM node's prompt_template (may be list or dict)

        Returns:
            System prompt string
        """
        if not prompt_template:
            return ""

        if isinstance(prompt_template, list):
            # Chat model: [{"role": "system", "text": "..."}, ...]
            system_msg = next((m for m in prompt_template if m.get("role") == "system"), None)
            return system_msg.get("text", "") if system_msg else ""
        elif isinstance(prompt_template, dict):
            # Completion model: {"text": "..."}
            return prompt_template.get("text", "")
        else:
            return ""
