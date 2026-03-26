# (c) 2026 EROS Systems - Issue #32306
# Hardened Version 1.3.1 - Dify Base Integration (No-Barrel Compliance)

import json
import logging
import uuid
from decimal import Decimal
from typing import Generator, List, Dict, Any, Union, cast, Optional

from sqlalchemy import select
from core.agent.entities import AgentEntity, AgentToolEntity
# EROS FIX: Direct import to comply with 'no-barrel-files' rule
from core.agent.plan_hydration.engine import get_hydrator  
from core.app.apps.agent_chat.app_config_manager import AgentChatAppConfig
from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.apps.base_app_runner import AppRunner
from core.app.entities.app_invoke_entities import (
    AgentChatAppGenerateEntity,
    ModelConfigWithCredentialsEntity,
)
from core.app.file_access import DatabaseFileAccessController
from core.callback_handler.agent_tool_callback_handler import DifyAgentCallbackHandler
from core.callback_handler.index_tool_callback_handler import DatasetIndexToolCallbackHandler
from core.memory.token_buffer_memory import TokenBufferMemory
from core.model_manager import ModelInstance
from core.prompt.utils.extract_thread_messages import extract_thread_messages
from core.tools.__base.tool import Tool
from core.tools.entities.tool_entities import (
    ToolParameter,
)
from core.tools.tool_manager import ToolManager
from core.tools.utils.dataset_retriever_tool import DatasetRetrieverTool
from extensions.ext_database import db
from factories import file_factory
from graphon.file import file_manager
from graphon.model_runtime.entities import (
    AssistantPromptMessage,
    LLMUsage,
    PromptMessage,
    PromptMessageTool,
    SystemPromptMessage,
    TextPromptMessageContent,
    ToolPromptMessage,
    UserPromptMessage,
)
from graphon.model_runtime.entities.message_entities import ImagePromptMessageContent, PromptMessageContentUnionTypes
from graphon.model_runtime.entities.model_entities import ModelFeature
from graphon.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from models.enums import CreatorUserRole
from models.model import Conversation, Message, MessageAgentThought, MessageFile

logger = logging.getLogger(__name__)
_file_access_controller = DatabaseFileAccessController()

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
        # 1. Initialize Core Attributes
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

        # 2. Init Callbacks & Dataset Tools
        self.agent_callback = DifyAgentCallbackHandler()
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
            return_resource=(
                app_config.additional_features.show_retrieve_source if app_config.additional_features else False
            ),
            invoke_from=application_generate_entity.invoke_from,
            hit_callback=hit_callback,
            user_id=user_id,
            inputs=cast(dict, application_generate_entity.inputs),
        )

        # 3. Handle Model Features (Vision/Streaming)
        llm_model = cast(LargeLanguageModel, model_instance.model_type_instance)
        model_schema = llm_model.get_model_schema(model_instance.model_name, model_instance.credentials)
        features = model_schema.features if model_schema and model_schema.features else []
        self.stream_tool_call = ModelFeature.STREAM_TOOL_CALL in features
        self.files = application_generate_entity.files if ModelFeature.VISION in features else []
        
        # 4. Query & Memory Initialization
        self.query = application_generate_entity.query
        self._current_thoughts: list[PromptMessage] = []

        # --- START EROS INITIALIZATION ---
        # This checks the persistent cache for an existing strategy before we run
        self.hydrator = get_hydrator()
        cache_result = self.hydrator.hydrate(
            query=self.query or "",
            tools=self._get_eros_tool_list(),
            tenant_id=self.tenant_id,
            instruction=self.config.prompt_template or ""
        )

        self.use_cached_plan = (cache_result.status == 'EXACT_HIT')
        self.is_partial_match = (cache_result.status == 'PARTIAL_HIT')
        self.plan_fingerprint = cache_result.fingerprint

        if self.use_cached_plan:
            logger.info(f"EROS [L1]: Exact hit for tenant {self.tenant_id}. Fingerprint: {self.plan_fingerprint}")
            self.cached_plan_steps = cache_result.plan_steps
        elif self.is_partial_match:
            logger.info(f"EROS [L2]: Partial match hit ({cache_result.match_ratio:.0%}).")
            self.partial_reusable_steps = cache_result.plan_steps
        # --- END EROS INITIALIZATION ---

        # 5. finalize thoughts count
        self.agent_thought_count = (
            db.session.query(MessageAgentThought)
            .where(MessageAgentThought.message_id == self.message.id)
            .count()
        )
        db.session.close()

    def _get_eros_tool_list(self) -> list:
        """Helper to format tools for the EROS engine."""
        if not self.app_config.agent or not self.app_config.agent.tools:
            return []
        return [{'name': t.tool_name, 'provider': t.provider_type} for t in self.app_config.agent.tools]

    # ... (Rest of the standard Dify methods)