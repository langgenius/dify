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
from services.knowledge_fs.product_dto import (
    KnowledgeFSInitialSourcePreviewPageResponse,
    KnowledgeFSInitialSourcePreviewResponse,
    KnowledgeFSInitialWebsiteSourcePreviewPayload,
)


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
    delete.assert_called_once_with(f"knowledge_fs:initial_source_preview:tenant-1:account-1:{job_id}")
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


def test_completed_preview_keeps_content_private_and_selectable() -> None:
    result = KnowledgeFSInitialSourcePreviewResponse(
        configurationFingerprint="a" * 64,
        kind="website_crawl",
        pages=[
            KnowledgeFSInitialSourcePreviewPageResponse(
                content="# Preview body",
                source_url="https://docs.dify.ai/page",
                title="Page",
            )
        ],
    )
    cache: dict[str, str] = {}
    objects: dict[str, bytes] = {}

    with (
        patch(
            "services.knowledge_fs.initial_source_preview_job.redis_client.setex",
            side_effect=lambda key, _ttl, value: cache.__setitem__(key, value),
        ),
        patch(
            "services.knowledge_fs.initial_source_preview_job.storage.save",
            side_effect=lambda key, value: objects.__setitem__(key, value),
        ),
    ):
        KnowledgeFSInitialSourcePreviewJobService.set_status(
            tenant_id="tenant-1", account_id="account-1", job_id="job-1", status="completed", result=result
        )
        KnowledgeFSInitialSourcePreviewJobService.store_content(
            tenant_id="tenant-1", account_id="account-1", job_id="job-1", result=result
        )

    public_value = cache["knowledge_fs:initial_source_preview:tenant-1:account-1:job-1"]
    assert "Preview body" not in public_value

    with (
        patch("services.knowledge_fs.initial_source_preview_job.redis_client.get", side_effect=cache.get),
        patch("services.knowledge_fs.initial_source_preview_job.storage.load_once", side_effect=objects.get),
    ):
        pages = KnowledgeFSInitialSourcePreviewJobService.selected_content(
            tenant_id="tenant-1",
            account_id="account-1",
            job_id="job-1",
            source_urls=["https://docs.dify.ai/page"],
            configuration_fingerprint="a" * 64,
        )

    assert [page.model_dump(mode="json", by_alias=True) for page in pages] == [
        {
            "content": "# Preview body",
            "description": None,
            "sourceUrl": "https://docs.dify.ai/page",
            "title": "Page",
        }
    ]


def test_cleanup_content_deletes_objects_and_manifest() -> None:
    manifest_key = "knowledge_fs:initial_source_preview:tenant-1:account-1:job-1:content"
    manifest = json.dumps(
        {
            "https://docs.dify.ai/page": {
                "objectKey": "knowledge_fs/initial_source_previews/tenant-1/account-1/job-1/page.md"
            }
        }
    )

    with (
        patch(
            "services.knowledge_fs.initial_source_preview_job.redis_client.get",
            return_value=manifest,
        ),
        patch("services.knowledge_fs.initial_source_preview_job.redis_client.delete") as delete_manifest,
        patch("services.knowledge_fs.initial_source_preview_job.storage.delete") as delete_object,
    ):
        KnowledgeFSInitialSourcePreviewJobService.cleanup_content(
            tenant_id="tenant-1", account_id="account-1", job_id="job-1"
        )

    delete_object.assert_called_once_with("knowledge_fs/initial_source_previews/tenant-1/account-1/job-1/page.md")
    delete_manifest.assert_called_once_with(manifest_key)


def test_cleanup_content_is_idempotent_after_manifest_expiry() -> None:
    with (
        patch("services.knowledge_fs.initial_source_preview_job.redis_client.get", return_value=None),
        patch("services.knowledge_fs.initial_source_preview_job.storage.delete") as delete_object,
    ):
        KnowledgeFSInitialSourcePreviewJobService.cleanup_content(
            tenant_id="tenant-1", account_id="account-1", job_id="job-1"
        )

    delete_object.assert_not_called()


def test_cleanup_content_keeps_manifest_when_object_delete_fails() -> None:
    manifest = json.dumps({"page": {"objectKey": "preview/page.md"}})

    with (
        patch("services.knowledge_fs.initial_source_preview_job.redis_client.get", return_value=manifest),
        patch("services.knowledge_fs.initial_source_preview_job.redis_client.delete") as delete_manifest,
        patch(
            "services.knowledge_fs.initial_source_preview_job.storage.delete",
            side_effect=RuntimeError("storage unavailable"),
        ),
        patch("services.knowledge_fs.initial_source_preview_job.logger.exception") as log_exception,
    ):
        KnowledgeFSInitialSourcePreviewJobService.cleanup_content(
            tenant_id="tenant-1", account_id="account-1", job_id="job-1"
        )

    delete_manifest.assert_not_called()
    log_exception.assert_called_once()


def test_store_content_removes_saved_objects_when_manifest_write_fails() -> None:
    result = KnowledgeFSInitialSourcePreviewResponse(
        kind="website_crawl",
        pages=[KnowledgeFSInitialSourcePreviewPageResponse(content="body", source_url="https://docs.dify.ai/page")],
    )

    with (
        patch("services.knowledge_fs.initial_source_preview_job.storage.save"),
        patch("services.knowledge_fs.initial_source_preview_job.storage.delete") as delete_object,
        patch(
            "services.knowledge_fs.initial_source_preview_job.redis_client.setex",
            side_effect=RuntimeError("redis unavailable"),
        ),
        pytest.raises(RuntimeError, match="redis unavailable"),
    ):
        KnowledgeFSInitialSourcePreviewJobService.store_content(
            tenant_id="tenant-1", account_id="account-1", job_id="job-1", result=result
        )

    delete_object.assert_called_once()
