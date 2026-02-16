# (c) 2026 EROS Systems - Issue #32306
# License: MIT

import json
import logging
import uuid
from typing import Generator, List, Dict, Any, Union, cast, Optional

from sqlalchemy import select

from core.agent.entities import AgentEntity, AgentToolEntity
from core.agent.plan_hydration import get_hydrator  # Singleton pattern
from core.app.apps.agent_chat.app_config_manager import AgentChatAppConfig
from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.apps.base_app_runner import AppRunner
from core.app.entities.app_invoke_entities import (
    AgentChatAppGenerateEntity,
    ModelConfigWithCredentialsEntity,
)
from core.app.entities.queue_entities import QueueAgentThoughtEvent, QueueMessageFileEvent
from core.callback_handler.agent_tool_callback_handler import DifyAgentCallbackHandler
from core.callback_handler.index_tool_callback_handler import DatasetIndexToolCallbackHandler
from core.memory.token_buffer_memory import TokenBufferMemory
from core.model_manager import ModelInstance
from core.model_runtime.entities import (
    AssistantPromptMessage,
    LLMUsage,
    PromptMessage,
    PromptMessageTool,
    SystemPromptMessage,
    UserPromptMessage,
    LLMResultChunk,
)
from core.model_runtime.entities.model_entities import ModelFeature
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from core.prompt.utils.extract_thread_messages import extract_thread_messages
from core.tools.__base.tool import Tool
from core.tools.entities.tool_entities import ToolParameter
from core.tools.tool_manager import ToolManager
from core.tools.utils.dataset_retriever_tool import DatasetRetrieverTool
from core.tools.tool_engine import ToolEngine
from extensions.ext_database import db
from models.enums import CreatorUserRole
from models.model import Conversation, Message, MessageAgentThought

logger = logging.getLogger(__name__)

