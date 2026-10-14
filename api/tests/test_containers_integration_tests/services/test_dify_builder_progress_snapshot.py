"""Real Redis coverage for progress snapshot revision and activated-lease fences."""

from dataclasses import replace
from uuid import uuid4

import pytest

from core.dify_builder.contract import ExecutionActivity, ExecutionProgress
from services.dify_builder import progress_snapshot, session_lock


def _snapshot(session_id: str) -> progress_snapshot.ProgressSnapshot:
    return progress_snapshot.ProgressSnapshot(
        session_id=session_id,
        operation_id="operation-1",
        at_version=2,
        revision=4,
        reply_language="zh-Hans",
        execution=ExecutionProgress(
            status="running",
            activities=[ExecutionActivity(id="plan", label="Generate plan", state="active")],
        ),
    )


@pytest.mark.usefixtures("flask_app_with_containers")
def test_out_of_order_snapshot_writes_cannot_regress_revision_or_durable_version():
    session_id, tenant_id = str(uuid4()), str(uuid4())
    token = session_lock.acquire(session_id)
    assert token is not None
    owner = session_lock.activate(session_id, token)
    assert owner is not None
    original = _snapshot(session_id)
    try:
        progress_snapshot.save(original, tenant_id=tenant_id, owner=owner)
        progress_snapshot.save(replace(original, revision=2), tenant_id=tenant_id, owner=owner)
        assert progress_snapshot.read(tenant_id=tenant_id, session_id=session_id) == original

        following = replace(original, operation_id="operation-2", at_version=3, revision=1)
        progress_snapshot.save(following, tenant_id=tenant_id, owner=owner)
        progress_snapshot.save(replace(original, revision=50), tenant_id=tenant_id, owner=owner)
        assert progress_snapshot.read(tenant_id=tenant_id, session_id=session_id) == following
    finally:
        session_lock.release(session_id, owner)


@pytest.mark.usefixtures("flask_app_with_containers")
def test_replacement_worker_does_not_restore_or_accept_previous_workers_progress():
    session_id, tenant_id = str(uuid4()), str(uuid4())
    token = session_lock.acquire(session_id)
    assert token is not None
    old_owner = session_lock.activate(session_id, token)
    assert old_owner is not None
    snapshot = _snapshot(session_id)
    progress_snapshot.save(snapshot, tenant_id=tenant_id, owner=old_owner)
    session_lock.release(session_id, old_owner)
    assert progress_snapshot.read(tenant_id=tenant_id, session_id=session_id) is None

    token = session_lock.acquire(session_id)
    assert token is not None
    owner = session_lock.activate(session_id, token)
    assert owner is not None
    try:
        assert progress_snapshot.read(tenant_id=tenant_id, session_id=session_id) is None
        progress_snapshot.save(snapshot, tenant_id=tenant_id, owner=owner)
        progress_snapshot.save(replace(snapshot, revision=50), tenant_id=tenant_id, owner=old_owner)
        assert progress_snapshot.read(tenant_id=tenant_id, session_id=session_id) == snapshot
        assert progress_snapshot.read(tenant_id=str(uuid4()), session_id=session_id) is None
    finally:
        session_lock.release(session_id, owner)
