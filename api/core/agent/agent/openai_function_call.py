from typing import List, Tuple, Any, Union, Sequence, Optional

from langchain.agents import OpenAIFunctionsAgent, BaseSingleActionAgent
from langchain.agents.openai_functions_agent.base import _parse_ai_message, \
    _format_intermediate_steps
from langchain.callbacks.base import BaseCallbackManager
from langchain.callbacks.manager import Callbacks
from langchain.chat_models.openai import _convert_message_to_dict, _import_tiktoken
from langchain.memory.prompt import SUMMARY_PROMPT
from langchain.prompts.chat import BaseMessagePromptTemplate
from langchain.schema import AgentAction, AgentFinish, SystemMessage, AIMessage, HumanMessage, BaseMessage, \
    get_buffer_string
from langchain.tools import BaseTool
from pydantic import root_validator

from core.agent.agent.calc_token_mixin import ExceededLLMTokensLimitError, CalcTokenMixin
from core.chain.llm_chain import LLMChain
from core.model_providers.models.entity.message import to_prompt_messages
from core.model_providers.models.llm.base import BaseLLM
from core.third_party.langchain.llms.fake import FakeLLM


class AutoSummarizingOpenAIFunctionCallAgent(OpenAIFunctionsAgent, CalcTokenMixin):
    moving_summary_buffer: str = ""
    moving_summary_index: int = 0
    summary_model_instance: BaseLLM = None
    model_instance: BaseLLM

    class Config:
        """Configuration for this pydantic object."""

        arbitrary_types_allowed = True

    @root_validator
    def validate_llm(cls, values: dict) -> dict:
        return values

    @classmethod
    def from_llm_and_tools(
            cls,
            model_instance: BaseLLM,
            tools: Sequence[BaseTool],
            callback_manager: Optional[BaseCallbackManager] = None,
            extra_prompt_messages: Optional[List[BaseMessagePromptTemplate]] = None,
            system_message: Optional[SystemMessage] = SystemMessage(
                content="You are a helpful AI assistant."
            ),
            **kwargs: Any,
    ) -> BaseSingleActionAgent:
        prompt = cls.create_prompt(
            extra_prompt_messages=extra_prompt_messages,
            system_message=system_message,
        )
        return cls(
            model_instance=model_instance,
            llm=FakeLLM(response=''),
            prompt=prompt,
            tools=tools,
            callback_manager=callback_manager,
            **kwargs,
        )

    def should_use_agent(self, query: str):
        """
        return should use agent

        :param query:
        :return:
        """
        original_max_tokens = self.model_instance.model_kwargs.max_tokens
        self.model_instance.model_kwargs.max_tokens = 40

        prompt = self.prompt.format_prompt(input=query, agent_scratchpad=[])
        messages = prompt.to_messages()

        try:
            prompt_messages = to_prompt_messages(messages)
            result = self.model_instance.run(
                messages=prompt_messages,
                functions=self.functions,
                callbacks=None
            )
        except Exception as e:
            new_exception = self.model_instance.handle_exceptions(e)
            raise new_exception

        function_call = result.function_call

        self.model_instance.model_kwargs.max_tokens = original_max_tokens

        return True if function_call else False

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

        # summarize messages if rest_tokens < 0
        try:
            messages = self.summarize_messages_if_needed(messages, functions=self.functions)
        except ExceededLLMTokensLimitError as e:
            return AgentFinish(return_values={"output": str(e)}, log=str(e))

        prompt_messages = to_prompt_messages(messages)
        result = self.model_instance.run(
            messages=prompt_messages,
            functions=self.functions,
        )

        ai_message = AIMessage(
            content=result.content,
            additional_kwargs={
                'function_call': result.function_call
            }
        )
        agent_decision = _parse_ai_message(ai_message)

        if isinstance(agent_decision, AgentAction) and agent_decision.tool == 'dataset':
            tool_inputs = agent_decision.tool_input
            if isinstance(tool_inputs, dict) and 'query' in tool_inputs:
                tool_inputs['query'] = kwargs['input']
                agent_decision.tool_input = tool_inputs

        return agent_decision

    @classmethod
    def get_system_message(cls):
        return SystemMessage(content="You are a helpful AI assistant.\n"
                                     "The current date or current time you know is wrong.\n"
                                     "Respond directly if appropriate.")

    def return_stopped_response(
            self,
            early_stopping_method: str,
            intermediate_steps: List[Tuple[AgentAction, str]],
            **kwargs: Any,
    ) -> AgentFinish:
        try:
            return super().return_stopped_response(early_stopping_method, intermediate_steps, **kwargs)
        except ValueError:
            return AgentFinish({"output": "I'm sorry, I don't know how to respond to that."}, "")

    def summarize_messages_if_needed(self, messages: List[BaseMessage], **kwargs) -> List[BaseMessage]:
        # calculate rest tokens and summarize previous function observation messages if rest_tokens < 0
        rest_tokens = self.get_message_rest_tokens(self.model_instance, messages, **kwargs)
        rest_tokens = rest_tokens - 20  # to deal with the inaccuracy of rest_tokens
        if rest_tokens >= 0:
            return messages

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

        self.moving_summary_buffer = self.predict_new_summary(
            messages=should_summary_messages,
            existing_summary=self.moving_summary_buffer
        )

        new_messages.append(AIMessage(content=self.moving_summary_buffer))
        new_messages.append(ai_message)
        new_messages.append(function_message)

        return new_messages

    def predict_new_summary(
        self, messages: List[BaseMessage], existing_summary: str
    ) -> str:
        new_lines = get_buffer_string(
            messages,
            human_prefix="Human",
            ai_prefix="AI",
        )

        chain = LLMChain(model_instance=self.summary_model_instance, prompt=SUMMARY_PROMPT)
        return chain.predict(summary=existing_summary, new_lines=new_lines)

    def get_num_tokens_from_messages(self, model_instance: BaseLLM, messages: List[BaseMessage], **kwargs) -> int:
        """Calculate num tokens for gpt-3.5-turbo and gpt-4 with tiktoken package.

        Official documentation: https://github.com/openai/openai-cookbook/blob/
        main/examples/How_to_format_inputs_to_ChatGPT_models.ipynb"""
        if model_instance.model_provider.provider_name == 'azure_openai':
            model = model_instance.base_model_name
            model = model.replace("gpt-35", "gpt-3.5")
        else:
            model = model_instance.base_model_name

        tiktoken_ = _import_tiktoken()
        try:
            encoding = tiktoken_.encoding_for_model(model)
        except KeyError:
            model = "cl100k_base"
            encoding = tiktoken_.get_encoding(model)

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

        if kwargs.get('functions'):
            for function in kwargs.get('functions'):
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
