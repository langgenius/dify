import logging
import re
from typing import Optional, List, Union, Tuple

from langchain.schema import BaseMessage
from requests.exceptions import ChunkedEncodingError

from core.agent.agent_executor import AgentExecuteResult, PlanningStrategy
from core.callback_handler.main_chain_gather_callback_handler import MainChainGatherCallbackHandler
from core.callback_handler.llm_callback_handler import LLMCallbackHandler
from core.conversation_message_task import ConversationMessageTask, ConversationTaskStoppedException
from core.model_providers.error import LLMBadRequestError
from core.memory.read_only_conversation_token_db_buffer_shared_memory import \
    ReadOnlyConversationTokenDBBufferSharedMemory
from core.model_providers.model_factory import ModelFactory
from core.model_providers.models.entity.message import PromptMessage, to_prompt_messages
from core.model_providers.models.llm.base import BaseLLM
from core.orchestrator_rule_parser import OrchestratorRuleParser
from core.prompt.prompt_builder import PromptBuilder
from core.prompt.prompt_template import JinjaPromptTemplate
from core.prompt.prompts import MORE_LIKE_THIS_GENERATE_PROMPT
from models.model import App, AppModelConfig, Account, Conversation, Message, EndUser


class Completion:
    @classmethod
    def generate(cls, task_id: str, app: App, app_model_config: AppModelConfig, query: str, inputs: dict,
                 user: Union[Account, EndUser], conversation: Optional[Conversation], streaming: bool, is_override: bool = False):
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

        final_model_instance = ModelFactory.get_text_generation_model_from_model_config(
            tenant_id=app.tenant_id,
            model_config=app_model_config.model_dict,
            streaming=streaming
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
            streaming=streaming,
            model_instance=final_model_instance
        )

        rest_tokens_for_context_and_memory = cls.get_validate_rest_tokens(
            mode=app.mode,
            model_instance=final_model_instance,
            app_model_config=app_model_config,
            query=query,
            inputs=inputs
        )

        # init orchestrator rule parser
        orchestrator_rule_parser = OrchestratorRuleParser(
            tenant_id=app.tenant_id,
            app_model_config=app_model_config
        )

        # parse sensitive_word_avoidance_chain
        chain_callback = MainChainGatherCallbackHandler(conversation_message_task)
        sensitive_word_avoidance_chain = orchestrator_rule_parser.to_sensitive_word_avoidance_chain([chain_callback])
        if sensitive_word_avoidance_chain:
            query = sensitive_word_avoidance_chain.run(query)

        # get agent executor
        agent_executor = orchestrator_rule_parser.to_agent_executor(
            conversation_message_task=conversation_message_task,
            memory=memory,
            rest_tokens=rest_tokens_for_context_and_memory,
            chain_callback=chain_callback
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
                model_instance=final_model_instance,
                mode=app.mode,
                app_model_config=app_model_config,
                query=query,
                inputs=inputs,
                agent_execute_result=agent_execute_result,
                conversation_message_task=conversation_message_task,
                memory=memory
            )
        except ConversationTaskStoppedException:
            return
        except ChunkedEncodingError as e:
            # Interrupt by LLM (like OpenAI), handle it.
            logging.warning(f'ChunkedEncodingError: {e}')
            conversation_message_task.end()
            return

    @classmethod
    def run_final_llm(cls, model_instance: BaseLLM, mode: str, app_model_config: AppModelConfig, query: str, inputs: dict,
                      agent_execute_result: Optional[AgentExecuteResult],
                      conversation_message_task: ConversationMessageTask,
                      memory: Optional[ReadOnlyConversationTokenDBBufferSharedMemory]):
        # When no extra pre prompt is specified,
        # the output of the agent can be used directly as the main output content without calling LLM again
        fake_response = None
        if not app_model_config.pre_prompt and agent_execute_result and agent_execute_result.output \
                and agent_execute_result.strategy != PlanningStrategy.ROUTER:
            fake_response = agent_execute_result.output

        # get llm prompt
        prompt_messages, stop_words = cls.get_main_llm_prompt(
            mode=mode,
            model=app_model_config.model_dict,
            pre_prompt=app_model_config.pre_prompt,
            query=query,
            inputs=inputs,
            agent_execute_result=agent_execute_result,
            memory=memory
        )

        cls.recale_llm_max_tokens(
            model_instance=model_instance,
            prompt_messages=prompt_messages,
        )

        response = model_instance.run(
            messages=prompt_messages,
            stop=stop_words,
            callbacks=[LLMCallbackHandler(model_instance, conversation_message_task)],
            fake_response=fake_response
        )

        return response

    @classmethod
    def get_main_llm_prompt(cls, mode: str, model: dict,
                            pre_prompt: str, query: str, inputs: dict,
                            agent_execute_result: Optional[AgentExecuteResult],
                            memory: Optional[ReadOnlyConversationTokenDBBufferSharedMemory]) -> \
            Tuple[List[PromptMessage], Optional[List[str]]]:
        if mode == 'completion':
            prompt_template = JinjaPromptTemplate.from_template(
                template=("""Use the following context as your learned knowledge, inside <context></context> XML tags.

<context>
{{context}}
</context>

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

            return [PromptMessage(content=prompt_content)], None
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
                human_message_prompt += """Use the following context as your learned knowledge, inside <context></context> XML tags.

<context>
{{context}}
</context>

When answer to user:
- If you don't know, just say that you don't know.
- If you don't know when you are not sure, ask for clarification. 
Avoid mentioning that you obtained the information from the context.
And answer according to the language of the user's question.
"""

            if pre_prompt:
                human_message_prompt += pre_prompt

            query_prompt = "\n\nHuman: {{query}}\n\nAssistant: "

            if memory:
                # append chat histories
                tmp_human_message = PromptBuilder.to_human_message(
                    prompt_content=human_message_prompt + query_prompt,
                    inputs=human_inputs
                )

                if memory.model_instance.model_rules.max_tokens.max:
                    curr_message_tokens = memory.model_instance.get_num_tokens(to_prompt_messages([tmp_human_message]))
                    max_tokens = model.get("completion_params").get('max_tokens')
                    rest_tokens = memory.model_instance.model_rules.max_tokens.max - max_tokens - curr_message_tokens
                    rest_tokens = max(rest_tokens, 0)
                else:
                    rest_tokens = 2000

                histories = cls.get_history_messages_from_memory(memory, rest_tokens)
                human_message_prompt += "\n\n" if human_message_prompt else ""
                human_message_prompt += "Here is the chat histories between human and assistant, " \
                                        "inside <histories></histories> XML tags.\n\n<histories>\n"
                human_message_prompt += histories + "\n</histories>"

            human_message_prompt += query_prompt

            # construct main prompt
            human_message = PromptBuilder.to_human_message(
                prompt_content=human_message_prompt,
                inputs=human_inputs
            )

            messages.append(human_message)

            for message in messages:
                message.content = re.sub(r'<\|.*?\|>', '', message.content)

            return to_prompt_messages(messages), ['\nHuman:', '</histories>']

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
        memory_model_instance = ModelFactory.get_text_generation_model_from_model_config(
            tenant_id=tenant_id,
            model_config=app_model_config.model_dict
        )

        # use llm config from conversation
        memory = ReadOnlyConversationTokenDBBufferSharedMemory(
            conversation=conversation,
            model_instance=memory_model_instance,
            max_token_limit=kwargs.get("max_token_limit", 2048),
            memory_key=kwargs.get("memory_key", "chat_history"),
            return_messages=kwargs.get("return_messages", True),
            input_key=kwargs.get("input_key", "input"),
            output_key=kwargs.get("output_key", "output"),
            message_limit=kwargs.get("message_limit", 10),
        )

        return memory

    @classmethod
    def get_validate_rest_tokens(cls, mode: str, model_instance: BaseLLM, app_model_config: AppModelConfig,
                                 query: str, inputs: dict) -> int:
        model_limited_tokens = model_instance.model_rules.max_tokens.max
        max_tokens = model_instance.get_model_kwargs().max_tokens

        if model_limited_tokens is None:
            return -1

        if max_tokens is None:
            max_tokens = 0

        # get prompt without memory and context
        prompt_messages, _ = cls.get_main_llm_prompt(
            mode=mode,
            model=app_model_config.model_dict,
            pre_prompt=app_model_config.pre_prompt,
            query=query,
            inputs=inputs,
            agent_execute_result=None,
            memory=None
        )

        prompt_tokens = model_instance.get_num_tokens(prompt_messages)
        rest_tokens = model_limited_tokens - max_tokens - prompt_tokens
        if rest_tokens < 0:
            raise LLMBadRequestError("Query or prefix prompt is too long, you can reduce the prefix prompt, "
                                     "or shrink the max token, or switch to a llm with a larger token limit size.")

        return rest_tokens

    @classmethod
    def recale_llm_max_tokens(cls, model_instance: BaseLLM, prompt_messages: List[PromptMessage]):
        # recalc max_tokens if sum(prompt_token +  max_tokens) over model token limit
        model_limited_tokens = model_instance.model_rules.max_tokens.max
        max_tokens = model_instance.get_model_kwargs().max_tokens

        if model_limited_tokens is None:
            return

        if max_tokens is None:
            max_tokens = 0

        prompt_tokens = model_instance.get_num_tokens(prompt_messages)

        if prompt_tokens + max_tokens > model_limited_tokens:
            max_tokens = max(model_limited_tokens - prompt_tokens, 16)

            # update model instance max tokens
            model_kwargs = model_instance.get_model_kwargs()
            model_kwargs.max_tokens = max_tokens
            model_instance.set_model_kwargs(model_kwargs)

    @classmethod
    def generate_more_like_this(cls, task_id: str, app: App, message: Message, pre_prompt: str,
                                app_model_config: AppModelConfig, user: Account, streaming: bool):

        final_model_instance = ModelFactory.get_text_generation_model_from_model_config(
            tenant_id=app.tenant_id,
            model_config=app_model_config.model_dict,
            streaming=streaming
        )

        # get llm prompt
        old_prompt_messages, _ = cls.get_main_llm_prompt(
            mode="completion",
            model=app_model_config.model_dict,
            pre_prompt=pre_prompt,
            query=message.query,
            inputs=message.inputs,
            agent_execute_result=None,
            memory=None
        )

        original_completion = message.answer.strip()

        prompt = MORE_LIKE_THIS_GENERATE_PROMPT
        prompt = prompt.format(prompt=old_prompt_messages[0].content, original_completion=original_completion)

        prompt_messages = [PromptMessage(content=prompt)]

        conversation_message_task = ConversationMessageTask(
            task_id=task_id,
            app=app,
            app_model_config=app_model_config,
            user=user,
            inputs=message.inputs,
            query=message.query,
            is_override=True if message.override_model_configs else False,
            streaming=streaming,
            model_instance=final_model_instance
        )

        cls.recale_llm_max_tokens(
            model_instance=final_model_instance,
            prompt_messages=prompt_messages
        )

        final_model_instance.run(
            messages=prompt_messages,
            callbacks=[LLMCallbackHandler(final_model_instance, conversation_message_task)]
        )
