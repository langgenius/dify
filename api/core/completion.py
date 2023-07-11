import logging
from typing import Optional, List, Union, Tuple

from langchain.base_language import BaseLanguageModel
from langchain.callbacks.base import BaseCallbackHandler
from langchain.chat_models.base import BaseChatModel
from langchain.llms import BaseLLM
from langchain.schema import BaseMessage, HumanMessage
from requests.exceptions import ChunkedEncodingError

from core.agent.agent_executor import AgentExecuteResult, PlanningStrategy
from core.callback_handler.main_chain_gather_callback_handler import MainChainGatherCallbackHandler
from core.constant import llm_constant
from core.callback_handler.llm_callback_handler import LLMCallbackHandler
from core.callback_handler.std_out_callback_handler import DifyStreamingStdOutCallbackHandler, \
    DifyStdOutCallbackHandler
from core.conversation_message_task import ConversationMessageTask, ConversationTaskStoppedException
from core.llm.error import LLMBadRequestError
from core.llm.fake import FakeLLM
from core.llm.llm_builder import LLMBuilder
from core.llm.streamable_chat_open_ai import StreamableChatOpenAI
from core.llm.streamable_open_ai import StreamableOpenAI
from core.memory.read_only_conversation_token_db_buffer_shared_memory import \
    ReadOnlyConversationTokenDBBufferSharedMemory
from core.orchestrator_rule_parser import OrchestratorRuleParser
from core.prompt.prompt_builder import PromptBuilder
from core.prompt.prompt_template import JinjaPromptTemplate
from core.prompt.prompts import MORE_LIKE_THIS_GENERATE_PROMPT
from models.model import App, AppModelConfig, Account, Conversation, Message


