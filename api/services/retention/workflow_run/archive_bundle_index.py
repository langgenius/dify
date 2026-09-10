"""
Workflow-run archive bundle index helpers.

Archive manifests in object storage remain the recoverable source of truth. This module mirrors their small query
surface into `workflow_run_archive_bundles` so console listing and download jobs can avoid listing R2 on request.
The backfill path is intentionally idempotent: every manifest is decoded, checked against the V2 schema markers, and
upserted by immutable bundle identity.
"""

import datetime
import json
import logging
import time
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import TypedDict, cast

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from extensions.ext_database import db
from libs.archive_storage import ArchiveStorage, get_archive_storage
from models.workflow import WorkflowRunArchiveBundle
from services.retention.workflow_run.constants import (
    ARCHIVE_BUNDLE_FORMAT,
    ARCHIVE_BUNDLE_MANIFEST_NAME,
    ARCHIVE_BUNDLE_SCHEMA_VERSION,
)

logger = logging.getLogger(__name__)

ARCHIVE_BUNDLE_ROOT_PREFIX = "workflow-runs/v2/"


class ArchiveBundleTableManifestEntry(TypedDict):
    row_count: int
    checksum: str
    size_bytes: int
    object_key: str


class ArchiveBundleManifest(TypedDict):
    schema_version: str
    archive_format: str
    tenant_id: str
    tenant_prefix: str
    year: int
    month: int
    shard: str
    bundle_id: str
    object_prefix: str
    workflow_run_count: int
    workflow_node_execution_count: int
    min_created_at: str
    max_created_at: str
    min_run_id: str
    max_run_id: str
    archived_at: str
    tables: dict[str, ArchiveBundleTableManifestEntry]
    run_ids: list[str]


@dataclass(frozen=True)
class ArchiveBundleIndexValues:
    """Computed DB-index values derived from one manifest."""

    row_count: int
    archive_bytes: int
    archived_at: datetime.datetime


@dataclass
class ArchiveBundleIndexBackfillSummary:
    """Aggregate result for a manifest-to-DB-index reconciliation run."""

    manifests_found: int = 0
    bundles_processed: int = 0
    bundles_upserted: int = 0
    bundles_failed: int = 0
    workflow_run_count: int = 0
    row_count: int = 0
    archive_bytes: int = 0
    elapsed_time: float = 0.0
    errors: list[str] = field(default_factory=list)


def decode_archive_bundle_manifest(manifest_data: bytes) -> ArchiveBundleManifest:
    """Decode raw manifest bytes into the V2 archive manifest shape."""
    return cast(ArchiveBundleManifest, json.loads(manifest_data.decode("utf-8")))


def parse_archive_manifest_datetime(value: str) -> datetime.datetime:
    """Parse manifest datetimes and normalize timezone-aware values to naive UTC for DB storage."""
    parsed = datetime.datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        return parsed
    return parsed.astimezone(datetime.UTC).replace(tzinfo=None)


def calculate_archive_bundle_index_values(
    manifest: ArchiveBundleManifest,
    manifest_size_bytes: int,
) -> ArchiveBundleIndexValues:
    """Calculate row count, stored bytes, and archived timestamp for the DB index."""
    _validate_archive_bundle_manifest(manifest)
    row_count = sum(entry["row_count"] for entry in manifest["tables"].values())
    archive_bytes = manifest_size_bytes + sum(entry["size_bytes"] for entry in manifest["tables"].values())
    return ArchiveBundleIndexValues(
        row_count=row_count,
        archive_bytes=archive_bytes,
        archived_at=parse_archive_manifest_datetime(manifest["archived_at"]),
    )


