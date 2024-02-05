import json
import logging
import re
from typing import Dict, Generator, List, Literal, Union

from core.application_queue_manager import PublishFrom
from core.entities.application_entities import AgentPromptEntity, AgentScratchpadUnit
from core.features.assistant_base_runner import BaseAssistantApplicationRunner
from core.model_manager import ModelInstance
from core.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta, LLMUsage
from core.model_runtime.entities.message_entities import (AssistantPromptMessage, PromptMessage, PromptMessageTool,
                                                          SystemPromptMessage, UserPromptMessage)
from core.model_runtime.utils.encoders import jsonable_encoder
from core.tools.errors import (ToolInvokeError, ToolNotFoundError, ToolNotSupportedError, ToolParameterValidationError,
                               ToolProviderCredentialValidationError, ToolProviderNotFoundError)
from models.model import Conversation, Message


class AssistantCotApplicationRunner(BaseAssistantApplicationRunner):
    def run(self, conversation: Conversation,
        message: Message,
        query: str,
        inputs: Dict[str, str],
    ) -> Union[Generator, LLMResult]:
        """
        Run Cot agent application
        """
        app_orchestration_config = self.app_orchestration_config
        self._repack_app_orchestration_config(app_orchestration_config)

        agent_scratchpad: List[AgentScratchpadUnit] = []

        # check model mode
        if self.app_orchestration_config.model_config.mode == "completion":
            # TODO: stop words
            if 'Observation' not in app_orchestration_config.model_config.stop:
                app_orchestration_config.model_config.stop.append('Observation')

        # override inputs
        inputs = inputs or {}
        instruction = self.app_orchestration_config.prompt_template.simple_prompt_template
        instruction = self._fill_in_inputs_from_external_data_tools(instruction, inputs)

        iteration_step = 1
        max_iteration_steps = min(self.app_orchestration_config.agent.max_iteration, 5) + 1

        prompt_messages = self.history_prompt_messages

        # convert tools into ModelRuntime Tool format
        prompt_messages_tools: List[PromptMessageTool] = []
        tool_instances = {}
        for tool in self.app_orchestration_config.agent.tools if self.app_orchestration_config.agent else []:
            try:
                prompt_tool, tool_entity = self._convert_tool_to_prompt_message_tool(tool)
            except Exception:
                # api tool may be deleted
                continue
            # save tool entity
            tool_instances[tool.tool_name] = tool_entity
            # save prompt tool
            prompt_messages_tools.append(prompt_tool)

        # convert dataset tools into ModelRuntime Tool format
        for dataset_tool in self.dataset_tools:
            prompt_tool = self._convert_dataset_retriever_tool_to_prompt_message_tool(dataset_tool)
            # save prompt tool
            prompt_messages_tools.append(prompt_tool)
            # save tool entity
            tool_instances[dataset_tool.identity.name] = dataset_tool

        function_call_state = True
        llm_usage = {
            'usage': None
        }
        final_answer = ''

        def increase_usage(final_llm_usage_dict: Dict[str, LLMUsage], usage: LLMUsage):
            if not final_llm_usage_dict['usage']:
                final_llm_usage_dict['usage'] = usage
            else:
                llm_usage = final_llm_usage_dict['usage']
                llm_usage.prompt_tokens += usage.prompt_tokens
                llm_usage.completion_tokens += usage.completion_tokens
                llm_usage.prompt_price += usage.prompt_price
                llm_usage.completion_price += usage.completion_price

        model_instance = self.model_instance

        while function_call_state and iteration_step <= max_iteration_steps:
            # continue to run until there is not any tool call
            function_call_state = False

            if iteration_step == max_iteration_steps:
                # the last iteration, remove all tools
                prompt_messages_tools = []

            message_file_ids = []

            agent_thought = self.create_agent_thought(
                message_id=message.id,
                message='',
                tool_name='',
                tool_input='',
                messages_ids=message_file_ids
            )

            if iteration_step > 1:
                self.queue_manager.publish_agent_thought(agent_thought, PublishFrom.APPLICATION_MANAGER)

            # update prompt messages
            prompt_messages = self._organize_cot_prompt_messages(
                mode=app_orchestration_config.model_config.mode,
                prompt_messages=prompt_messages,
                tools=prompt_messages_tools,
                agent_scratchpad=agent_scratchpad,
                agent_prompt_message=app_orchestration_config.agent.prompt,
                instruction=instruction,
                input=query
            )

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
                callbacks=[],
            )

            # check llm result
            if not llm_result:
                raise ValueError("failed to invoke llm")

            # get scratchpad
            scratchpad = self._extract_response_scratchpad(llm_result.message.content)
            agent_scratchpad.append(scratchpad)
                        
            # get llm usage
            if llm_result.usage:
                increase_usage(llm_usage, llm_result.usage)
            
            # publish agent thought if it's first iteration
            if iteration_step == 1:
                self.queue_manager.publish_agent_thought(agent_thought, PublishFrom.APPLICATION_MANAGER)

            self.save_agent_thought(agent_thought=agent_thought,
                                    tool_name=scratchpad.action.action_name if scratchpad.action else '',
                                    tool_input=scratchpad.action.action_input if scratchpad.action else '',
                                    thought=scratchpad.thought,
                                    observation='',
                                    answer=llm_result.message.content,
                                    messages_ids=[],
                                    llm_usage=llm_result.usage)
            
            if scratchpad.action and scratchpad.action.action_name.lower() != "final answer":
                self.queue_manager.publish_agent_thought(agent_thought, PublishFrom.APPLICATION_MANAGER)

            # publish agent thought if it's not empty and there is a action
            if scratchpad.thought and scratchpad.action:
                # check if final answer
                if not scratchpad.action.action_name.lower() == "final answer":
                    yield LLMResultChunk(
                        model=model_instance.model,
                        prompt_messages=prompt_messages,
                        delta=LLMResultChunkDelta(
                            index=0,
                            message=AssistantPromptMessage(
                                content=scratchpad.thought
                            ),
                            usage=llm_result.usage,
                        ),
                        system_fingerprint=''
                    )

            if not scratchpad.action:
                # failed to extract action, return final answer directly
                final_answer = scratchpad.agent_response or ''
            else:
                if scratchpad.action.action_name.lower() == "final answer":
                    # action is final answer, return final answer directly
                    try:
                        final_answer = scratchpad.action.action_input if \
                            isinstance(scratchpad.action.action_input, str) else \
                                json.dumps(scratchpad.action.action_input)
                    except json.JSONDecodeError:
                        final_answer = f'{scratchpad.action.action_input}'
                else:
                    function_call_state = True

                    # action is tool call, invoke tool
                    tool_call_name = scratchpad.action.action_name
                    tool_call_args = scratchpad.action.action_input
                    tool_instance = tool_instances.get(tool_call_name)
                    if not tool_instance:
                        answer = f"there is not a tool named {tool_call_name}"
                        self.save_agent_thought(agent_thought=agent_thought, 
                                                tool_name='',
                                                tool_input='',
                                                thought=None, 
                                                observation=answer, 
                                                answer=answer,
                                                messages_ids=[])
                        self.queue_manager.publish_agent_thought(agent_thought, PublishFrom.APPLICATION_MANAGER)
                    else:
                        # invoke tool
                        error_response = None
                        try:
                            tool_response = tool_instance.invoke(
                                user_id=self.user_id, 
                                tool_parameters=tool_call_args if isinstance(tool_call_args, dict) else json.loads(tool_call_args)
                            )
                            # transform tool response to llm friendly response
                            tool_response = self.transform_tool_invoke_messages(tool_response)
                            # extract binary data from tool invoke message
                            binary_files = self.extract_tool_response_binary(tool_response)
                            # create message file
                            message_files = self.create_message_files(binary_files)
                            # publish files
                            for message_file, save_as in message_files:
                                if save_as:
                                    self.variables_pool.set_file(tool_name=tool_call_name,
                                                                  value=message_file.id,
                                                                  name=save_as)
                                self.queue_manager.publish_message_file(message_file, PublishFrom.APPLICATION_MANAGER)

                            message_file_ids = [message_file.id for message_file, _ in message_files]
                        except ToolProviderCredentialValidationError as e:
                            error_response = f"Please check your tool provider credentials"
                        except (
                            ToolNotFoundError, ToolNotSupportedError, ToolProviderNotFoundError
                        ) as e:
                            error_response = f"there is not a tool named {tool_call_name}"
                        except (
                            ToolParameterValidationError
                        ) as e:
                            error_response = f"tool parameters validation error: {e}, please check your tool parameters"
                        except ToolInvokeError as e:
                            error_response = f"tool invoke error: {e}"
                        except Exception as e:
                            error_response = f"unknown error: {e}"

                        if error_response:
                            observation = error_response
                        else:
                            observation = self._convert_tool_response_to_str(tool_response)

                        # save scratchpad
                        scratchpad.observation = observation
                        scratchpad.agent_response = llm_result.message.content

                        # save agent thought
                        self.save_agent_thought(
                            agent_thought=agent_thought, 
                            tool_name=tool_call_name,
                            tool_input=tool_call_args,
                            thought=None,
                            observation=observation, 
                            answer=llm_result.message.content,
                            messages_ids=message_file_ids,
                        )
                        self.queue_manager.publish_agent_thought(agent_thought, PublishFrom.APPLICATION_MANAGER)

                # update prompt tool message
                for prompt_tool in prompt_messages_tools:
                    self.update_prompt_message_tool(tool_instances[prompt_tool.name], prompt_tool)

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

        # save agent thought
        self.save_agent_thought(
            agent_thought=agent_thought, 
            tool_name='',
            tool_input='',
            thought=final_answer,
            observation='', 
            answer=final_answer,
            messages_ids=[]
        )

        self.update_db_variables(self.variables_pool, self.db_variables_pool)
        # publish end event
        self.queue_manager.publish_message_end(LLMResult(
            model=model_instance.model,
            prompt_messages=prompt_messages,
            message=AssistantPromptMessage(
                content=final_answer
            ),
            usage=llm_usage['usage'] if llm_usage['usage'] else LLMUsage.empty_usage(),
            system_fingerprint=''
        ), PublishFrom.APPLICATION_MANAGER)

    def _fill_in_inputs_from_external_data_tools(self, instruction: str, inputs: dict) -> str:
        """
        fill in inputs from external data tools
        """
        for key, value in inputs.items():
            try:
                instruction = instruction.replace(f'{{{{{key}}}}}', str(value))
            except Exception as e:
                continue

        return instruction

    def _extract_response_scratchpad(self, content: str) -> AgentScratchpadUnit:
        """
        extract response from llm response
        """
        def extra_quotes() -> AgentScratchpadUnit:
            agent_response = content
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
                    action = json.loads(quotes[i].replace('```', ''))
                    action_name = action.get("action")
                    action_input = action.get("action_input")
                    agent_thought = agent_response.replace(quotes[i], '')

                    if action_name and action_input:
                        return AgentScratchpadUnit(
                            agent_response=content,
                            thought=agent_thought,
                            action_str=quotes[i],
                            action=AgentScratchpadUnit.Action(
                                action_name=action_name,
                                action_input=action_input,
                            )
                        )
                except:
                    # try to parse action from plain text
                    action_name = re.findall(r'action: (.*)', quotes[i], re.IGNORECASE)
                    action_input = re.findall(r'action input: (.*)', quotes[i], re.IGNORECASE)
                    # delete action from agent response
                    agent_thought = agent_response.replace(quotes[i], '')
                    # remove extra quotes
                    agent_thought = re.sub(r'```(json)*\n*```', '', agent_thought, flags=re.DOTALL)
                    # remove Action: xxx from agent thought
                    agent_thought = re.sub(r'Action:.*', '', agent_thought, flags=re.IGNORECASE)

                    if action_name and action_input:
                        return AgentScratchpadUnit(
                            agent_response=content,
                            thought=agent_thought,
                            action_str=quotes[i],
                            action=AgentScratchpadUnit.Action(
                                action_name=action_name[0],
                                action_input=action_input[0],
                            )
                        )

        def extra_json():
            agent_response = content
            # try to extract all json
            structures, pair_match_stack = [], []
            started_at, end_at = 0, 0
            for i in range(len(content)):
                if content[i] == '{':
                    pair_match_stack.append(i)
                    if len(pair_match_stack) == 1:
                        started_at = i
                elif content[i] == '}':
                    begin = pair_match_stack.pop()
                    if not pair_match_stack:
                        end_at = i + 1
                        structures.append((content[begin:i+1], (started_at, end_at)))

            # handle the last character
            if pair_match_stack:
                end_at = len(content)
                structures.append((content[pair_match_stack[0]:], (started_at, end_at)))
            
            for i in range(len(structures), 0, -1):
                try:
                    json_content, (started_at, end_at) = structures[i - 1]
                    action = json.loads(json_content)
                    action_name = action.get("action")
                    action_input = action.get("action_input")
                    # delete json content from agent response
                    agent_thought = agent_response[:started_at] + agent_response[end_at:]
                    # remove extra quotes like ```(json)*\n\n```
                    agent_thought = re.sub(r'```(json)*\n*```', '', agent_thought, flags=re.DOTALL)
                    # remove Action: xxx from agent thought
                    agent_thought = re.sub(r'Action:.*', '', agent_thought, flags=re.IGNORECASE)

                    if action_name and action_input is not None:
                        return AgentScratchpadUnit(
                            agent_response=content,
                            thought=agent_thought,
                            action_str=json_content,
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
            
    def _convert_scratchpad_list_to_str(self, agent_scratchpad: List[AgentScratchpadUnit]) -> str:
        """
            convert agent scratchpad list to str
        """
        next_iteration = self.app_orchestration_config.agent.prompt.next_iteration

        result = ''
        for scratchpad in agent_scratchpad:
            result += scratchpad.thought + next_iteration.replace("{{observation}}", scratchpad.observation or '') + "\n"

        return result
    
    def _organize_cot_prompt_messages(self, mode: Literal["completion", "chat"],
                                      prompt_messages: List[PromptMessage],
                                      tools: List[PromptMessageTool], 
                                      agent_scratchpad: List[AgentScratchpadUnit],
                                      agent_prompt_message: AgentPromptEntity,
                                      instruction: str,
                                      input: str,
        ) -> List[PromptMessage]:
        """
            organize chain of thought prompt messages, a standard prompt message is like:
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

        # organize prompt messages
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
                    content=(agent_scratchpad[-1].thought or '')
                ))
            
            # add user message
            if len(agent_scratchpad) > 0:
                prompt_messages.append(UserPromptMessage(
                    content=(agent_scratchpad[-1].observation or ''),
                ))

            return prompt_messages
        elif mode == "completion":
            # parse agent scratchpad
            agent_scratchpad_str = self._convert_scratchpad_list_to_str(agent_scratchpad)
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
        try:
            return json.dumps(tools, ensure_ascii=False)
        except json.JSONDecodeError:
            return json.dumps(tools)