import json
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.orm import Session

from models.dataset import Document
from models.enums import DataSourceType
from services import dataset_storage_cleanup_service as cleanup
from services.data_source.entities.website import WebsiteJobRef
from services.data_source.website_crawl_cache import (
    WebsiteCrawlReceipt,
    website_crawl_cache_key,
    website_crawl_provider_instance_id,
    website_crawl_provider_instance_prefix,
    website_crawl_receipt_key,
)
from tests.unit_tests.model_factories import make_dataset, make_document


@dataclass
class _RecordingStorage:
    deleted: list[str] = field(default_factory=list)
    objects: dict[str, bytes] = field(default_factory=dict)

    def save(self, key: str, value: bytes) -> None:
        self.objects[key] = value

    def load_once(self, key: str) -> bytes:
        return self.objects[key]

    def scan(self, prefix: str) -> list[str]:
        return sorted(key for key in self.objects if key.startswith(prefix))

    def delete(self, key: str) -> None:
        self.deleted.append(key)
        self.objects.pop(key, None)


def _website_document(
    *, document_id: str, dataset_id: str, provider: str, job_id: str, provider_instance_id: str
) -> Document:
    return make_document(
        document_id=document_id,
        dataset_id=dataset_id,
        data_source_type=DataSourceType.WEBSITE_CRAWL,
        data_source_info=json.dumps(
            {
                "provider": provider,
                "job_id": job_id,
                "provider_instance_id": provider_instance_id,
            }
        ),
    )


