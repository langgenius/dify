# (c) 2026 EROS Systems - Issue #32306
# Hardened Version 1.3.1 - Dify Production Grade (No-Barrel Compliance)

import json
import logging
import uuid
from typing import Generator, List, Dict, Any, Union, cast

from graphon.file import file_manager
from graphon.model_runtime.entities import (
    AssistantPromptMessage,
    LLMResult,
    LLMResultChunk,
    PromptMessage,
    SystemPromptMessage,
    ToolPromptMessage,
    LLMUsage
)
from graphon.model_runtime.entities.message_entities import ImagePromptMessageContent, PromptMessageContentUnionTypes

from core.agent.base_agent_runner import BaseAgentRunner
from core.agent.errors import AgentMaxIterationError
from core.app.apps.base_app_queue_manager import PublishFrom
from core.app.entities.queue_entities import QueueAgentThoughtEvent, QueueMessageEndEvent, QueueMessageFileEvent
from core.prompt.agent_history_prompt_transform import AgentHistoryPromptTransform
from core.tools.entities.tool_entities import ToolInvokeMeta
from core.tools.tool_engine import ToolEngine
from models.model import Message

logger = logging.getLogger(__name__)

class FCAgentRunner(BaseAgentRunner):
    def run(self, application_generate_entity, queue_manager) -> Generator[LLMResultChunk, None, None]:
        """
        Function Calling Agent Runner with secure EROS 3-Layer Integration.
        """
        # 1. Initialize tools (Dify Standard)
        self.tool_instances, prompt_messages_tools = self._init_prompt_tools()

        # --- LAYER 1: EXACT MATCH (EROS) ---
        if hasattr(self, 'use_cached_plan') and self.use_cached_plan:
            logger.info(f"EROS [L1]: Short-circuiting for fingerprint {self.plan_fingerprint}")
            yield from self._execute_eros_cached_path(self.tool_instances)
            return

        # 2. Prepare prompt history
        prompt_messages = self.history_prompt_messages
        
        # --- LAYER 2: HYBRID WELDING (EROS) ---
        if hasattr(self, 'is_partial_match') and self.is_partial_match:
            self._apply_hybrid_welding(prompt_messages)
        
        # 3. Iterative Reasoning Loop
        iteration_steps = [] 
        total_usage = LLMUsage(prompt_tokens=0, completion_tokens=0, total_tokens=0)
        final_answer = ""
        
        while self.agent_thought_count < self.config.max_iteration:
            llm_result = self.model_instance.validate_and_call_llm(
                prompt_messages=prompt_messages,
                tools=prompt_messages_tools,
                stop=application_generate_entity.model_conf.stop,
                stream=self.stream_tool_call,
                callbacks=[],
            )

            if isinstance(llm_result, Generator):
                full_result = self._handle_llm_stream(llm_result)
            else:
                full_result = llm_result

            if full_result.usage:
                total_usage.prompt_tokens += full_result.usage.prompt_tokens
                total_usage.completion_tokens += full_result.usage.completion_tokens
                total_usage.total_tokens += full_result.usage.total_tokens

            # 4. Process Tool Calls
            if full_result.message.tool_calls:
                prompt_messages.append(full_result.message)
                
                for tool_call in full_result.message.tool_calls:
                    tool_name = tool_call.function.name
                    try:
                        tool_input = json.loads(tool_call.function.arguments)
                    except (json.JSONDecodeError, TypeError):
                        tool_input = {}

                    # --- LAYER 3 TRACKING: Record steps for the final EROS cache storage ---
                    iteration_steps.append({
                        "tool_name": tool_name,
                        "inputs": tool_input,
                        "thought": full_result.message.content or ""
                    })

                    # Standard Dify Database Tracking
                    agent_thought_id = self.create_agent_thought(
                        message_id=self.message.id, 
                        message="", 
                        tool_name=tool_name, 
                        tool_input=json.dumps(tool_input, ensure_ascii=False), 
                        messages_ids=[]
                    )

                    # Invoke Tool
                    observation, files, meta = ToolEngine.agent_invoke(
                        tool=self.tool_instances.get(tool_name),
                        tool_parameters=tool_input,
                        user_id=self.user_id,
                        tenant_id=self.tenant_id,
                        message=self.message,
                        invoke_from=self.application_generate_entity.invoke_from,
                        agent_tool_callback=self.agent_callback,
                        app_id=self.app_config.app_id,
                        message_id=self.message.id,
                        conversation_id=self.conversation.id
                    )

                    # Save result of thought
                    self.save_agent_thought(
                        agent_thought_id=agent_thought_id,
                        tool_name=tool_name,
                        tool_input=tool_input,
                        thought=full_result.message.content,
                        observation=observation,
                        tool_invoke_meta=meta.to_dict(),
                        answer="",
                        messages_ids=files,
                        llm_usage=full_result.usage
                    )

                    # Re-feed observation
                    prompt_messages.append(ToolPromptMessage(
                        content=str(observation),
                        tool_call_id=tool_call.id,
                        name=tool_name
                    ))
                
                continue 

            else:
                # FINAL ANSWER REACHED
                final_answer = str(full_result.message.content)
                yield LLMResultChunk(delta=full_result)
                break

        # --- EROS LAYER 3 STORAGE ---
        if iteration_steps:
            self._store_execution_plan_in_cache(iteration_steps, success=True)

        # publish end event (Dify Standard)
        self.queue_manager.publish(
            QueueMessageEndEvent(
                llm_result=LLMResult(
                    model=self.model_instance.model_name,
                    prompt_messages=prompt_messages,
                    message=AssistantPromptMessage(content=final_answer),
                    usage=total_usage,
                    system_fingerprint="",
                )
            ),
            PublishFrom.APPLICATION_MANAGER,
        )

    def _apply_hybrid_welding(self, prompt_messages: List[PromptMessage]):
        """Injects Layer 2 knowledge with tool-existence verification."""
        from core.agent.plan_hydration.engine import get_hydrator
        
        is_valid, _ = get_hydrator().verify_plan(self.partial_reusable_steps, list(self.tool_instances.values()))
        if not is_valid:
            return

        reusable_names = [s.get('tool_name') or s.get('tool') for s in self.partial_reusable_steps]
        hybrid_hint = (
            f"\n\n[EROS HYBRID]: High-confidence sequence match detected. "
            f"Optimized path: ({' -> '.join(reusable_names)}). "
            "Execute these steps if they align with the current goal."
        )

        for message in prompt_messages:
            if isinstance(message, SystemPromptMessage):
                message.content += hybrid_hint
                return
        prompt_messages.insert(0, SystemPromptMessage(content=hybrid_hint))

    def _store_execution_plan_in_cache(self, iteration_steps: List[Dict], success: bool):
        """Secure storage wrapper for EROS."""
        try:
            from core.agent.plan_hydration.engine import get_hydrator
            get_hydrator().store(
                query=self.application_generate_entity.query,
                tools=list(self.tool_instances.values()),
                plan_steps=iteration_steps,
                tenant_id=self.tenant_id,
                instruction=self.app_config.agent.prompt_template,
                success=success
            )
        except Exception as e:
            logger.error(f"EROS Storage Failure: {e}")