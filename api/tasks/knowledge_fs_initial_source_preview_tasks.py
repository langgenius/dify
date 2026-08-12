"""Runs website datasource preview jobs outside Console request workers."""

from __future__ import annotations

import logging

from celery import shared_task
from sqlalchemy import select

from core.db.session_factory import session_factory
from models.account import Account, AccountStatus, TenantAccountJoin
from services.knowledge_fs.initial_source_preview import (
    KnowledgeFSInitialSourcePreviewCanceledError,
    KnowledgeFSInitialSourcePreviewService,
)
from services.knowledge_fs.initial_source_preview_job import (
    KnowledgeFSInitialSourcePreviewJobNotFoundError,
    KnowledgeFSInitialSourcePreviewJobService,
)
from services.knowledge_fs.product_dto import KnowledgeFSInitialWebsiteSourcePreviewPayload

logger = logging.getLogger(__name__)


@shared_task(queue="dataset")
def run_knowledge_fs_initial_source_preview(
    *,
    tenant_id: str,
    account_id: str,
    job_id: str,
    payload: dict[str, object],
) -> None:
    job_service = KnowledgeFSInitialSourcePreviewJobService(session_factory.get_session_maker())
    try:
        if not job_service.transition_status(
            tenant_id=tenant_id,
            account_id=account_id,
            job_id=job_id,
            status="running",
            allowed_from=("pending",),
        ):
            return
        with session_factory.create_session() as session:
            account = session.get(Account, account_id)
            if account is None or account.status != AccountStatus.ACTIVE:
                raise LookupError("Datasource preview account is unavailable")
            membership = session.scalar(
                select(TenantAccountJoin.id).where(
                    TenantAccountJoin.tenant_id == tenant_id,
                    TenantAccountJoin.account_id == account_id,
                )
            )
            if membership is None:
                raise PermissionError("Datasource preview account is not a tenant member")
            account.set_tenant_id_with_session(tenant_id, session=session)
            if account.current_tenant_id != tenant_id:
                raise PermissionError("Datasource preview account is not a tenant member")
            session.expunge(account)
        result = KnowledgeFSInitialSourcePreviewService(session_factory.get_session_maker()).preview(
            tenant_id=tenant_id,
            account=account,
            payload=KnowledgeFSInitialWebsiteSourcePreviewPayload.model_validate(payload),
            is_canceled=lambda: _preview_was_canceled(
                job_service=job_service,
                tenant_id=tenant_id,
                account_id=account_id,
                job_id=job_id,
            ),
        )
        job_service.transition_status(
            tenant_id=tenant_id,
            account_id=account_id,
            job_id=job_id,
            status="completed",
            allowed_from=("running",),
            result=result,
        )
    except KnowledgeFSInitialSourcePreviewCanceledError:
        logger.info(
            "KnowledgeFS initial source preview canceled",
            extra={"account_id": account_id, "job_id": job_id, "tenant_id": tenant_id},
        )
    except Exception:
        logger.exception(
            "KnowledgeFS initial source preview failed",
            extra={"account_id": account_id, "job_id": job_id, "tenant_id": tenant_id},
        )
        job_service.transition_status(
            tenant_id=tenant_id,
            account_id=account_id,
            job_id=job_id,
            status="failed",
            allowed_from=("pending", "running"),
        )
    finally:
        job_service.release_active_job(
            tenant_id=tenant_id,
            account_id=account_id,
            job_id=job_id,
        )


def _preview_was_canceled(
    *,
    job_service: KnowledgeFSInitialSourcePreviewJobService,
    tenant_id: str,
    account_id: str,
    job_id: str,
) -> bool:
    try:
        return job_service.get(tenant_id=tenant_id, account_id=account_id, job_id=job_id).status == "canceled"
    except KnowledgeFSInitialSourcePreviewJobNotFoundError:
        return True


__all__ = ["run_knowledge_fs_initial_source_preview"]
