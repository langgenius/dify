import json
from types import SimpleNamespace
from typing import cast
from unittest.mock import MagicMock, patch

import pytest

from models.account import Account
from services.knowledge_fs.initial_source_preview_job import (
    KnowledgeFSInitialSourcePreviewJobAlreadyRunningError,
    KnowledgeFSInitialSourcePreviewJobNotFoundError,
    KnowledgeFSInitialSourcePreviewJobService,
)
from services.knowledge_fs.product_dto import KnowledgeFSInitialWebsiteSourcePreviewPayload


def _payload() -> KnowledgeFSInitialWebsiteSourcePreviewPayload:
    return KnowledgeFSInitialWebsiteSourcePreviewPayload.model_validate(
        {
            "credentialId": "credential-1",
            "datasource": "crawl",
            "kind": "website_crawl",
            "parameters": {"url": "https://docs.dify.ai"},
            "pluginId": "langgenius/firecrawl_datasource",
            "provider": "firecrawl",
        }
    )


def test_start_validates_binding_and_enqueues_preview_without_running_it_inline() -> None:
    service = KnowledgeFSInitialSourcePreviewJobService(MagicMock())
    account = cast(Account, SimpleNamespace(id="account-1"))

    with (
        patch(
            "services.knowledge_fs.initial_source_preview_job.KnowledgeFSInitialSourcePreviewService.require_visible_credential"
        ) as require_credential,
        patch("services.knowledge_fs.initial_source_preview_job.redis_client.set", return_value=True) as acquire,
        patch("services.knowledge_fs.initial_source_preview_job.redis_client.setex") as setex,
        patch(
            "tasks.knowledge_fs_initial_source_preview_tasks.run_knowledge_fs_initial_source_preview.apply_async"
        ) as apply_async,
    ):
        response = service.start(tenant_id="tenant-1", account=account, payload=_payload())

    require_credential.assert_called_once()
    acquire.assert_called_once_with(
        "knowledge_fs:initial_source_preview:tenant-1:account-1:active",
        response.job_id,
        ex=3600,
        nx=True,
    )
    setex.assert_called_once()
    assert '"status":"pending"' in setex.call_args.args[2]
    apply_async.assert_called_once_with(
        kwargs={
            "account_id": "account-1",
            "job_id": response.job_id,
            "payload": {
                "credentialId": "credential-1",
                "datasource": "crawl",
                "kind": "website_crawl",
                "parameters": {"url": "https://docs.dify.ai"},
                "pluginId": "langgenius/firecrawl_datasource",
                "provider": "firecrawl",
                "providerDisplayName": None,
            },
            "tenant_id": "tenant-1",
        },
        task_id=response.job_id,
    )


def test_start_rejects_a_second_active_preview_for_the_same_account() -> None:
    service = KnowledgeFSInitialSourcePreviewJobService(MagicMock())
    account = cast(Account, SimpleNamespace(id="account-1"))

    with (
        patch(
            "services.knowledge_fs.initial_source_preview_job.KnowledgeFSInitialSourcePreviewService.require_visible_credential"
        ),
        patch("services.knowledge_fs.initial_source_preview_job.redis_client.set", return_value=False),
        patch("services.knowledge_fs.initial_source_preview_job.redis_client.setex") as setex,
        pytest.raises(KnowledgeFSInitialSourcePreviewJobAlreadyRunningError),
    ):
        service.start(tenant_id="tenant-1", account=account, payload=_payload())

    setex.assert_not_called()


