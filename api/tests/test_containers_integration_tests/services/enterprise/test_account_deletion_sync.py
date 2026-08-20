"""Redis integration coverage for account deletion task queueing."""

import json
from uuid import uuid4

import pytest

from configs import dify_config
from enums import DeploymentEdition
from extensions.ext_redis import redis_client
from services.enterprise.account_deletion_sync import (
    ACCOUNT_DELETION_FROM_WORKSPACE_SYNC_TASK_TYPE,
    ACCOUNT_DELETION_SYNC_QUEUE,
    ACCOUNT_DELETION_SYNC_TASK_TYPE,
    sync_account_deletion,
)


def test_sync_account_deletion_queues_workspace_cleanup_before_global_finalizer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(dify_config, "DEPLOYMENT_EDITION", DeploymentEdition.ENTERPRISE)
    workspace_ids = [str(uuid4()), str(uuid4())]
    account_id = str(uuid4())

    result = sync_account_deletion(
        account_id=account_id,
        workspace_ids=workspace_ids,
        source="test_source",
    )

    assert result is True
    tasks = [json.loads(redis_client.rpop(ACCOUNT_DELETION_SYNC_QUEUE)) for _ in range(3)]
    assert [task.get("workspace_id") for task in tasks] == [*workspace_ids, None]
    assert [task["type"] for task in tasks] == [
        ACCOUNT_DELETION_FROM_WORKSPACE_SYNC_TASK_TYPE,
        ACCOUNT_DELETION_FROM_WORKSPACE_SYNC_TASK_TYPE,
        ACCOUNT_DELETION_SYNC_TASK_TYPE,
    ]
    assert all(task["member_id"] == account_id for task in tasks)
