import logging

from typing import Optional

from core.app_runner.app_runner import AppRunner
from extensions.ext_database import db

from core.tools.entities.tool_entities import ToolInvokeMessage

from models.model import MessageAgentThought, Message

from core.agent.agent.agent_llm_callback import AgentLLMCallback
from core.app_runner.app_runner import AppRunner
from core.callback_handler.agent_loop_gather_callback_handler import AgentLoopGatherCallbackHandler
from core.entities.application_entities import ModelConfigEntity, AgentEntity
from core.application_queue_manager import ApplicationQueueManager
from core.memory.token_buffer_memory import TokenBufferMemory
from core.entities.application_entities import ModelConfigEntity, \
    AgentEntity, AppOrchestrationConfigEntity

logger = logging.getLogger(__name__)

class BaseAssistantApplicationRunner(AppRunner):
    def __init__(self, tenant_id: str,
                 app_orchestration_config: AppOrchestrationConfigEntity,
                 model_config: ModelConfigEntity,
                 config: AgentEntity,
                 queue_manager: ApplicationQueueManager,
                 message: Message,
                 user_id: str,
                 agent_llm_callback: AgentLLMCallback,
                 callback: AgentLoopGatherCallbackHandler,
                 memory: Optional[TokenBufferMemory] = None,
                 ) -> None:
        """
        Agent runner
        :param tenant_id: tenant id
        :param app_orchestration_config: app orchestration config
        :param model_config: model config
        :param config: dataset config
        :param queue_manager: queue manager
        :param message: message
        :param user_id: user id
        :param agent_llm_callback: agent llm callback
        :param callback: callback
        :param memory: memory
        """
        self.tenant_id = tenant_id
        self.app_orchestration_config = app_orchestration_config
        self.model_config = model_config
        self.config = config
        self.queue_manager = queue_manager
        self.message = message
        self.user_id = user_id
        self.agent_llm_callback = agent_llm_callback
        self.callback = callback
        self.memory = memory

    def _handle_tool_response(self, tool_response: ToolInvokeMessage) -> str:
        """
        Handle tool response
        """
        if tool_response.type == ToolInvokeMessage.MessageType.TEXT:
            return tool_response.message
        elif tool_response.type == ToolInvokeMessage.MessageType.LINK:
            return f"result link: {tool_response.message}"
        elif tool_response.type == ToolInvokeMessage.MessageType.IMAGE:
            return f"result image url: {tool_response.message}"
        elif tool_response.type == ToolInvokeMessage.MessageType.BLOB:
            return f"result has been sent to dialog of the assistant"
        else:
            return f"Here is the message: {tool_response.message}"
        
    def create_agent_thought(self, message_id: str, message: str, 
                             tool_name: str, tool_input: str,
                             ) -> MessageAgentThought:
        """
        Create agent thought
        """
        thought = MessageAgentThought(
            message_id=message_id,
            message_chain_id=None,
            thought='',
            tool=tool_name,
            tool_input=tool_input,
            message=message,
            message_token=0,
            message_unit_price=0,
            message_price_unit=0,
            answer='',
            answer_token=0,
            answer_unit_price=0,
            answer_price_unit=0,
            tokens=0,
            total_price=0,
            currency='USD',
            latency=0,
            created_by_role='account',
        )

        db.session.add(thought)
        db.session.commit()

        return thought

    def save_agent_thought(self, agent_thought: MessageAgentThought, thought: str, answer: str) -> MessageAgentThought:
        """
        Save agent thought
        """
        if thought is not None:
            agent_thought.thought = thought

        if answer is not None:
            agent_thought.answer = answer

        db.session.commit()