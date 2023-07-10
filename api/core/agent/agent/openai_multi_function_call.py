from datetime import datetime
from typing import List, Tuple, Any, Union, Sequence, Optional

import pytz
from langchain.agents import BaseMultiActionAgent
from langchain.agents.openai_functions_multi_agent.base import OpenAIMultiFunctionsAgent, _format_intermediate_steps, \
    _parse_ai_message
from langchain.callbacks.base import BaseCallbackManager
from langchain.callbacks.manager import Callbacks
from langchain.prompts.chat import BaseMessagePromptTemplate
from langchain.schema import AgentAction, AgentFinish, SystemMessage, BaseLanguageModel
from langchain.tools import BaseTool

from core.agent.agent.calc_token_mixin import ExceededLLMTokensLimitError
from core.agent.agent.openai_function_call_summarize_mixin import OpenAIFunctionCallSummarizeMixin


class AutoSummarizingOpenMultiAIFunctionCallAgent(OpenAIMultiFunctionsAgent, OpenAIFunctionCallSummarizeMixin):

    @classmethod
    def from_llm_and_tools(
            cls,
            llm: BaseLanguageModel,
            tools: Sequence[BaseTool],
            callback_manager: Optional[BaseCallbackManager] = None,
            extra_prompt_messages: Optional[List[BaseMessagePromptTemplate]] = None,
            system_message: Optional[SystemMessage] = SystemMessage(
                content="You are a helpful AI assistant."
            ),
            **kwargs: Any,
    ) -> BaseMultiActionAgent:
        return super().from_llm_and_tools(
            llm=llm,
            tools=tools,
            callback_manager=callback_manager,
            extra_prompt_messages=extra_prompt_messages,
            system_message=cls.get_system_message(),
            **kwargs,
        )

    def should_use_agent(self, query: str):
        """
        return should use agent

        :param query:
        :return:
        """
        original_max_tokens = self.llm.max_tokens
        self.llm.max_tokens = 6

        prompt = self.prompt.format_prompt(input=query, agent_scratchpad=[])
        messages = prompt.to_messages()

        predicted_message = self.llm.predict_messages(
            messages, functions=self.functions, callbacks=None
        )

        function_call = predicted_message.additional_kwargs.get("function_call", {})

        self.llm.max_tokens = original_max_tokens

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
            messages = self.summarize_messages_if_needed(self.llm, messages, functions=self.functions)
        except ExceededLLMTokensLimitError as e:
            return AgentFinish(return_values={"output": str(e)}, log=str(e))

        predicted_message = self.llm.predict_messages(
            messages, functions=self.functions, callbacks=callbacks
        )
        agent_decision = _parse_ai_message(predicted_message)
        return agent_decision

    @classmethod
    def get_system_message(cls):
        # get current time
        current_time = datetime.now()
        current_timezone = pytz.timezone('UTC')
        current_time = current_timezone.localize(current_time)

        return SystemMessage(content="You are a helpful AI assistant.\n"
                                     "Current time: {}\n"
                                     "Respond directly if appropriate.".format(
            current_time.strftime("%Y-%m-%d %H:%M:%S %Z%z")))
