from unittest.mock import Mock

import pytest
from pytest_mock import MockerFixture

from core.rag.pipeline.queue import TenantTaskDispatchClaimOutcome
from tasks.rag_pipeline.rag_pipeline_task_support import (
    RAG_PIPELINE_DISPATCH_TOKEN_HEADER,
    RagPipelineDispatchLease,
    build_rag_pipeline_dispatch_owner,
    resolve_rag_batch_tenant_isolation,
    resolve_rag_pipeline_dispatch_token,
)


def test_old_batch_without_isolation_metadata_defaults_to_isolated() -> None:
    assert resolve_rag_batch_tenant_isolation([{"pipeline_id": "pipeline-1"}]) is True


@pytest.mark.parametrize("tenant_isolated", [True, False])
def test_batch_uses_embedded_isolation_metadata(tenant_isolated: bool) -> None:
    assert resolve_rag_batch_tenant_isolation([{"tenant_isolated": tenant_isolated}]) is tenant_isolated


def test_batch_rejects_mixed_isolation_metadata() -> None:
    with pytest.raises(ValueError, match="inconsistent"):
        resolve_rag_batch_tenant_isolation([{"tenant_isolated": True}, {"tenant_isolated": False}])


def test_batch_rejects_non_boolean_isolation_metadata() -> None:
    with pytest.raises(ValueError, match="must be boolean"):
        resolve_rag_batch_tenant_isolation([{"tenant_isolated": "false"}])


def test_dispatch_lease_acquire_starts_only_for_the_claim_owner(mocker: MockerFixture) -> None:
    queue = Mock()
    queue.claim_dispatch.side_effect = [
        TenantTaskDispatchClaimOutcome.BUSY,
        TenantTaskDispatchClaimOutcome.DONE,
        TenantTaskDispatchClaimOutcome.ACQUIRED,
    ]
    mocker.patch(
        "tasks.rag_pipeline.rag_pipeline_task_support.TenantIsolatedTaskQueue",
        return_value=queue,
    )
    start = mocker.patch.object(RagPipelineDispatchLease, "start")

    busy = RagPipelineDispatchLease.acquire(tenant_id="tenant-1", dispatch_token="dispatch-1", owner="worker-1")
    done = RagPipelineDispatchLease.acquire(tenant_id="tenant-1", dispatch_token="dispatch-1", owner="worker-2")
    acquired = RagPipelineDispatchLease.acquire(
        tenant_id="tenant-1",
        dispatch_token="dispatch-1",
        owner="worker-3",
    )

    assert busy == (TenantTaskDispatchClaimOutcome.BUSY, None)
    assert done == (TenantTaskDispatchClaimOutcome.DONE, None)
    assert acquired[0] == TenantTaskDispatchClaimOutcome.ACQUIRED
    assert isinstance(acquired[1], RagPipelineDispatchLease)
    start.assert_called_once_with()


def test_dispatch_lease_completion_is_owner_fenced() -> None:
    queue = Mock()
    queue.complete_dispatch_claim.return_value = False
    lease = RagPipelineDispatchLease(
        queue=queue,
        dispatch_token="dispatch-1",
        owner="stale-worker",
    )

    with pytest.raises(RuntimeError, match="lease was lost"):
        lease.complete()

    queue.complete_dispatch_claim.assert_called_once()


def test_dispatch_owner_distinguishes_worker_processes(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("tasks.rag_pipeline.rag_pipeline_task_support.os.getpid", lambda: 42)

    assert build_rag_pipeline_dispatch_owner(task_id="celery-1", hostname="worker-a") == "worker-a:42:celery-1"


def test_dispatch_token_uses_rolling_safe_header_with_explicit_fallback_precedence() -> None:
    headers = {RAG_PIPELINE_DISPATCH_TOKEN_HEADER: "header-token"}

    assert resolve_rag_pipeline_dispatch_token(explicit_token=None, request_headers=headers) == "header-token"
    assert (
        resolve_rag_pipeline_dispatch_token(explicit_token="explicit-token", request_headers=headers)
        == "explicit-token"
    )
    assert resolve_rag_pipeline_dispatch_token(explicit_token=None, request_headers={}) is None
