"""Durable follow-up that imports the first Source after Space provisioning."""

from __future__ import annotations

from celery import shared_task
from pydantic import TypeAdapter

from services.knowledge_fs.initial_source_import import (
    KnowledgeFSInitialSourceNotReadyError,
    start_initial_source_import,
    start_initial_website_source_import,
)
from services.knowledge_fs.product_dto import (
    KnowledgeFSInitialSourcePayload,
    KnowledgeFSInitialWebsiteSourcePayload,
)
from services.knowledge_fs.product_remote import (
    KnowledgeFSProductRemoteError,
    KnowledgeFSProductRequestRejectedError,
    KnowledgeFSProductResourceNotFoundError,
)

_INITIAL_SOURCE_ADAPTER: TypeAdapter[KnowledgeFSInitialSourcePayload] = TypeAdapter(KnowledgeFSInitialSourcePayload)


def _run_initial_source_task(
    task,
    *,
    tenant_id: str,
    account_id: str,
    control_space_id: str,
    operation_id: str,
    payload: dict[str, object],
    workflow_id: str | None,
) -> str:
    try:
        return start_initial_source_import(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id=operation_id,
            payload=_INITIAL_SOURCE_ADAPTER.validate_python(payload),
            workflow_id=workflow_id,
        )
    except KnowledgeFSInitialSourceNotReadyError as exc:
        if exc.workflow_id is not None:
            raise task.retry(
                exc=exc,
                kwargs={
                    "tenant_id": tenant_id,
                    "account_id": account_id,
                    "control_space_id": control_space_id,
                    "operation_id": operation_id,
                    "payload": payload,
                    "workflow_id": exc.workflow_id,
                },
            )
        raise task.retry(exc=exc)
    except KnowledgeFSProductResourceNotFoundError:
        raise
    except KnowledgeFSProductRequestRejectedError as exc:
        if exc.status_code == 429:
            raise task.retry(exc=exc)
        raise
    except KnowledgeFSProductRemoteError as exc:
        raise task.retry(exc=exc)


@shared_task(bind=True, queue="knowledge_fs_lifecycle", max_retries=180, default_retry_delay=2)
def import_initial_source(
    self,
    *,
    tenant_id: str,
    account_id: str,
    control_space_id: str,
    operation_id: str,
    payload: dict[str, object],
    workflow_id: str | None = None,
) -> str:
    return _run_initial_source_task(
        self,
        tenant_id=tenant_id,
        account_id=account_id,
        control_space_id=control_space_id,
        operation_id=operation_id,
        payload=payload,
        workflow_id=workflow_id,
    )


@shared_task(bind=True, queue="knowledge_fs_lifecycle", max_retries=180, default_retry_delay=2)
def import_initial_website_source(
    self,
    *,
    tenant_id: str,
    account_id: str,
    control_space_id: str,
    operation_id: str,
    payload: dict[str, object],
    workflow_id: str | None = None,
) -> str:
    """Compatibility task for already-enqueued website-only messages."""

    try:
        return start_initial_website_source_import(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id=operation_id,
            payload=KnowledgeFSInitialWebsiteSourcePayload.model_validate(payload),
            workflow_id=workflow_id,
        )
    except KnowledgeFSInitialSourceNotReadyError as exc:
        if exc.workflow_id is not None:
            raise self.retry(
                exc=exc,
                kwargs={
                    "tenant_id": tenant_id,
                    "account_id": account_id,
                    "control_space_id": control_space_id,
                    "operation_id": operation_id,
                    "payload": payload,
                    "workflow_id": exc.workflow_id,
                },
            )
        raise self.retry(exc=exc)
    except KnowledgeFSProductResourceNotFoundError:
        raise
    except KnowledgeFSProductRemoteError as exc:
        raise self.retry(exc=exc)


__all__ = [
    "import_initial_source",
    "import_initial_website_source",
]
