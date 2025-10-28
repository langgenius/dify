import json
from dataclasses import dataclass
from typing import Any, Generic, TypeVar

from extensions.ext_redis import redis_client

T = TypeVar('T')


TASK_WRAPPER_PREFIX = "__WRAPPER__:"


@dataclass
class TaskWrapper:
    data: Any
    
    def serialize(self) -> str:
        return json.dumps(self.data, ensure_ascii=False)
    
    @classmethod
    def deserialize(cls, serialized_data: str) -> 'TaskWrapper':
        data = json.loads(serialized_data)
        return cls(data)


class TenantSelfTaskQueue(Generic[T]):
    """
    Simple queue for tenant self tasks, used for tenant self task isolation.
    It uses Redis list to store tasks, and Redis key to store task waiting flag.
    Support tasks that can be serialized by json.
    """
    DEFAULT_TASK_TTL = 60 * 60

    def __init__(self, tenant_id: str, unique_key: str):
        self.tenant_id = tenant_id
        self.unique_key = unique_key
        self.queue = f"tenant_self_{unique_key}_task_queue:{tenant_id}"
        self.task_key = f"tenant_{unique_key}_task:{tenant_id}"

    def get_task_key(self):
        return redis_client.get(self.task_key)

    def set_task_waiting_time(self, ttl: int | None = None):
        ttl = ttl or self.DEFAULT_TASK_TTL
        redis_client.setex(self.task_key, ttl, 1)

    def delete_task_key(self):
        redis_client.delete(self.task_key)

    def push_tasks(self, tasks: list[T]):
        serialized_tasks = []
        for task in tasks:
            # Store str list directly, maintaining full compatibility for pipeline scenarios
            if isinstance(task, str):
                serialized_tasks.append(task)
            else:
                # Use TaskWrapper to do JSON serialization, add prefix for identification
                wrapper = TaskWrapper(task)
                serialized_data = wrapper.serialize()
                serialized_tasks.append(f"{TASK_WRAPPER_PREFIX}{serialized_data}")
        
        redis_client.lpush(self.queue, *serialized_tasks)
    
    def pull_tasks(self, count: int = 1) -> list[T]:
        if count <= 0:
            return []
        
        tasks = []
        for _ in range(count):
            serialized_task = redis_client.rpop(self.queue)
            if not serialized_task:
                break
            
            if isinstance(serialized_task, bytes):
                serialized_task = serialized_task.decode('utf-8')
            
            # Check if use TaskWrapper or not
            if serialized_task.startswith(TASK_WRAPPER_PREFIX):
                try:
                    wrapper_data = serialized_task[len(TASK_WRAPPER_PREFIX):]
                    wrapper = TaskWrapper.deserialize(wrapper_data)
                    tasks.append(wrapper.data)
                except (json.JSONDecodeError, TypeError, ValueError):
                    tasks.append(serialized_task)
            else:
                tasks.append(serialized_task)
        
        return tasks

    def get_next_task(self) -> T | None:
        tasks = self.pull_tasks(1)
        return tasks[0] if tasks else None
