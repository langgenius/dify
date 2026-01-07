from __future__ import annotations

import json
from collections.abc import Sequence
from typing import Any

from pydantic import BaseModel, ValidationError

from extensions.ext_redis import redis_client

_DEFAULT_TASK_TTL = 60 * 60  # 1 hour


class TaskWrapper(BaseModel):
    data: Any

    def serialize(self) -> str:
        return self.model_dump_json()

    @classmethod
    def deserialize(cls, serialized_data: str) -> TaskWrapper:
        return cls.model_validate_json(serialized_data)


class TenantIsolatedTaskQueue:
    """
    Simple queue for tenant isolated tasks, used for rag related tenant tasks isolation.
    It uses Redis list to store tasks, and Redis key to store task waiting flag.
    Support tasks that can be serialized by json.
    """

    def __init__(self, tenant_id: str, unique_key: str):
        self._tenant_id = tenant_id
        self._unique_key = unique_key
        self._queue = f"tenant_self_{unique_key}_task_queue:{tenant_id}"
        self._task_key = f"tenant_{unique_key}_task:{tenant_id}"

    def get_task_key(self):
        return redis_client.get(self._task_key)

    def set_task_waiting_time(self, ttl: int = _DEFAULT_TASK_TTL):
        redis_client.setex(self._task_key, ttl, 1)

    def delete_task_key(self):
        redis_client.delete(self._task_key)

    def push_tasks(self, tasks: Sequence[Any]):
        serialized_tasks = []
        for task in tasks:
            # Store str list directly, maintaining full compatibility for pipeline scenarios
            if isinstance(task, str):
                serialized_tasks.append(task)
            else:
                # Use TaskWrapper to do JSON serialization for non-string tasks
                wrapper = TaskWrapper(data=task)
                serialized_data = wrapper.serialize()
                serialized_tasks.append(serialized_data)

        if not serialized_tasks:
            return

        redis_client.lpush(self._queue, *serialized_tasks)

    def pull_tasks(self, count: int = 1) -> Sequence[Any]:
        if count <= 0:
            return []

        tasks = []
        for _ in range(count):
            serialized_task = redis_client.rpop(self._queue)
            if not serialized_task:
                break

            if isinstance(serialized_task, bytes):
                serialized_task = serialized_task.decode("utf-8")

            try:
                wrapper = TaskWrapper.deserialize(serialized_task)
                tasks.append(wrapper.data)
            except (json.JSONDecodeError, ValidationError, TypeError, ValueError):
                # Fall back to raw string for legacy format or invalid JSON
                tasks.append(serialized_task)

        return tasks
