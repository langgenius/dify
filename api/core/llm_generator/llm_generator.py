import json
import logging
import re
from collections.abc import Sequence
from typing import Protocol, cast

import json_repair

from core.app.app_config.entities import ModelConfig
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
from core.ops.utils import measure_time
from core.prompt.utils.prompt_template_parser import PromptTemplateParser
from core.workflow.entities.workflow_node_execution import WorkflowNodeExecutionMetadataKey
from extensions.ext_database import db
from extensions.ext_storage import storage
from models import App, Message, WorkflowNodeExecutionModel
from models.workflow import Workflow

logger = logging.getLogger(__name__)

# Precompiled heuristic to detect common Persian (Farsi) words in short inputs.
# Using a compiled regex avoids repeated recompilation on every call.
_PERSIAN_HEURISTIC = re.compile(
    r"\b(سلام|متشکرم|ممنون|خوب|چطور|سپاس)\b",
    flags=re.IGNORECASE,
)

# Precompiled regex for Persian-specific characters (including Persian ye U+06CC)
_persian_chars_re = re.compile(r"[پچژگک\u06CC]")

# Optional langdetect import — import once at module import time to avoid repeated lookups
_langdetect_available = False
try:
    from langdetect import DetectorFactory, detect  # type: ignore

    DetectorFactory.seed = 0
    _langdetect_available = True
except Exception:
    detect = None
    DetectorFactory = None
    _langdetect_available = False


