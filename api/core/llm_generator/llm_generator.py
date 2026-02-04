import json
import logging
import re
from collections.abc import Sequence
from typing import Protocol

import json_repair

from core.app.app_config.entities import ModelConfig
from core.llm_generator.context_models import (
    AvailableVarPayload,
    CodeContextPayload,
    ParameterInfoPayload,
)
from core.llm_generator.entities import RuleCodeGeneratePayload, RuleGeneratePayload, RuleStructuredOutputPayload
from core.llm_generator.output_models import (
    CodeNodeOutputItem,
    CodeNodeStructuredOutput,
    InstructionModifyOutput,
    SuggestedQuestionsOutput,
)
from core.llm_generator.output_parser.rule_config_generator import RuleConfigGeneratorOutputParser
from core.llm_generator.output_parser.suggested_questions_after_answer import SuggestedQuestionsAfterAnswerOutputParser
from core.llm_generator.prompts import (
    CONVERSATION_TITLE_PROMPT,
    GENERATOR_QA_PROMPT,
    JAVASCRIPT_CODE_GENERATOR_PROMPT_TEMPLATE,
    LLM_MODIFY_CODE_SYSTEM,
    LLM_MODIFY_PROMPT_SYSTEM,
    PYTHON_CODE_GENERATOR_PROMPT_TEMPLATE,
    SUGGESTED_QUESTIONS_MAX_TOKENS,
    SUGGESTED_QUESTIONS_TEMPERATURE,
    SYSTEM_STRUCTURED_OUTPUT_GENERATE,
    WORKFLOW_RULE_CONFIG_PROMPT_GENERATE_TEMPLATE,
)
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
        answer = response.message.get_text_content()
        if answer == "":
            return ""
        try:
            result_dict = json.loads(answer)
        except json.JSONDecodeError:
            result_dict = json_repair.loads(answer)

        if not isinstance(result_dict, dict):
            answer = query
        else:
            output = result_dict.get("Your Output")
            if isinstance(output, str) and output.strip():
                answer = output.strip()
            else:
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
        try:
            response: LLMResult = model_instance.invoke_llm(
                prompt_messages=list(prompt_messages),
                model_parameters={
                    "max_tokens": SUGGESTED_QUESTIONS_MAX_TOKENS,
                    "temperature": SUGGESTED_QUESTIONS_TEMPERATURE,
                },
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
    def generate_rule_config(cls, tenant_id: str, args: RuleGeneratePayload):
        output_parser = RuleConfigGeneratorOutputParser()

        error = ""
        error_step = ""
        rule_config = {"prompt": "", "variables": [], "opening_statement": "", "error": ""}
        model_parameters = args.model_config_data.completion_params
        if args.no_variable:
            prompt_template = PromptTemplateParser(WORKFLOW_RULE_CONFIG_PROMPT_GENERATE_TEMPLATE)

            prompt_generate = prompt_template.format(
                inputs={
                    "TASK_DESCRIPTION": args.instruction,
                },
                remove_template_variables=False,
            )

            prompt_messages = [UserPromptMessage(content=prompt_generate)]

            model_manager = ModelManager()

            model_instance = model_manager.get_model_instance(
                tenant_id=tenant_id,
                model_type=ModelType.LLM,
                provider=args.model_config_data.provider,
                model=args.model_config_data.name,
            )

            try:
                response: LLMResult = model_instance.invoke_llm(
                    prompt_messages=list(prompt_messages), model_parameters=model_parameters, stream=False
                )

                rule_config["prompt"] = response.message.get_text_content()

            except InvokeError as e:
                error = str(e)
                error_step = "generate rule config"
            except Exception as e:
                logger.exception("Failed to generate rule config, model: %s", args.model_config_data.name)
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
                "TASK_DESCRIPTION": args.instruction,
            },
            remove_template_variables=False,
        )
        prompt_messages = [UserPromptMessage(content=prompt_generate_prompt)]

        # get model instance
        model_manager = ModelManager()
        model_instance = model_manager.get_model_instance(
            tenant_id=tenant_id,
            model_type=ModelType.LLM,
            provider=args.model_config_data.provider,
            model=args.model_config_data.name,
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

            rule_config["prompt"] = prompt_content.message.get_text_content()

            parameter_generate_prompt = parameter_template.format(
                inputs={
                    "INPUT_TEXT": prompt_content.message.get_text_content(),
                },
                remove_template_variables=False,
            )
            parameter_messages = [UserPromptMessage(content=parameter_generate_prompt)]

            # the second step to generate the task_parameter and task_statement
            statement_generate_prompt = statement_template.format(
                inputs={
                    "TASK_DESCRIPTION": args.instruction,
                    "INPUT_TEXT": prompt_content.message.get_text_content(),
                },
                remove_template_variables=False,
            )
            statement_messages = [UserPromptMessage(content=statement_generate_prompt)]

            try:
                parameter_content: LLMResult = model_instance.invoke_llm(
                    prompt_messages=list(parameter_messages), model_parameters=model_parameters, stream=False
                )
                rule_config["variables"] = re.findall(r'"\s*([^"]+)\s*"', parameter_content.message.get_text_content())
            except InvokeError as e:
                error = str(e)
                error_step = "generate variables"

            try:
                statement_content: LLMResult = model_instance.invoke_llm(
                    prompt_messages=list(statement_messages), model_parameters=model_parameters, stream=False
                )
                rule_config["opening_statement"] = statement_content.message.get_text_content()
            except InvokeError as e:
                error = str(e)
                error_step = "generate conversation opener"

        except Exception as e:
            logger.exception("Failed to generate rule config, model: %s", args.model_config_data.name)
            rule_config["error"] = str(e)

        rule_config["error"] = f"Failed to {error_step}. Error: {error}" if error else ""

        return rule_config

    @classmethod
    def generate_code(
        cls,
        tenant_id: str,
        args: RuleCodeGeneratePayload,
    ):
        if args.code_language == "python":
            prompt_template = PromptTemplateParser(PYTHON_CODE_GENERATOR_PROMPT_TEMPLATE)
        else:
            prompt_template = PromptTemplateParser(JAVASCRIPT_CODE_GENERATOR_PROMPT_TEMPLATE)

        prompt = prompt_template.format(
            inputs={
                "INSTRUCTION": args.instruction,
                "CODE_LANGUAGE": args.code_language,
            },
            remove_template_variables=False,
        )

        model_manager = ModelManager()
        model_instance = model_manager.get_model_instance(
            tenant_id=tenant_id,
            model_type=ModelType.LLM,
            provider=args.model_config_data.provider,
            model=args.model_config_data.name,
        )

        prompt_messages = [UserPromptMessage(content=prompt)]
        model_parameters = args.model_config_data.completion_params
        try:
            response: LLMResult = model_instance.invoke_llm(
                prompt_messages=list(prompt_messages), model_parameters=model_parameters, stream=False
            )

            generated_code = response.message.get_text_content()
            return {"code": generated_code, "language": args.code_language, "error": ""}

        except InvokeError as e:
            error = str(e)
            return {"code": "", "language": args.code_language, "error": f"Failed to generate code. Error: {error}"}
        except Exception as e:
            logger.exception(
                "Failed to invoke LLM model, model: %s, language: %s", args.model_config_data.name, args.code_language
            )
            return {"code": "", "language": args.code_language, "error": f"An unexpected error occurred: {str(e)}"}

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

        answer = response.message.get_text_content()
        return answer.strip()

    @classmethod
    def generate_structured_output(cls, tenant_id: str, args: RuleStructuredOutputPayload):
        model_manager = ModelManager()
        model_instance = model_manager.get_model_instance(
            tenant_id=tenant_id,
            model_type=ModelType.LLM,
            provider=args.model_config_data.provider,
            model=args.model_config_data.name,
        )

        prompt_messages = [
            SystemPromptMessage(content=SYSTEM_STRUCTURED_OUTPUT_GENERATE),
            UserPromptMessage(content=args.instruction),
        ]
        model_parameters = args.model_config_data.completion_params

        try:
            response: LLMResult = model_instance.invoke_llm(
                prompt_messages=list(prompt_messages), model_parameters=model_parameters, stream=False
            )

            raw_content = response.message.get_text_content()

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
            logger.exception("Failed to invoke LLM model, model: %s", args.model_config_data.name)
            return {"output": "", "error": f"An unexpected error occurred: {str(e)}"}

    @classmethod
    def generate_with_context(
        cls,
        tenant_id: str,
        language: str,
        prompt_messages: list[PromptMessage],
        model_config: dict,
        available_vars: Sequence[AvailableVarPayload],
        parameter_info: ParameterInfoPayload,
        code_context: CodeContextPayload,
    ) -> dict:
        """
        Generate extractor code node based on conversation context.

        Args:
            tenant_id: Tenant/workspace ID
            language: Code language (python3/javascript)
            prompt_messages: Multi-turn conversation history (last message is instruction)
            model_config: Model configuration (provider, name, completion_params)
            available_vars: Client-provided available variables with types/schema
            parameter_info: Client-provided parameter metadata (type/constraints)
            code_context: Client-provided existing code node context

        Returns:
            dict with CodeNodeData format:
            - variables: Input variable selectors
            - code_language: Code language
            - code: Generated code
            - outputs: Output definitions
            - message: Explanation
            - error: Error message if any
        """

        # available_vars/parameter_info/code_context are provided by the frontend context-generate modal.
        # See web/app/components/workflow/nodes/tool/components/context-generate-modal/hooks/use-context-generate.ts

        system_prompt = cls._build_extractor_system_prompt(
            available_vars=available_vars, parameter_info=parameter_info, language=language, code_context=code_context
        )

        # Construct complete prompt_messages with system prompt
        complete_messages: list[PromptMessage] = [
            SystemPromptMessage(content=system_prompt),
            *prompt_messages,
        ]

        from core.llm_generator.output_parser.structured_output import invoke_llm_with_pydantic_model

        # Get model instance and schema
        provider = model_config.get("provider", "")
        model_name = model_config.get("name", "")
        model_instance = ModelManager().get_model_instance(
            tenant_id=tenant_id,
            model_type=ModelType.LLM,
            provider=provider,
            model=model_name,
        )

        model_schema = model_instance.model_type_instance.get_model_schema(model_name, model_instance.credentials)
        if not model_schema:
            return cls._error_response(f"Model schema not found for {model_name}")

        model_parameters = model_config.get("completion_params", {})
        try:
            response = invoke_llm_with_pydantic_model(
                provider=provider,
                model_schema=model_schema,
                model_instance=model_instance,
                prompt_messages=complete_messages,
                output_model=CodeNodeStructuredOutput,
                model_parameters=model_parameters,
            )

            response_payload = response.model_dump()
            response_payload["outputs"] = cls._format_code_outputs(response.outputs)
            return {
                **response_payload,
                "code_language": language,
                "error": "",
            }

        except InvokeError as e:
            return cls._error_response(str(e))
        except Exception as e:
            logger.exception("Failed to generate with context, model: %s", model_config.get("name"))
            return cls._error_response(f"An unexpected error occurred: {str(e)}")

    @classmethod
    def _error_response(cls, error: str) -> dict:
        """Return error response in CodeNodeData format."""
        return {
            "variables": [],
            "code_language": "python3",
            "code": "",
            "outputs": {},
            "message": "",
            "error": error,
        }

    @classmethod
    def _format_code_outputs(cls, outputs: Sequence[CodeNodeOutputItem]) -> dict[str, dict[str, str]]:
        """Normalize code outputs to a stable mapping for frontend consumers.

        The LLM structured output uses an array to satisfy strict-mode schemas, but the
        frontend expects a name-to-type mapping for Code node outputs.
        """
        mapped: dict[str, dict[str, str]] = {}
        for output_item in outputs:
            if not output_item.name:
                continue
            mapped[output_item.name] = {"type": str(output_item.type)}
        return mapped

    @classmethod
    def generate_suggested_questions(
        cls,
        tenant_id: str,
        language: str,
        available_vars: Sequence[AvailableVarPayload],
        parameter_info: ParameterInfoPayload,
        model_config: dict,
    ) -> dict:
        """
        Generate suggested questions for context generation.

        Returns dict with questions array and error field.
        """

        from core.llm_generator.output_parser.structured_output import invoke_llm_with_pydantic_model

        # available_vars/parameter_info are provided by the frontend context-generate modal.
        # See web/app/components/workflow/nodes/tool/components/context-generate-modal/hooks/use-context-generate.ts
        # Build prompt
        system_prompt = cls._build_suggested_questions_prompt(
            available_vars=available_vars,
            parameter_info=parameter_info,
            language=language,
        )

        prompt_messages: list[PromptMessage] = [
            UserPromptMessage(content=system_prompt),
        ]

        # Get model instance - use default if model_config not provided
        model_manager = ModelManager()
        if model_config:
            provider = model_config.get("provider", "")
            model_name = model_config.get("name", "")
            model_instance = model_manager.get_model_instance(
                tenant_id=tenant_id,
                model_type=ModelType.LLM,
                provider=provider,
                model=model_name,
            )
        else:
            model_instance = model_manager.get_default_model_instance(
                tenant_id=tenant_id,
                model_type=ModelType.LLM,
            )
            model_name = model_instance.model

        model_schema = model_instance.model_type_instance.get_model_schema(model_name, model_instance.credentials)
        if not model_schema:
            return {"questions": [], "error": f"Model schema not found for {model_name}"}

        completion_params = model_config.get("completion_params", {}) if model_config else {}
        try:
            response = invoke_llm_with_pydantic_model(
                provider=model_instance.provider,
                model_schema=model_schema,
                model_instance=model_instance,
                prompt_messages=prompt_messages,
                output_model=SuggestedQuestionsOutput,
                model_parameters=completion_params,
            )

            return {"questions": response.questions, "error": ""}

        except InvokeError as e:
            return {"questions": [], "error": str(e)}
        except Exception as e:
            logger.exception("Failed to generate suggested questions, model: %s", model_name)
            return {"questions": [], "error": f"An unexpected error occurred: {str(e)}"}

    @classmethod
    def _build_suggested_questions_prompt(
        cls,
        available_vars: Sequence[AvailableVarPayload],
        parameter_info: ParameterInfoPayload,
        language: str = "English",
    ) -> str:
        """Build minimal prompt for suggested questions generation."""
        parameter_block = cls._format_parameter_info(parameter_info)
        available_vars_block = cls._format_available_vars(
            available_vars,
            max_items=30,
            max_schema_chars=400,
            max_description_chars=120,
        )

        return f"""Suggest exactly 3 short instructions that would help generate code for the target parameter.

## Target Parameter
{parameter_block}

## Available Variables
{available_vars_block}

## Constraints
- Output exactly 3 instructions.
- Use {language}.
- Keep each instruction short and practical.
- Do not include code or variable syntax in the instructions.

## Instruction Example

- Count the output length of the `LLM` node.
- Get the `account_list` from the `QueryAccounts` tool node's output
"""

    @classmethod
    def _format_parameter_info(cls, parameter_info: ParameterInfoPayload) -> str:
        payload = parameter_info.model_dump(mode="python", by_alias=True)
        return json.dumps(payload, ensure_ascii=False)

    @classmethod
    def _format_available_vars(
        cls,
        available_vars: Sequence[AvailableVarPayload],
        *,
        max_items: int,
        max_schema_chars: int,
        max_description_chars: int,
    ) -> str:
        payload = [item.model_dump(mode="python", by_alias=True) for item in available_vars]
        return json.dumps(payload, ensure_ascii=False)

    @classmethod
    def _format_code_context(cls, code_context: CodeContextPayload | None) -> str:
        if not code_context:
            return ""
        code = code_context.code
        outputs = code_context.outputs
        variables = code_context.variables
        if not code and not outputs and not variables:
            return ""
        payload = code_context.model_dump(mode="python", by_alias=True)
        return json.dumps(payload, ensure_ascii=False)

    @classmethod
    def _build_extractor_system_prompt(
        cls,
        available_vars: Sequence[AvailableVarPayload],
        parameter_info: ParameterInfoPayload,
        language: str,
        code_context: CodeContextPayload,
    ) -> str:
        """Build system prompt for extractor code generation."""
        param_type = parameter_info.type or "string"
        parameter_block = cls._format_parameter_info(parameter_info)
        available_vars_block = cls._format_available_vars(
            available_vars,
            max_items=80,
            max_schema_chars=800,
            max_description_chars=160,
        )
        code_context_block = cls._format_code_context(code_context)
        code_context_section = f"\n{code_context_block}\n" if code_context_block else "\n"
        return f"""You are a code generator for Dify workflow automation.

Generate {language} code to extract/transform available variables for the target parameter.

## Target Parameter
{parameter_block}

## Available Variables
{available_vars_block}
{code_context_section}## Requirements
- Use only the listed value_selector paths.
- Do not invent variables or fields that are not listed.
- Write a main function that returns a dict, which has only one key: "{parameter_info.name}", and the value is the extracted variable of type "{param_type}".
- Respect target constraints (options/min/max/default/multiple) if provided.
- If existing code is provided, adapt it instead of rewriting from scratch.
- Return only JSON that matches the provided schema.
- If user is not talking about the code node, provide blank code/outputs/variables for user, say to user in `message`.
"""  # noqa: E501

    @staticmethod
    def instruction_modify_legacy(
        tenant_id: str,
        flow_id: str,
        current: str,
        instruction: str,
        model_config: ModelConfig,
        ideal_output: str | None,
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
        model_config: ModelConfig,
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
            if not last_run:
                raise ValueError()
            node_type = last_run.node_type
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
        model_config: ModelConfig,
        last_run: dict | None,
        current: str | None,
        error_message: str | None,
        instruction: str,
        node_type: str,
        ideal_output: str | None,
    ):
        LAST_RUN = "{{#last_run#}}"
        CURRENT = "{{#current#}}"
        ERROR_MESSAGE = "{{#error_message#}}"
        injected_instruction = instruction
        if LAST_RUN in injected_instruction:
            injected_instruction = injected_instruction.replace(LAST_RUN, json.dumps(last_run))
        if CURRENT in injected_instruction:
            injected_instruction = injected_instruction.replace(CURRENT, current or "null")
        if ERROR_MESSAGE in injected_instruction:
            injected_instruction = injected_instruction.replace(ERROR_MESSAGE, error_message or "null")
        model_instance = ModelManager().get_model_instance(
            tenant_id=tenant_id,
            model_type=ModelType.LLM,
            provider=model_config.provider,
            model=model_config.name,
        )
        model_name = model_config.name
        model_schema = model_instance.model_type_instance.get_model_schema(model_name, model_instance.credentials)
        if not model_schema:
            return {"error": f"Model schema not found for {model_name}"}
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
            from core.llm_generator.output_parser.structured_output import invoke_llm_with_pydantic_model

            response = invoke_llm_with_pydantic_model(
                provider=model_instance.provider,
                model_schema=model_schema,
                model_instance=model_instance,
                prompt_messages=list(prompt_messages),
                output_model=InstructionModifyOutput,
                model_parameters=model_parameters,
            )
            return response.model_dump(mode="python")
        except InvokeError as e:
            error = str(e)
            return {"error": f"Failed to generate code. Error: {error}"}
        except Exception as e:
            logger.exception("Failed to invoke LLM model, model: %s", json.dumps(model_config.name), exc_info=True)
            return {"error": f"An unexpected error occurred: {str(e)}"}
