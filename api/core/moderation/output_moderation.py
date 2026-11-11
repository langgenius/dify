import logging
import threading
import time
from collections.abc import Callable
from typing import Any

from flask import Flask, current_app
from pydantic import BaseModel, ConfigDict, Field, PrivateAttr

from configs import dify_config
from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.entities.queue_entities import QueueMessageReplaceEvent
from core.moderation.base import ModerationAction, ModerationOutputsResult
from core.moderation.factory import ModerationFactory

logger = logging.getLogger(__name__)


class ModerationRule(BaseModel):
    type: str
    config: dict[str, Any]


class OutputModeration(BaseModel):
    """Coordinate app output checks across the response consumer and moderation worker.

    Injected evaluation failures are terminal for this handler. Serialized checks
    prevent a final approval from racing past a failed background check.
    """

    tenant_id: str
    app_id: str

    rule: ModerationRule
    queue_manager: AppQueueManager

    thread: threading.Thread | None = None
    thread_running: bool = True
    buffer: str = ""
    is_final_chunk: bool = False
    final_output: str | None = None
    output_evaluator: Callable[[str], ModerationOutputsResult | None] | None = Field(
        default=None,
        exclude=True,
        repr=False,
        description="Injected app moderation use case; None preserves the legacy factory fallback",
    )
    model_config = ConfigDict(arbitrary_types_allowed=True)
    _evaluation_lock: threading.RLock = PrivateAttr(default_factory=threading.RLock)
    _error: Exception | None = PrivateAttr(default=None)

    @property
    def error(self) -> Exception | None:
        """Return the latched evaluation failure, or None before any failed check."""
        return self._error

    def should_direct_output(self) -> bool:
        return self.final_output is not None

    def get_final_output(self) -> str:
        return self.final_output or ""

    def append_new_token(self, token: str):
        self.buffer += token

        if not self.thread:
            self.thread = self.start_thread()

    def moderation_completion(self, completion: str, public_event: bool = False) -> tuple[str, bool]:
        self.buffer = completion
        self.is_final_chunk = True

        result = self.moderation(tenant_id=self.tenant_id, app_id=self.app_id, moderation_buffer=completion)

        if not result or not result.flagged:
            return completion, False

        final_output = result.preset_response if result.action == ModerationAction.DIRECT_OUTPUT else result.text

        if public_event:
            self.queue_manager.publish(
                QueueMessageReplaceEvent(
                    text=final_output, reason=QueueMessageReplaceEvent.MessageReplaceReason.OUTPUT_MODERATION
                ),
                PublishFrom.TASK_PIPELINE,
            )

        return final_output, True

    def start_thread(self) -> threading.Thread:
        buffer_size = dify_config.MODERATION_BUFFER_SIZE
        thread = threading.Thread(
            target=self.worker,
            kwargs={
                "flask_app": current_app._get_current_object(),  # type: ignore
                "buffer_size": buffer_size if buffer_size > 0 else dify_config.MODERATION_BUFFER_SIZE,
            },
        )

        thread.start()

        return thread

    def stop_thread(self):
        if self.thread and self.thread.is_alive():
            self.thread_running = False

    def worker(self, flask_app: Flask, buffer_size: int):
        """Check growing output until stopped; publish failed evaluation as a terminal queue error."""
        with flask_app.app_context():
            current_length = 0
            while self.thread_running:
                moderation_buffer = self.buffer
                buffer_length = len(moderation_buffer)
                if not self.is_final_chunk:
                    chunk_length = buffer_length - current_length
                    if 0 <= chunk_length < buffer_size:
                        time.sleep(1)
                        continue

                current_length = buffer_length

                try:
                    result = self.moderation(
                        tenant_id=self.tenant_id, app_id=self.app_id, moderation_buffer=moderation_buffer
                    )
                except Exception as error:
                    self.thread_running = False
                    self.queue_manager.publish_error(error, PublishFrom.TASK_PIPELINE)
                    return

                if not result or not result.flagged:
                    continue

                if result.action == ModerationAction.DIRECT_OUTPUT:
                    final_output = result.preset_response
                    self.final_output = final_output
                else:
                    final_output = result.text + self.buffer[len(moderation_buffer) :]

                # trigger replace event
                if self.thread_running:
                    self.queue_manager.publish(
                        QueueMessageReplaceEvent(
                            text=final_output, reason=QueueMessageReplaceEvent.MessageReplaceReason.OUTPUT_MODERATION
                        ),
                        PublishFrom.TASK_PIPELINE,
                    )

                if result.action == ModerationAction.DIRECT_OUTPUT:
                    break

    def moderation(self, tenant_id: str, app_id: str, moderation_buffer: str) -> ModerationOutputsResult | None:
        """Evaluate output with terminal failure retention; unbound legacy callers keep their existing fallback."""
        if self.output_evaluator is not None:
            with self._evaluation_lock:
                if self._error is not None:
                    raise self._error
                try:
                    return self.output_evaluator(moderation_buffer)
                except Exception as error:
                    self._error = error
                    raise
        try:
            moderation_factory = ModerationFactory(
                name=self.rule.type, app_id=app_id, tenant_id=tenant_id, config=self.rule.config
            )

            result: ModerationOutputsResult = moderation_factory.moderation_for_outputs(moderation_buffer)
            return result
        except Exception:
            logger.exception("Moderation Output error, app_id: %s", app_id)

        return None