def upsert_archive_bundle_index_from_manifest(
    session: Session,
    manifest: ArchiveBundleManifest,
    manifest_size_bytes: int,
) -> WorkflowRunArchiveBundle:
    """
    Persist one archive manifest into `workflow_run_archive_bundles`.

    The caller owns transaction boundaries. Re-running this function for the same manifest is safe and refreshes the
    mutable metrics derived from object sizes and row counts.
    """
    values = calculate_archive_bundle_index_values(manifest, manifest_size_bytes)
    existing = session.scalar(
        select(WorkflowRunArchiveBundle).where(
            WorkflowRunArchiveBundle.tenant_id == manifest["tenant_id"],
            WorkflowRunArchiveBundle.year == manifest["year"],
            WorkflowRunArchiveBundle.month == manifest["month"],
            WorkflowRunArchiveBundle.shard == manifest["shard"],
            WorkflowRunArchiveBundle.bundle_id == manifest["bundle_id"],
        )
    )
    if existing is None:
        bundle = WorkflowRunArchiveBundle(
            tenant_id=manifest["tenant_id"],
            year=manifest["year"],
            month=manifest["month"],
            shard=manifest["shard"],
            bundle_id=manifest["bundle_id"],
            workflow_run_count=manifest["workflow_run_count"],
            row_count=values.row_count,
            archive_bytes=values.archive_bytes,
            archived_at=values.archived_at,
        )
        session.add(bundle)
        return bundle

    existing.workflow_run_count = manifest["workflow_run_count"]
    existing.row_count = values.row_count
    existing.archive_bytes = values.archive_bytes
    existing.archived_at = values.archived_at
    return existing


