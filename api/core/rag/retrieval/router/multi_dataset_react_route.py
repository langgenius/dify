from collections.abc import Generator, Sequence
from typing import Union

from core.app.entities.app_invoke_entities import ModelConfigWithCredentialsEntity
from core.model_manager import ModelInstance
from core.model_runtime.entities.llm_entities import LLMUsage
from core.model_runtime.entities.message_entities import PromptMessage, PromptMessageRole, PromptMessageTool
from core.prompt.advanced_prompt_transform import AdvancedPromptTransform
from core.prompt.entities.advanced_prompt_entities import ChatModelMessage, CompletionModelPromptTemplate
from core.rag.retrieval.output_parser.react_output import ReactAction
from core.rag.retrieval.output_parser.structured_chat import StructuredChatOutputParser
from core.workflow.nodes.llm.llm_node import LLMNode

PREFIX = """Respond to the human as helpfully and accurately as possible. You have access to the following tools:"""

SUFFIX = """Begin! Reminder to ALWAYS respond with a valid json blob of a single action. Use tools if necessary. Respond directly if appropriate. Format is Action:```$JSON_BLOB```then Observation:.
Thought:"""

FORMAT_INSTRUCTIONS = """Use a json blob to specify a tool by providing an action key (tool name) and an action_input key (tool input).
The nouns in the format of "Thought", "Action", "Action Input", "Final Answer" must be expressed in English.
Valid "action" values: "Final Answer" or {tool_names}

Provide only ONE action per $JSON_BLOB, as shown:

```
{{
  "action": $TOOL_NAME,
  "action_input": $INPUT
}}
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
{{
  "action": "Final Answer",
  "action_input": "Final response to human"
}}
```"""


