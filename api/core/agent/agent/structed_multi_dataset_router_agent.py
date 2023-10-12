import re
from typing import List, Tuple, Any, Union, Sequence, Optional, cast

from langchain import BasePromptTemplate
from langchain.agents import StructuredChatAgent, AgentOutputParser, Agent
from langchain.agents.structured_chat.base import HUMAN_MESSAGE_TEMPLATE
from langchain.callbacks.base import BaseCallbackManager
from langchain.callbacks.manager import Callbacks
from langchain.prompts import SystemMessagePromptTemplate, HumanMessagePromptTemplate, ChatPromptTemplate
from langchain.schema import AgentAction, AgentFinish, OutputParserException
from langchain.tools import BaseTool
from langchain.agents.structured_chat.prompt import PREFIX, SUFFIX

from core.chain.llm_chain import LLMChain
from core.model_providers.models.llm.base import BaseLLM
from core.tool.dataset_retriever_tool import DatasetRetrieverTool

FORMAT_INSTRUCTIONS = """Use a json blob to specify a tool by providing an action key (tool name) and an action_input key (tool input).
The nouns in the format of "Thought", "Action", "Action Input", "Final Answer" must be expressed in English.
Valid "action" values: "Final Answer" or {tool_names}

Provide only ONE action per $JSON_BLOB, as shown:

```
{{{{
  "action": $TOOL_NAME,
  "action_input": $INPUT
}}}}
```

Follow this format:

Question: input question to answer
Thought: consider previous and subsequent steps
Action:
```
$JSON_BLOB
```
Observation: action result
... (repeat Thought/Action/Observation N times)
Thought: I know what to respond
Action:
```
{{{{
  "action": "Final Answer",
  "action_input": "Final response to human"
}}}}
```"""


class StructuredMultiDatasetRouterAgent(StructuredChatAgent):
    dataset_tools: Sequence[BaseTool]

    class Config:
        """Configuration for this pydantic object."""

        arbitrary_types_allowed = True

    def should_use_agent(self, query: str):
        """
        return should use agent
        Using the ReACT mode to determine whether an agent is needed is costly,
        so it's better to just use an Agent for reasoning, which is cheaper.

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
            intermediate_steps: Steps the LLM has taken to date,
                along with observations
            callbacks: Callbacks to run.
            **kwargs: User inputs.

        Returns:
            Action specifying what tool to use.
        """
        if len(self.dataset_tools) == 0:
            return AgentFinish(return_values={"output": ''}, log='')
        elif len(self.dataset_tools) == 1:
            tool = next(iter(self.dataset_tools))
            tool = cast(DatasetRetrieverTool, tool)
            rst = tool.run(tool_input={'query': kwargs['input']})
            return AgentFinish(return_values={"output": rst}, log=rst)

        full_inputs = self.get_full_inputs(intermediate_steps, **kwargs)

        try:
            full_output = self.llm_chain.predict(callbacks=callbacks, **full_inputs)
        except Exception as e:
            new_exception = self.llm_chain.model_instance.handle_exceptions(e)
            raise new_exception

        try:
            agent_decision = self.output_parser.parse(full_output)
            if isinstance(agent_decision, AgentAction):
                tool_inputs = agent_decision.tool_input
                if isinstance(tool_inputs, dict) and 'query' in tool_inputs:
                    tool_inputs['query'] = kwargs['input']
                    agent_decision.tool_input = tool_inputs
            else:
                agent_decision.return_values['output'] = ''
            return agent_decision
        except OutputParserException:
            return AgentFinish({"output": "I'm sorry, the answer of model is invalid, "
                                          "I don't know how to respond to that."}, "")
    @classmethod
    def create_prompt(
            cls,
            tools: Sequence[BaseTool],
            prefix: str = PREFIX,
            suffix: str = SUFFIX,
            human_message_template: str = HUMAN_MESSAGE_TEMPLATE,
            format_instructions: str = FORMAT_INSTRUCTIONS,
            input_variables: Optional[List[str]] = None,
            memory_prompts: Optional[List[BasePromptTemplate]] = None,
    ) -> BasePromptTemplate:
        tool_strings = []
        for tool in tools:
            args_schema = re.sub("}", "}}}}", re.sub("{", "{{{{", str(tool.args)))
            tool_strings.append(f"{tool.name}: {tool.description}, args: {args_schema}")
        formatted_tools = "\n".join(tool_strings)
        unique_tool_names = set(tool.name for tool in tools)
        tool_names = ", ".join('"' + name + '"' for name in unique_tool_names)
        format_instructions = format_instructions.format(tool_names=tool_names)
        template = "\n\n".join([prefix, formatted_tools, format_instructions, suffix])
        if input_variables is None:
            input_variables = ["input", "agent_scratchpad"]
        _memory_prompts = memory_prompts or []
        messages = [
            SystemMessagePromptTemplate.from_template(template),
            *_memory_prompts,
            HumanMessagePromptTemplate.from_template(human_message_template),
        ]
        return ChatPromptTemplate(input_variables=input_variables, messages=messages)

    @classmethod
    def from_llm_and_tools(
            cls,
            model_instance: BaseLLM,
            tools: Sequence[BaseTool],
            callback_manager: Optional[BaseCallbackManager] = None,
            output_parser: Optional[AgentOutputParser] = None,
            prefix: str = PREFIX,
            suffix: str = SUFFIX,
            human_message_template: str = HUMAN_MESSAGE_TEMPLATE,
            format_instructions: str = FORMAT_INSTRUCTIONS,
            input_variables: Optional[List[str]] = None,
            memory_prompts: Optional[List[BasePromptTemplate]] = None,
            **kwargs: Any,
    ) -> Agent:
        """Construct an agent from an LLM and tools."""
        cls._validate_tools(tools)
        prompt = cls.create_prompt(
            tools,
            prefix=prefix,
            suffix=suffix,
            human_message_template=human_message_template,
            format_instructions=format_instructions,
            input_variables=input_variables,
            memory_prompts=memory_prompts,
        )
        llm_chain = LLMChain(
            model_instance=model_instance,
            prompt=prompt,
            callback_manager=callback_manager,
        )
        tool_names = [tool.name for tool in tools]
        _output_parser = output_parser
        return cls(
            llm_chain=llm_chain,
            allowed_tools=tool_names,
            output_parser=_output_parser,
            dataset_tools=tools,
            **kwargs,
        )
