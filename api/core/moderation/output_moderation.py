import logging
import threading
import time
from typing import Any

from flask import Flask, current_app
from pydantic import BaseModel, ConfigDict, Field

from configs import dify_config
from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.entities.queue_entities import QueueMessageReplaceEvent
from core.app.entities.task_entities import (
    MessageReplaceStreamResponse,
    MessageStreamResponse,
    StreamResponse,
)
from core.moderation.base import ModerationAction, ModerationOutputsResult
from core.moderation.factory import ModerationFactory
from models.model import AppMode

logger = logging.getLogger(__name__)


class ModerationRule(BaseModel):
    type: str
    config: dict[str, Any]


class OutputModeration(BaseModel):
    tenant_id: str
    app_id: str

    rule: ModerationRule
    queue_manager: AppQueueManager

    thread: threading.Thread | None = None
    thread_running: bool = True
    buffer: str = ""
    is_final_chunk: bool = False
    final_output: str | None = None
    model_config = ConfigDict(arbitrary_types_allowed=True)
    app_mode: AppMode | None = None
    pending_responses: list[MessageStreamResponse] = Field(default_factory=list)
    released_text: str = ""
    has_received_text: bool = False

    @property
    def is_blocking(self) -> bool:
        """Opt in only for supported text apps with an enabled output rule and blocking setting."""
        return (
            dify_config.MODERATION_OUTPUT_MODE == "blocking"
            and self.app_mode in (AppMode.CHAT, AppMode.COMPLETION, AppMode.ADVANCED_CHAT)
            and bool(self.rule.config.get("outputs_config", {}).get("enabled"))
        )

    def moderate_stream(self, response: MessageStreamResponse) -> list[StreamResponse]:
        """Buffer one text event in blocking mode; release only after cumulative approval.

        Call on a single consumer thread before delivery. Direct output locks the answer;
        overrides replace the prefix and allow later chunks. Failures retain pending events
        for another review. No worker is started; released_text is safe to persist.
        """
        if self.final_output is not None or self.is_final_chunk:
            return []
        self.has_received_text = self.has_received_text or bool(response.answer)
        self.buffer += response.answer
        self.pending_responses.append(response)
        if len(self.buffer) - len(self.released_text) < dify_config.MODERATION_BUFFER_SIZE:
            return []
        return self._review_pending(response.task_id)

    def finish_blocking(self, response: MessageStreamResponse) -> list[StreamResponse]:
        """Review once more before the terminal event, including a short pending tail.

        The fallback supplies non-streamed answers only if no text was received or prefilled.
        Failed final review discards pending originals; released_text remains safe to persist.
        """
        if self.final_output is not None or self.is_final_chunk:
            return []
        if not self.has_received_text and not self.buffer and response.answer:
            self.buffer = response.answer
            self.pending_responses.append(response)
        self.is_final_chunk = True
        responses = self._review_pending(response.task_id)
        self.pending_responses.clear()
        return responses

    def _review_pending(self, task_id: str) -> list[StreamResponse]:
        """Audit the cumulative buffer; errors never approve or release pending events.

        A hit replaces visible text, including an empty replacement. Overrides seed the
        next cumulative review; direct output suppresses further originals. Earlier approved
        segments can still be invalidated by later context; this is not whole-answer secrecy.
        """
        result = self.moderation(tenant_id=self.tenant_id, app_id=self.app_id, moderation_buffer=self.buffer)
        if result is None:
            logger.warning("Blocking output moderation failed; withholding pending text, app_id: %s", self.app_id)
            return []
        if result.flagged:
            if result.action == ModerationAction.DIRECT_OUTPUT:
                self.final_output = result.preset_response
                self.released_text = result.preset_response
            else:
                self.buffer = result.text
                self.released_text = result.text
            self.pending_responses.clear()
            return [
                MessageReplaceStreamResponse(
                    task_id=task_id,
                    answer=self.released_text,
                    reason=QueueMessageReplaceEvent.MessageReplaceReason.OUTPUT_MODERATION,
                )
            ]
        responses: list[StreamResponse] = list(self.pending_responses)
        self.pending_responses.clear()
        self.released_text = self.buffer
        return responses

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

                result = self.moderation(
                    tenant_id=self.tenant_id, app_id=self.app_id, moderation_buffer=moderation_buffer
                )

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
        try:
            moderation_factory = ModerationFactory(
                name=self.rule.type, app_id=app_id, tenant_id=tenant_id, config=self.rule.config
            )

            result: ModerationOutputsResult = moderation_factory.moderation_for_outputs(moderation_buffer)
            return result
        except Exception:
            logger.exception("Moderation Output error, app_id: %s", app_id)

        return None
