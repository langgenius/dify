import logging

from langchain.schema import OutputParserException

from core.model_providers.error import LLMError
from core.model_providers.model_factory import ModelFactory
from core.model_providers.models.entity.message import PromptMessage, MessageType
from core.model_providers.models.entity.model_params import ModelKwargs
from core.prompt.output_parser.rule_config_generator import RuleConfigGeneratorOutputParser

from core.prompt.output_parser.suggested_questions_after_answer import SuggestedQuestionsAfterAnswerOutputParser
from core.prompt.prompt_template import JinjaPromptTemplate, OutLinePromptTemplate
from core.prompt.prompts import CONVERSATION_TITLE_PROMPT, CONVERSATION_SUMMARY_PROMPT, INTRODUCTION_GENERATE_PROMPT, \
    GENERATOR_QA_PROMPT


class LLMGenerator:
    @classmethod
    def generate_conversation_name(cls, tenant_id: str, query, answer):
        prompt = CONVERSATION_TITLE_PROMPT

        if len(query) > 2000:
            query = query[:300] + "...[TRUNCATED]..." + query[-300:]

        prompt = prompt.format(query=query)

        model_instance = ModelFactory.get_text_generation_model(
            tenant_id=tenant_id,
            model_kwargs=ModelKwargs(
                max_tokens=50
            )
        )

        prompts = [PromptMessage(content=prompt)]
        response = model_instance.run(prompts)
        answer = response.content
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
        prompt_with_empty_context = prompt.format(context='')
        prompt_tokens = model_instance.get_num_tokens([PromptMessage(content=prompt_with_empty_context)])
        max_context_token_length = model_instance.model_rules.max_tokens.max
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

        prompt = prompt.format(context=context)
        prompts = [PromptMessage(content=prompt)]
        response = model_instance.run(prompts)
        answer = response.content
        return answer.strip()

    @classmethod
    def generate_introduction(cls, tenant_id: str, pre_prompt: str):
        prompt = INTRODUCTION_GENERATE_PROMPT
        prompt = prompt.format(prompt=pre_prompt)

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

        prompt = JinjaPromptTemplate(
            template="{{histories}}\n{{format_instructions}}\nquestions:\n",
            input_variables=["histories"],
            partial_variables={"format_instructions": format_instructions}
        )

        _input = prompt.format_prompt(histories=histories)

        model_instance = ModelFactory.get_text_generation_model(
            tenant_id=tenant_id,
            model_kwargs=ModelKwargs(
                max_tokens=256,
                temperature=0
            )
        )

        prompts = [PromptMessage(content=_input.to_string())]

        try:
            output = model_instance.run(prompts)
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

        prompt = OutLinePromptTemplate(
            template=output_parser.get_format_instructions(),
            input_variables=["audiences", "hoping_to_solve"],
            partial_variables={
                "variable": '{variable}',
                "lanA": '{lanA}',
                "lanB": '{lanB}',
                "topic": '{topic}'
            },
            validate_template=False
        )

        _input = prompt.format_prompt(audiences=audiences, hoping_to_solve=hoping_to_solve)

        model_instance = ModelFactory.get_text_generation_model(
            tenant_id=tenant_id,
            model_kwargs=ModelKwargs(
                max_tokens=512,
                temperature=0
            )
        )

        prompts = [PromptMessage(content=_input.to_string())]

        try:
            output = model_instance.run(prompts)
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
    def generate_qa_document(cls, tenant_id: str, query):
        prompt = GENERATOR_QA_PROMPT

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
