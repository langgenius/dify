import json
import logging
import re
from typing import Optional, cast

from core.llm_generator.output_parser.rule_config_generator import RuleConfigGeneratorOutputParser
from core.llm_generator.output_parser.suggested_questions_after_answer import SuggestedQuestionsAfterAnswerOutputParser
from core.llm_generator.prompts import (
    CONVERSATION_TITLE_PROMPT,
    GENERATOR_QA_PROMPT,
    JAVASCRIPT_CODE_GENERATOR_PROMPT_TEMPLATE,
    PYTHON_CODE_GENERATOR_PROMPT_TEMPLATE,
    WORKFLOW_RULE_CONFIG_PROMPT_GENERATE_TEMPLATE,
)
from core.model_manager import ModelManager
from core.model_runtime.entities.llm_entities import LLMResult
from core.model_runtime.entities.message_entities import SystemPromptMessage, UserPromptMessage
from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.errors.invoke import InvokeAuthorizationError, InvokeError
from core.ops.entities.trace_entity import TraceTaskName
from core.ops.ops_trace_manager import TraceQueueManager, TraceTask
from core.ops.utils import measure_time
from core.prompt.utils.prompt_template_parser import PromptTemplateParser


class LLMGenerator:
    @classmethod
    def generate_conversation_name(
        cls, tenant_id: str, query, conversation_id: Optional[str] = None, app_id: Optional[str] = None
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
            response = cast(
                LLMResult,
                model_instance.invoke_llm(
                    prompt_messages=prompts, model_parameters={"max_tokens": 100, "temperature": 1}, stream=False
                ),
            )
        answer = cast(str, response.message.content)
        cleaned_answer = re.sub(r"^.*(\{.*\}).*$", r"\1", answer, flags=re.DOTALL)
        if cleaned_answer is None:
            return ""
        result_dict = json.loads(cleaned_answer)
        answer = result_dict["Your Output"]
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
    def generate_suggested_questions_after_answer(cls, tenant_id: str, histories: str):
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
            response = cast(
                LLMResult,
                model_instance.invoke_llm(
                    prompt_messages=prompt_messages,
                    model_parameters={"max_tokens": 256, "temperature": 0},
                    stream=False,
                ),
            )

            questions = output_parser.parse(cast(str, response.message.content))
        except InvokeError:
            questions = []
        except Exception as e:
            logging.exception("Failed to generate suggested questions after answer")
            questions = []

        return questions

    @classmethod
    def generate_rule_config(
        cls, tenant_id: str, instruction: str, model_config: dict, no_variable: bool, rule_config_max_tokens: int = 512
    ) -> dict:
        output_parser = RuleConfigGeneratorOutputParser()

        error = ""
        error_step = ""
        rule_config = {"prompt": "", "variables": [], "opening_statement": "", "error": ""}
        model_parameters = {"max_tokens": rule_config_max_tokens, "temperature": 0.01}

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

            model_instance = model_manager.get_default_model_instance(
                tenant_id=tenant_id,
                model_type=ModelType.LLM,
            )

            try:
                response = cast(
                    LLMResult,
                    model_instance.invoke_llm(
                        prompt_messages=prompt_messages, model_parameters=model_parameters, stream=False
                    ),
                )

                rule_config["prompt"] = cast(str, response.message.content)

            except InvokeError as e:
                error = str(e)
                error_step = "generate rule config"
            except Exception as e:
                logging.exception(f"Failed to generate rule config, model: {model_config.get('name')}")
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
                prompt_content = cast(
                    LLMResult,
                    model_instance.invoke_llm(
                        prompt_messages=prompt_messages, model_parameters=model_parameters, stream=False
                    ),
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
                parameter_content = cast(
                    LLMResult,
                    model_instance.invoke_llm(
                        prompt_messages=parameter_messages, model_parameters=model_parameters, stream=False
                    ),
                )
                rule_config["variables"] = re.findall(r'"\s*([^"]+)\s*"', cast(str, parameter_content.message.content))
            except InvokeError as e:
                error = str(e)
                error_step = "generate variables"

            try:
                statement_content = cast(
                    LLMResult,
                    model_instance.invoke_llm(
                        prompt_messages=statement_messages, model_parameters=model_parameters, stream=False
                    ),
                )
                rule_config["opening_statement"] = cast(str, statement_content.message.content)
            except InvokeError as e:
                error = str(e)
                error_step = "generate conversation opener"

        except Exception as e:
            logging.exception(f"Failed to generate rule config, model: {model_config.get('name')}")
            rule_config["error"] = str(e)

        rule_config["error"] = f"Failed to {error_step}. Error: {error}" if error else ""

        return rule_config

    @classmethod
    def generate_code(
        cls,
        tenant_id: str,
        instruction: str,
        model_config: dict,
        code_language: str = "javascript",
        max_tokens: int = 1000,
    ) -> dict:
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
        model_parameters = {"max_tokens": max_tokens, "temperature": 0.01}

        try:
            response = cast(
                LLMResult,
                model_instance.invoke_llm(
                    prompt_messages=prompt_messages, model_parameters=model_parameters, stream=False
                ),
            )

            generated_code = cast(str, response.message.content)
            return {"code": generated_code, "language": code_language, "error": ""}

        except InvokeError as e:
            error = str(e)
            return {"code": "", "language": code_language, "error": f"Failed to generate code. Error: {error}"}
        except Exception as e:
            logging.exception(
                f"Failed to invoke LLM model, model: {model_config.get('name')}, language: {code_language}"
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

        prompt_messages = [SystemPromptMessage(content=prompt), UserPromptMessage(content=query)]

        response = cast(
            LLMResult,
            model_instance.invoke_llm(
                prompt_messages=prompt_messages,
                model_parameters={"temperature": 0.01, "max_tokens": 2000},
                stream=False,
            ),
        )

        answer = cast(str, response.message.content)
        return answer.strip()
