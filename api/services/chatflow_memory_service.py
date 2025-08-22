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
    MemoryBlockWithVisibility,
    MemoryScheduleMode,
    MemoryScope,
    MemoryTerm,
)
from core.memory.errors import MemorySyncTimeoutError
from core.model_runtime.entities.message_entities import AssistantPromptMessage, UserPromptMessage
from core.workflow.constants import MEMORY_BLOCK_VARIABLE_NODE_ID
from core.workflow.entities.variable_pool import VariablePool
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models import App
from models.chatflow_memory import ChatflowMemoryVariable
from models.workflow import WorkflowDraftVariable
from services.chatflow_history_service import ChatflowHistoryService
from services.workflow_draft_variable_service import WorkflowDraftVariableService
from services.workflow_service import WorkflowService

logger = logging.getLogger(__name__)

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
    @staticmethod
    def get_persistent_memories(app: App) -> Sequence[MemoryBlockWithVisibility]:
        stmt = select(ChatflowMemoryVariable).where(
            and_(
                ChatflowMemoryVariable.tenant_id == app.tenant_id,
                ChatflowMemoryVariable.app_id == app.id,
                ChatflowMemoryVariable.conversation_id == None
            )
        )
        with Session(db.engine) as session:
            db_results = session.execute(stmt).all()
        return ChatflowMemoryService._with_visibility(app, [result[0] for result in db_results])

    @staticmethod
    def get_session_memories(app: App, conversation_id: str) -> Sequence[MemoryBlockWithVisibility]:
        stmt = select(ChatflowMemoryVariable).where(
            and_(
                ChatflowMemoryVariable.tenant_id == app.tenant_id,
                ChatflowMemoryVariable.app_id == app.id,
                ChatflowMemoryVariable.conversation_id == conversation_id
            )
        )
        with Session(db.engine) as session:
            db_results = session.execute(stmt).all()
        return ChatflowMemoryService._with_visibility(app, [result[0] for result in db_results])

    @staticmethod
    def save_memory(memory: MemoryBlock, tenant_id: str, variable_pool: VariablePool, is_draft: bool) -> None:
        key =  f"{memory.node_id}:{memory.memory_id}" if memory.node_id else memory.memory_id
        variable_pool.add([MEMORY_BLOCK_VARIABLE_NODE_ID, key], memory.value)

        with db.session() as session:
            session.merge(ChatflowMemoryService._to_chatflow_memory_variable(memory))
            session.commit()

        if is_draft:
            with Session(bind=db.engine) as session:
                draft_var_service = WorkflowDraftVariableService(session)
                existing_vars = draft_var_service.get_draft_variables_by_selectors(
                    app_id=memory.app_id,
                    selectors=[['memory_block', memory.memory_id]]
                )
                if existing_vars:
                    draft_var = existing_vars[0]
                    draft_var.value = memory.value
                else:
                    draft_var = WorkflowDraftVariable.new_memory_block_variable(
                        app_id=memory.app_id,
                        memory_id=memory.memory_id,
                        name=memory.name,
                        value=memory.value,
                        description=""
                    )
                    session.add(draft_var)
                session.commit()

    @staticmethod
    def get_memories_by_specs(memory_block_specs: Sequence[MemoryBlockSpec],
                              tenant_id: str, app_id: str,
                              conversation_id: Optional[str] = None,
                              node_id: Optional[str] = None,
                              is_draft: bool = False) -> Sequence[MemoryBlock]:
       return [ChatflowMemoryService.get_memory_by_spec(
            spec, tenant_id, app_id, conversation_id, node_id, is_draft
        ) for spec in memory_block_specs]

    @staticmethod
    def get_memory_by_spec(spec: MemoryBlockSpec,
                           tenant_id: str, app_id: str,
                           conversation_id: Optional[str] = None,
                           node_id: Optional[str] = None,
                           is_draft: bool = False) -> MemoryBlock:
        with (Session(bind=db.engine) as session):
            if is_draft:
                draft_var_service = WorkflowDraftVariableService(session)
                selector = [MEMORY_BLOCK_VARIABLE_NODE_ID, f"{spec.id}.{node_id}"]\
                    if node_id else [MEMORY_BLOCK_VARIABLE_NODE_ID, spec.id]
                draft_vars = draft_var_service.get_draft_variables_by_selectors(
                    app_id=app_id,
                    selectors=[selector]
                )
                if draft_vars:
                    draft_var = draft_vars[0]
                    return MemoryBlock(
                        id=draft_var.id,
                        memory_id=draft_var.name,
                        name=spec.name,
                        value=draft_var.value,
                        scope=spec.scope,
                        term=spec.term,
                        app_id=app_id,
                        conversation_id=conversation_id,
                        node_id=node_id
                    )
            stmt = select(ChatflowMemoryVariable).where(
                and_(
                    ChatflowMemoryVariable.memory_id == spec.id,
                    ChatflowMemoryVariable.tenant_id == tenant_id,
                    ChatflowMemoryVariable.app_id == app_id,
                    ChatflowMemoryVariable.node_id == node_id,
                    ChatflowMemoryVariable.conversation_id == conversation_id
                )
            )
            result = session.execute(stmt).scalar()
            if result:
                return ChatflowMemoryService._to_memory_block(result)
            return MemoryBlock(
                id="",  # Will be assigned when saved
                memory_id=spec.id,
                name=spec.name,
                value=spec.template,
                scope=spec.scope,
                term=spec.term,
                app_id=app_id,
                conversation_id=conversation_id,
                node_id=node_id
            )

    @staticmethod
    def get_app_memories_by_workflow(workflow, tenant_id: str,
                                     conversation_id: Optional[str] = None) -> Sequence[MemoryBlock]:

        app_memory_specs = [spec for spec in workflow.memory_blocks if spec.scope == MemoryScope.APP]
        return ChatflowMemoryService.get_memories_by_specs(
            memory_block_specs=app_memory_specs,
            tenant_id=tenant_id,
            app_id=workflow.app_id,
            conversation_id=conversation_id
        )

    @staticmethod
    def get_node_memories_by_workflow(workflow, node_id: str, tenant_id: str) -> Sequence[MemoryBlock]:
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

    @staticmethod
    def update_node_memory_if_needed(
        tenant_id: str,
        app_id: str,
        node_id: str,
        conversation_id: str,
        memory_block_spec: MemoryBlockSpec,
        variable_pool: VariablePool,
        is_draft: bool
    ) -> bool:
        """Update node-level memory after LLM execution"""
        conversation_id_segment = variable_pool.get(('sys', 'conversation_id'))
        if not conversation_id_segment:
            return False
        conversation_id = conversation_id_segment.value

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
    def _get_memory_from_chatflow_table(memory_id: str, tenant_id: str,
                                        app_id: Optional[str] = None,
                                        conversation_id: Optional[str] = None,
                                        node_id: Optional[str] = None) -> Optional[MemoryBlock]:
        stmt = select(ChatflowMemoryVariable).where(
            and_(
                ChatflowMemoryVariable.app_id == app_id,
                ChatflowMemoryVariable.memory_id == memory_id,
                ChatflowMemoryVariable.tenant_id == tenant_id,
                ChatflowMemoryVariable.conversation_id == conversation_id,
                ChatflowMemoryVariable.node_id == node_id
            )
        )

        with db.session() as session:
            result = session.execute(stmt).first()
            return ChatflowMemoryService._to_memory_block(result[0]) if result else None

    @staticmethod
    def _to_memory_block(entity: ChatflowMemoryVariable) -> MemoryBlock:
        scope = MemoryScope(entity.scope) if not isinstance(entity.scope, MemoryScope) else entity.scope
        term = MemoryTerm(entity.term) if not isinstance(entity.term, MemoryTerm) else entity.term
        return MemoryBlock(
            id=entity.id,
            memory_id=entity.memory_id,
            name=entity.name,
            value=entity.value,
            scope=scope,
            term=term,
            app_id=cast(str, entity.app_id), # It's supposed to be not nullable for now
            conversation_id=entity.conversation_id,
            node_id=entity.node_id,
            created_at=entity.created_at,
            updated_at=entity.updated_at,
        )

    @staticmethod
    def _to_chatflow_memory_variable(memory_block: MemoryBlock) -> ChatflowMemoryVariable:
        return ChatflowMemoryVariable(
            id=memory_block.id,
            node_id=memory_block.node_id,
            memory_id=memory_block.memory_id,
            name=memory_block.name,
            value=memory_block.value,
            scope=memory_block.scope,
            term=memory_block.term,
            app_id=memory_block.app_id,
            conversation_id=memory_block.conversation_id,
        )

    @staticmethod
    def _with_visibility(
        app: App,
        raw_results: Sequence[ChatflowMemoryVariable]
    ) -> Sequence[MemoryBlockWithVisibility]:
        workflow = WorkflowService().get_published_workflow(app)
        if not workflow:
            return []
        results = []
        for db_result in raw_results:
            spec = next((spec for spec in workflow.memory_blocks if spec.id == db_result.memory_id), None)
            if spec:
                results.append(
                    MemoryBlockWithVisibility(
                        id=db_result.memory_id,
                        name=db_result.name,
                        value=db_result.value,
                        end_user_editable=spec.end_user_editable,
                        end_user_visible=spec.end_user_visible,
                    )
                )
        return results

    @staticmethod
    def _should_update_memory(tenant_id: str, app_id: str,
                              memory_block_spec: MemoryBlockSpec,
                              conversation_id: str, node_id: Optional[str] = None) -> bool:
        """Check if memory should be updated based on strategy"""
        # Currently, `memory_block_spec.strategy != MemoryStrategy.ON_TURNS` is not possible, but possible in the future

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
            target=ChatflowMemoryService._update_app_single_memory,
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
        ChatflowMemoryService._perform_memory_update(
            tenant_id=tenant_id,
            app_id=app_id,
            memory_block_spec=memory_block_spec,
            conversation_id=str(variable_pool.get(('sys', 'conversation_id'))),
            variable_pool=variable_pool,
            node_id=node_id,
            is_draft=is_draft
        )

    @staticmethod
    def _update_app_single_memory(*, tenant_id: str, app_id: str,
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
        """Perform the actual memory update using LLM"""
        history = ChatflowHistoryService.get_visible_chat_history(
            conversation_id=conversation_id,
            app_id=app_id,
            tenant_id=tenant_id,
            node_id=node_id,
        )

        # Get current memory value
        current_memory = ChatflowMemoryService._get_memory_from_chatflow_table(
            memory_id=memory_block_spec.id,
            tenant_id=tenant_id,
            app_id=app_id,
            conversation_id=conversation_id,
            node_id=node_id
        )

        current_value = current_memory.value if current_memory else memory_block_spec.template



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

        ChatflowMemoryService.save_memory(updated_memory, tenant_id, variable_pool, is_draft)

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
        """Update app-level memory after run completion"""
        sync_blocks = []
        async_blocks = []
        for block in workflow.memory_blocks:
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
                            ChatflowMemoryService._update_app_single_memory,
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
