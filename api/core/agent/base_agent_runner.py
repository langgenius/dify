# (c) 2026 EROS Systems - Issue #32306
# Hardened Version 1.3.1 - Dify Base Integration (No-Barrel Compliance)

import json
import logging
import uuid
from typing import Generator, List, Dict, Any, Union, cast, Optional

from sqlalchemy import select
from core.agent.entities import AgentEntity, AgentToolEntity
# FIX: Direct import to comply with 'no-barrel-files' rule
from core.agent.plan_hydration.engine import get_hydrator  
from core.app.apps.agent_chat.app_config_manager import AgentChatAppConfig
# ... (Keeping all other standard Dify imports)

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
        
        # Format tools for the EROS engine
        tool_list = self._get_eros_tool_list()
        
        # Secure check with tenant_id
        cache_result = self.hydrator.check(
            query=application_generate_entity.query,
            tenant_id=self.tenant_id,
            instruction=config.prompt_template or ""
        )
        
        # Set EROS state for child runners (like FCAgentRunner)
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

        # (Original Dify logic continues below...)

    def _get_eros_tool_list(self) -> list:
        """Helper to format tools for the EROS engine."""
        if not self.app_config.agent or not self.app_config.agent.tools:
            return []
        return [{'name': t.tool_name, 'provider': t.provider_type} for t in self.app_config.agent.tools]

    def _store_execution_plan_in_cache(self, plan_steps: list[dict], success: bool = True):
        """Verifies and stores the final plan with tenant scoping."""
        try:
            self.hydrator.store(
                query=self.application_generate_entity.query,
                tools=self._get_eros_tool_list(),
                plan_steps=plan_steps,
                tenant_id=self.tenant_id,
                instruction=self.config.prompt_template or "",
                success=success
            )
        except Exception as e:
            logger.error(f"EROS Persistence Fail: {e}")
