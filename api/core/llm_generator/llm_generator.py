import json
import logging
import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, NotRequired, Protocol, TypedDict, cast

import json_repair
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.app.app_config.entities import ModelConfig
from core.app.entities.app_invoke_entities import CreditUsageCreatedBy
from core.llm_generator.entities import RuleCodeGeneratePayload, RuleGeneratePayload, RuleStructuredOutputPayload
from core.llm_generator.output_parser.rule_config_generator import RuleConfigGeneratorOutputParser
from core.llm_generator.output_parser.suggested_questions_after_answer import SuggestedQuestionsAfterAnswerOutputParser
from core.llm_generator.prompts import (
    CONVERSATION_TITLE_PROMPT,
    GENERATOR_QA_PROMPT,
    JAVASCRIPT_CODE_GENERATOR_PROMPT_TEMPLATE,
    LLM_MODIFY_CODE_SYSTEM,
    LLM_MODIFY_PROMPT_SYSTEM,
    PYTHON_CODE_GENERATOR_PROMPT_TEMPLATE,
    SYSTEM_STRUCTURED_OUTPUT_GENERATE,
    WORKFLOW_RULE_CONFIG_PROMPT_GENERATE_TEMPLATE,
)
from core.model_context import with_credit_usage_created_by
from core.model_manager import ModelInstance, ModelManager
from core.ops.entities.trace_entity import TraceTaskName
from core.ops.ops_trace_manager import TraceQueueManager, TraceTask
from core.ops.utils import measure_time
from core.plugin.impl.base import use_plugin_daemon_request_timeout
from core.prompt.utils.prompt_template_parser import PromptTemplateParser
from core.telemetry import PromptGenerationEvent, TelemetryContext
from core.telemetry import emit as telemetry_emit
from extensions.ext_storage import storage
from graphon.enums import WorkflowNodeExecutionMetadataKey
from graphon.model_runtime.entities.llm_entities import LLMResult
from graphon.model_runtime.entities.message_entities import PromptMessage, SystemPromptMessage, UserPromptMessage
from graphon.model_runtime.entities.model_entities import ModelType, ParameterType
from graphon.model_runtime.errors.invoke import InvokeError
from models import App, Message, WorkflowNodeExecutionModel
from models.workflow import Workflow

logger = logging.getLogger(__name__)

_SUGGESTED_QUESTIONS_MAX_TOKENS = 256
_SUGGESTED_QUESTIONS_TIMEOUT_SECONDS = 30.0
_LOW_REASONING_EFFORTS = ("none", "minimal", "low")


class SuggestedQuestionsModelConfig(TypedDict):
    provider: str
    name: str
    completion_params: NotRequired[dict[str, object]]


@dataclass(frozen=True)
class PreparedSuggestedQuestionsModel:
    """Resolved model credentials; ``None`` parameters select the default-model tuning."""

    model_instance: ModelInstance
    completion_params: dict[str, object] | None


def _normalize_completion_params(completion_params: dict[str, object]) -> tuple[dict[str, object], list[str]]:
    """
    Normalize raw completion params into invocation parameters and stop sequences.

    This mirrors the app-model access path by separating ``stop`` from provider
    parameters before invocation, then drops non-positive token limits because
    some plugin-backed models reject ``0`` after mapping ``max_tokens`` to their
    provider-specific output-token field.
    """
    normalized_parameters = dict(completion_params)
    stop_value = normalized_parameters.pop("stop", [])
    if isinstance(stop_value, list) and all(isinstance(item, str) for item in stop_value):
        stop = stop_value
    else:
        stop = []

    for token_limit_key in ("max_tokens", "max_output_tokens"):
        token_limit = normalized_parameters.get(token_limit_key)
        if isinstance(token_limit, int | float) and token_limit <= 0:
            normalized_parameters.pop(token_limit_key, None)

    return normalized_parameters, stop


