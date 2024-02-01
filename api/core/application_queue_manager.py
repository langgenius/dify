import queue
import time
from enum import Enum
from typing import Any, Generator

from core.entities.application_entities import InvokeFrom
from core.entities.queue_entities import (AnnotationReplyEvent, AppQueueEvent, QueueAgentMessageEvent,
                                          QueueAgentThoughtEvent, QueueErrorEvent, QueueMessage, QueueMessageEndEvent,
                                          QueueMessageEvent, QueueMessageFileEvent, QueueMessageReplaceEvent,
                                          QueuePingEvent, QueueRetrieverResourcesEvent, QueueStopEvent)
from core.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk
from extensions.ext_redis import redis_client
from models.model import MessageAgentThought, MessageFile
from sqlalchemy.orm import DeclarativeMeta


class PublishFrom(Enum):
    APPLICATION_MANAGER = 1
    TASK_PIPELINE = 2


class ApplicationQueueManager:
    def __init__(self, task_id: str,
                 user_id: str,
                 invoke_from: InvokeFrom,
                 conversation_id: str,
                 app_mode: str,
                 message_id: str) -> None:
        if not user_id:
            raise ValueError("user is required")

        self._task_id = task_id
        self._user_id = user_id
        self._invoke_from = invoke_from
        self._conversation_id = str(conversation_id)
        self._app_mode = app_mode
        self._message_id = str(message_id)

        user_prefix = 'account' if self._invoke_from in [InvokeFrom.EXPLORE, InvokeFrom.DEBUGGER] else 'end-user'
        redis_client.setex(ApplicationQueueManager._generate_task_belong_cache_key(self._task_id), 1800, f"{user_prefix}-{self._user_id}")

        q = queue.Queue()

        self._q = q

    def listen(self) -> Generator:
        """
        Listen to queue
        :return:
        """
        # wait for 10 minutes to stop listen
        listen_timeout = 600
        start_time = time.time()
        last_ping_time = 0

        while True:
            try:
                message = self._q.get(timeout=1)
                if message is None:
                    break

                yield message
            except queue.Empty:
                continue
            finally:
                elapsed_time = time.time() - start_time
                if elapsed_time >= listen_timeout or self._is_stopped():
                    # publish two messages to make sure the client can receive the stop signal
                    # and stop listening after the stop signal processed
                    self.publish(
                        QueueStopEvent(stopped_by=QueueStopEvent.StopBy.USER_MANUAL),
                        PublishFrom.TASK_PIPELINE
                    )
                    self.stop_listen()

                if elapsed_time // 10 > last_ping_time:
                    self.publish(QueuePingEvent(), PublishFrom.TASK_PIPELINE)
                    last_ping_time = elapsed_time // 10

    def stop_listen(self) -> None:
        """
        Stop listen to queue
        :return:
        """
        self._q.put(None)

    def publish_chunk_message(self, chunk: LLMResultChunk, pub_from: PublishFrom) -> None:
        """
        Publish chunk message to channel

        :param chunk: chunk
        :param pub_from: publish from
        :return:
        """
        self.publish(QueueMessageEvent(
            chunk=chunk
        ), pub_from)

    def publish_agent_chunk_message(self, chunk: LLMResultChunk, pub_from: PublishFrom) -> None:
        """
        Publish agent chunk message to channel

        :param chunk: chunk
        :param pub_from: publish from
        :return:
        """
        self.publish(QueueAgentMessageEvent(
            chunk=chunk
        ), pub_from)

    def publish_message_replace(self, text: str, pub_from: PublishFrom) -> None:
        """
        Publish message replace
        :param text: text
        :param pub_from: publish from
        :return:
        """
        self.publish(QueueMessageReplaceEvent(
            text=text
        ), pub_from)

    def publish_retriever_resources(self, retriever_resources: list[dict], pub_from: PublishFrom) -> None:
        """
        Publish retriever resources
        :return:
        """
        self.publish(QueueRetrieverResourcesEvent(retriever_resources=retriever_resources), pub_from)

    def publish_annotation_reply(self, message_annotation_id: str, pub_from: PublishFrom) -> None:
        """
        Publish annotation reply
        :param message_annotation_id: message annotation id
        :param pub_from: publish from
        :return:
        """
        self.publish(AnnotationReplyEvent(message_annotation_id=message_annotation_id), pub_from)

    def publish_message_end(self, llm_result: LLMResult, pub_from: PublishFrom) -> None:
        """
        Publish message end
        :param llm_result: llm result
        :param pub_from: publish from
        :return:
        """
        self.publish(QueueMessageEndEvent(llm_result=llm_result), pub_from)
        self.stop_listen()

    def publish_agent_thought(self, message_agent_thought: MessageAgentThought, pub_from: PublishFrom) -> None:
        """
        Publish agent thought
        :param message_agent_thought: message agent thought
        :param pub_from: publish from
        :return:
        """
        self.publish(QueueAgentThoughtEvent(
            agent_thought_id=message_agent_thought.id
        ), pub_from)

    def publish_message_file(self, message_file: MessageFile, pub_from: PublishFrom) -> None:
        """
        Publish agent thought
        :param message_file: message file
        :param pub_from: publish from
        :return:
        """
        self.publish(QueueMessageFileEvent(
            message_file_id=message_file.id
        ), pub_from)

    def publish_error(self, e, pub_from: PublishFrom) -> None:
        """
        Publish error
        :param e: error
        :param pub_from: publish from
        :return:
        """
        self.publish(QueueErrorEvent(
            error=e
        ), pub_from)
        self.stop_listen()

    def publish(self, event: AppQueueEvent, pub_from: PublishFrom) -> None:
        """
        Publish event to queue
        :param event:
        :param pub_from:
        :return:
        """
        self._check_for_sqlalchemy_models(event.dict())

        message = QueueMessage(
            task_id=self._task_id,
            message_id=self._message_id,
            conversation_id=self._conversation_id,
            app_mode=self._app_mode,
            event=event
        )

        self._q.put(message)

        if isinstance(event, QueueStopEvent):
            self.stop_listen()

        if pub_from == PublishFrom.APPLICATION_MANAGER and self._is_stopped():
            raise ConversationTaskStoppedException()

    @classmethod
    def set_stop_flag(cls, task_id: str, invoke_from: InvokeFrom, user_id: str) -> None:
        """
        Set task stop flag
        :return:
        """
        result = redis_client.get(cls._generate_task_belong_cache_key(task_id))
        if result is None:
            return

        user_prefix = 'account' if invoke_from in [InvokeFrom.EXPLORE, InvokeFrom.DEBUGGER] else 'end-user'
        if result.decode('utf-8') != f"{user_prefix}-{user_id}":
            return

        stopped_cache_key = cls._generate_stopped_cache_key(task_id)
        redis_client.setex(stopped_cache_key, 600, 1)

    def _is_stopped(self) -> bool:
        """
        Check if task is stopped
        :return:
        """
        stopped_cache_key = ApplicationQueueManager._generate_stopped_cache_key(self._task_id)
        result = redis_client.get(stopped_cache_key)
        if result is not None:
            return True

        return False

    @classmethod
    def _generate_task_belong_cache_key(cls, task_id: str) -> str:
        """
        Generate task belong cache key
        :param task_id: task id
        :return:
        """
        return f"generate_task_belong:{task_id}"

    @classmethod
    def _generate_stopped_cache_key(cls, task_id: str) -> str:
        """
        Generate stopped cache key
        :param task_id: task id
        :return:
        """
        return f"generate_task_stopped:{task_id}"

    def _check_for_sqlalchemy_models(self, data: Any):
        # from entity to dict or list
        if isinstance(data, dict):
            for key, value in data.items():
                self._check_for_sqlalchemy_models(value)
        elif isinstance(data, list):
            for item in data:
                self._check_for_sqlalchemy_models(item)
        else:
            if isinstance(data, DeclarativeMeta) or hasattr(data, '_sa_instance_state'):
                raise TypeError("Critical Error: Passing SQLAlchemy Model instances "
                                "that cause thread safety issues is not allowed.")


class ConversationTaskStoppedException(Exception):
    pass
