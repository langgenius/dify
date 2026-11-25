"""Agent App task pipeline: shared EasyUI streaming plus steering frames.

The shared ``EasyUIBasedGenerateTaskPipeline`` owns every ordinary queue event.
Roster preview/build chats additionally emit two private events —
``QueueAgentQueueReadyEvent`` and ``QueueAgentInputDeliveredEvent`` — that must
reach the client as typed stream frames without changing shared dispatch. The
adapter below splits the single underlying listener into ordinary segments: a
segment ends where a steering event arrives, the shared loop processes only
ordinary messages, and this class emits the steering frame itself between
segments.

Invariants:
- Exactly one real queue listener exists (``listen_agent_messages``); segments
  borrow it, they never start a second consumer.
- Steering events never enter the shared ``match`` dispatch, so the shared
  pipeline file keeps zero diff for this feature.
- ``_save_message`` re-reads the persisted ``steering_inputs`` under the row
  lock so the terminal save cannot drop inputs delivered earlier in the turn.
"""

import json
import logging
from collections.abc import Generator, Iterator
from contextlib import closing, contextmanager
from typing import override

from pydantic import TypeAdapter, ValidationError
from sqlalchemy.orm import Session

from core.app.apps.message_based_app_queue_manager import MessageBasedAppQueueManager
from core.app.entities.app_invoke_entities import AgentAppGenerateEntity
from core.app.entities.queue_entities import (
    AgentDeliveredInput,
    MessageQueueMessage,
    QueueAgentInputDeliveredEvent,
    QueueAgentQueueReadyEvent,
    WorkflowQueueMessage,
)
from core.app.entities.task_entities import (
    AgentInputDeliveredStreamResponse,
    AgentQueueReadyStreamResponse,
    ErrorStreamResponse,
    StreamResponse,
    TaskStateMetadata,
)
from core.app.task_pipeline.easy_ui_based_generate_task_pipeline import EasyUIBasedGenerateTaskPipeline
from core.base.tts import AppGeneratorTTSPublisher
from models.model import Conversation, Message

logger = logging.getLogger(__name__)

type SteeringQueueEvent = QueueAgentQueueReadyEvent | QueueAgentInputDeliveredEvent
"""Private queue events owned by the Agent App steering feature."""


class AgentAppQueueManager(MessageBasedAppQueueManager):
    """Queue manager that can lend its real listener to ordinary segments.

    ``processing_segment`` installs one iterator that yields queue messages
    until a steering event arrives; ``listen`` then drains that iterator so
    ``EasyUIBasedGenerateTaskPipeline._process_stream_events`` sees only
    ordinary messages. Non-reentrant by design: a single consumer drives the
    stream and segments are installed strictly one at a time.
    """

    _segment: Iterator[MessageQueueMessage | WorkflowQueueMessage] | None = None

    @override
    def listen(self) -> Generator[MessageQueueMessage | WorkflowQueueMessage]:
        """Yield the active ordinary segment, or the real queue when unset."""
        if self._segment is not None:
            yield from self._segment
        else:
            yield from super().listen()

    def listen_agent_messages(self) -> Generator[MessageQueueMessage | WorkflowQueueMessage]:
        """Open the real underlying queue listener (watchdog + cleanup owned by the base class)."""
        yield from super().listen()

    @contextmanager
    def processing_segment(self, segment: Iterator[MessageQueueMessage | WorkflowQueueMessage]) -> Generator[None]:
        """Install ``segment`` as the source for ``listen`` for the block's duration."""
        self._segment = segment
        try:
            yield
        finally:
            self._segment = None


class _AgentAppTaskMetadata(TaskStateMetadata):
    """Task metadata extended with steering inputs persisted on the turn."""

    steering_inputs: list[AgentDeliveredInput]


