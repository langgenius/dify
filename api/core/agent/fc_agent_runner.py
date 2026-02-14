# (c) 2026 EROS Systems - Issue #32306
# License: MIT

import json
import logging
import uuid
from typing import Generator, List, Dict, Any, Union, cast

from core.agent.base_agent_runner import BaseAgentRunner
from core.app.apps.base_app_queue_manager import PublishFrom
from core.app.entities.queue_entities import QueueAgentThoughtEvent, QueueMessageFileEvent
from core.model_runtime.entities import (
    LLMResult,
    LLMResultChunk,
    PromptMessage,
    AssistantPromptMessage,
    SystemPromptMessage,
    ToolPromptMessage,
    LLMUsage
)
from core.tools.tool_engine import ToolEngine
from extensions.ext_database import db
from models.model import MessageAgentThought

logger = logging.getLogger(__name__)

class FCAgentRunner(BaseAgentRunner):
    def run(self, application_generate_entity, queue_manager) -> Generator[LLMResultChunk, None, None]:
        """
        Full-scale Function Calling Agent Runner with 3-Layer EROS Integration.
        Maintains all original Dify utility logic while adding Short-circuit and Hybrid capabilities.
        """
        # 1. Initialize tool instances and prompt-ready tool schemas (Dify Original)
        tool_instances, prompt_messages_tools = self._init_prompt_tools()

        # --- LAYER 1: 100% EXACT MATCH SHORT-CIRCUIT (EROS) ---
        if self.use_cached_plan:
            logger.info(f"EROS [L1]: Executing cached path for fingerprint {self.plan_fingerprint}")
            yield from self._execute_eros_cached_path(tool_instances)
            return

        # 2. Prepare the message history (Dify Original)
        prompt_messages = self.history_prompt_messages
        
        # --- LAYER 2: HYBRID PROMPT INJECTION (>50% Match) (EROS) ---
        if self.is_partial_match and hasattr(self, 'partial_reusable_steps'):
            self._apply_hybrid_welding(prompt_messages)
        
        # 3. Iterative Reasoning Loop
        iteration_steps = [] 
        total_usage = LLMUsage(prompt_tokens=0, completion_tokens=0, total_tokens=0)
        
        while self.agent_thought_count < self.config.max_iteration:
            # Call the LLM (Guided by EROS Hybrid context if match > 50%)
            llm_result = self.model_instance.validate_and_call_llm(
                prompt_messages=prompt_messages,
                tools=prompt_messages_tools,
                stream=self.stream_tool_call
            )

            # 4. Handle LLM Results (Streaming vs Blocking)
            if isinstance(llm_result, Generator):
                full_result = self._handle_llm_stream(llm_result)
            else:
                full_result = llm_result

            # Aggregate usage (Original Dify metric tracking)
            if full_result.usage:
                total_usage.prompt_tokens += full_result.usage.prompt_tokens
                total_usage.completion_tokens += full_result.usage.completion_tokens
                total_usage.total_tokens += full_result.usage.total_tokens

            # 5. Process Tool Calls
            if full_result.message.tool_calls:
                prompt_messages.append(full_result.message)
                
                for tool_call in full_result.message.tool_calls:
                    tool_name = tool_call.function.name
                    try:
                        tool_input = json.loads(tool_call.function.arguments)
                    except json.JSONDecodeError:
                        tool_input = {}
                    
                    # LAYER 3 TRACKING: Record for verification
                    iteration_steps.append({
                        "tool": tool_name,
                        "inputs": tool_input,
                        "thought": full_result.message.content or ""
                    })

                    # Original Dify Database Tracking
                    agent_thought_id = self.create_agent_thought(
                        message_id=self.message.id, 
                        message="", 
                        tool_name=tool_name, 
                        tool_input=json.dumps(tool_input), 
                        messages_ids=[]
                    )

                    # Trigger tool invocation (Original Tool Engine)
                    observation, files, meta = ToolEngine.agent_invoke(
                        tool=tool_instances.get(tool_name),
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

                    # Maintain Original File Publishing Logic
                    for file_id in files:
                        self.queue_manager.publish(
                            QueueMessageFileEvent(message_file_id=file_id), 
                            PublishFrom.APPLICATION_MANAGER
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

                    # Re-feed observation for next iteration
                    prompt_messages.append(ToolPromptMessage(
                        content=str(observation),
                        tool_call_id=tool_call.id,
                        name=tool_name
                    ))
                
                continue # Let the LLM reason on the tool results

            else:
                # 6. FINAL ANSWER REACHED
                # --- LAYER 3: VERIFICATION & STORAGE ---
                if iteration_steps:
                    # The store() method inside engine handles the >50% and Safety checks
                    self._store_execution_plan_in_cache(iteration_steps, success=True)
                
                yield LLMResultChunk(delta=full_result)
                break

    def _apply_hybrid_welding(self, prompt_messages: List[PromptMessage]):
        """Injects Layer 2 knowledge (Partial Pattern) into the prompt context."""
        reusable_names = [s.get('tool') or s.get('tool_name', 'unknown') for s in self.partial_reusable_steps]
        
        hybrid_hint = (
            "\n\n[EROS HYBRID SYSTEM]: A pattern match (>50%) was detected. "
            "Optimized tool sequence for this intent: "
            f"({' -> '.join(reusable_names)}). "
            "Integrate these steps to resolve the query efficiently."
        )

        for message in prompt_messages:
            if isinstance(message, SystemPromptMessage):
                message.content += hybrid_hint
                return
        
        prompt_messages.insert(0, SystemPromptMessage(content=hybrid_hint))

    def _handle_llm_stream(self, stream: Generator) -> LLMResult:
        """Aggregates streaming chunks while preserving usage and tool call data."""
        full_content = ""
        tool_calls = []
        usage = None

        for chunk in stream:
            if chunk.delta.message.content:
                full_content += chunk.delta.message.content
            if chunk.delta.message.tool_calls:
                tool_calls.extend(chunk.delta.message.tool_calls)
            if chunk.delta.usage:
                usage = chunk.delta.usage
            yield chunk

        return LLMResult(
            message=AssistantPromptMessage(content=full_content, tool_calls=tool_calls),
            usage=usage
        )