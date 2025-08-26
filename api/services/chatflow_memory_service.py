import logging
import threading
import time
from collections.abc import Sequence
from typing import Optional

from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from core.llm_generator.llm_generator import LLMGenerator
from core.memory.entities import (
    MemoryBlock,
    MemoryBlockSpec,
    MemoryBlockWithVisibility,
    MemoryScheduleMode,
    MemoryScope,
    MemoryTerm,
)
from core.memory.errors import MemorySyncTimeoutError
from core.model_runtime.entities.message_entities import PromptMessage
from core.workflow.constants import MEMORY_BLOCK_VARIABLE_NODE_ID
from core.workflow.entities.variable_pool import VariablePool
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models import App
from models.chatflow_memory import ChatflowMemoryVariable
from models.workflow import Workflow, WorkflowDraftVariable
from services.chatflow_history_service import ChatflowHistoryService
from services.workflow_draft_variable_service import WorkflowDraftVariableService
from services.workflow_service import WorkflowService

logger = logging.getLogger(__name__)

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
    def save_memory(memory: MemoryBlock, variable_pool: VariablePool, is_draft: bool) -> None:
        key = f"{memory.node_id}.{memory.spec.id}" if memory.node_id else memory.spec.id
        variable_pool.add([MEMORY_BLOCK_VARIABLE_NODE_ID, key], memory.value)

        with Session(db.engine) as session:
            existing = session.query(ChatflowMemoryVariable).filter_by(
                memory_id=memory.spec.id,
                tenant_id=memory.tenant_id,
                app_id=memory.app_id,
                node_id=memory.node_id,
                conversation_id=memory.conversation_id
            ).first()
            if existing:
                existing.value = memory.value
            else:
                session.add(
                    ChatflowMemoryVariable(
                        memory_id=memory.spec.id,
                        tenant_id=memory.tenant_id,
                        app_id=memory.app_id,
                        node_id=memory.node_id,
                        conversation_id=memory.conversation_id,
                        name=memory.spec.name,
                        value=memory.value,
                        term=memory.spec.term,
                        scope=memory.spec.scope,
                    )
                )
            session.commit()

        if is_draft:
            with Session(bind=db.engine) as session:
                draft_var_service = WorkflowDraftVariableService(session)
                existing_vars = draft_var_service.get_draft_variables_by_selectors(
                    app_id=memory.app_id,
                    selectors=[['memory_block', memory.spec.id]]
                )
                if existing_vars:
                    draft_var = existing_vars[0]
                    draft_var.value = memory.value
                else:
                    draft_var = WorkflowDraftVariable.new_memory_block_variable(
                        app_id=memory.app_id,
                        memory_id=memory.spec.id,
                        name=memory.spec.name,
                        value=memory.value,
                        description=""
                    )
                    session.add(draft_var)
                session.commit()

    @staticmethod
    def get_memories_by_specs(
        memory_block_specs: Sequence[MemoryBlockSpec],
        tenant_id: str, app_id: str,
        conversation_id: Optional[str],
        node_id: Optional[str],
        is_draft: bool
    ) -> Sequence[MemoryBlock]:
        return [ChatflowMemoryService.get_memory_by_spec(
            spec, tenant_id, app_id, conversation_id, node_id, is_draft
        ) for spec in memory_block_specs]

    @staticmethod
    def get_memory_by_spec(
        spec: MemoryBlockSpec,
        tenant_id: str,
        app_id: str,
        conversation_id: Optional[str],
        node_id: Optional[str],
        is_draft: bool
    ) -> MemoryBlock:
        with Session(db.engine) as session:
            if is_draft:
                draft_var_service = WorkflowDraftVariableService(session)
                selector = [MEMORY_BLOCK_VARIABLE_NODE_ID, f"{spec.id}.{node_id}"] \
                    if node_id else [MEMORY_BLOCK_VARIABLE_NODE_ID, spec.id]
                draft_vars = draft_var_service.get_draft_variables_by_selectors(
                    app_id=app_id,
                    selectors=[selector]
                )
                if draft_vars:
                    draft_var = draft_vars[0]
                    return MemoryBlock(
                        value=draft_var.value,
                        tenant_id=tenant_id,
                        app_id=app_id,
                        conversation_id=conversation_id,
                        node_id=node_id,
                        spec=spec
                    )
            stmt = select(ChatflowMemoryVariable).where(
                and_(
                    ChatflowMemoryVariable.memory_id == spec.id,
                    ChatflowMemoryVariable.tenant_id == tenant_id,
                    ChatflowMemoryVariable.app_id == app_id,
                    ChatflowMemoryVariable.node_id == \
                        (node_id if spec.scope == MemoryScope.NODE else None),
                    ChatflowMemoryVariable.conversation_id == \
                        (conversation_id if spec.term == MemoryTerm.SESSION else None),
                )
            )
            result = session.execute(stmt).scalar()
            if result:
                return MemoryBlock(
                    value=result.value,
                    tenant_id=tenant_id,
                    app_id=app_id,
                    conversation_id=conversation_id,
                    node_id=node_id,
                    spec=spec
                )
            return MemoryBlock(
                tenant_id=tenant_id,
                value=spec.template,
                app_id=app_id,
                conversation_id=conversation_id,
                node_id=node_id,
                spec=spec
            )

    @staticmethod
    def update_app_memory_if_needed(
        workflow: Workflow,
        conversation_id: str,
        variable_pool: VariablePool,
        is_draft: bool
    ):
        visible_messages = ChatflowHistoryService.get_visible_chat_history(
            conversation_id=conversation_id,
            app_id=workflow.app_id,
            tenant_id=workflow.tenant_id,
            node_id=None,
        )
        sync_blocks: list[MemoryBlock] = []
        async_blocks: list[MemoryBlock] = []
        for memory_spec in workflow.memory_blocks:
            if memory_spec.scope == MemoryScope.APP:
                memory = ChatflowMemoryService.get_memory_by_spec(
                    spec=memory_spec,
                    tenant_id=workflow.tenant_id,
                    app_id=workflow.app_id,
                    conversation_id=conversation_id,
                    node_id=None,
                    is_draft=is_draft
                )
                if ChatflowMemoryService._should_update_memory(memory, visible_messages):
                    if memory.spec.schedule_mode == MemoryScheduleMode.SYNC:
                        sync_blocks.append(memory)
                    else:
                        async_blocks.append(memory)

        if not sync_blocks and not async_blocks:
            return

        # async mode: submit individual async tasks directly
        for memory_block in async_blocks:
            ChatflowMemoryService._app_submit_async_memory_update(
                block=memory_block,
                is_draft=is_draft,
                variable_pool=variable_pool,
                visible_messages=visible_messages
            )

        # sync mode: submit a batch update task
        if sync_blocks:
            ChatflowMemoryService._app_submit_sync_memory_batch_update(
                sync_blocks=sync_blocks,
                is_draft=is_draft,
                conversation_id=conversation_id,
                app_id=workflow.app_id,
                visible_messages=visible_messages,
                variable_pool=variable_pool
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
        visible_messages = ChatflowHistoryService.get_visible_chat_history(
            conversation_id=conversation_id,
            app_id=app_id,
            tenant_id=tenant_id,
            node_id=node_id,
        )
        memory_block = ChatflowMemoryService.get_memory_by_spec(
            spec=memory_block_spec,
            tenant_id=tenant_id,
            app_id=app_id,
            conversation_id=conversation_id,
            node_id=node_id,
            is_draft=is_draft
        )
        if not ChatflowMemoryService._should_update_memory(
            memory_block=memory_block,
            visible_history=visible_messages
        ):
            return False

        if memory_block_spec.schedule_mode == MemoryScheduleMode.SYNC:
            # Node-level sync: blocking execution
            ChatflowMemoryService._update_node_memory_sync(
                visible_messages=visible_messages,
                memory_block=memory_block,
                variable_pool=variable_pool,
                is_draft=is_draft
            )
        else:
            # Node-level async: execute asynchronously
            ChatflowMemoryService._update_node_memory_async(
                memory_block=memory_block,
                visible_messages=visible_messages,
                variable_pool=variable_pool,
                is_draft=is_draft
            )
        return True

    @staticmethod
    def wait_for_sync_memory_completion(workflow: Workflow, conversation_id: str):
        """Wait for sync memory update to complete, maximum 50 seconds"""

        memory_blocks = workflow.memory_blocks
        sync_memory_blocks = [
            block for block in memory_blocks
            if block.scope == MemoryScope.APP and block.schedule_mode == MemoryScheduleMode.SYNC
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
    def _with_visibility(
        app: App,
        raw_results: Sequence[ChatflowMemoryVariable]
    ) -> Sequence[MemoryBlockWithVisibility]:
        workflow = WorkflowService().get_published_workflow(app)
        if not workflow:
            return []
        results = []
        for chatflow_memory_variable in raw_results:
            spec = next(
                (spec for spec in workflow.memory_blocks if spec.id == chatflow_memory_variable.memory_id),
                None
            )
            if spec:
                results.append(
                    MemoryBlockWithVisibility(
                        id=chatflow_memory_variable.memory_id,
                        name=chatflow_memory_variable.name,
                        value=chatflow_memory_variable.value,
                        end_user_editable=spec.end_user_editable,
                        end_user_visible=spec.end_user_visible,
                    )
                )
        return results

    @staticmethod
    def _should_update_memory(
        memory_block: MemoryBlock,
        visible_history: Sequence[PromptMessage]
    ) -> bool:
        return len(visible_history) >= memory_block.spec.update_turns

    @staticmethod
    def _app_submit_async_memory_update(
        block: MemoryBlock,
        visible_messages: Sequence[PromptMessage],
        variable_pool: VariablePool,
        is_draft: bool
    ):
        thread = threading.Thread(
            target=ChatflowMemoryService._perform_memory_update,
            kwargs={
                'memory_block': block,
                'visible_messages': visible_messages,
                'variable_pool': variable_pool,
                'is_draft': is_draft
            },
        )
        thread.start()

    @staticmethod
    def _app_submit_sync_memory_batch_update(
        sync_blocks: Sequence[MemoryBlock],
        app_id: str,
        conversation_id: str,
        visible_messages: Sequence[PromptMessage],
        variable_pool: VariablePool,
        is_draft: bool
    ):
        """Submit sync memory batch update task"""
        thread = threading.Thread(
            target=ChatflowMemoryService._batch_update_sync_memory,
            kwargs={
                'sync_blocks': sync_blocks,
                'app_id': app_id,
                'conversation_id': conversation_id,
                'visible_messages': visible_messages,
                'variable_pool': variable_pool,
                'is_draft': is_draft
            },
        )
        thread.start()

    @staticmethod
    def _batch_update_sync_memory(
        sync_blocks: Sequence[MemoryBlock],
        app_id: str,
        conversation_id: str,
        visible_messages: Sequence[PromptMessage],
        variable_pool: VariablePool,
        is_draft: bool
    ):
        try:
            lock_key = _get_memory_sync_lock_key(app_id, conversation_id)
            with redis_client.lock(lock_key, timeout=120):
                threads = []
                for block in sync_blocks:
                    thread = threading.Thread(
                        target=ChatflowMemoryService._perform_memory_update,
                        kwargs={
                            'memory_block': block,
                            'visible_messages': visible_messages,
                            'variable_pool': variable_pool,
                            'is_draft': is_draft
                        },
                    )
                    threads.append(thread)
                for thread in threads:
                    thread.start()
                for thread in threads:
                    thread.join()
        except Exception as e:
            logger.exception("Error batch updating memory", exc_info=e)

    @staticmethod
    def _update_node_memory_sync(
        memory_block: MemoryBlock,
        visible_messages: Sequence[PromptMessage],
        variable_pool: VariablePool,
        is_draft: bool
    ):
        ChatflowMemoryService._perform_memory_update(
            memory_block=memory_block,
            visible_messages=visible_messages,
            variable_pool=variable_pool,
            is_draft=is_draft
        )

    @staticmethod
    def _update_node_memory_async(
        memory_block: MemoryBlock,
        visible_messages: Sequence[PromptMessage],
        variable_pool: VariablePool,
        is_draft: bool = False
    ):
        thread = threading.Thread(
            target=ChatflowMemoryService._perform_memory_update,
            kwargs={
                'memory_block': memory_block,
                'visible_messages': visible_messages,
                'variable_pool': variable_pool,
                'is_draft': is_draft
            },
            daemon=True
        )
        thread.start()

    @staticmethod
    def _perform_memory_update(
        memory_block: MemoryBlock,
        variable_pool: VariablePool,
        visible_messages: Sequence[PromptMessage],
        is_draft: bool
    ):
        updated_value = LLMGenerator.update_memory_block(
            tenant_id=memory_block.tenant_id,
            visible_history=ChatflowMemoryService._format_chat_history(visible_messages),
            variable_pool=variable_pool,
            memory_block=memory_block,
            memory_spec=memory_block.spec,
        )
        updated_memory = MemoryBlock(
            tenant_id=memory_block.tenant_id,
            value=updated_value,
            spec=memory_block.spec,
            app_id=memory_block.app_id,
            conversation_id=memory_block.conversation_id,
            node_id=memory_block.node_id
        )
        ChatflowMemoryService.save_memory(updated_memory, variable_pool, is_draft)

    @staticmethod
    def _format_chat_history(messages: Sequence[PromptMessage]) -> Sequence[tuple[str, str]]:
        result = []
        for message in messages:
            result.append((str(message.role.value), message.get_text_content()))
        return result

def _get_memory_sync_lock_key(app_id: str, conversation_id: str) -> str:
    """Generate Redis lock key for memory sync updates

    Args:
        app_id: Application ID
        conversation_id: Conversation ID

    Returns:
        Formatted lock key
    """
    return f"memory_sync_update:{app_id}:{conversation_id}"
