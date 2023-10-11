import json
from typing import Tuple, List, Any, Union, Sequence, Optional, cast

from langchain.agents import OpenAIFunctionsAgent, BaseSingleActionAgent
from langchain.agents.openai_functions_agent.base import _format_intermediate_steps, _parse_ai_message
from langchain.callbacks.base import BaseCallbackManager
from langchain.callbacks.manager import Callbacks
from langchain.prompts.chat import BaseMessagePromptTemplate
from langchain.schema import AgentAction, AgentFinish, SystemMessage, Generation, LLMResult, AIMessage
from langchain.schema.language_model import BaseLanguageModel
from langchain.tools import BaseTool
from pydantic import root_validator

from core.model_providers.models.entity.message import to_prompt_messages
from core.model_providers.models.llm.base import BaseLLM
from core.third_party.langchain.llms.fake import FakeLLM
from core.tool.dataset_retriever_tool import DatasetRetrieverTool


class MultiDatasetRouterAgent(OpenAIFunctionsAgent):
    """
    An Multi Dataset Retrieve Agent driven by Router.
    """
    model_instance: BaseLLM

    class Config:
        """Configuration for this pydantic object."""

        arbitrary_types_allowed = True

    @root_validator
    def validate_llm(cls, values: dict) -> dict:
        return values

    def should_use_agent(self, query: str):
        """
        return should use agent

        :param query:
        :return:
        """
        return True

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
        if len(self.tools) == 0:
            return AgentFinish(return_values={"output": ''}, log='')
        elif len(self.tools) == 1:
            tool = next(iter(self.tools))
            tool = cast(DatasetRetrieverTool, tool)
            rst = tool.run(tool_input={'query': kwargs['input']})
            # output = ''
            # rst_json = json.loads(rst)
            # for item in rst_json:
            #     output += f'{item["content"]}\n'
            return AgentFinish(return_values={"output": rst}, log=rst)

        if intermediate_steps:
            _, observation = intermediate_steps[-1]
            return AgentFinish(return_values={"output": observation}, log=observation)

        try:
            agent_decision = self.real_plan(intermediate_steps, callbacks, **kwargs)
            if isinstance(agent_decision, AgentAction):
                tool_inputs = agent_decision.tool_input
                if isinstance(tool_inputs, dict) and 'query' in tool_inputs:
                    tool_inputs['query'] = kwargs['input']
                    agent_decision.tool_input = tool_inputs
            return agent_decision
        except Exception as e:
            new_exception = self.model_instance.handle_exceptions(e)
            raise new_exception

    def real_plan(
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
        return agent_decision

    async def aplan(
            self,
            intermediate_steps: List[Tuple[AgentAction, str]],
            callbacks: Callbacks = None,
            **kwargs: Any,
    ) -> Union[AgentAction, AgentFinish]:
        raise NotImplementedError()

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