def _default_suggested_questions_model_parameters(model_instance: ModelInstance) -> dict[str, object]:
    """Build a low-latency parameter set for the workspace default model."""
    parameters: dict[str, object] = {
        "max_tokens": _SUGGESTED_QUESTIONS_MAX_TOKENS,
        "temperature": 0.0,
    }

    try:
        model_schema = model_instance.get_model_schema()
    except Exception:
        logger.warning("Failed to inspect the default model schema for suggested questions", exc_info=True)
        return parameters

    parameter_rules = {rule.name: rule for rule in model_schema.parameter_rules}
    thinking_rule = parameter_rules.get("thinking")
    if thinking_rule is not None:
        if thinking_rule.type == ParameterType.BOOLEAN:
            parameters["thinking"] = False
            return parameters
        if "disabled" in thinking_rule.options:
            parameters["thinking"] = "disabled"
            return parameters

    reasoning_effort_rule = parameter_rules.get("reasoning_effort")
    if reasoning_effort_rule is not None:
        for effort in _LOW_REASONING_EFFORTS:
            if effort in reasoning_effort_rule.options:
                parameters["reasoning_effort"] = effort
                break

    return parameters


class WorkflowServiceInterface(Protocol):
    def get_draft_workflow(
        self, app_model: App, workflow_id: str | None = None, *, session: Session
    ) -> Workflow | None:
        pass

    def get_node_last_run(self, app_model: App, workflow: Workflow, node_id: str) -> WorkflowNodeExecutionModel | None:
        pass


class CodeGenerateResultDict(TypedDict):
    code: str
    language: str
    error: str


class StructuredOutputResultDict(TypedDict):
    output: str
    error: str


