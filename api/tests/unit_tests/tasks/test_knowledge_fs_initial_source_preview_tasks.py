from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Never
from unittest.mock import patch

from sqlalchemy import inspect

from core.db.session_factory import session_factory
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole
from services.knowledge_fs.initial_source_preview import KnowledgeFSInitialSourcePreviewCanceledError
from services.knowledge_fs.product_dto import (
    KnowledgeFSInitialSourcePreviewJobResponse,
    KnowledgeFSInitialSourcePreviewResponse,
)
from tasks.knowledge_fs_initial_source_preview_tasks import run_knowledge_fs_initial_source_preview
from tests.unit_tests.tasks.task_options import task_options

_JOB_KEY = {"tenant_id": "tenant-1", "account_id": "account-1", "job_id": "job-1"}


@dataclass
class _PreviewJobService:
    """Records preview job transitions; ``transition_results`` are consumed in order."""

    transition_results: list[bool]
    job_status: str = "running"
    transitions: list[dict[str, object]] = field(default_factory=list)
    stored: list[dict[str, object]] = field(default_factory=list)
    released: list[dict[str, str]] = field(default_factory=list)
    lookups: list[dict[str, str]] = field(default_factory=list)

    def transition_status(self, **kwargs: object) -> bool:
        self.transitions.append(kwargs)
        return self.transition_results.pop(0)

    def store_content(self, **kwargs: object) -> None:
        self.stored.append(kwargs)

    def release_active_job(self, *, tenant_id: str, account_id: str, job_id: str) -> None:
        self.released.append({"tenant_id": tenant_id, "account_id": account_id, "job_id": job_id})

    def get(self, *, tenant_id: str, account_id: str, job_id: str) -> KnowledgeFSInitialSourcePreviewJobResponse:
        self.lookups.append({"tenant_id": tenant_id, "account_id": account_id, "job_id": job_id})
        return KnowledgeFSInitialSourcePreviewJobResponse.model_construct(status=self.job_status)


@dataclass
class _PreviewService:
    run: Callable[..., KnowledgeFSInitialSourcePreviewResponse]
    calls: list[dict[str, object]] = field(default_factory=list)

    def preview(self, **kwargs: object) -> KnowledgeFSInitialSourcePreviewResponse:
        self.calls.append(kwargs)
        return self.run(**kwargs)


def _payload() -> dict[str, object]:
    return {
        "credentialId": "credential-1",
        "datasource": "crawl",
        "kind": "website_crawl",
        "parameters": {"url": "https://docs.dify.ai"},
        "pluginId": "langgenius/firecrawl_datasource",
        "provider": "firecrawl",
    }


def _seed_account(*, member: bool) -> None:
    tenant = Tenant(name="Preview tenant")
    tenant.id = "tenant-1"
    account = Account(name="Preview user", email="preview-user@example.com", status=AccountStatus.ACTIVE)
    account.id = "account-1"
    with session_factory.create_session() as session:
        session.add_all([tenant, account])
        if member:
            session.add(
                TenantAccountJoin(
                    tenant_id=tenant.id,
                    account_id=account.id,
                    current=True,
                    role=TenantAccountRole.OWNER,
                )
            )
        session.commit()


def _run_preview(job_service: _PreviewJobService, preview_service: _PreviewService | None) -> list[dict[str, object]]:
    """Run the task and return the cleanup schedules it requested."""
    scheduled_cleanups: list[dict[str, object]] = []
    with (
        patch(
            "tasks.knowledge_fs_initial_source_preview_tasks.KnowledgeFSInitialSourcePreviewJobService",
            return_value=job_service,
        ),
        patch(
            "tasks.knowledge_fs_initial_source_preview_tasks.KnowledgeFSInitialSourcePreviewService",
            return_value=preview_service,
        ) as preview_service_type,
        patch(
            "tasks.knowledge_fs_initial_source_preview_tasks.cleanup_knowledge_fs_initial_source_preview.apply_async",
            side_effect=lambda **kwargs: scheduled_cleanups.append(kwargs),
        ),
    ):
        run_knowledge_fs_initial_source_preview.run(
            tenant_id="tenant-1",
            account_id="account-1",
            job_id="job-1",
            payload=_payload(),
        )
    if preview_service is None:
        preview_service_type.assert_not_called()
    return scheduled_cleanups


def test_preview_task_uses_the_dataset_queue() -> None:
    assert task_options(run_knowledge_fs_initial_source_preview)["queue"] == "dataset"


def test_preview_task_persists_running_and_completed_states() -> None:
    _seed_account(member=True)
    job_service = _PreviewJobService(transition_results=[True, True])
    result = KnowledgeFSInitialSourcePreviewResponse(kind="website_crawl")
    preview_service = _PreviewService(run=lambda **_: result)

    scheduled_cleanups = _run_preview(job_service, preview_service)

    assert job_service.transitions == [
        {**_JOB_KEY, "status": "running", "allowed_from": ("pending",)},
        {**_JOB_KEY, "status": "completed", "allowed_from": ("running",), "result": result},
    ]
    assert job_service.stored == [{**_JOB_KEY, "result": result}]
    assert scheduled_cleanups == [
        {"kwargs": {"account_id": "account-1", "job_id": "job-1", "tenant_id": "tenant-1"}, "countdown": 3600}
    ]
    assert job_service.released == [_JOB_KEY]
    assert len(preview_service.calls) == 1
    account = preview_service.calls[0]["account"]
    assert isinstance(account, Account)
    assert account.id == "account-1"
    # The tenant was selected through the task's session before the account was detached from it.
    assert account.current_tenant_id == "tenant-1"
    assert inspect(account).detached


def test_preview_task_does_not_start_a_canceled_job() -> None:
    job_service = _PreviewJobService(transition_results=[False])

    _run_preview(job_service, preview_service=None)

    assert job_service.transitions == [{**_JOB_KEY, "status": "running", "allowed_from": ("pending",)}]
    assert job_service.released == [_JOB_KEY]


def test_preview_task_keeps_a_cooperatively_canceled_job_terminal() -> None:
    _seed_account(member=True)
    job_service = _PreviewJobService(transition_results=[True], job_status="canceled")

    def preview(**kwargs: object) -> Never:
        is_canceled = kwargs["is_canceled"]
        assert callable(is_canceled)
        assert is_canceled() is True
        raise KnowledgeFSInitialSourcePreviewCanceledError("canceled")

    preview_service = _PreviewService(run=preview)

    _run_preview(job_service, preview_service)

    assert job_service.transitions == [{**_JOB_KEY, "status": "running", "allowed_from": ("pending",)}]
    assert len(preview_service.calls) == 1
    assert job_service.lookups == [_JOB_KEY]


def test_preview_task_rejects_an_account_removed_from_the_tenant() -> None:
    _seed_account(member=False)
    job_service = _PreviewJobService(transition_results=[True, True])

    _run_preview(job_service, preview_service=None)

    assert job_service.transitions[-1] == {
        **_JOB_KEY,
        "status": "failed",
        "allowed_from": ("pending", "running"),
    }
