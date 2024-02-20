from collections.abc import Sequence
from typing import Any, Optional, Union

from langchain.agents import BaseSingleActionAgent, OpenAIFunctionsAgent
from langchain.agents.openai_functions_agent.base import _format_intermediate_steps, _parse_ai_message
from langchain.callbacks.base import BaseCallbackManager
from langchain.callbacks.manager import Callbacks
from langchain.chat_models.openai import _convert_message_to_dict, _import_tiktoken
from langchain.memory.prompt import SUMMARY_PROMPT
from langchain.prompts.chat import BaseMessagePromptTemplate
from langchain.schema import (
    AgentAction,
    AgentFinish,
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage,
    get_buffer_string,
)
from langchain.tools import BaseTool
from pydantic import root_validator

from core.agent.agent.agent_llm_callback import AgentLLMCallback
from core.agent.agent.calc_token_mixin import CalcTokenMixin, ExceededLLMTokensLimitError
from core.chain.llm_chain import LLMChain
from core.entities.application_entities import ModelConfigEntity
from core.entities.message_entities import lc_messages_to_prompt_messages
from core.model_manager import ModelInstance
from core.model_runtime.entities.message_entities import PromptMessage, PromptMessageTool
from core.third_party.langchain.llms.fake import FakeLLM


class AutoSummarizingOpenAIFunctionCallAgent(OpenAIFunctionsAgent, CalcTokenMixin):
    moving_summary_buffer: str = ""
    moving_summary_index: int = 0
    summary_model_config: ModelConfigEntity = None
    model_config: ModelConfigEntity
    agent_llm_callback: Optional[AgentLLMCallback] = None

    class Config:
        """Configuration for this pydantic object."""

        arbitrary_types_allowed = True

    @root_validator
    def validate_llm(cls, values: dict) -> dict:
        return values

    @classmethod
    def from_llm_and_tools(
            cls,
            model_config: ModelConfigEntity,
            tools: Sequence[BaseTool],
            callback_manager: Optional[BaseCallbackManager] = None,
            extra_prompt_messages: Optional[list[BaseMessagePromptTemplate]] = None,
            system_message: Optional[SystemMessage] = SystemMessage(
                content="You are a helpful AI assistant."
            ),
            agent_llm_callback: Optional[AgentLLMCallback] = None,
            **kwargs: Any,
    ) -> BaseSingleActionAgent:
        prompt = cls.create_prompt(
            extra_prompt_messages=extra_prompt_messages,
            system_message=system_message,
        )
        return cls(
            model_config=model_config,
            llm=FakeLLM(response=''),
            prompt=prompt,
            tools=tools,
            callback_manager=callback_manager,
            agent_llm_callback=agent_llm_callback,
            **kwargs,
        )

    def should_use_agent(self, query: str):
        """
        return should use agent

        :param query:
        :return:
        """
        original_max_tokens = 0
        for parameter_rule in self.model_config.model_schema.parameter_rules:
            if (parameter_rule.name == 'max_tokens'
                    or (parameter_rule.use_template and parameter_rule.use_template == 'max_tokens')):
                original_max_tokens = (self.model_config.parameters.get(parameter_rule.name)
                              or self.model_config.parameters.get(parameter_rule.use_template)) or 0

        self.model_config.parameters['max_tokens'] = 40

        prompt = self.prompt.format_prompt(input=query, agent_scratchpad=[])
        messages = prompt.to_messages()

        try:
            prompt_messages = lc_messages_to_prompt_messages(messages)
            model_instance = ModelInstance(
                provider_model_bundle=self.model_config.provider_model_bundle,
                model=self.model_config.model,
            )

            tools = []
            for function in self.functions:
                tool = PromptMessageTool(
                    **function
                )

                tools.append(tool)

            result = model_instance.invoke_llm(
                prompt_messages=prompt_messages,
                tools=tools,
                stream=False,
                model_parameters={
                    'temperature': 0.2,
                    'top_p': 0.3,
                    'max_tokens': 1500
                }
            )
        except Exception as e:
            raise e

        self.model_config.parameters['max_tokens'] = original_max_tokens

        return True if result.message.tool_calls else False

    def plan(
            self,
            intermediate_steps: list[tuple[AgentAction, str]],
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

        prompt_messages = lc_messages_to_prompt_messages(messages)

        # summarize messages if rest_tokens < 0
        try:
            prompt_messages = self.summarize_messages_if_needed(prompt_messages, functions=self.functions)
        except ExceededLLMTokensLimitError as e:
            return AgentFinish(return_values={"output": str(e)}, log=str(e))

        model_instance = ModelInstance(
            provider_model_bundle=self.model_config.provider_model_bundle,
            model=self.model_config.model,
        )

        tools = []
        for function in self.functions:
            tool = PromptMessageTool(
                **function
            )

            tools.append(tool)

        result = model_instance.invoke_llm(
            prompt_messages=prompt_messages,
            tools=tools,
            stream=False,
            callbacks=[self.agent_llm_callback] if self.agent_llm_callback else [],
            model_parameters={
                'temperature': 0.2,
                'top_p': 0.3,
                'max_tokens': 1500
            }
        )

        ai_message = AIMessage(
            content=result.message.content or "",
            additional_kwargs={
                'function_call': {
                    'id': result.message.tool_calls[0].id,
                    **result.message.tool_calls[0].function.dict()
                } if result.message.tool_calls else None
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
            intermediate_steps: list[tuple[AgentAction, str]],
            **kwargs: Any,
    ) -> AgentFinish:
        try:
            return super().return_stopped_response(early_stopping_method, intermediate_steps, **kwargs)
        except ValueError:
            return AgentFinish({"output": "I'm sorry, I don't know how to respond to that."}, "")

    def summarize_messages_if_needed(self, messages: list[PromptMessage], **kwargs) -> list[PromptMessage]:
        # calculate rest tokens and summarize previous function observation messages if rest_tokens < 0
        rest_tokens = self.get_message_rest_tokens(
            self.model_config,
            messages,
            **kwargs
        )

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
        self, messages: list[BaseMessage], existing_summary: str
    ) -> str:
        new_lines = get_buffer_string(
            messages,
            human_prefix="Human",
            ai_prefix="AI",
        )

        chain = LLMChain(model_config=self.summary_model_config, prompt=SUMMARY_PROMPT)
        return chain.predict(summary=existing_summary, new_lines=new_lines)

    def get_num_tokens_from_messages(self, model_config: ModelConfigEntity, messages: list[BaseMessage], **kwargs) -> int:
        """Calculate num tokens for gpt-3.5-turbo and gpt-4 with tiktoken package.

        Official documentation: https://github.com/openai/openai-cookbook/blob/
        main/examples/How_to_format_inputs_to_ChatGPT_models.ipynb"""
        if model_config.provider == 'azure_openai':
            model = model_config.model
            model = model.replace("gpt-35", "gpt-3.5")
        else:
            model = model_config.credentials.get("base_model_name")

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
