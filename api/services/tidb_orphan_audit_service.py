"""Export PostgreSQL evidence for C1 TiDB orphan cleanup."""

import json
import logging
import os
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from hashlib import sha256
from pathlib import Path
from typing import Any

from repositories.tidb_orphan_cleanup_repository import (
    TidbOrphanCleanupRepository,
    create_tidb_orphan_cleanup_repository,
)

logger = logging.getLogger(__name__)

_SCHEMA_VERSION = 1
_BUCKET_COUNT = 256


class OrphanAuditError(RuntimeError):
    pass


@dataclass(frozen=True)
class OrphanAuditResult:
    output_dir: Path
    completed_buckets: int
    ready: int
    held: int


def _utc_now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _json_bytes(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n").encode()


def _atomic_write_json(path: Path, value: Any) -> None:
    temporary_path = path.with_name(f"{path.name}.tmp")
    temporary_path.write_bytes(_json_bytes(value))
    os.replace(temporary_path, path)


def _atomic_write_jsonl(path: Path, records: Iterable[dict[str, Any]]) -> str:
    temporary_path = path.with_name(f"{path.name}.tmp")
    digest = sha256()
    with temporary_path.open("wb") as file:
        for record in records:
            line = _json_bytes(record)
            file.write(line)
            digest.update(line)
    os.replace(temporary_path, path)
    return digest.hexdigest()


def _file_digest(path: Path) -> str:
    digest = sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _atomic_concatenate(path: Path, parts: Iterable[Path]) -> str:
    temporary_path = path.with_name(f"{path.name}.tmp")
    digest = sha256()
    with temporary_path.open("wb") as output:
        for part in parts:
            with part.open("rb") as source:
                for chunk in iter(lambda: source.read(1024 * 1024), b""):
                    output.write(chunk)
                    digest.update(chunk)
    os.replace(temporary_path, path)
    return digest.hexdigest()


def _new_metadata() -> dict[str, Any]:
    return {
        "schema_version": _SCHEMA_VERSION,
        "started_at": _utc_now(),
        "completed_at": None,
        "buckets": {},
        "summary": {"completed_buckets": 0, "ready": 0, "held": 0},
    }


def _load_metadata(path: Path) -> dict[str, Any]:
    if not path.exists():
        return _new_metadata()
    try:
        metadata = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise OrphanAuditError(f"Audit metadata is unreadable: {path}") from exc
    if not isinstance(metadata, dict) or metadata.get("schema_version") != _SCHEMA_VERSION:
        raise OrphanAuditError(f"Audit metadata has an unsupported schema: {path}")
    if not isinstance(metadata.get("buckets"), dict):
        raise OrphanAuditError(f"Audit metadata has invalid bucket state: {path}")
    return metadata


def _bucket_is_complete(output_dir: Path, bucket_metadata: Any) -> bool:
    if not isinstance(bucket_metadata, dict):
        return False
    for status in ("ready", "held"):
        file_metadata = bucket_metadata.get(status)
        if not isinstance(file_metadata, dict):
            return False
        filename = file_metadata.get("file")
        expected_digest = file_metadata.get("sha256")
        if not isinstance(filename, str) or not isinstance(expected_digest, str):
            return False
        path = output_dir / filename
        if not path.is_file() or _file_digest(path) != expected_digest:
            return False
    return True


def _summary(metadata: dict[str, Any], output_dir: Path) -> OrphanAuditResult:
    buckets = metadata["buckets"]
    ready = sum(int(bucket["ready"]["count"]) for bucket in buckets.values())
    held = sum(int(bucket["held"]["count"]) for bucket in buckets.values())
    return OrphanAuditResult(
        output_dir=output_dir,
        completed_buckets=len(buckets),
        ready=ready,
        held=held,
    )


def _run_tidb_orphan_audit(
    repository: TidbOrphanCleanupRepository,
    *,
    output_dir: Path,
) -> OrphanAuditResult:
    output_dir.mkdir(parents=True, exist_ok=True)
    metadata_path = output_dir / "metadata.json"
    metadata = _load_metadata(metadata_path)
    buckets: dict[str, Any] = metadata["buckets"]

    for bucket in range(_BUCKET_COUNT):
        bucket_name = f"{bucket:02x}"
        if _bucket_is_complete(output_dir, buckets.get(bucket_name)):
            logger.info("status=SKIPPED bucket=%s reason=already_complete", bucket_name)
            continue

        logger.info("status=SCANNING bucket=%s position=%s/%s", bucket_name, bucket + 1, _BUCKET_COUNT)
        try:
            records = sorted(
                repository.audit_orphan_segment_bucket(bucket),
                key=lambda record: (record.dataset_id, record.tenant_id),
            )
        except Exception as exc:
            raise OrphanAuditError(f"PostgreSQL audit failed for UUID bucket {bucket_name}.") from exc
        audited_at = _utc_now()
        ready_records = [record for record in records if record.documents == 0]
        held_records = [record for record in records if record.documents != 0]
        ready_path = output_dir / f"ready.part-{bucket_name}.jsonl"
        held_path = output_dir / f"held.part-{bucket_name}.jsonl"

        ready_digest = _atomic_write_jsonl(
            ready_path,
            (
                {
                    "bucket": bucket_name,
                    "dataset_id": record.dataset_id,
                    "first_seen_at": audited_at,
                    "tenant_id": record.tenant_id,
                }
                for record in ready_records
            ),
        )
        held_digest = _atomic_write_jsonl(
            held_path,
            (
                {
                    "bucket": bucket_name,
                    "dataset_id": record.dataset_id,
                    "document_rows": record.documents,
                    "first_seen_at": audited_at,
                    "reason": "documents_exist",
                    "tenant_id": record.tenant_id,
                }
                for record in held_records
            ),
        )
        buckets[bucket_name] = {
            "audited_at": audited_at,
            "ready": {"count": len(ready_records), "file": ready_path.name, "sha256": ready_digest},
            "held": {"count": len(held_records), "file": held_path.name, "sha256": held_digest},
        }
        result = _summary(metadata, output_dir)
        metadata["completed_at"] = None
        metadata.pop("manifests", None)
        metadata["summary"] = {
            "completed_buckets": result.completed_buckets,
            "ready": result.ready,
            "held": result.held,
        }
        _atomic_write_json(metadata_path, metadata)
        logger.info(
            "status=AUDITED bucket=%s position=%s/%s ready=%s held=%s",
            bucket_name,
            bucket + 1,
            _BUCKET_COUNT,
            len(ready_records),
            len(held_records),
        )

    result = _summary(metadata, output_dir)
    if result.completed_buckets != _BUCKET_COUNT:
        raise OrphanAuditError(f"Audit stopped with {result.completed_buckets}/{_BUCKET_COUNT} UUID buckets complete.")
    manifests: dict[str, Any] = {}
    for status, count in (("ready", result.ready), ("held", result.held)):
        manifest_path = output_dir / f"{status}.jsonl"
        digest = _atomic_concatenate(
            manifest_path,
            (output_dir / f"{status}.part-{bucket:02x}.jsonl" for bucket in range(_BUCKET_COUNT)),
        )
        manifests[status] = {"count": count, "file": manifest_path.name, "sha256": digest}
    metadata["manifests"] = manifests
    metadata["completed_at"] = _utc_now()
    metadata["summary"] = {
        "completed_buckets": result.completed_buckets,
        "ready": result.ready,
        "held": result.held,
    }
    _atomic_write_json(metadata_path, metadata)
    logger.info(
        "summary completed_buckets=%s ready=%s held=%s output_dir=%s",
        result.completed_buckets,
        result.ready,
        result.held,
        output_dir,
    )
    return result


def run_tidb_orphan_audit(*, output_dir: str) -> OrphanAuditResult:
    try:
        repository = create_tidb_orphan_cleanup_repository()
        return _run_tidb_orphan_audit(repository, output_dir=Path(output_dir))
    except OrphanAuditError:
        raise
    except OSError as exc:
        raise OrphanAuditError(f"Audit output could not be written safely: {output_dir}") from exc
