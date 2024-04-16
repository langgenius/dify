import json
import logging

from core.llm_generator.output_parser.errors import OutputParserException
from core.llm_generator.output_parser.rule_config_generator import RuleConfigGeneratorOutputParser
from core.llm_generator.output_parser.suggested_questions_after_answer import SuggestedQuestionsAfterAnswerOutputParser
from core.llm_generator.prompts import CONVERSATION_TITLE_PROMPT, GENERATOR_QA_PROMPT
from core.model_manager import ModelManager
from core.model_runtime.entities.message_entities import SystemPromptMessage, UserPromptMessage
from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.errors.invoke import InvokeAuthorizationError, InvokeError
from core.prompt.utils.prompt_template_parser import PromptTemplateParser


class LLMGenerator:
    @classmethod
    def generate_conversation_name(cls, tenant_id: str, query):
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
        response = model_instance.invoke_llm(
            prompt_messages=prompts,
            model_parameters={
                "max_tokens": 100,
                "temperature": 1
            },
            stream=False
        )
        answer = response.message.content

        result_dict = json.loads(answer)
        answer = result_dict['Your Output']
        name = answer.strip()

        if len(name) > 75:
            name = name[:75] + '...'

        return name

    @classmethod
    def generate_suggested_questions_after_answer(cls, tenant_id: str, histories: str):
        output_parser = SuggestedQuestionsAfterAnswerOutputParser()
        format_instructions = output_parser.get_format_instructions()

        prompt_template = PromptTemplateParser(
            template="{{histories}}\n{{format_instructions}}\nquestions:\n"
        )

        prompt = prompt_template.format({
            "histories": histories,
            "format_instructions": format_instructions
        })

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
            response = model_instance.invoke_llm(
                prompt_messages=prompt_messages,
                model_parameters={
                    "max_tokens": 256,
                    "temperature": 0
                },
                stream=False
            )

            questions = output_parser.parse(response.message.content)
        except InvokeError:
            questions = []
        except Exception as e:
            logging.exception(e)
            questions = []

        return questions

    @classmethod
    def generate_rule_config(cls, tenant_id: str, audiences: str, hoping_to_solve: str) -> dict:
        output_parser = RuleConfigGeneratorOutputParser()

        prompt_template = PromptTemplateParser(
            template=output_parser.get_format_instructions()
        )

        prompt = prompt_template.format(
            inputs={
                "audiences": audiences,
                "hoping_to_solve": hoping_to_solve,
                "variable": "{{variable}}",
                "lanA": "{{lanA}}",
                "lanB": "{{lanB}}",
                "topic": "{{topic}}"
            },
            remove_template_variables=False
        )

        model_manager = ModelManager()
        model_instance = model_manager.get_default_model_instance(
            tenant_id=tenant_id,
            model_type=ModelType.LLM,
        )

        prompt_messages = [UserPromptMessage(content=prompt)]

        try:
            response = model_instance.invoke_llm(
                prompt_messages=prompt_messages,
                model_parameters={
                    "max_tokens": 512,
                    "temperature": 0
                },
                stream=False
            )

            rule_config = output_parser.parse(response.message.content)
        except InvokeError as e:
            raise e
        except OutputParserException:
            raise ValueError('Please give a valid input for intended audience or hoping to solve problems.')
        except Exception as e:
            logging.exception(e)
            rule_config = {
                "prompt": "",
                "variables": [],
                "opening_statement": ""
            }

        return rule_config

    @classmethod
    def generate_qa_document(cls, tenant_id: str, query, document_language: str):
        prompt = GENERATOR_QA_PROMPT.format(language=document_language)

        model_manager = ModelManager()
        model_instance = model_manager.get_default_model_instance(
            tenant_id=tenant_id,
            model_type=ModelType.LLM,
        )

        prompt_messages = [
            SystemPromptMessage(content=prompt),
            UserPromptMessage(content=query)
        ]

        response = model_instance.invoke_llm(
            prompt_messages=prompt_messages,
            model_parameters={
                'temperature': 0.01,
                "max_tokens": 2000
            },
            stream=False
        )

        answer = response.message.content
        return answer.strip()
