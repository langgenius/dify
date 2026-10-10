"""Manage annotation reply job admission, execution and status."""

import logging
from dataclasses import dataclass
from typing import Literal, Protocol
from uuid import uuid4

from services.annotation_query import AnnotationAppQuery

logger = logging.getLogger(__name__)

type AnnotationReplyAction = Literal["enable", "disable"]


class AnnotationReplyJobNotFoundError(Exception):
    """The job is absent or does not belong to the requested tenant, app and action."""


@dataclass(frozen=True, slots=True)
class AnnotationReplyJob:
    job_id: str
    job_status: str
    error_msg: str = ""


class AnnotationReplyChangedError(Exception):
    """The setting or index binding was replaced while this job was indexing."""


@dataclass(frozen=True, slots=True)
class AnnotationIndexBinding:
    id: str
    provider_name: str
    model_name: str
    collection_name: str


@dataclass(frozen=True, slots=True)
class AnnotationReplyRevision:
    """Index identity only: threshold edits do not invalidate an in-flight index operation."""

    id: str
    collection_binding_id: str


@dataclass(frozen=True, slots=True)
class AnnotationIndexEntry:
    id: str
    question: str


@dataclass(frozen=True, slots=True)
class AnnotationReplyEnablePlan:
    tenant_id: str
    app_id: str
    # None means reply was disabled when the job loaded its input.
    revision: AnnotationReplyRevision | None
    binding: AnnotationIndexBinding
    binding_is_new: bool
    # None means there is no previous index to clean up.
    previous_binding: AnnotationIndexBinding | None
    annotations: tuple[AnnotationIndexEntry, ...]


@dataclass(frozen=True, slots=True)
class AnnotationReplyDisablePlan:
    tenant_id: str
    app_id: str
    revision: AnnotationReplyRevision
    # A missing historical binding must not prevent disabling reply.
    binding: AnnotationIndexBinding | None
    has_annotations: bool


class AnnotationReplyStore(AnnotationAppQuery, Protocol):
    def prepare_enable_reply(
        self, *, tenant_id: str, app_id: str, provider_name: str, model_name: str
    ) -> AnnotationReplyEnablePlan:
        """Read detached inputs, allocating an unsaved binding if the model has none."""
        ...

    def complete_enable_reply(
        self, *, plan: AnnotationReplyEnablePlan, account_id: str, score_threshold: float
    ) -> None:
        """Commit settings and any new binding only after indexing succeeds; reject stale inputs."""
        ...

    def prepare_disable_reply(self, *, tenant_id: str, app_id: str) -> AnnotationReplyDisablePlan | None:
        """Return None if reply is already disabled; still verify the app's owner and status."""
        ...

    def complete_disable_reply(self, *, plan: AnnotationReplyDisablePlan) -> None:
        """Delete only the unchanged setting read by this job."""
        ...


class AnnotationReplyIndex(Protocol):
    def rebuild(
        self, *, tenant_id: str, app_id: str, binding: AnnotationIndexBinding, entries: tuple[AnnotationIndexEntry, ...]
    ) -> None: ...

    def delete(self, *, tenant_id: str, app_id: str, binding: AnnotationIndexBinding | None) -> None:
        """None denotes a missing historical binding; app-local indexes can still be cleaned up."""
        ...


class AnnotationReplyJobStore(Protocol):
    def get_processing(self, *, tenant_id: str, app_id: str, action: AnnotationReplyAction) -> str | None:
        """Return an owned processing job ID, or None when no such job is cached."""
        ...

    def create(self, *, tenant_id: str, app_id: str, action: AnnotationReplyAction, job_id: str) -> None: ...

    def finish(
        self, *, tenant_id: str, app_id: str, action: AnnotationReplyAction, job_id: str, error: str | None
    ) -> None:
        """Record completion when error is None; otherwise retain the failure message."""
        ...

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
        annotations: AnnotationReplyStore,
        index: AnnotationReplyIndex,
        jobs: AnnotationReplyJobStore,
        enable_task: EnableAnnotationReplyTask,
        disable_task: DisableAnnotationReplyTask,
    ) -> None:
        self._annotations = annotations
        self._index = index
        self._jobs = jobs
        self._enable_task = enable_task
        self._disable_task = disable_task

    def request_enable(
        self,
        *,
        tenant_id: str,
        app_id: str,
        account_id: str,
        score_threshold: float,
        embedding_provider_name: str,
        embedding_model_name: str,
    ) -> AnnotationReplyJob:
        self._annotations.require_app(tenant_id=tenant_id, app_id=app_id)
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

    def request_disable(self, *, tenant_id: str, app_id: str) -> AnnotationReplyJob:
        self._annotations.require_app(tenant_id=tenant_id, app_id=app_id)
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
        self._annotations.require_app(tenant_id=tenant_id, app_id=app_id)
        job = self._jobs.get(tenant_id=tenant_id, app_id=app_id, action=action, job_id=job_id)
        if job is None:
            raise AnnotationReplyJobNotFoundError(f"Annotation reply job {job_id} is unavailable for app {app_id}")
        return job

    def complete_job(
        self, *, tenant_id: str, app_id: str, action: AnnotationReplyAction, job_id: str, error: str | None
    ) -> None:
        """Publish a worker's outcome; None denotes successful committed execution.

        Do not re-admit the app here: a deleted app still needs a terminal job
        status, with ownership enforced by the job store instead.
        """
        self._jobs.finish(tenant_id=tenant_id, app_id=app_id, action=action, job_id=job_id, error=error)

    def execute_enable(
        self,
        *,
        tenant_id: str,
        app_id: str,
        account_id: str,
        score_threshold: float,
        embedding_provider_name: str,
        embedding_model_name: str,
    ) -> None:
        plan = self._annotations.prepare_enable_reply(
            tenant_id=tenant_id, app_id=app_id, provider_name=embedding_provider_name, model_name=embedding_model_name
        )
        if plan.annotations:
            if plan.previous_binding is not None and plan.previous_binding.id != plan.binding.id:
                self._delete_index(tenant_id=tenant_id, app_id=app_id, binding=plan.previous_binding)
            self._index.rebuild(tenant_id=tenant_id, app_id=app_id, binding=plan.binding, entries=plan.annotations)
        # Keep the existing failure contract: indexing errors do not enable reply
        # or replace its settings. SQL and the vector store are not atomic; a SQL
        # failure after indexing can still leave vectors, as in the legacy worker.
        self._annotations.complete_enable_reply(plan=plan, account_id=account_id, score_threshold=score_threshold)

    def execute_disable(self, *, tenant_id: str, app_id: str) -> None:
        plan = self._annotations.prepare_disable_reply(tenant_id=tenant_id, app_id=app_id)
        if plan is None:
            return
        if plan.has_annotations:
            self._delete_index(tenant_id=tenant_id, app_id=app_id, binding=plan.binding)
        self._annotations.complete_disable_reply(plan=plan)

    def _delete_index(self, *, tenant_id: str, app_id: str, binding: AnnotationIndexBinding | None) -> None:
        try:
            self._index.delete(tenant_id=tenant_id, app_id=app_id, binding=binding)
        except Exception:
            # Deletion remains best effort, including when switching embedding models.
            logger.exception("Cannot delete annotation index for app %s in tenant %s", app_id, tenant_id)