class AgentAppTaskPipeline(EasyUIBasedGenerateTaskPipeline):
    """EasyUI pipeline for steerable roster Agent App runs.

    Behaviour identical to the shared pipeline except:
    - ``_process_stream_events`` emits ``agent_queue_ready`` and
      ``agent_input_delivered`` frames at the positions where those private
      events arrive in the queue.
    - ``_save_message`` preserves ``steering_inputs`` already persisted on the
      message (written under lock by the run recorder on delivery).
    """

    def __init__(
        self,
        application_generate_entity: AgentAppGenerateEntity,
        queue_manager: AgentAppQueueManager,
        conversation: Conversation,
        message: Message,
        stream: bool,
    ) -> None:
        super().__init__(
            application_generate_entity=application_generate_entity,
            queue_manager=queue_manager,
            conversation=conversation,
            message=message,
            stream=stream,
        )

    @property
    def _agent_queue_manager(self) -> AgentAppQueueManager:
        """Narrow ``queue_manager`` to the steering adapter this pipeline was built with."""
        queue_manager = self.queue_manager
        assert isinstance(queue_manager, AgentAppQueueManager)
        return queue_manager

    @override
    def _process_stream_events(self, publisher: AppGeneratorTTSPublisher | None) -> Generator[StreamResponse]:
        """Process ordinary events via the shared loop; emit steering frames between segments.

        A steering event ends the current ordinary segment without yielding a
        message to the shared dispatch; this generator then emits the matching
        typed frame and resumes with the next segment. Postcondition: every
        yielded frame's order matches queue order, and steering events never
        reach the shared ``match``.
        """
        queue_manager = self._agent_queue_manager
        with closing(queue_manager.listen_agent_messages()) as messages:
            next_event: SteeringQueueEvent | None = None

            def ordinary_segment() -> Generator[MessageQueueMessage | WorkflowQueueMessage]:
                nonlocal next_event
                for message in messages:
                    event = message.event
                    if isinstance(event, QueueAgentQueueReadyEvent | QueueAgentInputDeliveredEvent):
                        next_event = event
                        return
                    yield message

            while True:
                next_event = None
                with queue_manager.processing_segment(ordinary_segment()):
                    for response in super()._process_stream_events(publisher):
                        yield response
                        if isinstance(response, ErrorStreamResponse):
                            return
                if next_event is None:
                    return
                task_id = self._application_generate_entity.task_id
                if isinstance(next_event, QueueAgentInputDeliveredEvent):
                    yield AgentInputDeliveredStreamResponse(task_id=task_id, input=next_event.input)
                else:
                    yield AgentQueueReadyStreamResponse(task_id=task_id)

    @override
    def _save_message(self, *, session: Session, preserve_existing_usage: bool = False) -> Message:
        """Delegate to the shared save after merging persisted steering inputs into task metadata.

        The run recorder appends delivered inputs to ``steering_inputs`` on the
        message row under ``with_for_update``; the shared save replaces
        ``message_metadata`` wholesale, so they are re-attached here under the
        same lock. Invalid or missing stored input lists are tolerated and left
        absent — they can only mean no delivery persisted.
        """
        message = session.get(Message, self._message_id, with_for_update=True, populate_existing=True)
        if message is not None:
            try:
                existing_metadata = json.loads(message.message_metadata) if message.message_metadata else {}
            except (json.JSONDecodeError, TypeError):
                existing_metadata = {}
            if not isinstance(existing_metadata, dict):
                existing_metadata = {}
            steering_inputs: list[AgentDeliveredInput] = []
            stored = existing_metadata.get("steering_inputs")
            if isinstance(stored, list):
                try:
                    steering_inputs = TypeAdapter(list[AgentDeliveredInput]).validate_python(stored)
                except ValidationError:
                    steering_inputs = []
            self._task_state.metadata = _AgentAppTaskMetadata.model_validate(
                {**self._task_state.metadata.model_dump(mode="python"), "steering_inputs": steering_inputs}
            )
        return super()._save_message(session=session, preserve_existing_usage=preserve_existing_usage)
