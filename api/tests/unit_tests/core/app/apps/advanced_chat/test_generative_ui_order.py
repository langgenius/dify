"""Keep content positions stable across producers, persistence, and resumed runs."""

import json

import pytest
from sqlalchemy.orm import Session

from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.apps.advanced_chat.generate_task_pipeline import (
    AdvancedChatAppGenerateTaskPipeline,
    ConversationSnapshot,
    MessageSnapshot,
    WorkflowSnapshot,
)
from core.app.apps.draft_variable_saver import NoopDraftVariableSaver
from core.app.apps.message_based_app_queue_manager import MessageBasedAppQueueManager
from core.app.apps.workflow_app_runner import WorkflowBasedAppRunner
from core.app.entities.app_invoke_entities import AdvancedChatAppGenerateEntity, InvokeFrom
from core.app.entities.queue_entities import QueueTextChunkEvent
from core.app.entities.task_entities import MessageContentStreamResponse
from graphon.engine_events import NodeRunStreamChunkEvent
from graphon.enums import BuiltinNodeTypes
from libs.generative_ui import OpenUIContentBlock
from models.enums import EndUserType, MessageStatus
from models.model import AppMode, Conversation, EndUser, Message
from tests.unit_tests.core.app.apps.test_workflow_app_runner import _workflow_entry


def _pipeline(message: Message, queue: MessageBasedAppQueueManager) -> AdvancedChatAppGenerateTaskPipeline:
    return AdvancedChatAppGenerateTaskPipeline(
        application_generate_entity=AdvancedChatAppGenerateEntity(
            task_id="task-1",
            app_config=WorkflowUIBasedAppConfig(
                app_id=message.app_id, tenant_id="tenant-1", app_mode=AppMode.ADVANCED_CHAT, workflow_id="workflow-1"
            ),
            inputs={},
            files=[],
            user_id="user-1",
            stream=True,
            invoke_from=InvokeFrom.WEB_APP,
            query="Analyze sales",
            workflow_run_id="run-1",
        ),
        workflow=WorkflowSnapshot(
            id="workflow-1", tenant_id="tenant-1", features_dict={}, generative_ui_nodes=frozenset({"first", "second"})
        ),
        queue_manager=queue,
        conversation=ConversationSnapshot(id=message.conversation_id, mode=AppMode.ADVANCED_CHAT),
        message=MessageSnapshot.from_message(message),
        user=EndUser(id="user-1", tenant_id="tenant-1", type=EndUserType.BROWSER, session_id="session-1"),
        stream=True,
        dialogue_count=1,
        draft_var_saver_factory=lambda *_args, **_kwargs: NoopDraftVariableSaver(),
    )


def test_interleaved_producers_use_global_prose_offsets_and_persist_them(
    agent_queue_manager: MessageBasedAppQueueManager,
    agent_records: tuple[Conversation, Message],
    sqlite_session: Session,
) -> None:
    message = agent_records[1]
    pipeline = _pipeline(message, agent_queue_manager)
    responses = []
    for text, selector in [
        ("Introduction \U00020000\n", None),
        ("First conclusion\n```openui\nroot = Stack([", ["first", "text"]),
        ("Transition\n", None),
        ('Second conclusion\n```openui\nroot = Stack([Text("two")])\n```\nSecond recommendation\n', ["second", "text"]),
        ('Text("one")])\n```\nFirst recommendation', ["first", "text"]),
    ]:
        responses.extend(
            pipeline._handle_text_chunk_event(QueueTextChunkEvent(text=text, from_variable_selector=selector))
        )
    responses.extend(pipeline._finish_generative_ui("completed"))

    expected_offsets = [
        len("Introduction \U00020000\nFirst conclusion\n"),
        len("Introduction \U00020000\nFirst conclusion\nTransition\nSecond conclusion\n"),
    ]
    blocks = pipeline._task_state.metadata.content_blocks
    assert [block.text_offset for block in blocks] == expected_offsets
    assert all(block.status == "completed" for block in blocks)
    snapshots = [
        response.data
        for response in responses
        if isinstance(response, MessageContentStreamResponse) and isinstance(response.data, OpenUIContentBlock)
    ]
    for snapshot in snapshots:
        assert snapshot.text_offset == next(block.text_offset for block in blocks if block.id == snapshot.id)
    pipeline._save_message(session=sqlite_session)
    sqlite_session.commit()
    sqlite_session.refresh(message)
    assert message.answer == (
        "Introduction \U00020000\nFirst conclusion\nTransition\nSecond conclusion\n"
        "Second recommendation\nFirst recommendation"
    )
    assert [block["text_offset"] for block in message.message_metadata_dict["content_blocks"]] == expected_offsets


