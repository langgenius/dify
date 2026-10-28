"""Authorize Web message cancellation by current conversation ownership."""

from uuid import UUID

from sqlalchemy.orm import sessionmaker

from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.entities.app_invoke_entities import InvokeFrom
from extensions.ext_redis import RedisClientWrapper
from repositories.conversation_access import may_stop_legacy_web_task, web_task_original_sender


def index_web_message_task(task_id: str, message_id: str, user_id: str, *, redis: RedisClientWrapper) -> None:
    redis.setex(f"generate_task_belong:{task_id}", 1800, f"end-user-{user_id}|{message_id}")


def stop_web_message_task(
    *,
    tenant_id: str,
    app_id: str,
    task_id: str,
    end_user_id: str,
    session_factory: sessionmaker,
    redis: RedisClientWrapper,
) -> bool:
    value = redis.get(f"generate_task_belong:{task_id}")
    if not value:
        return False
    parts = value.decode().split("|", 1)
    if len(parts) != 2:
        if parts[0] != f"end-user-{end_user_id}":
            return False
        with session_factory() as session:
            if not may_stop_legacy_web_task(session, tenant_id=tenant_id, app_id=app_id, end_user_id=end_user_id):
                return False
        return AppQueueManager.set_stop_flag(task_id, InvokeFrom.WEB_APP, end_user_id, redis=redis)
    try:
        message_id = str(UUID(parts[1]))
    except ValueError:
        return False
    with session_factory() as session:
        original_sender = web_task_original_sender(
            session, tenant_id=tenant_id, app_id=app_id, end_user_id=end_user_id, message_id=message_id
        )
    if original_sender is None:
        return False
    return AppQueueManager.set_stop_flag(task_id, InvokeFrom.WEB_APP, original_sender, redis=redis)
