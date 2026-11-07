"""Remove crawl caches whose remaining document references belong to a deleted dataset."""

import datetime
import logging
from typing import Literal

from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select

from core.db.session_factory import session_factory
from extensions.ext_storage import storage
from libs.datetime_utils import utc_now
from models.dataset import Document
from services.data_source.website_crawl_cache import (
    WEBSITE_CRAWL_RECEIPT_SUFFIX,
    WebsiteCrawlReceipt,
    website_crawl_cache_key,
    website_crawl_provider_instance_prefix,
    website_crawl_receipt_key,
)

logger = logging.getLogger(__name__)
WEBSITE_CRAWL_RECEIPT_RETENTION = datetime.timedelta(hours=48)
_RECEIPT_CLEANUP_BATCH_SIZE = 100


class WebsiteCrawlDataSourceInfo(BaseModel):
    provider: Literal["firecrawl", "watercrawl", "jinareader"]
    job_id: str
    provider_instance_id: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")

    @field_validator("job_id")
    @classmethod
    def validate_job_id(cls, v: str) -> str:
        if not v or any(char in v for char in "/\\\x00"):
            raise ValueError("Invalid job_id")
        return v


def _website_job_ref(data_source_info: str | None) -> tuple[str, str, str | None] | None:
    if not data_source_info:
        return None
    try:
        info = WebsiteCrawlDataSourceInfo.model_validate_json(data_source_info)
    except (ValueError, TypeError):
        return None
    return info.provider, info.job_id, info.provider_instance_id


def cleanup_dataset_crawl_cache(
    tenant_id: str,
    dataset_id: str,
) -> None:
    """Delete only unshared website crawl artifacts before deleting their document references.

    Crawl keys are tenant/provider scoped; another dataset in the same tenant may still share one.
    Storage failures propagate, preserving the database references for a later retry.
    """
    with session_factory.create_session() as session:
        candidate_refs = {
            job_ref
            for info in session.scalars(
                select(Document.data_source_info).where(
                    Document.tenant_id == tenant_id,
                    Document.dataset_id == dataset_id,
                    Document.data_source_type == "website_crawl",
                )
            )
            if (job_ref := _website_job_ref(info)) is not None
        }
        if not candidate_refs:
            return
        # A legacy source without a provider instance cannot identify a scoped
        # cache safely once durable crawl-job ownership is unavailable. Retain
        # those objects rather than guessing a global job identity.
        resolved_candidates = {
            (provider, job_id, provider_instance_id)
            for provider, job_id, provider_instance_id in candidate_refs
            if provider_instance_id is not None
        }
        if not resolved_candidates:
            return
        references = session.scalars(
            select(Document.data_source_info)
            .where(
                Document.tenant_id == tenant_id,
                Document.dataset_id != dataset_id,
                Document.data_source_type == "website_crawl",
            )
            .execution_options(yield_per=500)
        )
        for info in references:
            job_ref = _website_job_ref(info)
            if job_ref is None:
                continue
            provider, job_id, persisted_instance_id = job_ref
            if persisted_instance_id is None:
                resolved_candidates = {
                    candidate for candidate in resolved_candidates if candidate[0] != provider or candidate[1] != job_id
                }
            else:
                resolved_candidates.discard((provider, job_id, persisted_instance_id))
    # Finish the read transaction before accessing object storage.
    for provider, job_id, provider_instance_id in sorted(resolved_candidates):
        keys = []
        if provider == "firecrawl":
            keys.append(
                website_crawl_cache_key(
                    tenant_id=tenant_id,
                    provider=provider,
                    provider_instance_id=provider_instance_id,
                    job_id=job_id,
                )
            )
        keys.append(
            website_crawl_receipt_key(
                tenant_id=tenant_id,
                provider=provider,
                provider_instance_id=provider_instance_id,
                job_id=job_id,
            )
        )
        for key in keys:
            _delete_crawl_artifact(key=key, tenant_id=tenant_id, dataset_id=dataset_id)


