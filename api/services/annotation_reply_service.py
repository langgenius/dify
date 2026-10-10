"""Admit annotation reply jobs before accessing their cache or publishing tasks."""

from dataclasses import dataclass
from typing import Literal, Protocol
from uuid import uuid4

from services.annotation_query import AnnotationAppQuery

type AnnotationReplyAction = Literal["enable", "disable"]


class AnnotationReplyJobNotFoundError(Exception):
    """The job is absent or does not belong to the requested tenant, app and action."""


@dataclass(frozen=True, slots=True)
class AnnotationReplyJob:
    job_id: str
    job_status: str
    error_msg: str = ""


class AnnotationReplyJobStore(Protocol):
    def get_processing(self, *, tenant_id: str, app_id: str, action: AnnotationReplyAction) -> str | None:
        """Return an owned processing job ID, or None when no such job is cached."""
        ...

    def create(self, *, tenant_id: str, app_id: str, action: AnnotationReplyAction, job_id: str) -> None: ...

    def get(
        self, *, tenant_id: str, app_id: str, action: AnnotationReplyAction, job_id: str
    ) -> AnnotationReplyJob | None:
        """Return an owned job's state; missing or unverifiable jobs return None."""
        ...


class EnableAnnotationReplyTask(Protocol):
    def __call__(
        self,
        *,
        job_id: str,
        app_id: str,
        user_id: str,
        tenant_id: str,
        score_threshold: float,
        embedding_provider_name: str,
        embedding_model_name: str,
    ) -> object: ...


class DisableAnnotationReplyTask(Protocol):
    def __call__(self, *, job_id: str, app_id: str, tenant_id: str) -> object: ...


class AnnotationReplyService:
    def __init__(
        self,
        *,
        apps: AnnotationAppQuery,
        jobs: AnnotationReplyJobStore,
        enable_task: EnableAnnotationReplyTask,
        disable_task: DisableAnnotationReplyTask,
    ) -> None:
        self._apps = apps
        self._jobs = jobs
        self._enable_task = enable_task
        self._disable_task = disable_task

    def enable(
        self,
        *,
        tenant_id: str,
        app_id: str,
        account_id: str,
        score_threshold: float,
        embedding_provider_name: str,
        embedding_model_name: str,
    ) -> AnnotationReplyJob:
        self._apps.require_app(tenant_id=tenant_id, app_id=app_id)
        pending = self._jobs.get_processing(tenant_id=tenant_id, app_id=app_id, action="enable")
        if pending is not None:
            return AnnotationReplyJob(job_id=pending, job_status="processing")
        job_id = str(uuid4())
        self._jobs.create(tenant_id=tenant_id, app_id=app_id, action="enable", job_id=job_id)
        self._enable_task(
            job_id=job_id,
            app_id=app_id,
            user_id=account_id,
            tenant_id=tenant_id,
            score_threshold=score_threshold,
            embedding_provider_name=embedding_provider_name,
            embedding_model_name=embedding_model_name,
        )
        return AnnotationReplyJob(job_id=job_id, job_status="waiting")

    def disable(self, *, tenant_id: str, app_id: str) -> AnnotationReplyJob:
        self._apps.require_app(tenant_id=tenant_id, app_id=app_id)
        pending = self._jobs.get_processing(tenant_id=tenant_id, app_id=app_id, action="disable")
        if pending is not None:
            return AnnotationReplyJob(job_id=pending, job_status="processing")
        job_id = str(uuid4())
        self._jobs.create(tenant_id=tenant_id, app_id=app_id, action="disable", job_id=job_id)
        self._disable_task(job_id=job_id, app_id=app_id, tenant_id=tenant_id)
        return AnnotationReplyJob(job_id=job_id, job_status="waiting")

    def get_status(
        self, *, tenant_id: str, app_id: str, action: AnnotationReplyAction, job_id: str
    ) -> AnnotationReplyJob:
        self._apps.require_app(tenant_id=tenant_id, app_id=app_id)
        job = self._jobs.get(tenant_id=tenant_id, app_id=app_id, action=action, job_id=job_id)
        if job is None:
            raise AnnotationReplyJobNotFoundError(f"Annotation reply job {job_id} is unavailable for app {app_id}")
        return job