class LLMGenerator:
    @staticmethod
    def _emit_prompt_generation(
        *,
        tenant_id: str,
        app_id: str | None = None,
        operation_type: str,
        instruction: str,
        generated_output: str,
        model_provider: str,
        model_name: str,
        timer: dict,
        result: LLMResult | None = None,
        error: str | None = None,
    ) -> None:
        """Emit a PromptGenerationEvent via the core.telemetry facade."""
        try:
            usage = result.usage if result else None
            telemetry_emit(
                PromptGenerationEvent(
                    context=TelemetryContext(
                        tenant_id=tenant_id,
                        app_id=app_id,
                    ),
                    payload={
                        "tenant_id": tenant_id,
                        "app_id": app_id,
                        "operation_type": operation_type,
                        "instruction": instruction,
                        "generated_output": generated_output,
                        "model_provider": model_provider,
                        "model_name": model_name,
                        "prompt_tokens": usage.prompt_tokens if usage else 0,
                        "completion_tokens": usage.completion_tokens if usage else 0,
                        "total_tokens": usage.total_tokens if usage else 0,
                        "latency": (timer["end"] - timer["start"]).total_seconds() if timer.get("end") else 0.0,
                        "total_price": float(usage.total_price) if usage and usage.total_price else None,
                        "currency": usage.currency if usage else None,
                        "timer": timer,
                        "error": error,
                    },
                )
            )
        except Exception:
            logger.debug("Failed to emit prompt_generation telemetry", exc_info=True)

    @classmethod
    @with_credit_usage_created_by(CreditUsageCreatedBy.CONVERSATION_NAME)
    def generate_conversation_name(
        cls,
        tenant_id: str,
        query,
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
    ):
        prompt = CONVERSATION_TITLE_PROMPT

        if len(query) > 2000:
            query = query[:300] + "...[TRUNCATED]..." + query[-300:]

        query = query.replace("\n", " ")

        prompt += query + "\n"

        model_manager = ModelManager.for_tenant(tenant_id=tenant_id)
        model_instance = model_manager.get_default_model_instance(
            tenant_id=tenant_id,
            model_type=ModelType.LLM,
        )
        prompts: list[PromptMessage] = [UserPromptMessage(content=prompt)]

        with measure_time() as timer:
            response: LLMResult = model_instance.invoke_llm(
                prompt_messages=list(prompts), model_parameters={"max_tokens": 500, "temperature": 1}, stream=False
            )
        answer = response.message.get_text_content()
        if not answer.strip():
            answer = query
        else:
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
                message_id=message_id,
                generate_conversation_name=name,
                inputs=prompt,
                timer=timer,
                tenant_id=tenant_id,
            )
        )

        return name

    @classmethod
    @with_credit_usage_created_by(CreditUsageCreatedBy.SUGGESTED_QUESTIONS)
    def generate_suggested_questions_after_answer(
        cls,
        tenant_id: str,
        histories: str,
        *,
        instruction_prompt: str | None = None,
        model_config: object | None = None,
    ) -> Sequence[str]:
        prepared_model = cls.prepare_suggested_questions_model(tenant_id, model_config=model_config)
        if prepared_model is None:
            return []
        return cls.invoke_suggested_questions_after_answer(
            prepared_model, histories, instruction_prompt=instruction_prompt
        )

    @classmethod
    @with_credit_usage_created_by(CreditUsageCreatedBy.SUGGESTED_QUESTIONS)
    def prepare_suggested_questions_model(
        cls,
        tenant_id: str,
        *,
        model_config: object | None = None,
    ) -> PreparedSuggestedQuestionsModel | None:
        """Resolve the model before its caller releases database sessions.

        ``None`` means no usable configured or default model was found. Schema
        inspection and generation belong to invocation, after the read phase.
        """
        try:
            model_manager = ModelManager.for_tenant(tenant_id=tenant_id)
            configured_model = cast(dict[str, object], model_config) if isinstance(model_config, dict) else {}
            provider = configured_model.get("provider")
            model_name = configured_model.get("name")
            use_configured_model = False

            if isinstance(provider, str) and provider and isinstance(model_name, str) and model_name:
                try:
                    model_instance = model_manager.get_model_instance(
                        tenant_id=tenant_id,
                        model_type=ModelType.LLM,
                        provider=provider,
                        model=model_name,
                    )
                    use_configured_model = True
                except Exception:
                    logger.warning(
                        "Failed to use configured suggested-questions model %s/%s, fallback to default model",
                        provider,
                        model_name,
                        exc_info=True,
                    )
                    model_instance = model_manager.get_default_model_instance(
                        tenant_id=tenant_id,
                        model_type=ModelType.LLM,
                    )
            else:
                model_instance = model_manager.get_default_model_instance(
                    tenant_id=tenant_id,
                    model_type=ModelType.LLM,
                )
        except Exception:
            logger.exception("Failed to resolve the suggested-questions model")
            return None

        completion_params: dict[str, object] | None = None
        if use_configured_model:
            configured_completion_params = configured_model.get("completion_params")
            completion_params = (
                dict(configured_completion_params) if isinstance(configured_completion_params, dict) else {}
            )
        return PreparedSuggestedQuestionsModel(
            model_instance=model_instance,
            completion_params=completion_params,
        )

    @classmethod
    @with_credit_usage_created_by(CreditUsageCreatedBy.SUGGESTED_QUESTIONS)
    def invoke_suggested_questions_after_answer(
        cls,
        prepared_model: PreparedSuggestedQuestionsModel,
        histories: str,
        *,
        instruction_prompt: str | None = None,
    ) -> Sequence[str]:
        """Generate with an already resolved model without repeating model resolution."""
        output_parser = SuggestedQuestionsAfterAnswerOutputParser(instruction_prompt=instruction_prompt)
        format_instructions = output_parser.get_format_instructions()
        prompt_template = PromptTemplateParser(template="{{histories}}\n{{format_instructions}}\nquestions:\n")
        prompt = prompt_template.format({"histories": histories, "format_instructions": format_instructions})

        prompt_messages: list[PromptMessage] = [UserPromptMessage(content=prompt)]

        questions: Sequence[str] = []

        try:
            model_parameters: dict[str, object]
            stop: list[str]
            model_instance = prepared_model.model_instance
            if prepared_model.completion_params is not None:
                model_parameters, stop = _normalize_completion_params(prepared_model.completion_params)
            else:
                # Default-model generation keeps the built-in suggested-questions tuning.
                model_parameters = _default_suggested_questions_model_parameters(model_instance)
                stop = []

            with use_plugin_daemon_request_timeout(_SUGGESTED_QUESTIONS_TIMEOUT_SECONDS):
                response: LLMResult = model_instance.invoke_llm(
                    prompt_messages=list(prompt_messages),
                    model_parameters=model_parameters,
                    stop=stop,
                    stream=False,
                )

            text_content = response.message.get_text_content()
            questions = output_parser.parse(text_content) if text_content else []
        except Exception:
            logger.exception("Failed to generate suggested questions after answer")
            questions = []

        return questions

    @classmethod
    @with_credit_usage_created_by(CreditUsageCreatedBy.RULE_CONFIG)
    def generate_rule_config(cls, tenant_id: str, args: RuleGeneratePayload, *, app_id: str | None = None):
        output_parser = RuleConfigGeneratorOutputParser()

        error = ""
        error_step = ""
        rule_config: dict[str, Any] = {"prompt": "", "variables": [], "opening_statement": "", "error": ""}
        model_parameters = args.model_config_data.completion_params
        if args.no_variable:
            prompt_template = PromptTemplateParser(WORKFLOW_RULE_CONFIG_PROMPT_GENERATE_TEMPLATE)

            prompt_generate = prompt_template.format(
                inputs={
                    "TASK_DESCRIPTION": args.instruction,
                },
                remove_template_variables=False,
            )

            no_variable_prompt_messages: list[PromptMessage] = [UserPromptMessage(content=prompt_generate)]

            model_manager = ModelManager.for_tenant(tenant_id=tenant_id)
            model_instance = model_manager.get_model_instance(
                tenant_id=tenant_id,
                model_type=ModelType.LLM,
                provider=args.model_config_data.provider,
                model=args.model_config_data.name,
            )

            response: LLMResult | None = None
            with measure_time() as timer:
                try:
                    response = model_instance.invoke_llm(
                        prompt_messages=list(no_variable_prompt_messages),
                        model_parameters=model_parameters,
                        stream=False,
                    )
                    rule_config["prompt"] = response.message.get_text_content()
                except InvokeError as e:
                    error = str(e)
                    error_step = "generate rule config"
                except Exception as e:
                    logger.exception("Failed to generate rule config, model: %s", args.model_config_data.name)
                    error = str(e)
                    error_step = "generate rule config"

            cls._emit_prompt_generation(
                tenant_id=tenant_id,
                app_id=app_id,
                operation_type="rule_generate",
                instruction=args.instruction,
                generated_output=rule_config.get("prompt", ""),
                model_provider=args.model_config_data.provider,
                model_name=args.model_config_data.name,
                timer=timer,
                result=response,
                error=error or None,
            )

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
        prompt_generate_messages: list[PromptMessage] = [UserPromptMessage(content=prompt_generate_prompt)]

        # get model instance
        model_manager = ModelManager.for_tenant(tenant_id=tenant_id)
        model_instance = model_manager.get_model_instance(
            tenant_id=tenant_id,
            model_type=ModelType.LLM,
            provider=args.model_config_data.provider,
            model=args.model_config_data.name,
        )

        prompt_content: LLMResult | None = None
        with measure_time() as timer:
            try:
                try:
                    # the first step to generate the task prompt
                    prompt_content = model_instance.invoke_llm(
                        prompt_messages=list(prompt_generate_messages),
                        model_parameters=model_parameters,
                        stream=False,
                    )
                except InvokeError as e:
                    error = str(e)
                    error_step = "generate prefix prompt"
                    rule_config["error"] = f"Failed to {error_step}. Error: {error}"
                    return rule_config

                rule_config["prompt"] = prompt_content.message.get_text_content()

                parameter_generate_prompt = parameter_template.format(
                    inputs={
                        "INPUT_TEXT": prompt_content.message.get_text_content(),
                    },
                    remove_template_variables=False,
                )
                statement_generate_prompt = statement_template.format(
                    inputs={
                        "TASK_DESCRIPTION": args.instruction,
                        "INPUT_TEXT": prompt_content.message.get_text_content(),
                    },
                    remove_template_variables=False,
                )

                try:
                    parameter_content: LLMResult = model_instance.invoke_llm(
                        prompt_messages=[UserPromptMessage(content=parameter_generate_prompt)],
                        model_parameters=model_parameters,
                        stream=False,
                    )
                    rule_config["variables"] = re.findall(
                        r'"\s*([^"]+)\s*"', parameter_content.message.get_text_content()
                    )
                except InvokeError as e:
                    error = str(e)
                    error_step = "generate variables"

                try:
                    statement_content: LLMResult = model_instance.invoke_llm(
                        prompt_messages=[UserPromptMessage(content=statement_generate_prompt)],
                        model_parameters=model_parameters,
                        stream=False,
                    )
                    rule_config["opening_statement"] = statement_content.message.get_text_content()
                except InvokeError as e:
                    error = str(e)
                    error_step = "generate conversation opener"

            except Exception as e:
                logger.exception("Failed to generate rule config, model: %s", args.model_config_data.name)
                error = str(e)
                error_step = "handle unexpected exception"

        cls._emit_prompt_generation(
            tenant_id=tenant_id,
            app_id=app_id,
            operation_type="rule_generate",
            instruction=args.instruction,
            generated_output=rule_config.get("prompt", ""),
            model_provider=args.model_config_data.provider,
            model_name=args.model_config_data.name,
            timer=timer,
            result=prompt_content,
            error=error or None,
        )

        rule_config["error"] = f"Failed to {error_step}. Error: {error}" if error else ""

        return rule_config

    @classmethod
    @with_credit_usage_created_by(CreditUsageCreatedBy.CODE_GENERATION)
    def generate_code(
        cls,
        tenant_id: str,
        args: RuleCodeGeneratePayload,
        *,
        app_id: str | None = None,
    ) -> CodeGenerateResultDict:
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

        model_manager = ModelManager.for_tenant(tenant_id=tenant_id)
        model_instance = model_manager.get_model_instance(
            tenant_id=tenant_id,
            model_type=ModelType.LLM,
            provider=args.model_config_data.provider,
            model=args.model_config_data.name,
        )

        prompt_messages: list[PromptMessage] = [UserPromptMessage(content=prompt)]
        model_parameters = args.model_config_data.completion_params

        response: LLMResult | None = None
        error: str | None = None
        generated_code = ""
        with measure_time() as timer:
            try:
                response = model_instance.invoke_llm(
                    prompt_messages=list(prompt_messages), model_parameters=model_parameters, stream=False
                )
                generated_code = response.message.get_text_content()
            except InvokeError as e:
                error = str(e)
            except Exception as e:
                logger.exception(
                    "Failed to invoke LLM model, model: %s, language: %s",
                    args.model_config_data.name,
                    args.code_language,
                )
                error = str(e)

        cls._emit_prompt_generation(
            tenant_id=tenant_id,
            app_id=app_id,
            operation_type="code_generate",
            instruction=args.instruction,
            generated_output=generated_code,
            model_provider=args.model_config_data.provider,
            model_name=args.model_config_data.name,
            timer=timer,
            result=response,
            error=error,
        )

        if error:
            return {"code": "", "language": args.code_language, "error": f"Failed to generate code. Error: {error}"}
        return {"code": generated_code, "language": args.code_language, "error": ""}

    @classmethod
    @with_credit_usage_created_by(CreditUsageCreatedBy.QA_DOCUMENT)
    def generate_qa_document(cls, tenant_id: str, query, document_language: str):
        prompt = GENERATOR_QA_PROMPT.format(language=document_language)

        model_manager = ModelManager.for_tenant(tenant_id=tenant_id)
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

        # Runtime type check for overload narrowing.
        if not isinstance(result, LLMResult):
            raise TypeError("Expected LLMResult when stream=False")
        response = result

        answer = response.message.get_text_content()
        return answer.strip()

    @classmethod
    @with_credit_usage_created_by(CreditUsageCreatedBy.STRUCTURED_OUTPUT)
    def generate_structured_output(
        cls, tenant_id: str, args: RuleStructuredOutputPayload, *, app_id: str | None = None
    ) -> StructuredOutputResultDict:
        model_manager = ModelManager.for_tenant(tenant_id=tenant_id)
        model_instance = model_manager.get_model_instance(
            tenant_id=tenant_id,
            model_type=ModelType.LLM,
            provider=args.model_config_data.provider,
            model=args.model_config_data.name,
        )

        prompt_messages: list[PromptMessage] = [
            SystemPromptMessage(content=SYSTEM_STRUCTURED_OUTPUT_GENERATE),
            UserPromptMessage(content=args.instruction),
        ]
        model_parameters = args.model_config_data.completion_params

        response: LLMResult | None = None
        error: str | None = None
        generated_output = ""
        with measure_time() as timer:
            try:
                response = model_instance.invoke_llm(
                    prompt_messages=list(prompt_messages), model_parameters=model_parameters, stream=False
                )
                raw_content = response.message.get_text_content()
                try:
                    parsed_content = json.loads(raw_content)
                except json.JSONDecodeError:
                    parsed_content = json_repair.loads(raw_content)
                if not isinstance(parsed_content, dict | list):
                    raise ValueError(f"Failed to parse structured output from llm: {raw_content}")
                generated_output = json.dumps(parsed_content, indent=2, ensure_ascii=False)
            except InvokeError as e:
                error = str(e)
            except Exception as e:
                logger.exception("Failed to invoke LLM model, model: %s", args.model_config_data.name)
                error = str(e)

        cls._emit_prompt_generation(
            tenant_id=tenant_id,
            app_id=app_id,
            operation_type="structured_output",
            instruction=args.instruction,
            generated_output=generated_output,
            model_provider=args.model_config_data.provider,
            model_name=args.model_config_data.name,
            timer=timer,
            result=response,
            error=error,
        )

        if error:
            return {"output": "", "error": f"Failed to generate JSON Schema. Error: {error}"}
        return {"output": generated_output, "error": ""}

    @staticmethod
    @with_credit_usage_created_by(CreditUsageCreatedBy.INSTRUCTION_MODIFICATION)
    def instruction_modify_legacy(
        tenant_id: str,
        flow_id: str,
        current: str,
        instruction: str,
        model_config: ModelConfig,
        ideal_output: str | None,
        session: Session,
    ):
        last_run: Message | None = session.scalar(
            select(Message)
            .join(App, App.id == Message.app_id)
            .where(Message.app_id == flow_id, App.tenant_id == tenant_id)
            .order_by(Message.created_at.desc())
            .limit(1)
        )
        if not last_run:
            return LLMGenerator.__instruction_modify_common(
                tenant_id=tenant_id,
                app_id=flow_id,
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
            app_id=flow_id,
            model_config=model_config,
            last_run=last_run_dict,
            current=current,
            error_message=str(last_run.error),
            instruction=instruction,
            node_type="llm",
            ideal_output=ideal_output,
        )

    @staticmethod
    @with_credit_usage_created_by(CreditUsageCreatedBy.INSTRUCTION_MODIFICATION)
    def instruction_modify_workflow(
        tenant_id: str,
        flow_id: str,
        node_id: str,
        current: str,
        instruction: str,
        model_config: ModelConfig,
        ideal_output: str | None,
        workflow_service: WorkflowServiceInterface,
        session: Session,
    ):
        app: App | None = session.scalar(select(App).where(App.id == flow_id, App.tenant_id == tenant_id).limit(1))
        if not app:
            raise ValueError("App not found.")
        workflow = workflow_service.get_draft_workflow(app_model=app, session=session)
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
                app_id=flow_id,
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
            app_id=flow_id,
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
        app_id: str | None,
        model_config: ModelConfig,
        last_run: dict[str, Any] | None,
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
        model_instance = ModelManager.for_tenant(tenant_id=tenant_id).get_model_instance(
            tenant_id=tenant_id,
            model_type=ModelType.LLM,
            provider=model_config.provider,
            model=model_config.name,
        )
        match node_type:
            case "llm" | "agent":
                system_prompt = LLM_MODIFY_PROMPT_SYSTEM
            case "code":
                system_prompt = LLM_MODIFY_CODE_SYSTEM
            case _:
                system_prompt = LLM_MODIFY_PROMPT_SYSTEM
        prompt_messages: list[PromptMessage] = [
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
        model_parameters, stop = _normalize_completion_params(model_config.completion_params)

        response: LLMResult | None = None
        error: str | None = None
        generated_output = ""
        data: dict = {}
        with measure_time() as timer:
            try:
                response = model_instance.invoke_llm(
                    prompt_messages=list(prompt_messages),
                    model_parameters=model_parameters,
                    stop=stop,
                    stream=False,
                )
                generated_raw = response.message.get_text_content()
                first_brace = generated_raw.find("{")
                last_brace = generated_raw.rfind("}")
                if first_brace == -1 or last_brace == -1 or last_brace < first_brace:
                    raise ValueError(f"Could not find a valid JSON object in response: {generated_raw}")
                json_str = generated_raw[first_brace : last_brace + 1]
                parsed = json_repair.loads(json_str)
                if not isinstance(parsed, dict):
                    raise TypeError(f"Expected a JSON object, but got {type(parsed).__name__}")
                data = parsed
                generated_output = json_str
            except InvokeError as e:
                error = str(e)
            except Exception as e:
                logger.exception("Failed to invoke LLM model, model: %s", json.dumps(model_config.name), exc_info=True)
                error = str(e)

        LLMGenerator._emit_prompt_generation(
            tenant_id=tenant_id,
            app_id=app_id,
            operation_type="instruction_modify",
            instruction=instruction,
            generated_output=generated_output,
            model_provider=model_config.provider,
            model_name=model_config.name,
            timer=timer,
            result=response,
            error=error,
        )

        if error:
            return {"error": f"Failed to generate. Error: {error}"}
        return data
