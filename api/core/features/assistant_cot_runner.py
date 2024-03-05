import json
import re
from collections.abc import Generator
from typing import Literal, Union

from core.application_queue_manager import PublishFrom
from core.entities.application_entities import AgentPromptEntity, AgentScratchpadUnit
from core.features.assistant_base_runner import BaseAssistantApplicationRunner
from core.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta, LLMUsage
from core.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    PromptMessage,
    PromptMessageTool,
    SystemPromptMessage,
    ToolPromptMessage,
    UserPromptMessage,
)
from core.model_runtime.utils.encoders import jsonable_encoder
from core.tools.errors import (
    ToolInvokeError,
    ToolNotFoundError,
    ToolNotSupportedError,
    ToolParameterValidationError,
    ToolProviderCredentialValidationError,
    ToolProviderNotFoundError,
)
from models.model import Conversation, Message


class AssistantCotApplicationRunner(BaseAssistantApplicationRunner):
    _is_first_iteration = True
    _ignore_observation_providers = ['wenxin']

    def run(self, conversation: Conversation,
        message: Message,
        query: str,
        inputs: dict[str, str],
    ) -> Union[Generator, LLMResult]:
        """
        Run Cot agent application
        """
        app_orchestration_config = self.app_orchestration_config
        self._repack_app_orchestration_config(app_orchestration_config)

        agent_scratchpad: list[AgentScratchpadUnit] = []
        self._init_agent_scratchpad(agent_scratchpad, self.history_prompt_messages)

        if 'Observation' not in app_orchestration_config.model_config.stop:
            if app_orchestration_config.model_config.provider not in self._ignore_observation_providers:
                app_orchestration_config.model_config.stop.append('Observation')

        # override inputs
        inputs = inputs or {}
        instruction = self.app_orchestration_config.prompt_template.simple_prompt_template
        instruction = self._fill_in_inputs_from_external_data_tools(instruction, inputs)

        iteration_step = 1
        max_iteration_steps = min(self.app_orchestration_config.agent.max_iteration, 5) + 1

        prompt_messages = self.history_prompt_messages

        # convert tools into ModelRuntime Tool format
        prompt_messages_tools: list[PromptMessageTool] = []
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

        def increase_usage(final_llm_usage_dict: dict[str, LLMUsage], usage: LLMUsage):
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

            # recalc llm max tokens
            self.recalc_llm_max_tokens(self.model_config, prompt_messages)
            # invoke model
            chunks: Generator[LLMResultChunk, None, None] = model_instance.invoke_llm(
                prompt_messages=prompt_messages,
                model_parameters=app_orchestration_config.model_config.parameters,
                tools=[],
                stop=app_orchestration_config.model_config.stop,
                stream=True,
                user=self.user_id,
                callbacks=[],
            )

            # check llm result
            if not chunks:
                raise ValueError("failed to invoke llm")
            
            usage_dict = {}
            react_chunks = self._handle_stream_react(chunks, usage_dict)
            scratchpad = AgentScratchpadUnit(
                agent_response='',
                thought='',
                action_str='',
                observation='',
                action=None,
            )

            # publish agent thought if it's first iteration
            if iteration_step == 1:
                self.queue_manager.publish_agent_thought(agent_thought, PublishFrom.APPLICATION_MANAGER)

            for chunk in react_chunks:
                if isinstance(chunk, dict):
                    scratchpad.agent_response += json.dumps(chunk)
                    try:
                        if scratchpad.action:
                            raise Exception("")
                        scratchpad.action_str = json.dumps(chunk)
                        scratchpad.action = AgentScratchpadUnit.Action(
                            action_name=chunk['action'],
                            action_input=chunk['action_input']
                        )
                    except:
                        scratchpad.thought += json.dumps(chunk)
                        yield LLMResultChunk(
                            model=self.model_config.model,
                            prompt_messages=prompt_messages,
                            system_fingerprint='',
                            delta=LLMResultChunkDelta(
                                index=0,
                                message=AssistantPromptMessage(
                                    content=json.dumps(chunk)
                                ),
                                usage=None
                            )
                        )
                else:
                    scratchpad.agent_response += chunk
                    scratchpad.thought += chunk
                    yield LLMResultChunk(
                        model=self.model_config.model,
                        prompt_messages=prompt_messages,
                        system_fingerprint='',
                        delta=LLMResultChunkDelta(
                            index=0,
                            message=AssistantPromptMessage(
                                content=chunk
                            ),
                            usage=None
                        )
                    )

            scratchpad.thought = scratchpad.thought.strip() or 'I am thinking about how to help you'
            agent_scratchpad.append(scratchpad)
                        
            # get llm usage
            if 'usage' in usage_dict:
                increase_usage(llm_usage, usage_dict['usage'])
            else:
                usage_dict['usage'] = LLMUsage.empty_usage()
            
            self.save_agent_thought(agent_thought=agent_thought,
                                    tool_name=scratchpad.action.action_name if scratchpad.action else '',
                                    tool_input=scratchpad.action.action_input if scratchpad.action else '',
                                    thought=scratchpad.thought,
                                    observation='',
                                    answer=scratchpad.agent_response,
                                    messages_ids=[],
                                    llm_usage=usage_dict['usage'])
            
            if scratchpad.action and scratchpad.action.action_name.lower() != "final answer":
                self.queue_manager.publish_agent_thought(agent_thought, PublishFrom.APPLICATION_MANAGER)

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
                            if isinstance(tool_call_args, str):
                                try:
                                    tool_call_args = json.loads(tool_call_args)
                                except json.JSONDecodeError:
                                    pass
                            
                            tool_response = tool_instance.invoke(
                                user_id=self.user_id, 
                                tool_parameters=tool_call_args
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
                            error_response = "Please check your tool provider credentials"
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

                        # save agent thought
                        self.save_agent_thought(
                            agent_thought=agent_thought, 
                            tool_name=tool_call_name,
                            tool_input=tool_call_args,
                            thought=None,
                            observation=observation, 
                            answer=scratchpad.agent_response,
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

    def _handle_stream_react(self, llm_response: Generator[LLMResultChunk, None, None], usage: dict) \
        -> Generator[Union[str, dict], None, None]:
        def parse_json(json_str):
            try:
                return json.loads(json_str.strip())
            except:
                return json_str
            
        def extra_json_from_code_block(code_block) -> Generator[Union[dict, str], None, None]:
            code_blocks = re.findall(r'```(.*?)```', code_block, re.DOTALL)
            if not code_blocks:
                return
            for block in code_blocks:
                json_text = re.sub(r'^[a-zA-Z]+\n', '', block.strip(), flags=re.MULTILINE)
                yield parse_json(json_text)
            
        code_block_cache = ''
        code_block_delimiter_count = 0
        in_code_block = False
        json_cache = ''
        json_quote_count = 0
        in_json = False
        got_json = False
    
        for response in llm_response:
            response = response.delta.message.content
            if not isinstance(response, str):
                continue

            # stream
            index = 0
            while index < len(response):
                steps = 1
                delta = response[index:index+steps]
                if delta == '`':
                    code_block_cache += delta
                    code_block_delimiter_count += 1
                else:
                    if not in_code_block:
                        if code_block_delimiter_count > 0:
                            yield code_block_cache
                        code_block_cache = ''
                    else:
                        code_block_cache += delta
                    code_block_delimiter_count = 0

                if code_block_delimiter_count == 3:
                    if in_code_block:
                        yield from extra_json_from_code_block(code_block_cache)
                        code_block_cache = ''
                        
                    in_code_block = not in_code_block
                    code_block_delimiter_count = 0

                if not in_code_block:
                    # handle single json
                    if delta == '{':
                        json_quote_count += 1
                        in_json = True
                        json_cache += delta
                    elif delta == '}':
                        json_cache += delta
                        if json_quote_count > 0:
                            json_quote_count -= 1
                            if json_quote_count == 0:
                                in_json = False
                                got_json = True
                                index += steps
                                continue
                    else:
                        if in_json:
                            json_cache += delta

                    if got_json:
                        got_json = False
                        yield parse_json(json_cache)
                        json_cache = ''
                        json_quote_count = 0
                        in_json = False
                    
                if not in_code_block and not in_json:
                    yield delta.replace('`', '')

                index += steps

        if code_block_cache:
            yield code_block_cache

        if json_cache:
            yield parse_json(json_cache)

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
    
    def _init_agent_scratchpad(self, 
                               agent_scratchpad: list[AgentScratchpadUnit],
                               messages: list[PromptMessage]
                               ) -> list[AgentScratchpadUnit]:
        """
        init agent scratchpad
        """
        current_scratchpad: AgentScratchpadUnit = None
        for message in messages:
            if isinstance(message, AssistantPromptMessage):
                current_scratchpad = AgentScratchpadUnit(
                    agent_response=message.content,
                    thought=message.content or 'I am thinking about how to help you',
                    action_str='',
                    action=None,
                    observation=None,
                )
                if message.tool_calls:
                    try:
                        current_scratchpad.action = AgentScratchpadUnit.Action(
                            action_name=message.tool_calls[0].function.name,
                            action_input=json.loads(message.tool_calls[0].function.arguments)
                        )
                    except:
                        pass
                    
                agent_scratchpad.append(current_scratchpad)
            elif isinstance(message, ToolPromptMessage):
                if current_scratchpad:
                    current_scratchpad.observation = message.content
        
        return agent_scratchpad

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
            raise ValueError("first_prompt or next_iteration is required in CoT agent mode")
        
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
            
    def _convert_scratchpad_list_to_str(self, agent_scratchpad: list[AgentScratchpadUnit]) -> str:
        """
            convert agent scratchpad list to str
        """
        next_iteration = self.app_orchestration_config.agent.prompt.next_iteration

        result = ''
        for scratchpad in agent_scratchpad:
            result += (scratchpad.thought or '') + (scratchpad.action_str or '') + \
                next_iteration.replace("{{observation}}", scratchpad.observation or 'It seems that no response is available')

        return result
    
    def _organize_cot_prompt_messages(self, mode: Literal["completion", "chat"],
                                      prompt_messages: list[PromptMessage],
                                      tools: list[PromptMessageTool], 
                                      agent_scratchpad: list[AgentScratchpadUnit],
                                      agent_prompt_message: AgentPromptEntity,
                                      instruction: str,
                                      input: str,
        ) -> list[PromptMessage]:
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
            overridden = False
            prompt_messages = prompt_messages.copy()
            for prompt_message in prompt_messages:
                if isinstance(prompt_message, SystemPromptMessage):
                    prompt_message.content = system_message
                    overridden = True
                    break
            
            # convert tool prompt messages to user prompt messages
            for idx, prompt_message in enumerate(prompt_messages):
                if isinstance(prompt_message, ToolPromptMessage):
                    prompt_messages[idx] = UserPromptMessage(
                        content=prompt_message.content
                    )

            if not overridden:
                prompt_messages.insert(0, SystemPromptMessage(
                    content=system_message,
                ))

            # add assistant message
            if len(agent_scratchpad) > 0 and not self._is_first_iteration:
                prompt_messages.append(AssistantPromptMessage(
                    content=(agent_scratchpad[-1].thought or '') + (agent_scratchpad[-1].action_str or ''),
                ))
            
            # add user message
            if len(agent_scratchpad) > 0 and not self._is_first_iteration:
                prompt_messages.append(UserPromptMessage(
                    content=(agent_scratchpad[-1].observation or 'It seems that no response is available'),
                ))

            self._is_first_iteration = False

            return prompt_messages
        elif mode == "completion":
            # parse agent scratchpad
            agent_scratchpad_str = self._convert_scratchpad_list_to_str(agent_scratchpad)
            self._is_first_iteration = False
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