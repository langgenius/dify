from collections.abc import Sequence
from typing import Any, Optional, Union

from langchain.agents import BaseSingleActionAgent, OpenAIFunctionsAgent
from langchain.agents.openai_functions_agent.base import _format_intermediate_steps, _parse_ai_message
from langchain.callbacks.base import BaseCallbackManager
from langchain.callbacks.manager import Callbacks
from langchain.prompts.chat import BaseMessagePromptTemplate
from langchain.schema import AgentAction, AgentFinish, AIMessage, SystemMessage
from langchain.tools import BaseTool
from pydantic import root_validator

from core.entities.application_entities import ModelConfigEntity
from core.entities.message_entities import lc_messages_to_prompt_messages
from core.features.dataset_retrieval.agent.fake_llm import FakeLLM
from core.model_manager import ModelInstance
from core.model_runtime.entities.message_entities import PromptMessageTool


class MultiDatasetRouterAgent(OpenAIFunctionsAgent):
    """
    An Multi Dataset Retrieve Agent driven by Router.
    """
    model_config: ModelConfigEntity

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
        if len(self.tools) == 0:
            return AgentFinish(return_values={"output": ''}, log='')
        elif len(self.tools) == 1:
            tool = next(iter(self.tools))
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
                if isinstance(tool_inputs, dict) and 'query' in tool_inputs and 'chat_history' not in kwargs:
                    tool_inputs['query'] = kwargs['input']
                    agent_decision.tool_input = tool_inputs
            else:
                agent_decision.return_values['output'] = ''
            return agent_decision
        except Exception as e:
            raise e

    def real_plan(
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
        return agent_decision

    async def aplan(
            self,
            intermediate_steps: list[tuple[AgentAction, str]],
            callbacks: Callbacks = None,
            **kwargs: Any,
    ) -> Union[AgentAction, AgentFinish]:
        raise NotImplementedError()

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
            **kwargs,
        )
