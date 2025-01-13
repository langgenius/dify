import logging
import threading
import time
from typing import Any, Optional

from flask import Flask, current_app
from pydantic import BaseModel, ConfigDict

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
    tenant_id: str
    app_id: str

    rule: ModerationRule
    queue_manager: AppQueueManager

    thread: Optional[threading.Thread] = None
    thread_running: bool = True
    buffer: str = ""
    is_final_chunk: bool = False
    final_output: Optional[str] = None
    model_config = ConfigDict(arbitrary_types_allowed=True)

    def should_direct_output(self) -> bool:
        return self.final_output is not None

    def get_final_output(self) -> str:
        return self.final_output or ""

    def append_new_token(self, token: str) -> None:
        self.buffer += token

        if not self.thread:
            self.thread = self.start_thread()

    def moderation_completion(self, completion: str, public_event: bool = False) -> str:
        self.buffer = completion
        self.is_final_chunk = True

        result = self.moderation(tenant_id=self.tenant_id, app_id=self.app_id, moderation_buffer=completion)

        if not result or not result.flagged:
            return completion

        if result.action == ModerationAction.DIRECT_OUTPUT:
            final_output = result.preset_response
        else:
            final_output = result.text

        if public_event:
            self.queue_manager.publish(QueueMessageReplaceEvent(text=final_output), PublishFrom.TASK_PIPELINE)

        return final_output

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
                    self.queue_manager.publish(QueueMessageReplaceEvent(text=final_output), PublishFrom.TASK_PIPELINE)

                if result.action == ModerationAction.DIRECT_OUTPUT:
                    break

    def moderation(self, tenant_id: str, app_id: str, moderation_buffer: str) -> Optional[ModerationOutputsResult]:
        try:
            moderation_factory = ModerationFactory(
                name=self.rule.type, app_id=app_id, tenant_id=tenant_id, config=self.rule.config
            )

            result: ModerationOutputsResult = moderation_factory.moderation_for_outputs(moderation_buffer)
            return result
        except Exception as e:
            logger.exception(f"Moderation Output error, app_id: {app_id}")

        return None
