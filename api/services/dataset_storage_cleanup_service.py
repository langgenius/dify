"""Remove crawl caches whose remaining document references belong to a deleted dataset."""

import logging
from collections.abc import Callable
from typing import Literal

from pydantic import BaseModel, ValidationError, field_validator
from sqlalchemy import select

from core.db.session_factory import session_factory
from extensions.ext_storage import storage
from models.dataset import Document
from services.knowledge.file_cleanup_gate import assert_physical_file_cleanup_enabled

logger = logging.getLogger(__name__)


class FirecrawlDataSourceInfo(BaseModel):
    provider: Literal["firecrawl"]
    job_id: str

    @field_validator("job_id")
    @classmethod
    def validate_job_id(cls, v: str) -> str:
        if not v or any(char in v for char in "/\\\x00"):
            raise ValueError("Invalid job_id")
        return v


def _crawl_cache_key(data_source_info: str | None) -> str | None:
    if not data_source_info:
        return None
    try:
        info = FirecrawlDataSourceInfo.model_validate_json(data_source_info)
    except (ValueError, TypeError, ValidationError):
        return None
    return f"website_files/{info.job_id}.txt"


def cleanup_dataset_crawl_cache(
    tenant_id: str,
    dataset_id: str,
    *,
    assert_cleanup_allowed: Callable[[], None] = assert_physical_file_cleanup_enabled,
) -> None:
    """Delete only unshared Firecrawl caches, before deleting their document references.

    Crawl keys have no tenant namespace, so references in other tenants also prevent deletion.
    Storage failures propagate, preserving the database references for a later retry.
    """
    with session_factory.create_session() as session:
        candidates = {
            key
            for info in session.scalars(
                select(Document.data_source_info).where(
                    Document.tenant_id == tenant_id,
                    Document.dataset_id == dataset_id,
                    Document.data_source_type == "website_crawl",
                )
            )
            if (key := _crawl_cache_key(info)) is not None
        }
        if not candidates:
            return
        references = session.execute(
            select(Document.tenant_id, Document.dataset_id, Document.data_source_info)
            .where(Document.data_source_type == "website_crawl")
            .execution_options(yield_per=500)
        )
        for owner_tenant, owner_dataset, info in references:
            if owner_tenant != tenant_id or owner_dataset != dataset_id:
                key = _crawl_cache_key(info)
                if key is not None:
                    candidates.discard(key)
    # Finish the read transaction before accessing object storage.
    for key in sorted(candidates):
        assert_cleanup_allowed()
        try:
            storage.delete(key)
        except FileNotFoundError:
            pass
        except Exception:
            logger.exception(
                "Failed to delete dataset crawl cache tenant=%s dataset=%s key=%s", tenant_id, dataset_id, key
            )
            raise
