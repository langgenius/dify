"""Redis integration coverage for account deletion task queueing."""

import json
from uuid import uuid4

from extensions.ext_redis import redis_client
from services.enterprise.account_deletion_sync import _queue_task


def test_queue_task_success() -> None:
    workspace_id = str(uuid4())
    member_id = str(uuid4())

    result = _queue_task(workspace_id=workspace_id, member_id=member_id, source="test_source")

    assert result is True
    raw = redis_client.rpop("enterprise:member:sync:queue")
    assert raw is not None
    task_data = json.loads(raw)
    assert task_data["workspace_id"] == workspace_id
    assert task_data["member_id"] == member_id
    assert task_data["source"] == "test_source"
    assert task_data["type"] == "sync_member_deletion_from_workspace"
    assert task_data["retry_count"] == 0
    assert "task_id" in task_data
    assert "created_at" in task_data
