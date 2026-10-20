"""Exercise pause persistence before resume counts the existing message.

An LLM node can accrue usage before an answer node emits text. The runtime
state is supplied here; no model, graph engine or HTTP service is executed.
"""

from contextlib import nullcontext
from datetime import datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session, sessionmaker

from constants import UUID_NIL
from core.app.apps.advanced_chat import app_generator as generator_module
from core.app.apps.advanced_chat.generate_task_pipeline import AdvancedChatAppGenerateTaskPipeline
from core.app.entities.queue_entities import QueueWorkflowPausedEvent
from graphon.model_runtime.entities.llm_entities import LLMUsage
from graphon.runtime import GraphRuntimeState, VariablePool
from models.enums import ConversationFromSource, MessageStatus
from models.model import Message


@pytest.mark.parametrize(
    ("answer", "completion_tokens", "expected_length"), [("", 5, 2), ("", 0, 1), ("visible", 5, 2)]
)
@pytest.mark.parametrize("sqlite_session", [(Message,)], indirect=True)
def test_resume_counts_message_written_by_pause(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch, answer: str, completion_tokens: int, expected_length: int
):
    conversation_id, previous_id, current_id = (str(uuid4()) for _ in range(3))
    now = datetime.now()
    for message_id, parent, text, created in [
        (previous_id, UUID_NIL, "previous answer", now - timedelta(seconds=1)),
        (current_id, previous_id, "", now),
    ]:
        message = Message(
            id=message_id,
            app_id=str(uuid4()),
            conversation_id=conversation_id,
            query="question",
            message={"role": "user", "content": "question"},
            answer=text,
            message_tokens=0,
            answer_tokens=0,
            message_unit_price=Decimal(0),
            answer_unit_price=Decimal(0),
            currency="USD",
            from_source=ConversationFromSource.API,
            parent_message_id=parent,
            created_at=created,
            updated_at=created,
        )
        message._inputs = {}
        sqlite_session.add(message)
    sqlite_session.commit()
    factory = sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False)
    monkeypatch.setattr("core.app.apps.advanced_chat.generate_task_pipeline.session_factory.create_session", factory)

    state = GraphRuntimeState(variable_pool=VariablePool(), start_at=0.0)
    state.llm_usage = LLMUsage.empty_usage().model_copy(update={"completion_tokens": completion_tokens})
    pipeline = AdvancedChatAppGenerateTaskPipeline.__new__(AdvancedChatAppGenerateTaskPipeline)
    pipeline._message_id = current_id
    pipeline._graph_runtime_state = state
    pipeline._workflow_run_id = str(uuid4())
    pipeline._application_generate_entity = Mock(task_id="task")
    pipeline._workflow_response_converter = Mock()
    pipeline._workflow_response_converter.workflow_pause_to_stream_response.return_value = []
    pipeline._base_task_pipeline = Mock(start_at=0.0, queue_manager=Mock())
    pipeline._task_state = Mock(answer=answer, is_streaming_response=False, first_token_time=None)
    pipeline._task_state.metadata.model_dump.return_value = {}
    pipeline._recorded_files = []
    pipeline._message_saved_on_pause = False

    # Neither the real pause handler nor _save_message/_get_message is replaced.
    list(pipeline._handle_workflow_paused_event(QueueWorkflowPausedEvent(reasons=[], outputs={})))
    with factory() as reader:
        saved = reader.get(Message, current_id)
        assert saved is not None
        assert (saved.answer, saved.answer_tokens, saved.status) == (answer, completion_tokens, MessageStatus.PAUSED)
        generator = generator_module.AdvancedChatAppGenerator.__new__(generator_module.AdvancedChatAppGenerator)
        generator._bind_file_access_scope = Mock(return_value=nullcontext())
        generator._init_generate_records = Mock(side_effect=AssertionError("resume must reuse its message"))

        class CountObservedError(Exception):
            pass

        # Stop only after the real resume/_generate path has queried the database
        # and set dialogue_count, before creating queues or starting a worker.
        monkeypatch.setattr(generator_module, "MessageBasedAppQueueManager", Mock(side_effect=CountObservedError))
        entity = Mock(
            trace_manager=object(),
            app_config=SimpleNamespace(tenant_id="tenant"),
            invoke_from="service-api",
            task_id="task",
            user_id="user",
            stream=False,
        )
        with pytest.raises(CountObservedError):
            generator.resume(
                app_model=Mock(),
                workflow=Mock(),
                user=Mock(),
                conversation=Mock(id=conversation_id, mode="advanced-chat"),
                message=saved,
                session=reader,
                application_generate_entity=entity,
                workflow_execution_repository=Mock(),
                workflow_node_execution_repository=Mock(),
                graph_runtime_state=state,
            )
        assert generator._dialogue_count == expected_length + 1
        generator._init_generate_records.assert_not_called()
