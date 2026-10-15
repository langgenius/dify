"""Remove crawl caches whose remaining document references belong to a deleted dataset."""

import json
import logging

from sqlalchemy import select

from core.db.session_factory import session_factory
from extensions.ext_storage import storage
from models.dataset import Document

logger = logging.getLogger(__name__)


def _crawl_cache_key(data_source_info: str | None) -> str | None:
    try:
        info = json.loads(data_source_info or "{}")
    except (ValueError, TypeError):
        return None
    if not isinstance(info, dict) or info.get("provider") != "firecrawl":
        return None
    job_id = info.get("job_id")
    if not isinstance(job_id, str) or not job_id or any(char in job_id for char in "/\\\x00"):
        return None
    return f"website_files/{job_id}.txt"


def cleanup_dataset_crawl_cache(tenant_id: str, dataset_id: str) -> None:
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
        try:
            storage.delete(key)
        except FileNotFoundError:
            pass
        except Exception:
            logger.exception(
                "Failed to delete dataset crawl cache tenant=%s dataset=%s key=%s", tenant_id, dataset_id, key
            )
            raise