def test_cleanup_removes_cache_and_receipt_only_after_last_reference(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    firecrawl_instance = website_crawl_provider_instance_id(provider="firecrawl")
    watercrawl_instance = website_crawl_provider_instance_id(provider="watercrawl")
    sqlite_session.add_all(
        [
            make_dataset(dataset_id="dataset-1"),
            make_dataset(dataset_id="dataset-2", name="Other"),
            _website_document(
                document_id="firecrawl-document",
                dataset_id="dataset-1",
                provider="firecrawl",
                job_id="firecrawl-job",
                provider_instance_id=firecrawl_instance,
            ),
            _website_document(
                document_id="watercrawl-document",
                dataset_id="dataset-1",
                provider="watercrawl",
                job_id="shared-watercrawl-job",
                provider_instance_id=watercrawl_instance,
            ),
            _website_document(
                document_id="shared-watercrawl-document",
                dataset_id="dataset-2",
                provider="watercrawl",
                job_id="shared-watercrawl-job",
                provider_instance_id=watercrawl_instance,
            ),
        ]
    )
    sqlite_session.commit()
    storage = _RecordingStorage()
    monkeypatch.setattr(cleanup, "storage", storage)

    cleanup.cleanup_dataset_crawl_cache("tenant-1", "dataset-1")

    assert storage.deleted == [
        website_crawl_cache_key(
            tenant_id="tenant-1",
            provider="firecrawl",
            provider_instance_id=firecrawl_instance,
            job_id="firecrawl-job",
        ),
        website_crawl_receipt_key(
            tenant_id="tenant-1",
            provider="firecrawl",
            provider_instance_id=firecrawl_instance,
            job_id="firecrawl-job",
        ),
    ]


def test_cleanup_removes_non_firecrawl_receipt_when_unreferenced(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    watercrawl_instance = website_crawl_provider_instance_id(provider="watercrawl")
    sqlite_session.add_all(
        [
            make_dataset(),
            _website_document(
                document_id="watercrawl-document",
                dataset_id="dataset-1",
                provider="watercrawl",
                job_id="watercrawl-job",
                provider_instance_id=watercrawl_instance,
            ),
        ]
    )
    sqlite_session.commit()
    storage = _RecordingStorage()
    monkeypatch.setattr(cleanup, "storage", storage)

    cleanup.cleanup_dataset_crawl_cache("tenant-1", "dataset-1")

    assert storage.deleted == [
        website_crawl_receipt_key(
            tenant_id="tenant-1",
            provider="watercrawl",
            provider_instance_id=watercrawl_instance,
            job_id="watercrawl-job",
        )
    ]


def test_cleanup_retains_scoped_artifacts_when_legacy_reference_is_ambiguous(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    firecrawl_instance = website_crawl_provider_instance_id(provider="firecrawl")
    sqlite_session.add_all(
        [
            make_dataset(dataset_id="dataset-1"),
            make_dataset(dataset_id="dataset-2", name="Legacy"),
            _website_document(
                document_id="scoped-document",
                dataset_id="dataset-1",
                provider="firecrawl",
                job_id="shared-job",
                provider_instance_id=firecrawl_instance,
            ),
            make_document(
                document_id="legacy-document",
                dataset_id="dataset-2",
                data_source_type=DataSourceType.WEBSITE_CRAWL,
                data_source_info=json.dumps({"provider": "firecrawl", "job_id": "shared-job"}),
            ),
        ]
    )
    sqlite_session.commit()
    storage = _RecordingStorage()
    monkeypatch.setattr(cleanup, "storage", storage)

    cleanup.cleanup_dataset_crawl_cache("tenant-1", "dataset-1")

    assert storage.deleted == []


def test_opportunistic_cleanup_removes_only_expired_unpublished_receipts(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    now = datetime(2026, 10, 29, tzinfo=UTC)
    provider = "watercrawl"
    provider_instance_id = website_crawl_provider_instance_id(provider=provider)
    storage = _RecordingStorage()
    refs = {
        "expired-unpublished": WebsiteJobRef(
            tenant_id="tenant-1",
            provider=provider,
            provider_instance_id=provider_instance_id,
            job_id="expired-unpublished",
        ),
        "active-unpublished": WebsiteJobRef(
            tenant_id="tenant-1",
            provider=provider,
            provider_instance_id=provider_instance_id,
            job_id="active-unpublished",
        ),
        "expired-published": WebsiteJobRef(
            tenant_id="tenant-1",
            provider=provider,
            provider_instance_id=provider_instance_id,
            job_id="expired-published",
        ),
    }
    created_at = {
        "expired-unpublished": now - timedelta(hours=49),
        "active-unpublished": now - timedelta(hours=24),
        "expired-published": now - timedelta(days=7),
    }
    for name, job_ref in refs.items():
        storage.save(
            website_crawl_receipt_key(
                tenant_id=job_ref.tenant_id,
                provider=job_ref.provider,
                provider_instance_id=job_ref.provider_instance_id,
                job_id=job_ref.job_id,
            ),
            WebsiteCrawlReceipt(created_at=created_at[name], job_ref=job_ref).model_dump_json().encode(),
        )
    sqlite_session.add_all(
        [
            make_dataset(),
            _website_document(
                document_id="published-document",
                dataset_id="dataset-1",
                provider=provider,
                job_id="expired-published",
                provider_instance_id=provider_instance_id,
            ),
        ]
    )
    sqlite_session.commit()
    monkeypatch.setattr(cleanup, "storage", storage)

    deleted = cleanup.cleanup_expired_website_crawl_receipts(
        tenant_id="tenant-1",
        provider=provider,
        provider_instance_id=provider_instance_id,
        now=now,
    )

    expired_key = website_crawl_receipt_key(
        tenant_id="tenant-1",
        provider=provider,
        provider_instance_id=provider_instance_id,
        job_id="expired-unpublished",
    )
    assert deleted == 1
    assert storage.deleted == [expired_key]
    assert set(storage.objects) == {
        website_crawl_receipt_key(
            tenant_id="tenant-1",
            provider=provider,
            provider_instance_id=provider_instance_id,
            job_id="active-unpublished",
        ),
        website_crawl_receipt_key(
            tenant_id="tenant-1",
            provider=provider,
            provider_instance_id=provider_instance_id,
            job_id="expired-published",
        ),
    }
    assert all(
        key.startswith(
            website_crawl_provider_instance_prefix(
                tenant_id="tenant-1",
                provider=provider,
                provider_instance_id=provider_instance_id,
            )
        )
        for key in storage.objects
    )
