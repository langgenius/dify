from typing import List, Tuple, Any, Union

from langchain.agents.openai_functions_multi_agent.base import OpenAIMultiFunctionsAgent, _format_intermediate_steps, \
    _parse_ai_message
from langchain.callbacks.manager import Callbacks
from langchain.schema import AgentAction, AgentFinish

from core.agent.agent.calc_token_mixin import ExceededLLMTokensLimitError
from core.agent.agent.openai_function_call_summarize_mixin import OpenAIFunctionCallSummarizeMixin


class AutoSummarizingOpenMultiAIFunctionCallAgent(OpenAIMultiFunctionsAgent, OpenAIFunctionCallSummarizeMixin):

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