def test_resumed_message_keeps_existing_positions_and_offsets_new_ui_after_previous_answer(
    agent_queue_manager: MessageBasedAppQueueManager,
    agent_records: tuple[Conversation, Message],
) -> None:
    message = agent_records[1]
    message.status = MessageStatus.PAUSED
    message.answer = "Previous\n"
    previous = OpenUIContentBlock(id="previous", source="root = Stack([])", status="completed", text_offset=0)
    message.message_metadata = json.dumps({"content_blocks": [previous.model_dump(mode="json")]})
    pipeline = _pipeline(message, agent_queue_manager)

    list(
        pipeline._handle_text_chunk_event(
            QueueTextChunkEvent(
                text='Continue\n```openui\nroot = Stack([Text("next")])\n```\nEnd',
                from_variable_selector=["first", "text"],
            )
        )
    )

    blocks = pipeline._task_state.metadata.content_blocks
    assert blocks[0] == previous
    assert blocks[1].text_offset == len("Previous\nContinue\n")
    assert pipeline._task_state.answer == "Previous\nContinue\nEnd"


@pytest.mark.parametrize("empty_terminal", [False, True])
def test_repeated_producer_finishes_each_execution_without_a_trailing_newline(
    empty_terminal: bool,
    agent_queue_manager: MessageBasedAppQueueManager,
    agent_records: tuple[Conversation, Message],
) -> None:
    pipeline = _pipeline(agent_records[1], agent_queue_manager)
    runner = WorkflowBasedAppRunner(queue_manager=agent_queue_manager, app_id=agent_records[1].app_id)
    entry = _workflow_entry(runner)
    for index, label in enumerate(["First", "Second"]):
        source = f'```openui\nroot = Text("{label}")\n```'
        chunks = [(source, not empty_terminal)] + ([("", True)] if empty_terminal else [])
        for text, is_final in chunks:
            runner.handle_event(
                entry,
                NodeRunStreamChunkEvent(
                    id=f"execution-{index}",
                    node_id="first",
                    node_type=BuiltinNodeTypes.LLM,
                    selector=["first", "text"],
                    chunk=text,
                    is_final=is_final,
                ),
            )
            queued = agent_queue_manager._q.get_nowait()
            assert queued is not None
            assert isinstance(queued.event, QueueTextChunkEvent)
            assert queued.event.node_execution_id == f"execution-{index}"
            assert queued.event.is_final is is_final
            list(pipeline._handle_text_chunk_event(queued.event))
        assert pipeline._task_state.metadata.content_blocks[-1].status == "completed"

    blocks = pipeline._task_state.metadata.content_blocks
    assert [block.source for block in blocks] == ['root = Text("First")\n', 'root = Text("Second")\n']
    assert len({block.id for block in blocks}) == 2
    assert pipeline._task_state.answer == ""
    assert list(pipeline._finish_generative_ui("completed")) == []


def test_parallel_executions_of_one_producer_keep_independent_source_and_offsets(
    agent_queue_manager: MessageBasedAppQueueManager,
    agent_records: tuple[Conversation, Message],
) -> None:
    pipeline = _pipeline(agent_records[1], agent_queue_manager)
    for execution, text, is_final in [
        ("first-pass", 'First\n```openui\nroot = Text("', False),
        ("second-pass", 'Second\n```openui\nroot = Text("', False),
        ("second-pass", 'Second")\n```', True),
        ("first-pass", 'First")\n```', True),
    ]:
        list(
            pipeline._handle_text_chunk_event(
                QueueTextChunkEvent(
                    text=text,
                    from_variable_selector=["first", "text"],
                    node_execution_id=execution,
                    is_final=is_final,
                )
            )
        )

    blocks = pipeline._task_state.metadata.content_blocks
    assert [block.source for block in blocks] == ['root = Text("First")\n', 'root = Text("Second")\n']
    assert [block.text_offset for block in blocks] == [len("First\n"), len("First\nSecond\n")]
    assert len({block.id for block in blocks}) == 2
    assert all(block.status == "completed" for block in blocks)


def test_final_prose_prefix_is_flushed_before_the_next_plain_producer(
    agent_queue_manager: MessageBasedAppQueueManager,
    agent_records: tuple[Conversation, Message],
) -> None:
    pipeline = _pipeline(agent_records[1], agent_queue_manager)
    for text, selector, is_final in [
        ("Before\n``", ["first", "text"], False),
        ("", ["first", "text"], True),
        ("After", ["plain", "text"], True),
    ]:
        list(
            pipeline._handle_text_chunk_event(
                QueueTextChunkEvent(
                    text=text,
                    from_variable_selector=selector,
                    is_final=is_final,
                )
            )
        )

    assert pipeline._task_state.answer == "Before\n``After"
    assert pipeline._task_state.metadata.content_blocks == []