class WorkflowRunArchiveBundleIndexBackfill:
    """
    Rebuild the DB bundle index by scanning object-store manifests.

    Tenant IDs are the cheapest scope because they map directly to the object prefix. Tenant prefixes are supported for
    rollout reconciliation, but they still require listing all tenants under that prefix and filtering keys locally.
    """

    storage: ArchiveStorage | None
    session_factory: sessionmaker[Session]

    def __init__(
        self,
        *,
        storage: ArchiveStorage | None = None,
        session_factory: sessionmaker[Session] | None = None,
    ) -> None:
        self.storage = storage
        self.session_factory = session_factory or sessionmaker(bind=db.engine, expire_on_commit=False)

    def run(
        self,
        *,
        tenant_ids: Sequence[str] | None = None,
        tenant_prefixes: Sequence[str] | None = None,
        year: int | None = None,
        month: int | None = None,
        limit: int | None = None,
        dry_run: bool = False,
    ) -> ArchiveBundleIndexBackfillSummary:
        """Scan matching manifest objects and idempotently upsert their DB index rows."""
        start_time = time.time()
        summary = ArchiveBundleIndexBackfillSummary()
        storage = self.storage or get_archive_storage()
        manifest_keys = self._list_manifest_keys(
            storage,
            tenant_ids=tenant_ids,
            tenant_prefixes=tenant_prefixes,
            year=year,
            month=month,
        )
        summary.manifests_found = len(manifest_keys)

        if limit is not None:
            manifest_keys = manifest_keys[:limit]

        for manifest_key in manifest_keys:
            try:
                manifest_data = storage.get_object(manifest_key)
                manifest = decode_archive_bundle_manifest(manifest_data)
                self._validate_manifest_scope(
                    manifest,
                    manifest_key=manifest_key,
                    tenant_ids=tenant_ids,
                    tenant_prefixes=tenant_prefixes,
                    year=year,
                    month=month,
                )
                values = calculate_archive_bundle_index_values(manifest, len(manifest_data))
                summary.bundles_processed += 1
                summary.workflow_run_count += manifest["workflow_run_count"]
                summary.row_count += values.row_count
                summary.archive_bytes += values.archive_bytes
                if dry_run:
                    continue

                with self.session_factory() as session:
                    upsert_archive_bundle_index_from_manifest(session, manifest, len(manifest_data))
                    session.commit()
                summary.bundles_upserted += 1
            except Exception as exc:
                logger.warning("Failed to backfill workflow archive bundle index from %s", manifest_key, exc_info=True)
                summary.bundles_failed += 1
                summary.errors.append(f"{manifest_key}: {exc}")

        summary.elapsed_time = time.time() - start_time
        return summary

    @classmethod
    def _list_manifest_keys(
        cls,
        storage: ArchiveStorage,
        *,
        tenant_ids: Sequence[str] | None,
        tenant_prefixes: Sequence[str] | None,
        year: int | None,
        month: int | None,
    ) -> list[str]:
        prefixes = cls._list_prefixes(tenant_ids=tenant_ids, tenant_prefixes=tenant_prefixes, year=year, month=month)
        keys: list[str] = []
        for prefix in prefixes:
            keys.extend(storage.list_objects(prefix))
        return sorted(
            key
            for key in keys
            if key.endswith(f"/{ARCHIVE_BUNDLE_MANIFEST_NAME}")
            and cls._manifest_key_matches_scope(
                key,
                tenant_ids=tenant_ids,
                tenant_prefixes=tenant_prefixes,
                year=year,
                month=month,
            )
        )

    @staticmethod
    def _list_prefixes(
        *,
        tenant_ids: Sequence[str] | None,
        tenant_prefixes: Sequence[str] | None,
        year: int | None,
        month: int | None,
    ) -> list[str]:
        if tenant_ids:
            prefixes = []
            for tenant_id in sorted(set(tenant_ids)):
                prefix = f"{ARCHIVE_BUNDLE_ROOT_PREFIX}tenant_prefix={tenant_id[0].lower()}/tenant_id={tenant_id}/"
                if year is not None:
                    prefix += f"year={year:04d}/"
                    if month is not None:
                        prefix += f"month={month:02d}/"
                prefixes.append(prefix)
            return prefixes

        if tenant_prefixes:
            return [
                f"{ARCHIVE_BUNDLE_ROOT_PREFIX}tenant_prefix={tenant_prefix}/"
                for tenant_prefix in sorted(set(tenant_prefixes))
            ]

        return [ARCHIVE_BUNDLE_ROOT_PREFIX]

    @staticmethod
    def _manifest_key_matches_scope(
        key: str,
        *,
        tenant_ids: Sequence[str] | None,
        tenant_prefixes: Sequence[str] | None,
        year: int | None,
        month: int | None,
    ) -> bool:
        if tenant_ids and _extract_key_part(key, "tenant_id") not in set(tenant_ids):
            return False
        if tenant_prefixes and _extract_key_part(key, "tenant_prefix") not in set(tenant_prefixes):
            return False
        if year is not None and _extract_key_part(key, "year") != f"{year:04d}":
            return False
        if month is not None and _extract_key_part(key, "month") != f"{month:02d}":
            return False
        return True

    @staticmethod
    def _validate_manifest_scope(
        manifest: ArchiveBundleManifest,
        *,
        manifest_key: str,
        tenant_ids: Sequence[str] | None,
        tenant_prefixes: Sequence[str] | None,
        year: int | None,
        month: int | None,
    ) -> None:
        expected_object_prefix = manifest_key.removesuffix(f"/{ARCHIVE_BUNDLE_MANIFEST_NAME}")
        if manifest["object_prefix"] != expected_object_prefix:
            raise ValueError(
                f"manifest object_prefix mismatch: expected={expected_object_prefix}, "
                f"actual={manifest['object_prefix']}"
            )
        if tenant_ids and manifest["tenant_id"] not in tenant_ids:
            raise ValueError(f"manifest tenant_id is outside requested scope: {manifest['tenant_id']}")
        if tenant_prefixes and manifest["tenant_prefix"] not in tenant_prefixes:
            raise ValueError(f"manifest tenant_prefix is outside requested scope: {manifest['tenant_prefix']}")
        if year is not None and manifest["year"] != year:
            raise ValueError(f"manifest year is outside requested scope: {manifest['year']}")
        if month is not None and manifest["month"] != month:
            raise ValueError(f"manifest month is outside requested scope: {manifest['month']}")


def _validate_archive_bundle_manifest(manifest: ArchiveBundleManifest) -> None:
    if manifest["schema_version"] != ARCHIVE_BUNDLE_SCHEMA_VERSION:
        raise ValueError(f"unsupported archive bundle schema version: {manifest['schema_version']}")
    if manifest["archive_format"] != ARCHIVE_BUNDLE_FORMAT:
        raise ValueError(f"unsupported archive bundle format: {manifest['archive_format']}")


def _extract_key_part(key: str, name: str) -> str | None:
    prefix = f"{name}="
    for part in key.split("/"):
        if part.startswith(prefix):
            return part[len(prefix) :]
    return None