def cleanup_expired_website_crawl_receipts(
    *,
    tenant_id: str,
    provider: str,
    provider_instance_id: str,
    now: datetime.datetime | None = None,
    limit: int = _RECEIPT_CLEANUP_BATCH_SIZE,
) -> int:
    """Delete expired, unpublished receipts within one tenant/provider-instance shard.

    Receipts remain usable for at least 48 hours, including when Redis loses its
    timer marker. A persisted document reference retains its receipt beyond that
    window. Legacy references without an instance conservatively retain every
    matching receipt because their physical identity is ambiguous.
    """
    if limit < 1:
        raise ValueError("Receipt cleanup limit must be positive")
    current_time = now or utc_now()
    if current_time.tzinfo is None or current_time.utcoffset() is None:
        raise ValueError("Receipt cleanup time must be timezone-aware")
    cutoff = current_time.astimezone(datetime.UTC) - WEBSITE_CRAWL_RECEIPT_RETENTION
    prefix = website_crawl_provider_instance_prefix(
        tenant_id=tenant_id,
        provider=provider,
        provider_instance_id=provider_instance_id,
    )
    try:
        keys = storage.scan(prefix)
    except FileNotFoundError:
        return 0

    candidates: list[tuple[str, WebsiteCrawlReceipt]] = []
    for key in keys:
        if not key.startswith(prefix) or not key.endswith(WEBSITE_CRAWL_RECEIPT_SUFFIX):
            continue
        try:
            receipt = WebsiteCrawlReceipt.model_validate_json(storage.load_once(key))
        except FileNotFoundError:
            continue
        except (ValueError, TypeError):
            logger.warning("Ignoring invalid website crawl receipt key=%s", key, exc_info=True)
            continue
        job_ref = receipt.job_ref
        expected_key = website_crawl_receipt_key(
            tenant_id=job_ref.tenant_id,
            provider=job_ref.provider,
            provider_instance_id=job_ref.provider_instance_id,
            job_id=job_ref.job_id,
        )
        if (
            expected_key != key
            or job_ref.tenant_id != tenant_id
            or job_ref.provider != provider
            or job_ref.provider_instance_id != provider_instance_id
        ):
            logger.warning("Ignoring website crawl receipt whose identity does not match key=%s", key)
            continue
        if receipt.created_at > cutoff:
            continue
        candidates.append((key, receipt))
        if len(candidates) >= limit:
            break
    if not candidates:
        return 0

    candidate_job_ids = {receipt.job_ref.job_id for _, receipt in candidates}
    protected_job_ids: set[str] = set()
    with session_factory.create_session() as session:
        references = session.scalars(
            select(Document.data_source_info).where(
                Document.tenant_id == tenant_id,
                Document.data_source_type == "website_crawl",
            )
        )
        for info in references:
            stored_ref = _website_job_ref(info)
            if stored_ref is None:
                continue
            stored_provider, stored_job_id, stored_instance_id = stored_ref
            if stored_provider != provider or stored_job_id not in candidate_job_ids:
                continue
            if stored_instance_id is None or stored_instance_id == provider_instance_id:
                protected_job_ids.add(stored_job_id)

    deleted = 0
    for key, receipt in candidates:
        if receipt.job_ref.job_id in protected_job_ids:
            continue
        if provider == "firecrawl":
            _delete_crawl_artifact(
                key=website_crawl_cache_key(
                    tenant_id=tenant_id,
                    provider=provider,
                    provider_instance_id=provider_instance_id,
                    job_id=receipt.job_ref.job_id,
                ),
                tenant_id=tenant_id,
                dataset_id="unpublished",
            )
        _delete_crawl_artifact(key=key, tenant_id=tenant_id, dataset_id="unpublished")
        deleted += 1
    return deleted


def _delete_crawl_artifact(*, key: str, tenant_id: str, dataset_id: str) -> None:
    try:
        storage.delete(key)
    except FileNotFoundError:
        pass
    except Exception:
        logger.exception(
            "Failed to delete dataset crawl artifact tenant=%s dataset=%s key=%s", tenant_id, dataset_id, key
        )
        raise
