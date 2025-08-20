import logging
import threading
import time
from collections.abc import Sequence
from typing import Optional, cast

from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from core.memory.entities import (
    MemoryBlock,
    MemoryBlockSpec,
    MemoryScheduleMode,
    MemoryScope,
    MemoryStrategy,
    MemoryTerm,
)
from core.memory.errors import MemorySyncTimeoutError
from core.model_runtime.entities.message_entities import AssistantPromptMessage, UserPromptMessage
from core.workflow.entities.variable_pool import VariablePool
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.chatflow_memory import ChatflowMemoryVariable
from services.chatflow_history_service import ChatflowHistoryService

logger = logging.getLogger(__name__)

# Important note: Since Dify uses gevent, we don't need an extra task queue (e.g., Celery).
# Threads created via threading.Thread are automatically patched into greenlets in a gevent environment,
# enabling efficient asynchronous execution.

def _get_memory_sync_lock_key(app_id: str, conversation_id: str) -> str:
    """Generate Redis lock key for memory sync updates

    Args:
        app_id: Application ID
        conversation_id: Conversation ID

    Returns:
        Formatted lock key
    """
    return f"memory_sync_update:{app_id}:{conversation_id}"

class ChatflowMemoryService:
    """
    Memory service class with only static methods.
    All methods are static and do not require instantiation.
    """

    @staticmethod
    def get_memory(memory_id: str, tenant_id: str,
                   app_id: Optional[str] = None,
                   conversation_id: Optional[str] = None,
                   node_id: Optional[str] = None) -> Optional[MemoryBlock]:
        """Get single memory by ID"""
        stmt = select(ChatflowMemoryVariable).where(
            and_(
                ChatflowMemoryVariable.memory_id == memory_id,
                ChatflowMemoryVariable.tenant_id == tenant_id
            )
        )

        if app_id:
            stmt = stmt.where(ChatflowMemoryVariable.app_id == app_id)
        if conversation_id:
            stmt = stmt.where(ChatflowMemoryVariable.conversation_id == conversation_id)
        if node_id:
            stmt = stmt.where(ChatflowMemoryVariable.node_id == node_id)

        with db.session() as session:
            result = session.execute(stmt).first()
            if result:
                return MemoryBlock.model_validate(result[0].__dict__)
        return None

    @staticmethod
    def save_memory(memory: MemoryBlock, tenant_id: str, is_draft: bool = False) -> None:
        """Save or update memory with draft mode support"""
        stmt = select(ChatflowMemoryVariable).where(
            and_(
                ChatflowMemoryVariable.memory_id == memory.memory_id,
                ChatflowMemoryVariable.tenant_id == tenant_id
            )
        )

        with db.session() as session:
            existing = session.execute(stmt).first()
            if existing:
                # Update existing
                for key, value in memory.model_dump(exclude_unset=True).items():
                    if hasattr(existing[0], key):
                        setattr(existing[0], key, value)
            else:
                # Create new
                new_memory = ChatflowMemoryVariable(
                    tenant_id=tenant_id,
                    **memory.model_dump(exclude={'id'})
                )
                session.add(new_memory)
            session.commit()

        # In draft mode, also write to workflow_draft_variables
        if is_draft:
            from models.workflow import WorkflowDraftVariable
            from services.workflow_draft_variable_service import WorkflowDraftVariableService
            with Session(bind=db.engine) as session:
                draft_var_service = WorkflowDraftVariableService(session)

                # Try to get existing variables
                existing_vars = draft_var_service.get_draft_variables_by_selectors(
                    app_id=memory.app_id,
                    selectors=[['memory_block', memory.memory_id]]
                )

                if existing_vars:
                    # Update existing draft variable
                    draft_var = existing_vars[0]
                    draft_var.value = memory.value
                else:
                    # Create new draft variable
                    draft_var = WorkflowDraftVariable.new_memory_block_variable(
                        app_id=memory.app_id,
                        memory_id=memory.memory_id,
                        name=memory.name,
                        value=memory.value,
                        description=f"Memory block: {memory.name}"
                    )
                    session.add(draft_var)

                session.commit()

    @staticmethod
    def get_memories_by_specs(memory_block_specs: Sequence[MemoryBlockSpec],
                              tenant_id: str, app_id: str,
                              conversation_id: Optional[str] = None,
                              node_id: Optional[str] = None,
                              is_draft: bool = False) -> list[MemoryBlock]:
        """Get runtime memory values based on MemoryBlockSpecs with draft mode support"""
        from models.enums import DraftVariableType

        if not memory_block_specs:
            return []

        # In draft mode, prefer reading from workflow_draft_variables
        if is_draft:
            # Try reading from the draft variables table
            from services.workflow_draft_variable_service import WorkflowDraftVariableService
            with Session(bind=db.engine) as session:
                draft_var_service = WorkflowDraftVariableService(session)

                # Build selector list
                selectors = [['memory_block', spec.id] for spec in memory_block_specs]

                # Fetch draft variables
                draft_vars = draft_var_service.get_draft_variables_by_selectors(
                    app_id=app_id,
                    selectors=selectors
                )

                # If draft variables exist, prefer using them
                if draft_vars:
                    spec_by_id = {spec.id: spec for spec in memory_block_specs}
                    draft_memories = []

                    for draft_var in draft_vars:
                        if draft_var.node_id == DraftVariableType.MEMORY_BLOCK:
                            spec = spec_by_id.get(draft_var.name)
                            if spec:
                                memory_block = MemoryBlock(
                                    id=draft_var.id,
                                    memory_id=draft_var.name,
                                    name=spec.name,
                                    value=draft_var.value,
                                    scope=spec.scope,
                                    term=spec.term,
                                    app_id=app_id,
                                    conversation_id='draft',
                                    node_id=node_id
                                )
                                draft_memories.append(memory_block)

                    if draft_memories:
                        return draft_memories

        memory_ids = [spec.id for spec in memory_block_specs]

        stmt = select(ChatflowMemoryVariable).where(
            and_(
                ChatflowMemoryVariable.memory_id.in_(memory_ids),
                ChatflowMemoryVariable.tenant_id == tenant_id,
                ChatflowMemoryVariable.app_id == app_id
            )
        )

        if conversation_id:
            stmt = stmt.where(ChatflowMemoryVariable.conversation_id == conversation_id)
        if node_id:
            stmt = stmt.where(ChatflowMemoryVariable.node_id == node_id)

        with db.session() as session:
            results = session.execute(stmt).all()
            found_memories = {row[0].memory_id: MemoryBlock.model_validate(row[0].__dict__) for row in results}

            # Create MemoryBlock objects for specs that don't have runtime values yet
            all_memories = []
            for spec in memory_block_specs:
                if spec.id in found_memories:
                    all_memories.append(found_memories[spec.id])
                else:
                    # Create default memory with template value following design rules
                    default_memory = MemoryBlock(
                        id="",  # Will be assigned when saved
                        memory_id=spec.id,
                        name=spec.name,
                        value=spec.template,
                        scope=spec.scope,
                        term=spec.term,
                        # Design rules:
                        # - app_id=None for global (future), app_id=str for app-specific
                        app_id=app_id,  # Always app-specific for now
                        # - conversation_id=None for persistent, conversation_id=str for session
                        conversation_id=conversation_id if spec.term == MemoryTerm.SESSION else None,
                        # - node_id=None for app-scope, node_id=str for node-scope
                        node_id=node_id if spec.scope == MemoryScope.NODE else None
                    )
                    all_memories.append(default_memory)

            return all_memories

    @staticmethod
    def get_app_memories_by_workflow(workflow, tenant_id: str,
                                     conversation_id: Optional[str] = None) -> list[MemoryBlock]:
        """Get app-scoped memories based on workflow configuration"""
        from core.memory.entities import MemoryScope

        app_memory_specs = [spec for spec in workflow.memory_blocks if spec.scope == MemoryScope.APP]
        return ChatflowMemoryService.get_memories_by_specs(
            memory_block_specs=app_memory_specs,
            tenant_id=tenant_id,
            app_id=workflow.app_id,
            conversation_id=conversation_id
        )

    @staticmethod
    def get_node_memories_by_workflow(workflow, node_id: str, tenant_id: str) -> list[MemoryBlock]:
        """Get node-scoped memories based on workflow configuration"""
        from core.memory.entities import MemoryScope

        node_memory_specs = [
            spec for spec in workflow.memory_blocks
            if spec.scope == MemoryScope.NODE and spec.id == node_id
        ]
        return ChatflowMemoryService.get_memories_by_specs(
            memory_block_specs=node_memory_specs,
            tenant_id=tenant_id,
            app_id=workflow.app_id,
            node_id=node_id
        )

    # Core Memory Orchestration features

    @staticmethod
    def update_memory_if_needed(tenant_id: str, app_id: str,
                                memory_block_spec: MemoryBlockSpec,
                                conversation_id: str,
                                variable_pool: VariablePool,
                                is_draft: bool = False) -> bool:
        """Update app-level memory if conditions are met

        Args:
            tenant_id: Tenant ID
            app_id: Application ID
            memory_block_spec: Memory block specification
            conversation_id: Conversation ID
            variable_pool: Variable pool for context
            is_draft: Whether in draft mode
        """
        if not ChatflowMemoryService._should_update_memory(
            tenant_id, app_id, memory_block_spec, conversation_id
        ):
            return False

        if memory_block_spec.schedule_mode == MemoryScheduleMode.SYNC:
            # Sync mode: will be processed in batch after the App run completes
            # This only marks the need; actual update happens in _update_app_memory_after_run
            return True
        else:
            # Async mode: submit asynchronous update immediately
            ChatflowMemoryService._submit_async_memory_update(
                tenant_id, app_id, memory_block_spec, conversation_id, variable_pool, is_draft
            )
        return True

    @staticmethod
    def update_node_memory_if_needed(tenant_id: str, app_id: str,
                                     memory_block_spec: MemoryBlockSpec,
                                     node_id: str, llm_output: str,
                                     variable_pool: VariablePool,
                                     is_draft: bool = False) -> bool:
        """Update node-level memory after LLM execution

        Args:
            tenant_id: Tenant ID
            app_id: Application ID
            memory_block_spec: Memory block specification
            node_id: Node ID
            llm_output: LLM output content
            variable_pool: Variable pool for context
            is_draft: Whether in draft mode
        """
        conversation_id_segment = variable_pool.get(('sys', 'conversation_id'))
        if not conversation_id_segment:
            return False
        conversation_id = conversation_id_segment.value

        # Save LLM output to node conversation history
        assistant_message = AssistantPromptMessage(content=llm_output)
        ChatflowHistoryService.save_node_message(
            prompt_message=assistant_message,
            node_id=node_id,
            conversation_id=str(conversation_id),
            app_id=app_id,
            tenant_id=tenant_id
        )

        if not ChatflowMemoryService._should_update_memory(
            tenant_id, app_id, memory_block_spec, str(conversation_id), node_id
        ):
            return False

        if memory_block_spec.schedule_mode == MemoryScheduleMode.SYNC:
            # Node-level sync: blocking execution
            ChatflowMemoryService._update_node_memory_sync(
                tenant_id, app_id, memory_block_spec, node_id,
                str(conversation_id), variable_pool, is_draft
            )
        else:
            # Node-level async: execute asynchronously
            ChatflowMemoryService._update_node_memory_async(
                tenant_id, app_id, memory_block_spec, node_id,
                llm_output, str(conversation_id), variable_pool, is_draft
            )
        return True

    @staticmethod
    def _should_update_memory(tenant_id: str, app_id: str,
                              memory_block_spec: MemoryBlockSpec,
                              conversation_id: str, node_id: Optional[str] = None) -> bool:
        """Check if memory should be updated based on strategy"""
        if memory_block_spec.strategy != MemoryStrategy.ON_TURNS:
            return False

        # Check turn count
        turn_key = f"memory_turn_count:{tenant_id}:{app_id}:{conversation_id}"
        if node_id:
            turn_key += f":{node_id}"

        current_turns = redis_client.get(turn_key)
        current_turns = int(current_turns) if current_turns else 0
        current_turns += 1

        # Update count
        redis_client.set(turn_key, current_turns)

        return current_turns % memory_block_spec.update_turns == 0

    # App-level async update method
    @staticmethod
    def _submit_async_memory_update(tenant_id: str, app_id: str,
                                    block: MemoryBlockSpec,
                                    conversation_id: str,
                                    variable_pool: VariablePool,
                                    is_draft: bool = False):
        """Submit async memory update task"""

        # Execute update asynchronously using thread
        thread = threading.Thread(
            target=ChatflowMemoryService._update_single_memory,
            kwargs={
                'tenant_id': tenant_id,
                'app_id': app_id,
                'memory_block_spec': block,
                'conversation_id': conversation_id,
                'variable_pool': variable_pool,
                'is_draft': is_draft
            },
            daemon=True
        )
        thread.start()

    # Node-level sync update method
    @staticmethod
    def _update_node_memory_sync(tenant_id: str, app_id: str,
                                 memory_block_spec: MemoryBlockSpec,
                                 node_id: str, conversation_id: str,
                                 variable_pool: VariablePool,
                                 is_draft: bool = False):
        """Synchronously update node memory (blocking execution)"""
        ChatflowMemoryService._perform_memory_update(
            tenant_id=tenant_id,
            app_id=app_id,
            memory_block_spec=memory_block_spec,
            conversation_id=conversation_id,
            variable_pool=variable_pool,
            node_id=node_id,
            is_draft=is_draft
        )
        # Wait for update to complete before returning

    # Node-level async update method
    @staticmethod
    def _update_node_memory_async(tenant_id: str, app_id: str,
                                  memory_block_spec: MemoryBlockSpec,
                                  node_id: str, llm_output: str,
                                  conversation_id: str,
                                  variable_pool: VariablePool,
                                  is_draft: bool = False):
        """Asynchronously update node memory (submit task)"""

        # Execute update asynchronously using thread
        thread = threading.Thread(
            target=ChatflowMemoryService._perform_node_memory_update,
            kwargs={
                'memory_block_spec': memory_block_spec,
                'tenant_id': tenant_id,
                'app_id': app_id,
                'node_id': node_id,
                'llm_output': llm_output,
                'variable_pool': variable_pool,
                'is_draft': is_draft
            },
            daemon=True
        )
        thread.start()
        # Return immediately without waiting

    @staticmethod
    def _perform_node_memory_update(*, memory_block_spec: MemoryBlockSpec,
                                    tenant_id: str, app_id: str, node_id: str,
                                    llm_output: str, variable_pool: VariablePool,
                                    is_draft: bool = False):
        """Execute node memory update"""
        try:
            # Call existing _perform_memory_update method here
            ChatflowMemoryService._perform_memory_update(
                tenant_id=tenant_id,
                app_id=app_id,
                memory_block_spec=memory_block_spec,
                conversation_id=str(variable_pool.get(('sys', 'conversation_id'))),
                variable_pool=variable_pool,
                node_id=node_id,
                is_draft=is_draft
            )
        except Exception as e:
            logger.exception(
                "Failed to update node memory %s for node %s",
                memory_block_spec.id,
                node_id,
                exc_info=e
            )

    @staticmethod
    def _update_single_memory(*, tenant_id: str, app_id: str,
                              memory_block_spec: MemoryBlockSpec,
                              conversation_id: str,
                              variable_pool: VariablePool,
                              is_draft: bool = False):
        """Update single memory"""
        ChatflowMemoryService._perform_memory_update(
            tenant_id=tenant_id,
            app_id=app_id,
            memory_block_spec=memory_block_spec,
            conversation_id=conversation_id,
            variable_pool=variable_pool,
            node_id=None,  # App-level memory doesn't have node_id
            is_draft=is_draft
        )

    @staticmethod
    def _perform_memory_update(tenant_id: str, app_id: str,
                               memory_block_spec: MemoryBlockSpec,
                               conversation_id: str, variable_pool: VariablePool,
                               node_id: Optional[str] = None,
                               is_draft: bool = False):
        """Perform the actual memory update using LLM

        Args:
            tenant_id: Tenant ID
            app_id: Application ID
            memory_block_spec: Memory block specification
            conversation_id: Conversation ID
            variable_pool: Variable pool for context
            node_id: Optional node ID for node-level memory updates
            is_draft: Whether in draft mode
        """
        # Get conversation history
        history = ChatflowHistoryService.get_visible_chat_history(
            conversation_id=conversation_id,
            app_id=app_id,
            tenant_id=tenant_id,
            node_id=node_id,  # Pass node_id, if None then get app-level history
            max_visible_count=memory_block_spec.preserved_turns
        )

        # Get current memory value
        current_memory = ChatflowMemoryService.get_memory(
            memory_id=memory_block_spec.id,
            tenant_id=tenant_id,
            app_id=app_id,
            conversation_id=conversation_id if memory_block_spec.term == MemoryTerm.SESSION else None,
            node_id=node_id
        )

        current_value = current_memory.value if current_memory else memory_block_spec.template

        # Build update prompt - adjust wording based on whether there's a node_id
        context_type = "Node conversation history" if node_id else "Conversation history"
        memory_update_prompt = f"""
            Based on the following {context_type}, update the memory content:

            Current memory: {current_value}

            {context_type}:
            {[msg.content for msg in history]}

            Update instruction: {memory_block_spec.instruction}

            Please output the updated memory content:
            """

        # Invoke LLM to update memory - extracted as a separate method
        updated_value = ChatflowMemoryService._invoke_llm_for_memory_update(
            tenant_id,
            memory_block_spec,
            memory_update_prompt,
            current_value
        )

        if updated_value is None:
            return  # LLM invocation failed

        # Save updated memory
        updated_memory = MemoryBlock(
            id=current_memory.id if current_memory else "",
            memory_id=memory_block_spec.id,
            name=memory_block_spec.name,
            value=updated_value,
            scope=memory_block_spec.scope,
            term=memory_block_spec.term,
            app_id=app_id,
            conversation_id=conversation_id if memory_block_spec.term == MemoryTerm.SESSION else None,
            node_id=node_id
        )

        ChatflowMemoryService.save_memory(updated_memory, tenant_id, is_draft)

        # Not implemented yet: Send success event
        # self._send_memory_update_event(memory_block_spec.id, "completed", updated_value)

    @staticmethod
    def _invoke_llm_for_memory_update(tenant_id: str,
                                      memory_block_spec: MemoryBlockSpec,
                                      prompt: str, current_value: str) -> Optional[str]:
        """Invoke LLM to update memory content

        Args:
            tenant_id: Tenant ID
            memory_block_spec: Memory block specification
            prompt: Update prompt
            current_value: Current memory value (used for fallback on failure)

        Returns:
            Updated value, returns None if failed
        """
        from core.model_manager import ModelManager
        from core.model_runtime.entities.llm_entities import LLMResult
        from core.model_runtime.entities.model_entities import ModelType

        model_manager = ModelManager()

        # Use model configuration defined in memory_block_spec, use default model if not specified
        if hasattr(memory_block_spec, 'model') and memory_block_spec.model:
            model_instance = model_manager.get_model_instance(
                tenant_id=tenant_id,
                model_type=ModelType.LLM,
                provider=memory_block_spec.model.get("provider", ""),
                model=memory_block_spec.model.get("name", "")
            )
            model_parameters = memory_block_spec.model.get("completion_params", {})
        else:
            # Use default model
            model_instance = model_manager.get_default_model_instance(
                tenant_id=tenant_id,
                model_type=ModelType.LLM
            )
            model_parameters = {"temperature": 0.7, "max_tokens": 1000}

        try:
            response = cast(
                LLMResult,
                model_instance.invoke_llm(
                    prompt_messages=[UserPromptMessage(content=prompt)],
                    model_parameters=model_parameters,
                    stream=False
                )
            )
            return response.message.get_text_content()
        except Exception as e:
            logger.exception("Failed to update memory using LLM", exc_info=e)
            # Not implemented yet: Send failure event
            # ChatflowMemoryService._send_memory_update_event(memory_block_spec.id, "failed", current_value, str(e))
            return None


    def _send_memory_update_event(self, memory_id: str, status: str, value: str, error: str = ""):
        """Send memory update event

        Note: Event system integration not implemented yet, this method is retained as a placeholder
        """
        # Not implemented yet: Event system integration will be added in future versions
        pass

    # App-level sync batch update related methods
    @staticmethod
    def wait_for_sync_memory_completion(workflow, conversation_id: str):
        """Wait for sync memory update to complete, maximum 50 seconds

        Args:
            workflow: Workflow object
            conversation_id: Conversation ID

        Raises:
            MemorySyncTimeoutError: Raised when timeout is reached
        """
        from core.memory.entities import MemoryScope

        memory_blocks = workflow.memory_blocks
        sync_memory_blocks = [
            block for block in memory_blocks
            if block.scope == MemoryScope.APP and block.update_mode == "sync"
        ]

        if not sync_memory_blocks:
            return

        lock_key = _get_memory_sync_lock_key(workflow.app_id, conversation_id)

        # Retry up to 10 times, wait 5 seconds each time, total 50 seconds
        max_retries = 10
        retry_interval = 5

        for i in range(max_retries):
            if not redis_client.exists(lock_key):
                # Lock doesn't exist, can continue
                return

            if i < max_retries - 1:
                # Still have retry attempts, wait
                time.sleep(retry_interval)
            else:
                # Maximum retry attempts reached, raise exception
                raise MemorySyncTimeoutError(
                    app_id=workflow.app_id,
                    conversation_id=conversation_id
                )

    @staticmethod
    def update_app_memory_after_run(workflow, conversation_id: str, variable_pool: VariablePool,
                                    is_draft: bool = False):
        """Update app-level memory after run completion

        Args:
            workflow: Workflow object
            conversation_id: Conversation ID
            variable_pool: Variable pool
            is_draft: Whether in draft mode
        """
        from core.memory.entities import MemoryScope

        memory_blocks = workflow.memory_blocks

        # Separate sync and async memory blocks
        sync_blocks = []
        async_blocks = []

        for block in memory_blocks:
            if block.scope == MemoryScope.APP:
                if block.update_mode == "sync":
                    sync_blocks.append(block)
                else:
                    async_blocks.append(block)

        # async mode: submit individual async tasks directly
        for block in async_blocks:
            ChatflowMemoryService._submit_async_memory_update(
                tenant_id=workflow.tenant_id,
                app_id=workflow.app_id,
                block=block,
                conversation_id=conversation_id,
                variable_pool=variable_pool,
                is_draft=is_draft
            )

        # sync mode: submit a batch update task
        if sync_blocks:
            ChatflowMemoryService._submit_sync_memory_batch_update(
                workflow=workflow,
                sync_blocks=sync_blocks,
                conversation_id=conversation_id,
                variable_pool=variable_pool,
                is_draft=is_draft
            )

    @staticmethod
    def _submit_sync_memory_batch_update(workflow,
                                         sync_blocks: list[MemoryBlockSpec],
                                         conversation_id: str,
                                         variable_pool: VariablePool,
                                         is_draft: bool = False):
        """Submit sync memory batch update task"""

        # Execute batch update asynchronously using thread
        thread = threading.Thread(
            target=ChatflowMemoryService._batch_update_sync_memory,
            kwargs={
                'workflow': workflow,
                'sync_blocks': sync_blocks,
                'conversation_id': conversation_id,
                'variable_pool': variable_pool,
                'is_draft': is_draft
            },
            daemon=True
        )
        thread.start()

    @staticmethod
    def _batch_update_sync_memory(*, workflow,
                                  sync_blocks: list[MemoryBlockSpec],
                                  conversation_id: str,
                                  variable_pool: VariablePool,
                                  is_draft: bool = False):
        """Batch update sync memory (with Redis lock)"""
        from concurrent.futures import ThreadPoolExecutor

        lock_key = _get_memory_sync_lock_key(workflow.app_id, conversation_id)

        # Use Redis lock context manager (30 seconds timeout)
        with redis_client.lock(lock_key, timeout=30):
            try:
                # Update all sync memory in parallel
                with ThreadPoolExecutor(max_workers=5) as executor:
                    futures = []
                    for block in sync_blocks:
                        future = executor.submit(
                            ChatflowMemoryService._update_single_memory,
                            tenant_id=workflow.tenant_id,
                            app_id=workflow.app_id,
                            memory_block_spec=block,
                            conversation_id=conversation_id,
                            variable_pool=variable_pool,
                            is_draft=is_draft
                        )
                        futures.append(future)

                    # Wait for all updates to complete
                    for future in futures:
                        try:
                            future.result()
                        except Exception as e:
                            logger.exception("Failed to update memory", exc_info=e)
            except Exception as e:
                logger.exception("Failed to update sync memory for app %s", workflow.app_id, exc_info=e)
