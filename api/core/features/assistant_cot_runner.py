import json
import logging
import re
from typing import Literal, Union, Generator, Dict, Any, List, Tuple

from core.entities.application_entities import AgentPromptEntity, AgentScratchpadUnit
from core.application_queue_manager import PublishFrom
from core.model_runtime.utils.encoders import jsonable_encoder
from core.model_runtime.entities.message_entities import PromptMessageTool, PromptMessage, \
    UserPromptMessage, SystemPromptMessage, AssistantPromptMessage
from core.model_runtime.entities.llm_entities import LLMResult, LLMUsage, LLMResultChunk, LLMResultChunkDelta
from core.model_manager import ModelInstance

from core.tools.provider.tool import Tool
from core.tools.errors import ToolInvokeError, ToolNotFoundError, \
    ToolNotSupportedError, ToolProviderNotFoundError, ToolParamterValidationError, \
          ToolProviderCredentialValidationError

from core.features.assistant_base_runner import BaseAssistantApplicationRunner

from extensions.ext_database import db
from models.model import Conversation, Message, MessageAgentThought

logger = logging.getLogger(__name__)

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

        agent_scratchpad: List[AgentScratchpadUnit] = []

        # check model mode
        if self.app_orchestration_config.model_config.mode == "completion":
            # TODO: stop words
            if 'Thought' not in app_orchestration_config.model_config.stop:
                app_orchestration_config.model_config.stop.append('Thought')

        prompt_messages = self.history_prompt_messages
        prompt_messages = self._originze_cot_prompt_messages(
            mode=app_orchestration_config.model_config.mode,
            prompt_messages=prompt_messages,
            tools=prompt_messages_tools,
            agent_scratchpad=agent_scratchpad,
            agent_prompt_message=app_orchestration_config.agent.prompt,
            instruction=app_orchestration_config.prompt_template.simple_prompt_template,
            input=query
        )

        iteration_step = 1
        max_iteration_steps = 5

        # continue to run until there is not any tool call
        function_call_state = True
        agent_thought: MessageAgentThought = None
        llm_usage = {
            'usage': None
        }
        final_answer = ''

        def increse_usage(final_llm_usage_dict: Dict[str, LLMUsage], usage: LLMUsage):
            if not final_llm_usage_dict['usage']:
                final_llm_usage_dict['usage'] = usage
            else:
                llm_usage = final_llm_usage_dict['usage']
                llm_usage.prompt_tokens += usage.prompt_tokens
                llm_usage.completion_tokens += usage.completion_tokens
                llm_usage.prompt_price += usage.prompt_price
                llm_usage.completion_price += usage.completion_price

        while function_call_state and iteration_step <= max_iteration_steps:
            
            function_call_state = False
            # recale llm max tokens
            self.recale_llm_max_tokens(self.model_config, prompt_messages)
            # invoke model
            llm_result: LLMResult = model_instance.invoke_llm(
                prompt_messages=prompt_messages,
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
            
            # get llm usage
            if llm_result.usage:
                increse_usage(llm_usage, llm_result.usage)

            # get scratchpad
            scratchpad = self._extract_response_scratchpad(llm_result.message.content)
            agent_scratchpad.append(scratchpad)

            if not scratchpad.action:
                # failed to extract action, return final answer directly
                final_answer = scratchpad.agent_response or ''
            else:
                if scratchpad.action.action_name.lower() == "final answer":
                    # action is final answer, return final answer directly
                    final_answer = scratchpad.action.action_input if \
                        isinstance(scratchpad.action.action_input, str) else \
                            json.dumps(scratchpad.action.action_input)
                else:
                    function_call_state = True

                    # action is tool call, invoke tool
                    tool_call_name = scratchpad.action.action_name
                    tool_call_args = scratchpad.action.action_input
                    tool_instance = tool_instances.get(tool_call_name)
                    # create agent thought
                    agent_thought = self.create_agent_thought(
                        message_id=message.id,
                        message=message.message,
                        tool_name=tool_call_name,
                        tool_input=tool_call_args if isinstance(tool_call_args, str) else json.dumps(tool_call_args),
                    )
                    self.queue_manager.publish_agent_thought(agent_thought, PublishFrom.APPLICATION_MANAGER)

                    if not tool_instance:
                        logger.error(f"failed to find tool instance: {tool_call_name}")
                        answer = f"there is not a tool named {tool_call_name}"
                        self.save_agent_thought(agent_thought, thought=None, observation=answer, answer=answer)
                        self.queue_manager.publish_agent_thought(agent_thought, PublishFrom.APPLICATION_MANAGER)
                    else:
                        # invoke tool
                        error_response = None
                        try:
                            tool_response = tool_instance.invoke(
                                user_id=self.user_id, 
                                tool_paramters=tool_call_args if isinstance(tool_call_args, dict) else json.loads(tool_call_args)
                            )
                        except ToolProviderCredentialValidationError as e:
                            error_response = f"Plese check your tool provider credentials"
                        except (
                            ToolNotFoundError, ToolNotSupportedError, ToolProviderNotFoundError
                        ) as e:
                            error_response = f"there is not a tool named {tool_call_name}"
                        except (
                            ToolParamterValidationError
                        ) as e:
                            error_response = f"tool paramters validation error: {e}, please check your tool paramters"
                        except ToolInvokeError as e:
                            error_response = f"tool invoke error: {e}"
                        except Exception as e:
                            error_response = f"unknown error: {e}"

                        if error_response:
                            observation = error_response
                            logger.error(error_response)
                        else:
                            observation = self._handle_tool_response(tool_response)

                        # save scratchpad
                        scratchpad.observation = observation
                        scratchpad.agent_response = llm_result.message.content

                        # save agent thought
                        self.save_agent_thought(
                            agent_thought=agent_thought, 
                            thought=llm_result.message.content, 
                            observation=observation, 
                            answer=''
                        )
                        self.queue_manager.publish_agent_thought(agent_thought, PublishFrom.APPLICATION_MANAGER)

                        # update prompt messages
                        prompt_messages = self._originze_cot_prompt_messages(
                            mode=app_orchestration_config.model_config.mode,
                            prompt_messages=prompt_messages,
                            tools=prompt_messages_tools,
                            agent_scratchpad=agent_scratchpad,
                            agent_prompt_message=app_orchestration_config.agent.prompt,
                            instruction=app_orchestration_config.prompt_template.simple_prompt_template,
                            input=query
                        )

            iteration_step += 1

        yield LLMResultChunk(
            model=model_instance.model,
            prompt_messages=prompt_messages,
            delta=LLMResultChunkDelta(
                index=0,
                message=AssistantPromptMessage(
                    content=final_answer
                ),
                usage=llm_usage['usage']
            ),
            system_fingerprint=''
        )

        # publish end event
        self.queue_manager.publish_message_end(LLMResult(
            model=model_instance.model,
            prompt_messages=prompt_messages,
            message=AssistantPromptMessage(
                content=final_answer
            ),
            usage=llm_usage['usage'],
            system_fingerprint=''
        ), PublishFrom.APPLICATION_MANAGER)

    def _extract_response_scratchpad(self, content: str) -> AgentScratchpadUnit:
        """
        extract response from llm response
        """
        def extra_quotes() -> AgentScratchpadUnit:
            # try to extract all quotes
            pattern = re.compile(r'```(.*?)```', re.DOTALL)
            quotes = pattern.findall(content)

            # try to extract action from end to start
            for i in range(len(quotes) - 1, 0, -1):
                """
                    1. use json load to parse action
                    2. use plain text `Action: xxx` to parse action
                """
                try:
                    action = json.loads(quotes[i])
                    action_name = action.get("action")
                    action_input = action.get("action_input")
                    if action_name and action_input:
                        return AgentScratchpadUnit(
                            agent_response=content,
                            thought=content,
                            action_str=quotes[i],
                            action=AgentScratchpadUnit.Action(
                                action_name=action_name,
                                action_input=action_input,
                            )
                        )
                except:
                    # try to parse action from plain text
                    action_name = re.findall(r'Action: (.*)', quotes[i])
                    action_input = re.findall(r'Action Input: (.*)', quotes[i])
                    if action_name and action_input:
                        return AgentScratchpadUnit(
                            agent_response=content,
                            thought=content,
                            action_str=quotes[i],
                            action=AgentScratchpadUnit.Action(
                                action_name=action_name[0],
                                action_input=action_input[0],
                            )
                        )

        def extra_json():
            # try to extract all json
            structures, pair_match_stack = [], []
            for i in range(len(content)):
                if content[i] == '{':
                    pair_match_stack.append(i)
                elif content[i] == '}':
                    begin = pair_match_stack.pop()
                    if not pair_match_stack:
                        print(content[begin:i+1])
                        structures.append(content[begin:i+1])

            # handle the last character
            if pair_match_stack:
                structures.append(content[pair_match_stack[0]:])
            
            for i in range(len(structures), 0, -1):
                try:
                    action = json.loads(structures[i - 1])
                    action_name = action.get("action")
                    action_input = action.get("action_input")
                    if action_name and action_input:
                        return AgentScratchpadUnit(
                            agent_response=content,
                            thought=content,
                            action_str=structures[i - 1],
                            action=AgentScratchpadUnit.Action(
                                action_name=action_name,
                                action_input=action_input,
                            )
                        )
                except:
                    pass
        
        agent_scratchpad = extra_quotes()
        if agent_scratchpad:
            return agent_scratchpad
        agent_scratchpad = extra_json()
        if agent_scratchpad:
            return agent_scratchpad
        
        return AgentScratchpadUnit(
            agent_response=content,
            thought=content,
            action_str='',
            action=None
        )
        
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
                {
                "action": $TOOL_NAME,
                "action_input": $ACTION_INPUT
                }
                ```
        """

        # parse agent prompt message
        first_prompt = agent_prompt_message.first_prompt
        next_iteration = agent_prompt_message.next_iteration

        if not isinstance(first_prompt, str) or not isinstance(next_iteration, str):
            raise ValueError(f"first_prompt or next_iteration is required in CoT agent mode")
        
        # check instruction, tools, and tool_names slots
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
            
    def _convert_strachpad_list_to_str(self, agent_scratchpad: List[AgentScratchpadUnit]) -> str:
        """
            convert agent scratchpad list to str
        """
        next_iteration = self.app_orchestration_config.agent.prompt.next_iteration

        result = ''
        for scratchpad in agent_scratchpad:
            result += next_iteration.replace("{{observation}}", scratchpad.observation) + "\n"

        return result
    
    def _originze_cot_prompt_messages(self, mode: Literal["completion", "chat"],
                                      prompt_messages: List[PromptMessage],
                                      tools: List[PromptMessageTool], 
                                      agent_scratchpad: List[AgentScratchpadUnit],
                                      agent_prompt_message: AgentPromptEntity,
                                      instruction: str,
                                      input: str,
        ) -> List[PromptMessage]:
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

        # get system message
        system_message = first_prompt.replace("{{instruction}}", instruction) \
                                     .replace("{{tools}}", tools_str) \
                                     .replace("{{tool_names}}", tool_names)

        # originze prompt messages
        if mode == "chat":
            # override system message
            overrided = False
            prompt_messages = prompt_messages.copy()
            for prompt_message in prompt_messages:
                if isinstance(prompt_message, SystemPromptMessage):
                    prompt_message.content = system_message
                    overrided = True
                    break

            if not overrided:
                prompt_messages.insert(0, SystemPromptMessage(
                    content=system_message,
                ))

            # add assistant message
            if len(agent_scratchpad) > 0:
                prompt_messages.append(AssistantPromptMessage(
                    content=agent_scratchpad[-1].thought + "\n" + agent_scratchpad[-1].observation
                ))

            # add user message
            if len(agent_scratchpad) > 0:
                prompt_messages.append(UserPromptMessage(
                    content=input,
                ))

            return prompt_messages
        elif mode == "completion":
            # parse agent scratchpad
            agent_scratchpad_str = self._convert_strachpad_list_to_str(agent_scratchpad)
            # parse prompt messages
            return [UserPromptMessage(
                content=first_prompt.replace("{{instruction}}", instruction)
                                    .replace("{{tools}}", tools_str)
                                    .replace("{{tool_names}}", tool_names)
                                    .replace("{{query}}", input)
                                    .replace("{{agent_scratchpad}}", agent_scratchpad_str),
            )]
        else:
            raise ValueError(f"mode {mode} is not supported")
            
    def _jsonify_tool_prompt_messages(self, tools: list[PromptMessageTool]) -> str:
        """
            jsonify tool prompt messages
        """
        tools = jsonable_encoder(tools)
        return json.dumps(tools)