def test_start_releases_the_active_preview_slot_when_enqueue_fails() -> None:
    service = KnowledgeFSInitialSourcePreviewJobService(MagicMock())
    account = cast(Account, SimpleNamespace(id="account-1"))

    with (
        patch(
            "services.knowledge_fs.initial_source_preview_job.KnowledgeFSInitialSourcePreviewService.require_visible_credential"
        ),
        patch("services.knowledge_fs.initial_source_preview_job.redis_client.set", return_value=True),
        patch("services.knowledge_fs.initial_source_preview_job.redis_client.setex"),
        patch("services.knowledge_fs.initial_source_preview_job.redis_client.delete") as delete,
        patch("services.knowledge_fs.initial_source_preview_job.redis_client.eval", return_value=1) as redis_eval,
        patch(
            "tasks.knowledge_fs_initial_source_preview_tasks.run_knowledge_fs_initial_source_preview.apply_async",
            side_effect=RuntimeError("broker unavailable"),
        ),
        pytest.raises(RuntimeError, match="broker unavailable"),
    ):
        service.start(tenant_id="tenant-1", account=account, payload=_payload())

    job_id = redis_eval.call_args.args[3]
    delete.assert_called_once_with(
        f"knowledge_fs:initial_source_preview:tenant-1:account-1:{job_id}"
    )
    assert redis_eval.call_args.args[2:] == (
        "knowledge_fs:initial_source_preview:tenant-1:account-1:active",
        job_id,
    )


def test_cancel_is_scoped_to_the_requesting_tenant_and_account() -> None:
    cache: dict[str, str] = {}

    def setex(key: str, _ttl: int, value: str) -> None:
        cache[key] = value

    def transition(
        _script: str,
        _key_count: int,
        key: str,
        value: str,
        _ttl: int | None = None,
        *allowed_from: str,
    ) -> int:
        if _ttl is None:
            return 0
        current = cache.get(key)
        if current is None or json.loads(current)["status"] not in allowed_from:
            return 0
        cache[key] = value
        return 1

    with (
        patch("services.knowledge_fs.initial_source_preview_job.redis_client.get", side_effect=cache.get),
        patch("services.knowledge_fs.initial_source_preview_job.redis_client.setex", side_effect=setex),
        patch("services.knowledge_fs.initial_source_preview_job.redis_client.eval", side_effect=transition),
        patch("services.knowledge_fs.initial_source_preview_job.celery_app.control.revoke") as revoke,
    ):
        KnowledgeFSInitialSourcePreviewJobService.set_status(
            tenant_id="tenant-1",
            account_id="account-1",
            job_id="job-1",
            status="running",
        )
        response = KnowledgeFSInitialSourcePreviewJobService.cancel(
            tenant_id="tenant-1",
            account_id="account-1",
            job_id="job-1",
        )
        with pytest.raises(KnowledgeFSInitialSourcePreviewJobNotFoundError):
            KnowledgeFSInitialSourcePreviewJobService.get(
                tenant_id="tenant-1",
                account_id="account-2",
                job_id="job-1",
            )

    assert response.status == "canceled"
    revoke.assert_called_once_with("job-1", terminate=True, signal="SIGTERM")


def test_cancel_reissues_termination_for_an_already_canceled_job() -> None:
    canceled = json.dumps({"jobId": "job-1", "result": None, "status": "canceled"})

    with (
        patch("services.knowledge_fs.initial_source_preview_job.redis_client.get", return_value=canceled),
        patch("services.knowledge_fs.initial_source_preview_job.redis_client.eval") as redis_eval,
        patch("services.knowledge_fs.initial_source_preview_job.celery_app.control.revoke") as revoke,
    ):
        response = KnowledgeFSInitialSourcePreviewJobService.cancel(
            tenant_id="tenant-1",
            account_id="account-1",
            job_id="job-1",
        )

    assert response.status == "canceled"
    redis_eval.assert_called_once()
    revoke.assert_called_once_with("job-1", terminate=True, signal="SIGTERM")


def test_terminal_canceled_status_cannot_be_overwritten() -> None:
    with patch("services.knowledge_fs.initial_source_preview_job.redis_client.eval", return_value=0) as eval_status:
        transitioned = KnowledgeFSInitialSourcePreviewJobService.transition_status(
            tenant_id="tenant-1",
            account_id="account-1",
            job_id="job-1",
            status="completed",
            allowed_from=("running",),
            result=None,
        )

    assert transitioned is False
    assert '"status":"completed"' in eval_status.call_args.args[3]
    assert eval_status.call_args.args[5:] == ("running",)