def _contains_persian(text: str) -> bool:
    """Return True if text appears to be Persian (Farsi).

    Detection is multi-layered: quick character check, word heuristics, and
    an optional langdetect fallback when available.
    """
    text = text or ""

    # 1) Quick check: Persian-specific letters
    if _persian_chars_re.search(text):
        return True

    # 2) Heuristic check for common Persian words (fast, precompiled)
    if _PERSIAN_HEURISTIC.search(text):
        return True

    # 3) Fallback: language detection (more expensive) — only run if langdetect is available
    if _langdetect_available and detect is not None:
        try:
            return detect(text) == "fa"
        except Exception as exc:
            # langdetect can fail for very short/ambiguous texts; log and continue
            logger.debug("langdetect detection failed: %s", exc)

    return False


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

        # _contains_persian is implemented at module scope for reuse and testability

        if len(query) > 2000:
            query = query[:300] + "...[TRUNCATED]..." + query[-300:]

        query = query.replace("\n", " ")

        prompt += query + "\n"

        model_manager = ModelManager()
        model_instance = model_manager.get_default_model_instance(
            tenant_id=tenant_id,
            model_type=ModelType.LLM,
        )

        # If the input contains Persian characters, add explicit instruction to produce Persian title
        is_persian_input = _contains_persian(query)

        if is_persian_input:
            prompt += (
                "\nIMPORTANT: The user input is Persian (Farsi). "
                "Only output the final title in Persian (Farsi), use Persian characters "
                "(پ, چ, ژ, گ, ک, ی) and do NOT use Arabic or any other language.\n"
            )

        prompts = [UserPromptMessage(content=prompt)]

        with measure_time() as timer:
            # Try generation with up to 2 attempts.
            # If Persian required but not produced, retry with stronger instruction.
            attempts = 0
            max_attempts = 2
            generated_output = None

            while attempts < max_attempts:
                attempts += 1
                try:
                    response: LLMResult = model_instance.invoke_llm(
                        prompt_messages=list(prompts),
                        model_parameters={"max_tokens": 500, "temperature": 0.2},
                        stream=False,
                    )
                except (InvokeError, InvokeAuthorizationError):
                    logger.exception("Failed to invoke LLM for conversation name generation")
                    break

                answer = cast(str, response.message.content)

                def _extract_and_parse_json(raw_text: str) -> dict | None:
                    if not raw_text:
                        return None
                    # Try to extract JSON object by braces
                    first_brace = raw_text.find("{")
                    last_brace = raw_text.rfind("}")
                    if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
                        candidate_json = raw_text[first_brace : last_brace + 1]
                    else:
                        candidate_json = raw_text

                    # Try normal json loads, then attempt to repair malformed JSON
                    try:
                        parsed = json.loads(candidate_json)
                        # Only accept dict results for structured conversation title parsing
                        return parsed if isinstance(parsed, dict) else None
                    except json.JSONDecodeError:
                        # Prefer a json_repair.loads implementation if available
                        json_repair_loads = getattr(json_repair, "loads", None)
                        if callable(json_repair_loads):
                            try:
                                repaired_parsed = json_repair_loads(candidate_json)
                                if isinstance(repaired_parsed, dict):
                                    return repaired_parsed
                                # If the repair function returns a string, try parsing it
                                if isinstance(repaired_parsed, str):
                                    try:
                                        parsed2 = json.loads(repaired_parsed)
                                        return parsed2 if isinstance(parsed2, dict) else None
                                    except Exception:
                                        return None
                                return None
                            except Exception as exc:
                                logger.debug("json_repair.loads failed: %s", exc)
                                return None

                        # Otherwise try to call a 'repair' function if present and parse result
                        json_repair_repair = getattr(json_repair, "repair", None)
                        if callable(json_repair_repair):
                            try:
                                repaired = json_repair_repair(candidate_json)
                                if isinstance(repaired, (dict, list)):
                                    return repaired if isinstance(repaired, dict) else None
                                if isinstance(repaired, str):
                                    parsed = json.loads(repaired)
                                    return parsed if isinstance(parsed, dict) else None
                                return None
                            except Exception as exc:
                                logger.debug("json_repair.repair failed: %s", exc)
                                return None

                        logger.debug("No suitable json_repair function available to repair JSON")
                        return None

                result_dict = _extract_and_parse_json(answer)

                if not isinstance(result_dict, dict):
                    candidate = query
                else:
                    candidate = result_dict.get("Your Output", "")

                # If input is Persian, ensure candidate contains Persian-specific characters.
                # Otherwise retry with stronger instruction.
                if is_persian_input and not _contains_persian(candidate):
                    logger.info("Generated title doesn't appear to be Persian; retrying with stricter instruction")
                    prompts = [
                        UserPromptMessage(
                            content=(
                                prompt + "\nCRITICAL: You must output the title in Persian (Farsi) "
                                "using Persian-specific letters (پ, چ, ژ, گ, ک, ی). "
                                "Output only the JSON as specified earlier."
                            )
                        )
                    ]
                    continue

                generated_output = candidate.strip()
                break

            if generated_output:
                name = generated_output
            else:
                # Use the last non-Persian candidate (if any) so that the translation fallback
                # can translate the generated candidate into Persian. Otherwise fall back to
                # the original query.
                last_candidate = locals().get("candidate", None)
                name = last_candidate.strip() if isinstance(last_candidate, str) and last_candidate else (query or "")

        if is_persian_input and not _contains_persian(name):
            # As a last resort, ask the model to translate the title into Persian directly
            try:
                translate_prompt = UserPromptMessage(
                    content=(
                        "Translate the following short chat title into Persian (Farsi) ONLY. "
                        "Output the Persian translation only (no JSON):\n\n"
                        f"{name}"
                    )
                )
                translate_response: LLMResult = model_instance.invoke_llm(
                    prompt_messages=[translate_prompt],
                    model_parameters={"max_tokens": 200, "temperature": 0},
                    stream=False,
                )
                translation = cast(str, translate_response.message.content).strip()
                if _contains_persian(translation):
                    name = translation
            except (InvokeError, InvokeAuthorizationError):
                logger.exception("Failed to obtain Persian translation for the conversation title")

        if len(name) > 75:
            name = name[:75] + "..."

        # get tracing instance
        from core.ops.ops_trace_manager import TraceQueueManager, TraceTask

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

            # Initialize parsed_content to ensure the variable is always bound for type-checkers
            parsed_content: dict | list | None = None
            try:
                parsed_content = json.loads(raw_content)
            except json.JSONDecodeError:
                # Prefer a json_repair.loads implementation if available
                json_repair_loads = getattr(json_repair, "loads", None)
                if callable(json_repair_loads):
                    try:
                        parsed_candidate = json_repair_loads(raw_content)
                        # Accept dict or list directly
                        if isinstance(parsed_candidate, (dict, list)):
                            parsed_content = parsed_candidate
                        elif isinstance(parsed_candidate, str):
                            try:
                                parsed2 = json.loads(parsed_candidate)
                                parsed_content = parsed2 if isinstance(parsed2, (dict, list)) else None
                            except Exception as exc:
                                logger.debug("json_repair.loads returned a string that failed to parse: %s", exc)
                                parsed_content = None
                        else:
                            parsed_content = None
                    except Exception as exc:
                        logger.debug("json_repair.loads failed: %s", exc)
                        parsed_content = None
                else:
                    # As a fallback, use a 'repair' function followed by json.loads
                    json_repair_repair = getattr(json_repair, "repair", None)
                    if callable(json_repair_repair):
                        try:
                            repaired = json_repair_repair(raw_content)
                            if isinstance(repaired, (dict, list)):
                                parsed_content = repaired
                            elif isinstance(repaired, str):
                                parsed_content = json.loads(repaired)
                            else:
                                parsed_content = None
                        except Exception as exc:
                            logger.debug("json_repair.repair failed: %s", exc)
                            parsed_content = None

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
            logger.exception("Failed to invoke LLM model, model: %s", json.dumps(model_config.name), exc_info=True)
            return {"error": f"An unexpected error occurred: {str(e)}"}
