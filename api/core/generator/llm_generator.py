import logging

from langchain import PromptTemplate
from langchain.chat_models.base import BaseChatModel
from langchain.schema import HumanMessage, OutputParserException, BaseMessage

from core.constant import llm_constant
from core.llm.llm_builder import LLMBuilder
from core.llm.streamable_open_ai import StreamableOpenAI
from core.llm.token_calculator import TokenCalculator
from core.prompt.output_parser.rule_config_generator import RuleConfigGeneratorOutputParser

from core.prompt.output_parser.suggested_questions_after_answer import SuggestedQuestionsAfterAnswerOutputParser
from core.prompt.prompt_template import JinjaPromptTemplate, OutLinePromptTemplate
from core.prompt.prompts import CONVERSATION_TITLE_PROMPT, CONVERSATION_SUMMARY_PROMPT, INTRODUCTION_GENERATE_PROMPT


# gpt-3.5-turbo works not well
generate_base_model = 'text-davinci-003'


class LLMGenerator:
    @classmethod
    def generate_conversation_name(cls, tenant_id: str, query, answer):
        prompt = CONVERSATION_TITLE_PROMPT

        if len(query) > 2000:
            query = query[:300] + "...[TRUNCATED]..." + query[-300:]

        prompt = prompt.format(query=query)
        llm: StreamableOpenAI = LLMBuilder.to_llm(
            tenant_id=tenant_id,
            model_name='gpt-3.5-turbo',
            max_tokens=50
        )

        if isinstance(llm, BaseChatModel):
            prompt = [HumanMessage(content=prompt)]

        response = llm.generate([prompt])
        answer = response.generations[0][0].text
        return answer.strip()

    @classmethod
    def generate_conversation_summary(cls, tenant_id: str, messages):
        max_tokens = 200
        model = 'gpt-3.5-turbo'

        prompt = CONVERSATION_SUMMARY_PROMPT
        prompt_with_empty_context = prompt.format(context='')
        prompt_tokens = TokenCalculator.get_num_tokens(model, prompt_with_empty_context)
        rest_tokens = llm_constant.max_context_token_length[model] - prompt_tokens - max_tokens - 1

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
            if rest_tokens - TokenCalculator.get_num_tokens(model, context + message_qa_text) > 0:
                context += message_qa_text

        if not context:
            return '[message too long, no summary]'

        prompt = prompt.format(context=context)

        llm: StreamableOpenAI = LLMBuilder.to_llm(
            tenant_id=tenant_id,
            model_name=model,
            max_tokens=max_tokens
        )

        if isinstance(llm, BaseChatModel):
            prompt = [HumanMessage(content=prompt)]

        response = llm.generate([prompt])
        answer = response.generations[0][0].text
        return answer.strip()

    @classmethod
    def generate_introduction(cls, tenant_id: str, pre_prompt: str):
        prompt = INTRODUCTION_GENERATE_PROMPT
        prompt = prompt.format(prompt=pre_prompt)

        llm: StreamableOpenAI = LLMBuilder.to_llm(
            tenant_id=tenant_id,
            model_name=generate_base_model,
        )

        if isinstance(llm, BaseChatModel):
            prompt = [HumanMessage(content=prompt)]

        response = llm.generate([prompt])
        answer = response.generations[0][0].text
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

        llm: StreamableOpenAI = LLMBuilder.to_llm(
            tenant_id=tenant_id,
            model_name='gpt-3.5-turbo',
            temperature=0,
            max_tokens=256
        )

        if isinstance(llm, BaseChatModel):
            query = [HumanMessage(content=_input.to_string())]
        else:
            query = _input.to_string()

        try:
            output = llm(query)
            if isinstance(output, BaseMessage):
                output = output.content
            questions = output_parser.parse(output)
        except Exception:
            logging.exception("Error generating suggested questions after answer")
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

        llm: StreamableOpenAI = LLMBuilder.to_llm(
            tenant_id=tenant_id,
            model_name=generate_base_model,
            temperature=0,
            max_tokens=512
        )

        if isinstance(llm, BaseChatModel):
            query = [HumanMessage(content=_input.to_string())]
        else:
            query = _input.to_string()

        try:
            output = llm(query)
            rule_config = output_parser.parse(output)
        except OutputParserException:
            raise ValueError('Please give a valid input for intended audience or hoping to solve problems.')
        except Exception:
            logging.exception("Error generating prompt")
            rule_config = {
                "prompt": "",
                "variables": [],
                "opening_statement": ""
            }

        return rule_config