class ReactMultiDatasetRouter:

    def invoke(
            self,
            query: str,
            dataset_tools: list[PromptMessageTool],
            model_config: ModelConfigWithCredentialsEntity,
            model_instance: ModelInstance,
            user_id: str,
            tenant_id: str

    ) -> Union[str, None]:
        """Given input, decided what to do.
        Returns:
            Action specifying what tool to use.
        """
        if len(dataset_tools) == 0:
            return None
        elif len(dataset_tools) == 1:
            return dataset_tools[0].name

        try:
            return self._react_invoke(query=query, model_config=model_config,
                                      model_instance=model_instance,
                                      tools=dataset_tools, user_id=user_id, tenant_id=tenant_id)
        except Exception as e:
            return None

    def _react_invoke(
            self,
            query: str,
            model_config: ModelConfigWithCredentialsEntity,
            model_instance: ModelInstance,
            tools: Sequence[PromptMessageTool],
            user_id: str,
            tenant_id: str,
            prefix: str = PREFIX,
            suffix: str = SUFFIX,
            format_instructions: str = FORMAT_INSTRUCTIONS,
    ) -> Union[str, None]:
        if model_config.mode == "chat":
            prompt = self.create_chat_prompt(
                query=query,
                tools=tools,
                prefix=prefix,
                suffix=suffix,
                format_instructions=format_instructions,
            )
        else:
            prompt = self.create_completion_prompt(
                tools=tools,
                prefix=prefix,
                format_instructions=format_instructions,
            )
        stop = ['Observation:']
        # handle invoke result
        prompt_transform = AdvancedPromptTransform()
        prompt_messages = prompt_transform.get_prompt(
            prompt_template=prompt,
            inputs={},
            query='',
            files=[],
            context='',
            memory_config=None,
            memory=None,
            model_config=model_config
        )
        result_text, usage = self._invoke_llm(
            completion_param=model_config.parameters,
            model_instance=model_instance,
            prompt_messages=prompt_messages,
            stop=stop,
            user_id=user_id,
            tenant_id=tenant_id
        )
        output_parser = StructuredChatOutputParser()
        react_decision = output_parser.parse(result_text)
        if isinstance(react_decision, ReactAction):
            return react_decision.tool
        return None

    def _invoke_llm(self, completion_param: dict,
                    model_instance: ModelInstance,
                    prompt_messages: list[PromptMessage],
                    stop: list[str], user_id: str, tenant_id: str
                    ) -> tuple[str, LLMUsage]:
        """
            Invoke large language model
            :param model_instance: model instance
            :param prompt_messages: prompt messages
            :param stop: stop
            :return:
        """
        invoke_result = model_instance.invoke_llm(
            prompt_messages=prompt_messages,
            model_parameters=completion_param,
            stop=stop,
            stream=True,
            user=user_id,
        )

        # handle invoke result
        text, usage = self._handle_invoke_result(
            invoke_result=invoke_result
        )

        # deduct quota
        LLMNode.deduct_llm_quota(tenant_id=tenant_id, model_instance=model_instance, usage=usage)

        return text, usage

    def _handle_invoke_result(self, invoke_result: Generator) -> tuple[str, LLMUsage]:
        """
        Handle invoke result
        :param invoke_result: invoke result
        :return:
        """
        model = None
        prompt_messages = []
        full_text = ''
        usage = None
        for result in invoke_result:
            text = result.delta.message.content
            full_text += text

            if not model:
                model = result.model

            if not prompt_messages:
                prompt_messages = result.prompt_messages

            if not usage and result.delta.usage:
                usage = result.delta.usage

        if not usage:
            usage = LLMUsage.empty_usage()

        return full_text, usage

    def create_chat_prompt(
            self,
            query: str,
            tools: Sequence[PromptMessageTool],
            prefix: str = PREFIX,
            suffix: str = SUFFIX,
            format_instructions: str = FORMAT_INSTRUCTIONS,
    ) -> list[ChatModelMessage]:
        tool_strings = []
        for tool in tools:
            tool_strings.append(
                f"{tool.name}: {tool.description}, args: {{'query': {{'title': 'Query', 'description': 'Query for the dataset to be used to retrieve the dataset.', 'type': 'string'}}}}")
        formatted_tools = "\n".join(tool_strings)
        unique_tool_names = {tool.name for tool in tools}
        tool_names = ", ".join('"' + name + '"' for name in unique_tool_names)
        format_instructions = format_instructions.format(tool_names=tool_names)
        template = "\n\n".join([prefix, formatted_tools, format_instructions, suffix])
        prompt_messages = []
        system_prompt_messages = ChatModelMessage(
            role=PromptMessageRole.SYSTEM,
            text=template
        )
        prompt_messages.append(system_prompt_messages)
        user_prompt_message = ChatModelMessage(
            role=PromptMessageRole.USER,
            text=query
        )
        prompt_messages.append(user_prompt_message)
        return prompt_messages

    def create_completion_prompt(
            self,
            tools: Sequence[PromptMessageTool],
            prefix: str = PREFIX,
            format_instructions: str = FORMAT_INSTRUCTIONS,
    ) -> CompletionModelPromptTemplate:
        """Create prompt in the style of the zero shot agent.

        Args:
            tools: List of tools the agent will have access to, used to format the
                prompt.
            prefix: String to put before the list of tools.
        Returns:
            A PromptTemplate with the template assembled from the pieces here.
        """
        suffix = """Begin! Reminder to ALWAYS respond with a valid json blob of a single action. Use tools if necessary. Respond directly if appropriate. Format is Action:```$JSON_BLOB```then Observation:.
Question: {input}
Thought: {agent_scratchpad}
"""

        tool_strings = "\n".join([f"{tool.name}: {tool.description}" for tool in tools])
        tool_names = ", ".join([tool.name for tool in tools])
        format_instructions = format_instructions.format(tool_names=tool_names)
        template = "\n\n".join([prefix, tool_strings, format_instructions, suffix])
        return CompletionModelPromptTemplate(text=template)
