import json
from hashlib import sha256

import pytest

from repositories.tidb_orphan_cleanup_repository import OrphanAuditRecord
from services import tidb_orphan_audit_service as audit_service


class _Repository:
    def __init__(self, records_by_bucket: dict[int, tuple[OrphanAuditRecord, ...]]) -> None:
        self.records_by_bucket = records_by_bucket
        self.calls: list[int] = []

    def audit_orphan_segment_bucket(self, bucket: int) -> tuple[OrphanAuditRecord, ...]:
        self.calls.append(bucket)
        return self.records_by_bucket.get(bucket, ())


def _read_jsonl(path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


def test_audit_exports_atomic_bucket_manifests_and_metadata(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(audit_service, "_BUCKET_COUNT", 2)
    monkeypatch.setattr(audit_service, "_utc_now", lambda: "2026-08-18T00:00:00Z")
    repository = _Repository(
        {
            0: (
                OrphanAuditRecord(dataset_id="0002", tenant_id="tenant-b", documents=3),
                OrphanAuditRecord(dataset_id="0001", tenant_id="tenant-a", documents=0),
            )
        }
    )

    result = audit_service._run_tidb_orphan_audit(
        repository,  # type: ignore[arg-type]
        output_dir=tmp_path,
    )

    assert repository.calls == [0, 1]
    assert (result.completed_buckets, result.ready, result.held) == (2, 1, 1)
    assert _read_jsonl(tmp_path / "ready.part-00.jsonl") == [
        {
            "bucket": "00",
            "dataset_id": "0001",
            "first_seen_at": "2026-08-18T00:00:00Z",
            "tenant_id": "tenant-a",
        }
    ]
    assert _read_jsonl(tmp_path / "held.part-00.jsonl") == [
        {
            "bucket": "00",
            "dataset_id": "0002",
            "document_rows": 3,
            "first_seen_at": "2026-08-18T00:00:00Z",
            "reason": "documents_exist",
            "tenant_id": "tenant-b",
        }
    ]
    assert not list(tmp_path.glob("*.tmp"))
    assert (tmp_path / "ready.jsonl").read_bytes() == (tmp_path / "ready.part-00.jsonl").read_bytes()
    assert (tmp_path / "held.jsonl").read_bytes() == (tmp_path / "held.part-00.jsonl").read_bytes()

    metadata = json.loads((tmp_path / "metadata.json").read_text(encoding="utf-8"))
    assert metadata["schema_version"] == 1
    assert "tenant_id" not in metadata
    assert metadata["summary"] == {"completed_buckets": 2, "held": 1, "ready": 1}
    assert (
        metadata["buckets"]["00"]["ready"]["sha256"]
        == sha256((tmp_path / "ready.part-00.jsonl").read_bytes()).hexdigest()
    )
    assert metadata["manifests"]["ready"] == {
        "count": 1,
        "file": "ready.jsonl",
        "sha256": sha256((tmp_path / "ready.jsonl").read_bytes()).hexdigest(),
    }


def test_audit_resumes_verified_buckets(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(audit_service, "_BUCKET_COUNT", 1)
    repository = _Repository({0: (OrphanAuditRecord(dataset_id="0001", tenant_id="tenant-a", documents=0),)})
    audit_service._run_tidb_orphan_audit(
        repository,  # type: ignore[arg-type]
        output_dir=tmp_path,
    )

    resumed_repository = _Repository({})
    result = audit_service._run_tidb_orphan_audit(
        resumed_repository,  # type: ignore[arg-type]
        output_dir=tmp_path,
    )

    assert resumed_repository.calls == []
    assert (result.completed_buckets, result.ready, result.held) == (1, 1, 0)


def test_audit_uses_all_uuid_prefix_buckets() -> None:
    assert audit_service._BUCKET_COUNT == 256


def test_audit_reports_the_failed_bucket(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(audit_service, "_BUCKET_COUNT", 1)
    repository = _Repository({})

    def fail_audit(_bucket):
        raise RuntimeError

    monkeypatch.setattr(repository, "audit_orphan_segment_bucket", fail_audit)

    with pytest.raises(audit_service.OrphanAuditError, match="UUID bucket 00"):
        audit_service._run_tidb_orphan_audit(
            repository,  # type: ignore[arg-type]
            output_dir=tmp_path,
        )
