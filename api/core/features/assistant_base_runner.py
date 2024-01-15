import logging

from typing import Optional, List

from core.app_runner.app_runner import AppRunner
from extensions.ext_database import db

from models.model import MessageAgentThought, Message, MessageFile

from core.tools.entities.tool_entities import ToolInvokeMessage, ToolInvokeMessageBinary
from core.tools.tool_file_manager import ToolFileManager
from core.agent.agent.agent_llm_callback import AgentLLMCallback
from core.app_runner.app_runner import AppRunner
from core.callback_handler.agent_loop_gather_callback_handler import AgentLoopGatherCallbackHandler
from core.entities.application_entities import ModelConfigEntity, AgentEntity
from core.application_queue_manager import ApplicationQueueManager
from core.memory.token_buffer_memory import TokenBufferMemory
from core.entities.application_entities import ModelConfigEntity, \
    AgentEntity, AppOrchestrationConfigEntity, ApplicationGenerateEntity, InvokeFrom
from core.model_runtime.entities.message_entities import PromptMessage

logger = logging.getLogger(__name__)

class BaseAssistantApplicationRunner(AppRunner):
    def __init__(self, tenant_id: str,
                 application_generate_entity: ApplicationGenerateEntity,
                 app_orchestration_config: AppOrchestrationConfigEntity,
                 model_config: ModelConfigEntity,
                 config: AgentEntity,
                 queue_manager: ApplicationQueueManager,
                 message: Message,
                 user_id: str,
                 agent_llm_callback: AgentLLMCallback,
                 callback: AgentLoopGatherCallbackHandler,
                 memory: Optional[TokenBufferMemory] = None,
                 prompt_messages: Optional[List[PromptMessage]] = None,
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
        self.application_generate_entity = application_generate_entity
        self.app_orchestration_config = app_orchestration_config
        self.model_config = model_config
        self.config = config
        self.queue_manager = queue_manager
        self.message = message
        self.user_id = user_id
        self.agent_llm_callback = agent_llm_callback
        self.callback = callback
        self.memory = memory
        self.history_prompt_messages = prompt_messages

        # get how many agent thoughts have been created
        self.agent_thought_count = db.session.query(MessageAgentThought).filter(
            MessageAgentThought.message_id == self.message.id,
        ).count()

    def _repacket_app_orchestration_config(self, app_orchestration_config: AppOrchestrationConfigEntity) -> AppOrchestrationConfigEntity:
        """
        Repacket app orchestration config
        """
        if app_orchestration_config.prompt_template.simple_prompt_template is None:
            app_orchestration_config.prompt_template.simple_prompt_template = ''

        return app_orchestration_config

    def _convert_tool_response_to_str(self, tool_response: List[ToolInvokeMessage]) -> str:
        """
        Handle tool response
        """
        result = ''
        for response in tool_response:
            if response.type == ToolInvokeMessage.MessageType.TEXT:
                result += response.message
            elif response.type == ToolInvokeMessage.MessageType.LINK:
                result += f"result link: {response.message}."
            elif response.type == ToolInvokeMessage.MessageType.IMAGE_LINK or \
                 response.type == ToolInvokeMessage.MessageType.IMAGE:
                result += f"image has been created already and sent to user, you should tell user to check it now."
            else:
                result += f"tool response: {response.message}."

        return result
    
    def extract_tool_response_binary(self, tool_response: List[ToolInvokeMessage]) -> List[ToolInvokeMessageBinary]:
        """
        Extract tool response binary
        """
        result = []

        for response in tool_response:
            if response.type == ToolInvokeMessage.MessageType.IMAGE_LINK or \
                response.type == ToolInvokeMessage.MessageType.IMAGE:
                result.append(ToolInvokeMessageBinary(
                    mimetype=response.meta.get('mime_type', 'octet/stream'),
                    url=response.message,
                ))
            elif response.type == ToolInvokeMessage.MessageType.BLOB:
                result.append(ToolInvokeMessageBinary(
                    mimetype=response.meta.get('mime_type', 'octet/stream'),
                    url=response.message,
                ))
            elif response.type == ToolInvokeMessage.MessageType.LINK:
                # check if there is a mime type in meta
                if 'mime_type' in response.meta:
                    result.append(ToolInvokeMessageBinary(
                        mimetype=response.meta.get('mime_type', 'octet/stream'),
                        url=response.message,
                    ))
        return result
    
    def create_message_files(self, messages: List[ToolInvokeMessageBinary]) -> List[MessageFile]:
        """
        Create message file
        """
        result = []

        for message in messages:
            file_type = 'bin'
            if 'image' in message.mimetype:
                file_type = 'image'
            elif 'video' in message.mimetype:
                file_type = 'video'
            elif 'audio' in message.mimetype:
                file_type = 'audio'
            elif 'text' in message.mimetype:
                file_type = 'text'
            elif 'pdf' in message.mimetype:
                file_type = 'pdf'
            elif 'zip' in message.mimetype:
                file_type = 'zip'
            # ...

            invoke_from = self.application_generate_entity.invoke_from

            message_file = MessageFile(
                message_id=self.message.id,
                type=file_type,
                transfer_method='remote_file',
                belongs_to='assistant',
                url=message.url,
                upload_file_id=None,
                created_by_role=('account'if invoke_from in [InvokeFrom.EXPLORE, InvokeFrom.DEBUGGER] else 'end_user'),
                created_by=self.user_id,
            )
            db.session.add(message_file)
            result.append(message_file)
            
        db.session.commit()

        return result
        
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
            observation='',
            answer_token=0,
            answer_unit_price=0,
            answer_price_unit=0,
            tokens=0,
            total_price=0,
            position=self.agent_thought_count + 1,
            currency='USD',
            latency=0,
            created_by_role='account',
            created_by=self.user_id,
        )

        db.session.add(thought)
        db.session.commit()

        self.agent_thought_count += 1

        return thought

    def save_agent_thought(self, agent_thought: MessageAgentThought, thought: str, observation: str, answer: str) -> MessageAgentThought:
        """
        Save agent thought
        """
        if thought is not None:
            agent_thought.thought = thought

        if observation is not None:
            agent_thought.observation = observation

        if answer is not None:
            agent_thought.answer = answer

        db.session.commit()

    def get_history_prompt_messages(self) -> List[PromptMessage]:
        """
        Get history prompt messages
        """
        if self.history_prompt_messages is None:
            self.history_prompt_messages = db.session.query(PromptMessage).filter(
                PromptMessage.message_id == self.message.id,
            ).order_by(PromptMessage.position.asc()).all()

        return self.history_prompt_messages
    
    def transform_tool_invoke_messages(self, messages: List[ToolInvokeMessage]) -> List[ToolInvokeMessage]:
        """
        Transform tool message into agent thought
        """
        result = []

        for message in messages:
            if message.type == ToolInvokeMessage.MessageType.TEXT:
                result.append(message)
            elif message.type == ToolInvokeMessage.MessageType.LINK:
                result.append(message)
            elif message.type == ToolInvokeMessage.MessageType.IMAGE:
                # try to download image
                try:
                    file = ToolFileManager.create_file_by_url(user_id=self.user_id, tenant_id=self.tenant_id,
                                                               conversation_id=self.message.conversation_id,
                                                               file_url=message.message)
                    url = f'/files/tools/{file.id}'

                    result.append(ToolInvokeMessage(
                        type=ToolInvokeMessage.MessageType.IMAGE_LINK,
                        message=url,
                    ))
                except Exception as e:
                    logger.exception(e)
                    result.append(ToolInvokeMessage(
                        type=ToolInvokeMessage.MessageType.TEXT,
                        message=f"Failed to download image: {message.message}, you can try to download it yourself.",
                        meta=message.meta.copy() if message.meta is not None else {},
                    ))
            elif message.type == ToolInvokeMessage.MessageType.BLOB:
                # get mime type and save blob to storage
                mimetype = message.meta.get('mime_type', 'octet/stream')
                file = ToolFileManager.create_file_by_raw(user_id=self.user_id, tenant_id=self.tenant_id,
                                                            conversation_id=self.message.conversation_id,
                                                            file_binary=message.message,
                                                            mimetype=mimetype)
                url = f'/files/tools/{file.id}'

                result.append(ToolInvokeMessage(
                    type=ToolInvokeMessage.MessageType.LINK,
                    message=url,
                    meta=message.meta.copy() if message.meta is not None else {},
                ))
            else:
                result.append(message)

        return result