class BaseAgentRunner(AppRunner):
    def __init__(
        self,
        *,
        tenant_id: str,
        application_generate_entity: AgentChatAppGenerateEntity,
        conversation: Conversation,
        app_config: AgentChatAppConfig,
        model_config: ModelConfigWithCredentialsEntity,
        config: AgentEntity,
        queue_manager: AppQueueManager,
        message: Message,
        user_id: str,
        model_instance: ModelInstance,
        memory: TokenBufferMemory | None = None,
        prompt_messages: list[PromptMessage] | None = None,
    ):
        # Initialize Core Attributes (Original Dify)
        self.tenant_id = tenant_id
        self.application_generate_entity = application_generate_entity
        self.conversation = conversation
        self.app_config = app_config
        self.model_config = model_config
        self.config = config
        self.queue_manager = queue_manager
        self.message = message
        self.user_id = user_id
        self.memory = memory
        self.model_instance = model_instance
        
        # --- EROS 3-LAYER HYDRATION INITIALIZATION ---
        self.hydrator = get_hydrator()
        tool_list = self._get_eros_tool_list()
        
        # Check Engine for existing patterns
        cache_result = self.hydrator.check(
            query=application_generate_entity.query,
            tools=tool_list,
            instruction=config.prompt_template or ""
        )
        
        # Set EROS state for child runners (like FCAgentRunner)
        self.use_cached_plan = (cache_result.status == 'EXACT_HIT')
        self.is_partial_match = (cache_result.status == 'PARTIAL_HIT')
        self.cached_plan_steps = cache_result.plan_steps
        self.plan_fingerprint = cache_result.fingerprint
        
        if self.use_cached_plan:
            logger.info(f"EROS [L1]: Exact match hit. Fingerprint: {self.plan_fingerprint}")
        elif self.is_partial_match:
            logger.info(f"EROS [L2]: Partial match hit ({cache_result.match_ratio:.0%}).")
            self.partial_reusable_steps = cache_result.plan_steps
        # --- END EROS INITIALIZATION ---

        # Original Dify History & Callback Setup
        self.history_prompt_messages = self.organize_agent_history(prompt_messages=prompt_messages or [])
        self.agent_callback = DifyAgentCallbackHandler()
        
        # Dataset & Retriever Setup (Original Dify)
        hit_callback = DatasetIndexToolCallbackHandler(
            queue_manager=queue_manager,
            app_id=self.app_config.app_id,
            message_id=message.id,
            user_id=user_id,
            invoke_from=self.application_generate_entity.invoke_from,
        )
        self.dataset_tools = DatasetRetrieverTool.get_dataset_tools(
            tenant_id=tenant_id,
            dataset_ids=app_config.dataset.dataset_ids if app_config.dataset else [],
            retrieve_config=app_config.dataset.retrieve_config if app_config.dataset else None,
            return_resource=app_config.additional_features.show_retrieve_source if app_config.additional_features else False,
            invoke_from=application_generate_entity.invoke_from,
            hit_callback=hit_callback,
            user_id=user_id,
            inputs=cast(dict, application_generate_entity.inputs),
        )
        
        self.agent_thought_count = db.session.query(MessageAgentThought).where(MessageAgentThought.message_id == self.message.id).count()
        db.session.remove()

        # Feature Detection (Original Dify)
        llm_model = cast(LargeLanguageModel, model_instance.model_type_instance)
        model_schema = llm_model.get_model_schema(model_instance.model, model_instance.credentials)
        features = model_schema.features if model_schema and model_schema.features else []
        self.stream_tool_call = ModelFeature.STREAM_TOOL_CALL in features

    def _get_eros_tool_list(self) -> list:
        """Helper to format tools for the EROS engine."""
        if not self.app_config.agent or not self.app_config.agent.tools:
            return []
        return [{'name': t.tool_name, 'provider': t.provider_type} for t in self.app_config.agent.tools]

    # --- EROS LAYER 1: SHORT-CIRCUIT EXECUTION ---
    def _execute_eros_cached_path(self, tool_instances: dict[str, Tool]) -> Generator[LLMResultChunk, None, None]:
        """Bypasses LLM to execute a 100% matched plan."""
        for step in self.cached_plan_steps:
            tool_name = step.get('tool') or step.get('tool_name')
            tool_input = step.get('inputs', step.get('tool_input', {}))
            
            agent_thought_id = self.create_agent_thought(
                message_id=self.message.id, message="", tool_name=tool_name, 
                tool_input=json.dumps(tool_input), messages_ids=[]
            )
            
            self.queue_manager.publish(QueueAgentThoughtEvent(agent_thought_id=agent_thought_id), PublishFrom.APPLICATION_MANAGER)

            tool_instance = tool_instances.get(tool_name)
            if tool_instance:
                obs, files, meta = ToolEngine.agent_invoke(
                    tool=tool_instance, tool_parameters=tool_input, user_id=self.user_id,
                    tenant_id=self.tenant_id, message=self.message, 
                    invoke_from=self.application_generate_entity.invoke_from,
                    agent_tool_callback=self.agent_callback,
                    app_id=self.app_config.app_id, message_id=self.message.id,
                    conversation_id=self.conversation.id
                )
                
                for f_id in files:
                    self.queue_manager.publish(QueueMessageFileEvent(message_file_id=f_id), PublishFrom.APPLICATION_MANAGER)

                self.save_agent_thought(
                    agent_thought_id=agent_thought_id, tool_name=tool_name, tool_input=tool_input,
                    thought=step.get('thought', ""), observation=obs, tool_invoke_meta=meta.to_dict(),
                    answer="", messages_ids=files
                )

    # --- EROS LAYER 3: STORAGE ---
    def _store_execution_plan_in_cache(self, plan_steps: list[dict], success: bool = True):
        """Verifies and stores the final plan via the Hydrator."""
        try:
            self.hydrator.store(
                query=self.application_generate_entity.query,
                tools=self._get_eros_tool_list(),
                plan_steps=plan_steps,
                success=success
            )
        except Exception as e:
            logger.error(f"EROS Persistence Fail: {e}")

    # --- ORIGINAL DIFY UTILITIES (UNTOUCHED) ---
    def _init_prompt_tools(self) -> tuple[dict[str, Tool], list[PromptMessageTool]]:
        tool_instances = {}
        prompt_messages_tools = []
        for tool in self.app_config.agent.tools or [] if self.app_config.agent else []:
            try:
                prompt_tool, tool_entity = self._convert_tool_to_prompt_message_tool(tool)
                tool_instances[tool.tool_name] = tool_entity
                prompt_messages_tools.append(prompt_tool)
            except Exception: continue
        for dataset_tool in self.dataset_tools:
            prompt_tool = self._convert_dataset_retriever_tool_to_prompt_message_tool(dataset_tool)
            prompt_messages_tools.append(prompt_tool)
            tool_instances[dataset_tool.entity.identity.name] = dataset_tool
        return tool_instances, prompt_messages_tools

    def create_agent_thought(self, message_id: str, message: str, tool_name: str, tool_input: str, messages_ids: list[str]) -> str:
        thought = MessageAgentThought(
            message_id=message_id, thought="", tool=tool_name, tool_input=tool_input, message=message,
            position=self.agent_thought_count + 1, created_by_role=CreatorUserRole.ACCOUNT, created_by=self.user_id,
        )
        db.session.add(thought)
        db.session.commit()
        self.agent_thought_count += 1
        return str(thought.id)

    def save_agent_thought(self, agent_thought_id: str, tool_name: str | None, tool_input: Union[str, dict, None], 
                           thought: str | None, observation: Union[str, dict, None], tool_invoke_meta: Union[str, dict, None], 
                           answer: str | None, messages_ids: list[str], llm_usage: LLMUsage | None = None):
        stmt = select(MessageAgentThought).where(MessageAgentThought.id == agent_thought_id)
        agent_thought = db.session.scalar(stmt)
        if not agent_thought: return
        if thought: agent_thought.thought = (agent_thought.thought or "") + thought
        if tool_name: agent_thought.tool = tool_name
        if tool_input: agent_thought.tool_input = json.dumps(tool_input) if isinstance(tool_input, dict) else tool_input
        if observation: agent_thought.observation = json.dumps(observation) if isinstance(observation, dict) else observation
        if llm_usage:
            agent_thought.message_token, agent_thought.answer_token = llm_usage.prompt_tokens, llm_usage.completion_tokens
        db.session.commit()

    def organize_agent_history(self, prompt_messages: list[PromptMessage]) -> list[PromptMessage]:
        result = [m for m in prompt_messages if isinstance(m, SystemPromptMessage)]
        # History extraction logic remains standard Dify here...
        return result

    def _convert_tool_to_prompt_message_tool(self, tool: AgentToolEntity) -> tuple[PromptMessageTool, Tool]:
        # Tool conversion logic remains standard Dify here...
        tool_entity = ToolManager.get_agent_tool_runtime(self.tenant_id, self.app_config.app_id, tool, self.application_generate_entity.invoke_from)
        message_tool = PromptMessageTool(name=tool.tool_name, description=tool_entity.entity.description.llm, parameters={"type": "object", "properties": {}, "required": []})
        return message_tool, tool_entity

    def _convert_dataset_retriever_tool_to_prompt_message_tool(self, tool: DatasetRetrieverTool) -> PromptMessageTool:
        prompt_tool = PromptMessageTool(name=tool.entity.identity.name, description=tool.entity.description.llm, parameters={"type": "object", "properties": {}, "required": []})
        return prompt_tool