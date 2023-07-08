from typing import List, Tuple, Any, Union

from langchain.agents import StructuredChatAgent
from langchain.base_language import BaseLanguageModel
from langchain.callbacks.manager import Callbacks
from langchain.memory.summary import SummarizerMixin
from langchain.schema import AgentAction, AgentFinish, AIMessage, HumanMessage

from core.agent.agent.calc_token_mixin import CalcTokenMixin, ExceededLLMTokensLimitError


class AutoSummarizingStructuredChatAgent(StructuredChatAgent, CalcTokenMixin):
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
            intermediate_steps: Steps the LLM has taken to date,
                along with observations
            callbacks: Callbacks to run.
            **kwargs: User inputs.

        Returns:
            Action specifying what tool to use.
        """
        full_inputs = self.get_full_inputs(intermediate_steps, **kwargs)

        prompts, _ = self.llm_chain.prep_prompts(input_list=[self.llm_chain.prep_inputs(full_inputs)])
        messages = []
        if prompts:
            messages = prompts[0].to_messages()

        rest_tokens = self.get_message_rest_tokens(self.llm_chain.llm, messages)
        if rest_tokens < 0:
            full_inputs = self.summarize_messages(intermediate_steps, **kwargs)

        full_output = self.llm_chain.predict(callbacks=callbacks, **full_inputs)
        return self.output_parser.parse(full_output)

    def summarize_messages(self, intermediate_steps: List[Tuple[AgentAction, str]], **kwargs):
        if len(intermediate_steps) >= 2:
            should_summary_intermediate_steps = intermediate_steps[self.moving_summary_index:-1]
            should_summary_messages = [AIMessage(content=observation)
                                       for _, observation in should_summary_intermediate_steps]
            if self.moving_summary_index == 0:
                should_summary_messages.insert(0, HumanMessage(content=kwargs.get("input")))

            self.moving_summary_index = len(intermediate_steps)
        else:
            error_msg = "Exceeded LLM tokens limit, stopped."
            raise ExceededLLMTokensLimitError(error_msg)

        summary_handler = SummarizerMixin(llm=self.summary_llm)
        if self.moving_summary_buffer:
            kwargs["chat_history"].pop()

        self.moving_summary_buffer = summary_handler.predict_new_summary(
            messages=should_summary_messages,
            existing_summary=self.moving_summary_buffer
        )

        kwargs["chat_history"].append(AIMessage(content=self.moving_summary_buffer))

        return self.get_full_inputs([intermediate_steps[-1]], **kwargs)