class Completion:
    @classmethod
    def generate(cls, task_id: str, app: App, app_model_config: AppModelConfig, query: str, inputs: dict,
                 user: Account, conversation: Optional[Conversation], streaming: bool, is_override: bool = False):
        """
        errors: ProviderTokenNotInitError
        """
        query = PromptBuilder.process_template(query)

        memory = None
        if conversation:
            # get memory of conversation (read-only)
            memory = cls.get_memory_from_conversation(
                tenant_id=app.tenant_id,
                app_model_config=app_model_config,
                conversation=conversation,
                return_messages=False
            )

            inputs = conversation.inputs

        rest_tokens_for_context_and_memory = cls.get_validate_rest_tokens(
            mode=app.mode,
            tenant_id=app.tenant_id,
            app_model_config=app_model_config,
            query=query,
            inputs=inputs
        )

        conversation_message_task = ConversationMessageTask(
            task_id=task_id,
            app=app,
            app_model_config=app_model_config,
            user=user,
            conversation=conversation,
            is_override=is_override,
            inputs=inputs,
            query=query,
            streaming=streaming
        )

        chain_callback = MainChainGatherCallbackHandler(conversation_message_task)

        # init orchestrator rule parser
        orchestrator_rule_parser = OrchestratorRuleParser(
            tenant_id=app.tenant_id,
            app_model_config=app_model_config
        )

        # parse sensitive_word_avoidance_chain
        sensitive_word_avoidance_chain = orchestrator_rule_parser.to_sensitive_word_avoidance_chain([chain_callback])
        if sensitive_word_avoidance_chain:
            query = sensitive_word_avoidance_chain.run(query)

        # get agent executor
        agent_executor = orchestrator_rule_parser.to_agent_executor(
            conversation_message_task=conversation_message_task,
            memory=memory,
            rest_tokens=rest_tokens_for_context_and_memory,
            callbacks=[chain_callback]
        )

        # run agent executor
        agent_execute_result = None
        if agent_executor:
            should_use_agent = agent_executor.should_use_agent(query)
            if should_use_agent:
                agent_execute_result = agent_executor.run(query)

        # run the final llm
        try:
            cls.run_final_llm(
                tenant_id=app.tenant_id,
                mode=app.mode,
                app_model_config=app_model_config,
                query=query,
                inputs=inputs,
                agent_execute_result=agent_execute_result,
                conversation_message_task=conversation_message_task,
                memory=memory,
                streaming=streaming
            )
        except ConversationTaskStoppedException:
            return
        except ChunkedEncodingError as e:
            # Interrupt by LLM (like OpenAI), handle it.
            logging.warning(f'ChunkedEncodingError: {e}')
            conversation_message_task.end()
            return

    @classmethod
    def run_final_llm(cls, tenant_id: str, mode: str, app_model_config: AppModelConfig, query: str, inputs: dict,
                      agent_execute_result: Optional[AgentExecuteResult],
                      conversation_message_task: ConversationMessageTask,
                      memory: Optional[ReadOnlyConversationTokenDBBufferSharedMemory], streaming: bool):
        # When no extra pre prompt is specified,
        # the output of the agent can be used directly as the main output content without calling LLM again
        if not app_model_config.pre_prompt and agent_execute_result \
                and agent_execute_result.strategy != PlanningStrategy.ROUTER:
            final_llm = FakeLLM(response=agent_execute_result.output, streaming=streaming)
            final_llm.callbacks = cls.get_llm_callbacks(final_llm, streaming, conversation_message_task)
            response = final_llm.generate([[HumanMessage(content=query)]])
            return response

        final_llm = LLMBuilder.to_llm_from_model(
            tenant_id=tenant_id,
            model=app_model_config.model_dict,
            streaming=streaming
        )

        # get llm prompt
        prompt, stop_words = cls.get_main_llm_prompt(
            mode=mode,
            llm=final_llm,
            pre_prompt=app_model_config.pre_prompt,
            query=query,
            inputs=inputs,
            agent_execute_result=agent_execute_result,
            memory=memory
        )

        final_llm.callbacks = cls.get_llm_callbacks(final_llm, streaming, conversation_message_task)

        cls.recale_llm_max_tokens(
            final_llm=final_llm,
            prompt=prompt,
            mode=mode
        )

        response = final_llm.generate([prompt], stop_words)

        return response

    @classmethod
    def get_main_llm_prompt(cls, mode: str, llm: BaseLanguageModel, pre_prompt: str, query: str, inputs: dict,
                            agent_execute_result: Optional[AgentExecuteResult],
                            memory: Optional[ReadOnlyConversationTokenDBBufferSharedMemory]) -> \
            Tuple[Union[str | List[BaseMessage]], Optional[List[str]]]:
        if mode == 'completion':
            prompt_template = JinjaPromptTemplate.from_template(
                template=("""Use the following CONTEXT as your learned knowledge:
[CONTEXT]
{{context}}
[END CONTEXT]

When answer to user:
- If you don't know, just say that you don't know.
- If you don't know when you are not sure, ask for clarification. 
Avoid mentioning that you obtained the information from the context.
And answer according to the language of the user's question.
""" if agent_execute_result else "")
                         + (pre_prompt + "\n" if pre_prompt else "")
                         + "{{query}}\n"
            )

            if agent_execute_result:
                inputs['context'] = agent_execute_result.output

            prompt_inputs = {k: inputs[k] for k in prompt_template.input_variables if k in inputs}
            prompt_content = prompt_template.format(
                query=query,
                **prompt_inputs
            )

            if isinstance(llm, BaseChatModel):
                # use chat llm as completion model
                return [HumanMessage(content=prompt_content)], None
            else:
                return prompt_content, None
        else:
            messages: List[BaseMessage] = []

            human_inputs = {
                "query": query
            }

            human_message_prompt = ""

            if pre_prompt:
                pre_prompt_inputs = {k: inputs[k] for k in
                                     JinjaPromptTemplate.from_template(template=pre_prompt).input_variables
                                     if k in inputs}

                if pre_prompt_inputs:
                    human_inputs.update(pre_prompt_inputs)

            if agent_execute_result:
                human_inputs['context'] = agent_execute_result.output
                human_message_prompt += """Use the following CONTEXT as your learned knowledge.
[CONTEXT]
{{context}}
[END CONTEXT]

When answer to user:
- If you don't know, just say that you don't know.
- If you don't know when you are not sure, ask for clarification. 
Avoid mentioning that you obtained the information from the context.
And answer according to the language of the user's question.
"""

            if pre_prompt:
                human_message_prompt += pre_prompt

            query_prompt = "\nHuman: {{query}}\nAI: "

            if memory:
                # append chat histories
                tmp_human_message = PromptBuilder.to_human_message(
                    prompt_content=human_message_prompt + query_prompt,
                    inputs=human_inputs
                )

                curr_message_tokens = memory.llm.get_messages_tokens([tmp_human_message])
                rest_tokens = llm_constant.max_context_token_length[memory.llm.model_name] \
                              - memory.llm.max_tokens - curr_message_tokens
                rest_tokens = max(rest_tokens, 0)
                histories = cls.get_history_messages_from_memory(memory, rest_tokens)
                human_message_prompt += "\n\n" + histories

            human_message_prompt += query_prompt

            # construct main prompt
            human_message = PromptBuilder.to_human_message(
                prompt_content=human_message_prompt,
                inputs=human_inputs
            )

            messages.append(human_message)

            return messages, ['\nHuman:']

    @classmethod
    def get_llm_callbacks(cls, llm: BaseLanguageModel,
                          streaming: bool,
                          conversation_message_task: ConversationMessageTask) -> List[BaseCallbackHandler]:
        llm_callback_handler = LLMCallbackHandler(llm, conversation_message_task)
        if streaming:
            return [llm_callback_handler, DifyStreamingStdOutCallbackHandler()]
        else:
            return [llm_callback_handler, DifyStdOutCallbackHandler()]

    @classmethod
    def get_history_messages_from_memory(cls, memory: ReadOnlyConversationTokenDBBufferSharedMemory,
                                         max_token_limit: int) -> str:
        """Get memory messages."""
        memory.max_token_limit = max_token_limit
        memory_key = memory.memory_variables[0]
        external_context = memory.load_memory_variables({})
        return external_context[memory_key]

    @classmethod
    def get_memory_from_conversation(cls, tenant_id: str, app_model_config: AppModelConfig,
                                     conversation: Conversation,
                                     **kwargs) -> ReadOnlyConversationTokenDBBufferSharedMemory:
        # only for calc token in memory
        memory_llm = LLMBuilder.to_llm_from_model(
            tenant_id=tenant_id,
            model=app_model_config.model_dict
        )

        # use llm config from conversation
        memory = ReadOnlyConversationTokenDBBufferSharedMemory(
            conversation=conversation,
            llm=memory_llm,
            max_token_limit=kwargs.get("max_token_limit", 2048),
            memory_key=kwargs.get("memory_key", "chat_history"),
            return_messages=kwargs.get("return_messages", True),
            input_key=kwargs.get("input_key", "input"),
            output_key=kwargs.get("output_key", "output"),
            message_limit=kwargs.get("message_limit", 10),
        )

        return memory

    @classmethod
    def get_validate_rest_tokens(cls, mode: str, tenant_id: str, app_model_config: AppModelConfig,
                                 query: str, inputs: dict) -> int:
        llm = LLMBuilder.to_llm_from_model(
            tenant_id=tenant_id,
            model=app_model_config.model_dict
        )

        model_limited_tokens = llm_constant.max_context_token_length[llm.model_name]
        max_tokens = llm.max_tokens

        # get prompt without memory and context
        prompt, _ = cls.get_main_llm_prompt(
            mode=mode,
            llm=llm,
            pre_prompt=app_model_config.pre_prompt,
            query=query,
            inputs=inputs,
            agent_execute_result=None,
            memory=None
        )

        prompt_tokens = llm.get_num_tokens(prompt) if isinstance(prompt, str) \
            else llm.get_num_tokens_from_messages(prompt)

        rest_tokens = model_limited_tokens - max_tokens - prompt_tokens
        if rest_tokens < 0:
            raise LLMBadRequestError("Query or prefix prompt is too long, you can reduce the prefix prompt, "
                                     "or shrink the max token, or switch to a llm with a larger token limit size.")

        return rest_tokens

    @classmethod
    def recale_llm_max_tokens(cls, final_llm: Union[StreamableOpenAI, StreamableChatOpenAI],
                              prompt: Union[str, List[BaseMessage]], mode: str):
        # recalc max_tokens if sum(prompt_token +  max_tokens) over model token limit
        model_limited_tokens = llm_constant.max_context_token_length[final_llm.model_name]
        max_tokens = final_llm.max_tokens

        if mode == 'completion' and isinstance(final_llm, BaseLLM):
            prompt_tokens = final_llm.get_num_tokens(prompt)
        else:
            prompt_tokens = final_llm.get_messages_tokens(prompt)

        if prompt_tokens + max_tokens > model_limited_tokens:
            max_tokens = max(model_limited_tokens - prompt_tokens, 16)
            final_llm.max_tokens = max_tokens

    @classmethod
    def generate_more_like_this(cls, task_id: str, app: App, message: Message, pre_prompt: str,
                                app_model_config: AppModelConfig, user: Account, streaming: bool):
        llm: StreamableOpenAI = LLMBuilder.to_llm(
            tenant_id=app.tenant_id,
            model_name='gpt-3.5-turbo',
            streaming=streaming
        )

        # get llm prompt
        original_prompt, _ = cls.get_main_llm_prompt(
            mode="completion",
            llm=llm,
            pre_prompt=pre_prompt,
            query=message.query,
            inputs=message.inputs,
            chain_output=None,
            memory=None
        )

        original_completion = message.answer.strip()

        prompt = MORE_LIKE_THIS_GENERATE_PROMPT
        prompt = prompt.format(prompt=original_prompt, original_completion=original_completion)

        if isinstance(llm, BaseChatModel):
            prompt = [HumanMessage(content=prompt)]

        conversation_message_task = ConversationMessageTask(
            task_id=task_id,
            app=app,
            app_model_config=app_model_config,
            user=user,
            inputs=message.inputs,
            query=message.query,
            is_override=True if message.override_model_configs else False,
            streaming=streaming
        )

        llm.callbacks = cls.get_llm_callbacks(llm, streaming, conversation_message_task)

        cls.recale_llm_max_tokens(
            final_llm=llm,
            prompt=prompt,
            mode='completion'
        )

        llm.generate([prompt])
