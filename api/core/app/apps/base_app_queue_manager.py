import logging
import queue
import threading
import time
from abc import abstractmethod
from enum import IntEnum, auto
from typing import Any

from cachetools import TTLCache, cachedmethod
from redis.exceptions import RedisError
from sqlalchemy.orm import DeclarativeMeta

from configs import dify_config
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.entities.queue_entities import (
    AppQueueEvent,
    MessageQueueMessage,
    QueueErrorEvent,
    QueuePingEvent,
    QueueStopEvent,
    WorkflowQueueMessage,
)
from core.workflow.runtime import GraphRuntimeState
from extensions.ext_redis import redis_client

logger = logging.getLogger(__name__)


class PublishFrom(IntEnum):
    APPLICATION_MANAGER = auto()
    TASK_PIPELINE = auto()


class AppQueueManager:
    def __init__(self, task_id: str, user_id: str, invoke_from: InvokeFrom):
        if not user_id:
            raise ValueError("user is required")

        self._task_id = task_id
        self._user_id = user_id
        self._invoke_from = invoke_from
        self.invoke_from = invoke_from  # Public accessor for invoke_from

        user_prefix = "account" if self._invoke_from in {InvokeFrom.EXPLORE, InvokeFrom.DEBUGGER} else "end-user"
        self._task_belong_cache_key = AppQueueManager._generate_task_belong_cache_key(self._task_id)
        redis_client.setex(self._task_belong_cache_key, 1800, f"{user_prefix}-{self._user_id}")

        q: queue.Queue[WorkflowQueueMessage | MessageQueueMessage | None] = queue.Queue()

        self._q = q
        self._graph_runtime_state: GraphRuntimeState | None = None
        self._stopped_cache: TTLCache[tuple, bool] = TTLCache(maxsize=1, ttl=1)
        self._cache_lock = threading.Lock()

    def listen(self):
        """
        Listen to queue
        :return:
        """
        # wait for APP_MAX_EXECUTION_TIME seconds to stop listen
        listen_timeout = dify_config.APP_MAX_EXECUTION_TIME
        start_time = time.time()
        last_ping_time: int | float = 0
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
                        QueueStopEvent(stopped_by=QueueStopEvent.StopBy.USER_MANUAL), PublishFrom.TASK_PIPELINE
                    )

                if elapsed_time // 10 > last_ping_time:
                    self.publish(QueuePingEvent(), PublishFrom.TASK_PIPELINE)
                    last_ping_time = elapsed_time // 10

    def stop_listen(self):
        """
        Stop listen to queue
        :return:
        """
        self._clear_task_belong_cache()
        self._q.put(None)
        self._graph_runtime_state = None  # Release reference to allow GC to reclaim memory

    def _clear_task_belong_cache(self) -> None:
        """
        Remove the task belong cache key once listening is finished.
        """
        try:
            redis_client.delete(self._task_belong_cache_key)
        except RedisError:
            logger.exception(
                "Failed to clear task belong cache for task %s (key: %s)", self._task_id, self._task_belong_cache_key
            )

    def publish_error(self, e, pub_from: PublishFrom) -> None:
        """
        Publish error
        :param e: error
        :param pub_from: publish from
        :return:
        """
        self.publish(QueueErrorEvent(error=e), pub_from)

    @property
    def graph_runtime_state(self) -> GraphRuntimeState | None:
        """Retrieve the attached graph runtime state, if available."""
        return self._graph_runtime_state

    @graph_runtime_state.setter
    def graph_runtime_state(self, graph_runtime_state: GraphRuntimeState | None) -> None:
        """Attach the live graph runtime state reference for downstream consumers."""
        self._graph_runtime_state = graph_runtime_state

    def publish(self, event: AppQueueEvent, pub_from: PublishFrom):
        """
        Publish event to queue
        :param event:
        :param pub_from:
        :return:
        """
        self._check_for_sqlalchemy_models(event.model_dump())
        self._publish(event, pub_from)

    @abstractmethod
    def _publish(self, event: AppQueueEvent, pub_from: PublishFrom):
        """
        Publish event to queue
        :param event:
        :param pub_from:
        :return:
        """
        raise NotImplementedError

    @classmethod
    def set_stop_flag(cls, task_id: str, invoke_from: InvokeFrom, user_id: str):
        """
        Set task stop flag
        :return:
        """
        result: Any | None = redis_client.get(cls._generate_task_belong_cache_key(task_id))
        if result is None:
            return

        user_prefix = "account" if invoke_from in {InvokeFrom.EXPLORE, InvokeFrom.DEBUGGER} else "end-user"
        if result.decode("utf-8") != f"{user_prefix}-{user_id}":
            return

        stopped_cache_key = cls._generate_stopped_cache_key(task_id)
        redis_client.setex(stopped_cache_key, 600, 1)

    @classmethod
    def set_stop_flag_no_user_check(cls, task_id: str) -> None:
        """
        Set task stop flag without user permission check.
        This method allows stopping workflows without user context.

        :param task_id: The task ID to stop
        :return:
        """
        if not task_id:
            return

        stopped_cache_key = cls._generate_stopped_cache_key(task_id)
        redis_client.setex(stopped_cache_key, 600, 1)

    @cachedmethod(lambda self: self._stopped_cache, lock=lambda self: self._cache_lock)
    def _is_stopped(self) -> bool:
        """
        Check if task is stopped
        :return:
        """
        stopped_cache_key = AppQueueManager._generate_stopped_cache_key(self._task_id)
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
            for value in data.values():
                self._check_for_sqlalchemy_models(value)
        elif isinstance(data, list):
            for item in data:
                self._check_for_sqlalchemy_models(item)
        else:
            if isinstance(data, DeclarativeMeta) or hasattr(data, "_sa_instance_state"):
                raise TypeError(
                    "Critical Error: Passing SQLAlchemy Model instances that cause thread safety issues is not allowed."
                )
