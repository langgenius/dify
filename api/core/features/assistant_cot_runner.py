import json
from typing import Literal, Union, Generator, Dict, Any

from core.entities.application_entities import AgentPromptEntity
from core.model_runtime.utils.encoders import jsonable_encoder
from core.model_runtime.entities.message_entities import PromptMessageTool, PromptMessage, UserPromptMessage
from core.model_runtime.entities.llm_entities import LLMResult
from core.model_manager import ModelInstance

from core.tools.provider.tool import Tool

from core.features.assistant_base_runner import BaseAssistantApplicationRunner

from extensions.ext_database import db
from models.model import Conversation, Message

class AssistantCotApplicationRunner(BaseAssistantApplicationRunner):
    def run(self, model_instance: ModelInstance,
        conversation: Conversation,
        tool_instances: Dict[str, Tool],
        message: Message,
        prompt_messages_tools: list[PromptMessageTool],
        query: str,
    ) -> Union[Generator, LLMResult]:
        """
        Run Cot agent application
        """
        app_orchestration_config = self.app_orchestration_config

        first_prompt_messages = self._originze_first_cot_prompt_messages(
            mode=app_orchestration_config.model_config.mode,
            tools=prompt_messages_tools,
            agent_prompt_message=app_orchestration_config.agent.prompt,
            instruction=app_orchestration_config.prompt_template.simple_prompt_template,
            input=query
        )

        # recale llm max tokens
        self.recale_llm_max_tokens(model_instance, first_prompt_messages)

        # invoke model
        llm_result: LLMResult = model_instance.invoke_llm(
            prompt_messages=first_prompt_messages,
            model_parameters=app_orchestration_config.model_config.parameters,
            tools=[],
            stop=app_orchestration_config.model_config.stop,
            stream=False,
            user=self.user_id,
            callbacks=[self.agent_llm_callback],
        )

        # check llm result
        if not llm_result:
            raise ValueError("failed to invoke llm")
        
        # parse llm result
        llm_result = self._parse_llm_result(llm_result.message.content)

    def _parse_cot_agent_tool_call(self, content: str) -> Union[None, str, Dict[str, Any]]:
        """
            parse result content message into tool call
        """
        pass

    def _check_cot_prompt_messages(self, mode: Literal["completion", "chat"], 
                                      agent_prompt_message: AgentPromptEntity,
    ):
        """
            check chain of thought prompt messages, a standard prompt message is like:
                Respond to the human as helpfully and accurately as possible. 

                {{instruction}}

                You have access to the following tools:

                {{tools}}

                Use a json blob to specify a tool by providing an action key (tool name) and an action_input key (tool input).
                Valid action values: "Final Answer" or {{tool_names}}

                Provide only ONE action per $JSON_BLOB, as shown:

                ```
                {{{{
                "action": $TOOL_NAME,
                "action_input": $ACTION_INPUT
                }}}}
                ```
        """

        # parse agent prompt message
        first_prompt = agent_prompt_message.first_prompt
        next_iteration = agent_prompt_message.next_iteration

        if not first_prompt or not next_iteration:
            raise ValueError(f"first_prompt or next_iteration is required in CoT agent mode")
        
        # check instruction, tools, and tool_names slots {{query}}
        if not first_prompt.find("{{instruction}}") >= 0:
            raise ValueError("{{instruction}} is required in first_prompt")
        if not first_prompt.find("{{tools}}") >= 0:
            raise ValueError("{{tools}} is required in first_prompt")
        if not first_prompt.find("{{tool_names}}") >= 0:
            raise ValueError("{{tool_names}} is required in first_prompt")
        
        if mode == "completion":
            if not first_prompt.find("{{query}}") >= 0:
                raise ValueError("{{query}} is required in first_prompt")
            if not first_prompt.find("{{agent_scratchpad}}") >= 0:
                raise ValueError("{{agent_scratchpad}} is required in first_prompt")
        
        if mode == "completion":
            if not next_iteration.find("{{observation}}") >= 0:
                raise ValueError("{{observation}} is required in next_iteration")

    def _originze_first_cot_prompt_messages(self, mode: Literal["completion", "chat"], 
                                      tools: list[PromptMessageTool], 
                                      agent_prompt_message: AgentPromptEntity,
                                      instruction: str,
                                      input: str,
        ) -> list[PromptMessage]:
        """
            originze chain of thought prompt messages, a standard prompt message is like:
                Respond to the human as helpfully and accurately as possible. 

                {{instruction}}

                You have access to the following tools:

                {{tools}}

                Use a json blob to specify a tool by providing an action key (tool name) and an action_input key (tool input).
                Valid action values: "Final Answer" or {{tool_names}}

                Provide only ONE action per $JSON_BLOB, as shown:

                ```
                {{{{
                "action": $TOOL_NAME,
                "action_input": $ACTION_INPUT
                }}}}
                ```
        """

        self._check_cot_prompt_messages(mode, agent_prompt_message)

        # parse agent prompt message
        first_prompt = agent_prompt_message.first_prompt

        # parse tools
        tools_str = self._jsonify_tool_prompt_messages(tools)

        # parse tools name
        tool_names = '"' + '","'.join([tool.name for tool in tools]) + '"'

        if mode == "chat":
            # parse prompt messages
            return [UserPromptMessage(
                content=first_prompt.replace("{{instruction}}", instruction)
                                    .replace("{{tools}}", tools_str)
                                    .replace("{{tool_names}}", tool_names)
                                    .replace("{{input}}", input)
                                    .replace("{{observation}}", ""),
            )]
        elif mode == "completion":
            # parse prompt messages
            return [UserPromptMessage(
                content=first_prompt.replace("{{instruction}}", instruction)
                                    .replace("{{tools}}", tools_str)
                                    .replace("{{tool_names}}", tool_names)
                                    .replace("{{query}}", input)
                                    .replace("{{agent_scratchpad}}", ""),
            )]
        else:
            raise ValueError(f"mode {mode} is not supported")
    
    def _originze_next_cot_prompt_messages(self, mode: Literal["completion", "chat"],
                                        prompt_messages: list[PromptMessage],
                                        agent_prompt_message: AgentPromptEntity,
                                        observation: str,
        ) -> list[PromptMessage]:
        """
            originze chain of thought prompt messages, a standard prompt message is like:
                Observation: {{observation}}
                Thought:
        """

        self._check_cot_prompt_messages(mode, agent_prompt_message)

        # parse agent prompt message
        next_iteration = agent_prompt_message.next_iteration

        # copy prompt messages
        prompt_messages = prompt_messages.copy()

        if mode == "chat":
            # parse prompt messages
            prompt_messages.append(UserPromptMessage(
                content=next_iteration.replace("{{observation}}", observation),
            ))
        elif mode == "completion":
            # parse prompt messages
            prompt_messages.append(UserPromptMessage(
                content=next_iteration.replace("{{observation}}", observation),
            ))
        else:
            raise ValueError(f"mode {mode} is not supported")
        
        return prompt_messages

    def _jsonify_tool_prompt_messages(self, tools: list[PromptMessageTool]) -> str:
        """
            jsonify tool prompt messages
        """
        tools = jsonable_encoder(tools)
        return json.dumps(tools)