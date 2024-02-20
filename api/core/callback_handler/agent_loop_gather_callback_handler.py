import json
import logging
import time
from typing import Any, Optional, Union, cast

from langchain.agents import openai_functions_agent, openai_functions_multi_agent
from langchain.callbacks.base import BaseCallbackHandler
from langchain.schema import AgentAction, AgentFinish, BaseMessage, LLMResult

from core.application_queue_manager import ApplicationQueueManager, PublishFrom
from core.callback_handler.entity.agent_loop import AgentLoop
from core.entities.application_entities import ModelConfigEntity
from core.model_runtime.entities.llm_entities import LLMResult as RuntimeLLMResult
from core.model_runtime.entities.message_entities import AssistantPromptMessage, PromptMessage, UserPromptMessage
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from extensions.ext_database import db
from models.model import Message, MessageAgentThought, MessageChain


class AgentLoopGatherCallbackHandler(BaseCallbackHandler):
    """Callback Handler that prints to std out."""
    raise_error: bool = True

    def __init__(self, model_config: ModelConfigEntity,
                 queue_manager: ApplicationQueueManager,
                 message: Message,
                 message_chain: MessageChain) -> None:
        """Initialize callback handler."""
        self.model_config = model_config
        self.queue_manager = queue_manager
        self.message = message
        self.message_chain = message_chain
        model_type_instance = self.model_config.provider_model_bundle.model_type_instance
        self.model_type_instance = cast(LargeLanguageModel, model_type_instance)
        self._agent_loops = []
        self._current_loop = None
        self._message_agent_thought = None

    @property
    def agent_loops(self) -> list[AgentLoop]:
        return self._agent_loops

    def clear_agent_loops(self) -> None:
        self._agent_loops = []
        self._current_loop = None
        self._message_agent_thought = None

    @property
    def always_verbose(self) -> bool:
        """Whether to call verbose callbacks even if verbose is False."""
        return True

    @property
    def ignore_chain(self) -> bool:
        """Whether to ignore chain callbacks."""
        return True

    def on_llm_before_invoke(self, prompt_messages: list[PromptMessage]) -> None:
        if not self._current_loop:
            # Agent start with a LLM query
            self._current_loop = AgentLoop(
                position=len(self._agent_loops) + 1,
                prompt="\n".join([prompt_message.content for prompt_message in prompt_messages]),
                status='llm_started',
                started_at=time.perf_counter()
            )

    def on_llm_after_invoke(self, result: RuntimeLLMResult) -> None:
        if self._current_loop and self._current_loop.status == 'llm_started':
            self._current_loop.status = 'llm_end'
            if result.usage:
                self._current_loop.prompt_tokens = result.usage.prompt_tokens
            else:
                self._current_loop.prompt_tokens = self.model_type_instance.get_num_tokens(
                    model=self.model_config.model,
                    credentials=self.model_config.credentials,
                    prompt_messages=[UserPromptMessage(content=self._current_loop.prompt)]
                )

            completion_message = result.message
            if completion_message.tool_calls:
                self._current_loop.completion \
                    = json.dumps({'function_call': completion_message.tool_calls})
            else:
                self._current_loop.completion = completion_message.content

            if result.usage:
                self._current_loop.completion_tokens = result.usage.completion_tokens
            else:
                self._current_loop.completion_tokens = self.model_type_instance.get_num_tokens(
                    model=self.model_config.model,
                    credentials=self.model_config.credentials,
                    prompt_messages=[AssistantPromptMessage(content=self._current_loop.completion)]
                )

    def on_chat_model_start(
            self,
            serialized: dict[str, Any],
            messages: list[list[BaseMessage]],
            **kwargs: Any
    ) -> Any:
        pass

    def on_llm_start(
        self, serialized: dict[str, Any], prompts: list[str], **kwargs: Any
    ) -> None:
        pass

    def on_llm_end(self, response: LLMResult, **kwargs: Any) -> None:
        """Do nothing."""
        pass

    def on_llm_error(
        self, error: Union[Exception, KeyboardInterrupt], **kwargs: Any
    ) -> None:
        logging.debug("Agent on_llm_error: %s", error)
        self._agent_loops = []
        self._current_loop = None
        self._message_agent_thought = None

    def on_tool_start(
        self,
        serialized: dict[str, Any],
        input_str: str,
        **kwargs: Any,
    ) -> None:
        """Do nothing."""
        # kwargs={'color': 'green', 'llm_prefix': 'Thought:', 'observation_prefix': 'Observation: '}
        # input_str='action-input'
        # serialized={'description': 'A search engine. Useful for when you need to answer questions about current events. Input should be a search query.', 'name': 'Search'}
        pass

    def on_agent_action(
        self, action: AgentAction, color: Optional[str] = None, **kwargs: Any
    ) -> Any:
        """Run on agent action."""
        tool = action.tool
        tool_input = json.dumps({"query": action.tool_input}
                                if isinstance(action.tool_input, str) else action.tool_input)
        completion = None
        if isinstance(action, openai_functions_agent.base._FunctionsAgentAction) \
                or isinstance(action, openai_functions_multi_agent.base._FunctionsAgentAction):
            thought = action.log.strip()
            completion = json.dumps({'function_call': action.message_log[0].additional_kwargs['function_call']})
        else:
            action_name_position = action.log.index("Action:") if action.log else -1
            thought = action.log[:action_name_position].strip() if action.log else ''

        if self._current_loop and self._current_loop.status == 'llm_end':
            self._current_loop.status = 'agent_action'
            self._current_loop.thought = thought
            self._current_loop.tool_name = tool
            self._current_loop.tool_input = tool_input
            if completion is not None:
                self._current_loop.completion = completion

            self._message_agent_thought = self._init_agent_thought()

    def on_tool_end(
        self,
        output: str,
        color: Optional[str] = None,
        observation_prefix: Optional[str] = None,
        llm_prefix: Optional[str] = None,
        **kwargs: Any,
    ) -> None:
        """If not the final action, print out observation."""
        # kwargs={'name': 'Search'}
        # llm_prefix='Thought:'
        # observation_prefix='Observation: '
        # output='53 years'

        if self._current_loop and self._current_loop.status == 'agent_action' and output and output != 'None':
            self._current_loop.status = 'tool_end'
            self._current_loop.tool_output = output
            self._current_loop.completed = True
            self._current_loop.completed_at = time.perf_counter()
            self._current_loop.latency = self._current_loop.completed_at - self._current_loop.started_at

            self._complete_agent_thought(self._message_agent_thought)

            self._agent_loops.append(self._current_loop)
            self._current_loop = None
            self._message_agent_thought = None

    def on_tool_error(
        self, error: Union[Exception, KeyboardInterrupt], **kwargs: Any
    ) -> None:
        """Do nothing."""
        logging.debug("Agent on_tool_error: %s", error)
        self._agent_loops = []
        self._current_loop = None
        self._message_agent_thought = None

    def on_agent_finish(self, finish: AgentFinish, **kwargs: Any) -> Any:
        """Run on agent end."""
        # Final Answer
        if self._current_loop and (self._current_loop.status == 'llm_end' or self._current_loop.status == 'agent_action'):
            self._current_loop.status = 'agent_finish'
            self._current_loop.completed = True
            self._current_loop.completed_at = time.perf_counter()
            self._current_loop.latency = self._current_loop.completed_at - self._current_loop.started_at
            self._current_loop.thought = '[DONE]'
            self._message_agent_thought = self._init_agent_thought()

            self._complete_agent_thought(self._message_agent_thought)

            self._agent_loops.append(self._current_loop)
            self._current_loop = None
            self._message_agent_thought = None
        elif not self._current_loop and self._agent_loops:
            self._agent_loops[-1].status = 'agent_finish'

    def _init_agent_thought(self) -> MessageAgentThought:
        message_agent_thought = MessageAgentThought(
            message_id=self.message.id,
            message_chain_id=self.message_chain.id,
            position=self._current_loop.position,
            thought=self._current_loop.thought,
            tool=self._current_loop.tool_name,
            tool_input=self._current_loop.tool_input,
            message=self._current_loop.prompt,
            message_price_unit=0,
            answer=self._current_loop.completion,
            answer_price_unit=0,
            created_by_role=('account' if self.message.from_source == 'console' else 'end_user'),
            created_by=(self.message.from_account_id
                        if self.message.from_source == 'console' else self.message.from_end_user_id)
        )

        db.session.add(message_agent_thought)
        db.session.commit()

        self.queue_manager.publish_agent_thought(message_agent_thought, PublishFrom.APPLICATION_MANAGER)

        return message_agent_thought

    def _complete_agent_thought(self, message_agent_thought: MessageAgentThought) -> None:
        loop_message_tokens = self._current_loop.prompt_tokens
        loop_answer_tokens = self._current_loop.completion_tokens

        # transform usage
        llm_usage = self.model_type_instance._calc_response_usage(
            self.model_config.model,
            self.model_config.credentials,
            loop_message_tokens,
            loop_answer_tokens
        )

        message_agent_thought.observation = self._current_loop.tool_output
        message_agent_thought.tool_process_data = ''  # currently not support
        message_agent_thought.message_token = loop_message_tokens
        message_agent_thought.message_unit_price = llm_usage.prompt_unit_price
        message_agent_thought.message_price_unit = llm_usage.prompt_price_unit
        message_agent_thought.answer_token = loop_answer_tokens
        message_agent_thought.answer_unit_price = llm_usage.completion_unit_price
        message_agent_thought.answer_price_unit = llm_usage.completion_price_unit
        message_agent_thought.latency = self._current_loop.latency
        message_agent_thought.tokens = self._current_loop.prompt_tokens + self._current_loop.completion_tokens
        message_agent_thought.total_price = llm_usage.total_price
        message_agent_thought.currency = llm_usage.currency
        db.session.commit()
