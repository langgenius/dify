import json
import logging

from langchain.schema import OutputParserException

from core.model_providers.error import LLMError, ProviderTokenNotInitError
from core.model_providers.model_factory import ModelFactory
from core.model_providers.models.entity.message import PromptMessage, MessageType
from core.model_providers.models.entity.model_params import ModelKwargs
from core.prompt.output_parser.rule_config_generator import RuleConfigGeneratorOutputParser

from core.prompt.output_parser.suggested_questions_after_answer import SuggestedQuestionsAfterAnswerOutputParser
from core.prompt.prompt_template import PromptTemplateParser
from core.prompt.prompts import CONVERSATION_TITLE_PROMPT, CONVERSATION_SUMMARY_PROMPT, INTRODUCTION_GENERATE_PROMPT, \
    GENERATOR_QA_PROMPT


class LLMGenerator:
    @classmethod
    def generate_conversation_name(cls, tenant_id: str, query, answer):
        prompt = CONVERSATION_TITLE_PROMPT

        if len(query) > 2000:
            query = query[:300] + "...[TRUNCATED]..." + query[-300:]

        query = query.replace("\n", " ")

        prompt += query + "\n"

        model_instance = ModelFactory.get_text_generation_model(
            tenant_id=tenant_id,
            model_kwargs=ModelKwargs(
                temperature=1,
                max_tokens=100
            )
        )

        prompts = [PromptMessage(content=prompt)]
        response = model_instance.run(prompts)
        answer = response.content

        result_dict = json.loads(answer)
        answer = result_dict['Your Output']

        return answer.strip()

    @classmethod
    def generate_conversation_summary(cls, tenant_id: str, messages):
        max_tokens = 200

        model_instance = ModelFactory.get_text_generation_model(
            tenant_id=tenant_id,
            model_kwargs=ModelKwargs(
                max_tokens=max_tokens
            )
        )

        prompt = CONVERSATION_SUMMARY_PROMPT
        prompt_with_empty_context = prompt.format({"context": ''})
        prompt_tokens = model_instance.get_num_tokens([PromptMessage(content=prompt_with_empty_context)])
        max_context_token_length = model_instance.model_rules.max_tokens.max
        max_context_token_length = max_context_token_length if max_context_token_length else 1500
        rest_tokens = max_context_token_length - prompt_tokens - max_tokens - 1

        context = ''
        for message in messages:
            if not message.answer:
                continue

            if len(message.query) > 2000:
                query = message.query[:300] + "...[TRUNCATED]..." + message.query[-300:]
            else:
                query = message.query

            if len(message.answer) > 2000:
                answer = message.answer[:300] + "...[TRUNCATED]..." + message.answer[-300:]
            else:
                answer = message.answer

            message_qa_text = "\n\nHuman:" + query + "\n\nAssistant:" + answer
            if rest_tokens - model_instance.get_num_tokens([PromptMessage(content=context + message_qa_text)]) > 0:
                context += message_qa_text

        if not context:
            return '[message too long, no summary]'

        prompt = prompt.format({"context": context})
        prompts = [PromptMessage(content=prompt)]
        response = model_instance.run(prompts)
        answer = response.content
        return answer.strip()

    @classmethod
    def generate_introduction(cls, tenant_id: str, pre_prompt: str):
        prompt = INTRODUCTION_GENERATE_PROMPT
        prompt = prompt.format({"prompt": pre_prompt})

        model_instance = ModelFactory.get_text_generation_model(
            tenant_id=tenant_id
        )

        prompts = [PromptMessage(content=prompt)]
        response = model_instance.run(prompts)
        answer = response.content
        return answer.strip()

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
            model_instance = ModelFactory.get_text_generation_model(
                tenant_id=tenant_id,
                model_kwargs=ModelKwargs(
                    max_tokens=256,
                    temperature=0
                )
            )
        except ProviderTokenNotInitError:
            return []

        prompt_messages = [PromptMessage(content=prompt)]

        try:
            output = model_instance.run(prompt_messages)
            questions = output_parser.parse(output.content)
        except LLMError:
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

        model_instance = ModelFactory.get_text_generation_model(
            tenant_id=tenant_id,
            model_kwargs=ModelKwargs(
                max_tokens=512,
                temperature=0
            )
        )

        prompt_messages = [PromptMessage(content=prompt)]

        try:
            output = model_instance.run(prompt_messages)
            rule_config = output_parser.parse(output.content)
        except LLMError as e:
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

        model_instance = ModelFactory.get_text_generation_model(
            tenant_id=tenant_id,
            model_kwargs=ModelKwargs(
                max_tokens=2000
            )
        )

        prompts = [
            PromptMessage(content=prompt, type=MessageType.SYSTEM),
            PromptMessage(content=query)
        ]

        response = model_instance.run(prompts)
        answer = response.content
        return answer.strip()
