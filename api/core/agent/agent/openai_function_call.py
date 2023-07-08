from typing import List, Tuple, Any, Union, cast

from langchain.agents import OpenAIFunctionsAgent
from langchain.agents.openai_functions_agent.base import _parse_ai_message, \
    _format_intermediate_steps
from langchain.base_language import BaseLanguageModel
from langchain.callbacks.manager import Callbacks
from langchain.chat_models import ChatOpenAI
from langchain.chat_models.openai import _convert_message_to_dict
from langchain.memory.summary import SummarizerMixin
from langchain.schema import AgentAction, AgentFinish, BaseMessage, SystemMessage, HumanMessage, AIMessage

from core.agent.agent.calc_token_mixin import CalcTokenMixin, ExceededLLMTokensLimitError


class AutoSummarizingOpenAIFunctionCallAgent(OpenAIFunctionsAgent, CalcTokenMixin):
    moving_summary_buffer: str = ""
    moving_summary_index: int = 0
    summary_llm: BaseLanguageModel

    def plan(
            self,
            intermediate_steps: List[Tuple[AgentAction, str]],
            callbacks: Callbacks = None,
            **kwargs: Any,
    ) -> Union[AgentAction, AgentFinish]:
        """Given input, decided what to do.

        Args:
            intermediate_steps: Steps the LLM has taken to date, along with observations
            **kwargs: User inputs.

        Returns:
            Action specifying what tool to use.
        """
        agent_scratchpad = _format_intermediate_steps(intermediate_steps)
        selected_inputs = {
            k: kwargs[k] for k in self.prompt.input_variables if k != "agent_scratchpad"
        }
        full_inputs = dict(**selected_inputs, agent_scratchpad=agent_scratchpad)
        prompt = self.prompt.format_prompt(**full_inputs)
        messages = prompt.to_messages()

        # calculate rest tokens and summarize previous function observation messages if rest_tokens < 0
        rest_tokens = self.get_message_rest_tokens(self.llm, messages)
        rest_tokens = rest_tokens - 20  # to deal with the inaccuracy of rest_tokens
        if rest_tokens < 0:
            try:
                messages = self.summarize_messages(messages)
            except ExceededLLMTokensLimitError as e:
                return AgentFinish(return_values={"output": str(e)}, log=str(e))

        predicted_message = self.llm.predict_messages(
            messages, functions=self.functions, callbacks=callbacks
        )
        agent_decision = _parse_ai_message(predicted_message)
        return agent_decision

    def summarize_messages(self, messages: List[BaseMessage]) -> List[BaseMessage]:
        system_message = None
        human_message = None
        should_summary_messages = []
        for message in messages:
            if isinstance(message, SystemMessage):
                system_message = message
            elif isinstance(message, HumanMessage):
                human_message = message
            else:
                should_summary_messages.append(message)

        if len(should_summary_messages) > 2:
            ai_message = should_summary_messages[-2]
            function_message = should_summary_messages[-1]
            should_summary_messages = should_summary_messages[self.moving_summary_index:-2]
            self.moving_summary_index = len(should_summary_messages)
        else:
            error_msg = "Exceeded LLM tokens limit, stopped."
            raise ExceededLLMTokensLimitError(error_msg)

        new_messages = [system_message, human_message]

        if self.moving_summary_index == 0:
            should_summary_messages.insert(0, human_message)

        summary_handler = SummarizerMixin(llm=self.summary_llm)
        self.moving_summary_buffer = summary_handler.predict_new_summary(
            messages=should_summary_messages,
            existing_summary=self.moving_summary_buffer
        )

        new_messages.append(AIMessage(content=self.moving_summary_buffer))
        new_messages.append(ai_message)
        new_messages.append(function_message)

        return new_messages

    def get_num_tokens_from_messages(self, llm: BaseLanguageModel, messages: List[BaseMessage]) -> int:
        """Calculate num tokens for gpt-3.5-turbo and gpt-4 with tiktoken package.

        Official documentation: https://github.com/openai/openai-cookbook/blob/
        main/examples/How_to_format_inputs_to_ChatGPT_models.ipynb"""
        llm = cast(ChatOpenAI, llm)
        model, encoding = llm._get_encoding_model()
        if model.startswith("gpt-3.5-turbo"):
            # every message follows <im_start>{role/name}\n{content}<im_end>\n
            tokens_per_message = 4
            # if there's a name, the role is omitted
            tokens_per_name = -1
        elif model.startswith("gpt-4"):
            tokens_per_message = 3
            tokens_per_name = 1
        else:
            raise NotImplementedError(
                f"get_num_tokens_from_messages() is not presently implemented "
                f"for model {model}."
                "See https://github.com/openai/openai-python/blob/main/chatml.md for "
                "information on how messages are converted to tokens."
            )
        num_tokens = 0
        for m in messages:
            message = _convert_message_to_dict(m)
            num_tokens += tokens_per_message
            for key, value in message.items():
                if key == "function_call":
                    for f_key, f_value in value.items():
                        num_tokens += len(encoding.encode(f_key))
                        num_tokens += len(encoding.encode(f_value))
                else:
                    num_tokens += len(encoding.encode(value))

                if key == "name":
                    num_tokens += tokens_per_name
        # every reply is primed with <im_start>assistant
        num_tokens += 3

        if self.functions:
            for function in self.functions:
                num_tokens += len(encoding.encode('name'))
                num_tokens += len(encoding.encode(function.get("name")))
                num_tokens += len(encoding.encode('description'))
                num_tokens += len(encoding.encode(function.get("description")))
                parameters = function.get("parameters")
                num_tokens += len(encoding.encode('parameters'))
                if 'title' in parameters:
                    num_tokens += len(encoding.encode('title'))
                    num_tokens += len(encoding.encode(parameters.get("title")))
                num_tokens += len(encoding.encode('type'))
                num_tokens += len(encoding.encode(parameters.get("type")))
                if 'properties' in parameters:
                    num_tokens += len(encoding.encode('properties'))
                    for key, value in parameters.get('properties').items():
                        num_tokens += len(encoding.encode(key))
                        for field_key, field_value in value.items():
                            num_tokens += len(encoding.encode(field_key))
                            if field_key == 'enum':
                                for enum_field in field_value:
                                    num_tokens += 3
                                    num_tokens += len(encoding.encode(enum_field))
                            else:
                                num_tokens += len(encoding.encode(field_key))
                                num_tokens += len(encoding.encode(str(field_value)))
                if 'required' in parameters:
                    num_tokens += len(encoding.encode('required'))
                    for required_field in parameters['required']:
                        num_tokens += 3
                        num_tokens += len(encoding.encode(required_field))

        return num_tokens
