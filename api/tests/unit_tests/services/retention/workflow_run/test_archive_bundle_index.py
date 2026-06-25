import datetime
import json
from collections.abc import Iterator
from typing import cast
from unittest.mock import MagicMock

from services.retention.workflow_run.archive_bundle_index import (
    ARCHIVE_BUNDLE_ROOT_PREFIX,
    ArchiveBundleManifest,
    WorkflowRunArchiveBundleIndexBackfill,
    calculate_archive_bundle_index_values,
    decode_archive_bundle_manifest,
    upsert_archive_bundle_index_from_manifest,
)
from services.retention.workflow_run.constants import ARCHIVE_BUNDLE_FORMAT, ARCHIVE_BUNDLE_SCHEMA_VERSION

TENANT_ID = "1251fe32-c0c7-4fe2-a7bd-a8105267faf5"
BUNDLE_ID = "bundle-a"
OBJECT_PREFIX = (
    f"{ARCHIVE_BUNDLE_ROOT_PREFIX}tenant_prefix=1/tenant_id={TENANT_ID}/"
    f"year=2025/month=03/shard=00-of-01/bundle={BUNDLE_ID}"
)
MANIFEST_KEY = f"{OBJECT_PREFIX}/manifest.json"


class FakeArchiveStorage:
    listed_prefixes: list[str]
    objects: dict[str, bytes]

    def __init__(self, objects: dict[str, bytes]) -> None:
        self.objects = objects
        self.listed_prefixes = []

    def list_objects(self, prefix: str) -> list[str]:
        self.listed_prefixes.append(prefix)
        return sorted(key for key in self.objects if key.startswith(prefix))

    def get_object(self, key: str) -> bytes:
        return self.objects[key]


class FakeSessionContext:
    session: MagicMock

    def __init__(self, session: MagicMock) -> None:
        self.session = session

    def __enter__(self) -> MagicMock:
        return self.session

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> None:
        return None


class FakeSessionFactory:
    session: MagicMock

    def __init__(self, session: MagicMock) -> None:
        self.session = session

    def __call__(self) -> FakeSessionContext:
        return FakeSessionContext(self.session)


class FailingSessionFactory:
    def __call__(self) -> Iterator[MagicMock]:
        raise AssertionError("dry-run should not open a database session")


def _manifest(*, object_prefix: str = OBJECT_PREFIX, month: int = 3) -> ArchiveBundleManifest:
    return ArchiveBundleManifest(
        schema_version=ARCHIVE_BUNDLE_SCHEMA_VERSION,
        archive_format=ARCHIVE_BUNDLE_FORMAT,
        tenant_id=TENANT_ID,
        tenant_prefix="1",
        year=2025,
        month=month,
        shard="00-of-01",
        bundle_id=BUNDLE_ID,
        object_prefix=object_prefix,
        workflow_run_count=2,
        workflow_node_execution_count=3,
        min_created_at="2025-03-01T00:00:00+00:00",
        max_created_at="2025-03-02T00:00:00+00:00",
        min_run_id="run-a",
        max_run_id="run-b",
        archived_at="2026-06-25T08:00:00+00:00",
        tables={
            "workflow_runs": {
                "row_count": 2,
                "checksum": "checksum-a",
                "size_bytes": 100,
                "object_key": f"{object_prefix}/workflow_runs.parquet",
            },
            "workflow_node_executions": {
                "row_count": 3,
                "checksum": "checksum-b",
                "size_bytes": 200,
                "object_key": f"{object_prefix}/workflow_node_executions.parquet",
            },
        },
        run_ids=["run-a", "run-b"],
    )


def _manifest_bytes(manifest: ArchiveBundleManifest | None = None) -> bytes:
    return json.dumps(manifest or _manifest()).encode("utf-8")


def test_decode_and_calculate_archive_bundle_index_values() -> None:
    data = _manifest_bytes()

    manifest = decode_archive_bundle_manifest(data)
    values = calculate_archive_bundle_index_values(manifest, len(data))

    assert manifest["tenant_id"] == TENANT_ID
    assert values.row_count == 5
    assert values.archive_bytes == len(data) + 300
    assert values.archived_at == datetime.datetime(2026, 6, 25, 8, 0)


def test_upsert_archive_bundle_index_inserts_new_bundle() -> None:
    session = MagicMock()
    session.scalar.return_value = None
    data = _manifest_bytes()

    bundle = upsert_archive_bundle_index_from_manifest(session, decode_archive_bundle_manifest(data), len(data))

    assert bundle.tenant_id == TENANT_ID
    assert bundle.year == 2025
    assert bundle.month == 3
    assert bundle.workflow_run_count == 2
    assert bundle.row_count == 5
    assert bundle.archive_bytes == len(data) + 300
    session.add.assert_called_once_with(bundle)


def test_upsert_archive_bundle_index_updates_existing_bundle() -> None:
    existing = MagicMock()
    session = MagicMock()
    session.scalar.return_value = existing
    data = _manifest_bytes()

    bundle = upsert_archive_bundle_index_from_manifest(session, decode_archive_bundle_manifest(data), len(data))

    assert bundle is existing
    assert existing.workflow_run_count == 2
    assert existing.row_count == 5
    assert existing.archive_bytes == len(data) + 300
    assert existing.archived_at == datetime.datetime(2026, 6, 25, 8, 0)
    session.add.assert_not_called()


def test_backfill_lists_tenant_month_prefix_and_upserts_bundle_index() -> None:
    storage = FakeArchiveStorage({MANIFEST_KEY: _manifest_bytes()})
    session = MagicMock()
    session.scalar.return_value = None
    backfill = WorkflowRunArchiveBundleIndexBackfill(
        storage=cast(MagicMock, storage),
        session_factory=cast(MagicMock, FakeSessionFactory(session)),
    )

    summary = backfill.run(tenant_ids=[TENANT_ID], year=2025, month=3)

    assert storage.listed_prefixes == [
        f"{ARCHIVE_BUNDLE_ROOT_PREFIX}tenant_prefix=1/tenant_id={TENANT_ID}/year=2025/month=03/"
    ]
    assert summary.manifests_found == 1
    assert summary.bundles_processed == 1
    assert summary.bundles_upserted == 1
    assert summary.bundles_failed == 0
    session.add.assert_called_once()
    session.commit.assert_called_once()


def test_backfill_dry_run_filters_by_year_month_without_database_write() -> None:
    other_month_prefix = OBJECT_PREFIX.replace("month=03", "month=04")
    storage = FakeArchiveStorage(
        {
            MANIFEST_KEY: _manifest_bytes(),
            f"{other_month_prefix}/manifest.json": _manifest_bytes(
                _manifest(object_prefix=other_month_prefix, month=4)
            ),
        }
    )
    backfill = WorkflowRunArchiveBundleIndexBackfill(
        storage=cast(MagicMock, storage),
        session_factory=cast(MagicMock, FailingSessionFactory()),
    )

    summary = backfill.run(tenant_prefixes=["1"], year=2025, month=3, dry_run=True)

    assert storage.listed_prefixes == [f"{ARCHIVE_BUNDLE_ROOT_PREFIX}tenant_prefix=1/"]
    assert summary.manifests_found == 1
    assert summary.bundles_processed == 1
    assert summary.bundles_upserted == 0
    assert summary.archive_bytes > 0
