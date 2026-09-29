"""
Delete Archived Workflow Run Service.

This service deletes archived workflow run data from the database while keeping
archive logs intact. Deletion is intentionally gated by archive-object validation:
the archive bundle must exist, have a supported manifest, pass zip/member checksum
checks, and match the live row counts for every cleanup-owned table before rows
are removed from the primary database.
"""

import io
import json
import logging
import time
import zipfile
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime
from typing import TypedDict

from sqlalchemy.orm import Session, sessionmaker

from extensions.ext_database import db
from libs.archive_storage import ArchiveStorage, ArchiveStorageNotConfiguredError, get_archive_storage
from models.workflow import WorkflowArchiveLog, WorkflowRun
from repositories.api_workflow_run_repository import APIWorkflowRunRepository, RunsWithRelatedCountsDict
from repositories.sqlalchemy_workflow_trigger_log_repository import SQLAlchemyWorkflowTriggerLogRepository
from services.retention.workflow_run.constants import ARCHIVE_BUNDLE_NAME, ARCHIVE_SCHEMA_VERSION

logger = logging.getLogger(__name__)


class _TableManifestEntry(TypedDict):
    row_count: int
    checksum: str
    size_bytes: int


class _ArchiveManifest(TypedDict):
    schema_version: str
    workflow_run_id: str
    tenant_id: str
    app_id: str
    workflow_id: str
    tables: dict[str, _TableManifestEntry]


_ARCHIVED_TABLES = [
    "workflow_runs",
    "workflow_app_logs",
    "workflow_node_executions",
    "workflow_node_execution_offload",
    "workflow_pauses",
    "workflow_pause_reasons",
    "workflow_trigger_logs",
]

_TABLE_TO_COUNT_KEY = {
    "workflow_runs": "runs",
    "workflow_app_logs": "app_logs",
    "workflow_node_executions": "node_executions",
    "workflow_node_execution_offload": "offloads",
    "workflow_pauses": "pauses",
    "workflow_pause_reasons": "pause_reasons",
    "workflow_trigger_logs": "trigger_logs",
}


@dataclass
class DeleteResult:
    run_id: str
    tenant_id: str
    success: bool
    deleted_counts: RunsWithRelatedCountsDict = field(
        default_factory=lambda: {  # type: ignore[assignment]
            "runs": 0,
            "node_executions": 0,
            "offloads": 0,
            "app_logs": 0,
            "trigger_logs": 0,
            "pauses": 0,
            "pause_reasons": 0,
        }
    )
    validated_counts: RunsWithRelatedCountsDict = field(
        default_factory=lambda: {  # type: ignore[assignment]
            "runs": 0,
            "node_executions": 0,
            "offloads": 0,
            "app_logs": 0,
            "trigger_logs": 0,
            "pauses": 0,
            "pause_reasons": 0,
        }
    )
    archive_key: str | None = None
    restore_sampled: bool = False
    restore_sample_success: bool | None = None
    error: str | None = None
    elapsed_time: float = 0.0


class ArchivedWorkflowRunDeletion:
    """
    Delete archived workflow-run rows after validating the archive bundle.

    Args:
        dry_run: Preview validation and row counts without deleting.
        skip_bad_archives: Continue batch deletion after a validation/delete failure.
        restore_sample_interval: Run restore dry-run for every Nth successful deletion; 0 disables sampling.
    """

    _delete_attempt_count: int

    def __init__(
        self,
        dry_run: bool = False,
        *,
        skip_bad_archives: bool = False,
        restore_sample_interval: int = 0,
    ):
        self.dry_run = dry_run
        self.skip_bad_archives = skip_bad_archives
        if restore_sample_interval < 0:
            raise ValueError("restore_sample_interval must be >= 0")
        self.restore_sample_interval = restore_sample_interval
        self._delete_attempt_count = 0
        self.workflow_run_repo: APIWorkflowRunRepository | None = None

    def delete_by_run_id(self, run_id: str) -> DeleteResult:
        start_time = time.time()
        result = DeleteResult(run_id=run_id, tenant_id="", success=False)

        repo = self._get_workflow_run_repo()
        session_maker = sessionmaker(bind=db.engine, expire_on_commit=False)
        with session_maker() as session:
            run = session.get(WorkflowRun, run_id)
            if not run:
                result.error = f"Workflow run {run_id} not found"
                result.elapsed_time = time.time() - start_time
                return result

            result.tenant_id = run.tenant_id
            archive_log = repo.get_archived_log_by_run_id(run.id)
            if archive_log is None:
                result.error = f"Workflow run {run_id} is not archived"
                result.elapsed_time = time.time() - start_time
                return result

        result = self._delete_run(run, archive_log)
        result.elapsed_time = time.time() - start_time
        return result

    def delete_batch(
        self,
        tenant_ids: list[str] | None,
        start_date: datetime,
        end_date: datetime,
        limit: int = 100,
    ) -> list[DeleteResult]:
        session_maker = sessionmaker(bind=db.engine, expire_on_commit=False)
        results: list[DeleteResult] = []

        repo = self._get_workflow_run_repo()
        with session_maker() as session:
            archive_logs = list(
                repo.get_archived_logs_by_time_range(
                    session=session,
                    tenant_ids=tenant_ids,
                    start_date=start_date,
                    end_date=end_date,
                    limit=limit,
                )
            )
            run_ids = [archive_log.workflow_run_id for archive_log in archive_logs]
            runs_by_id = {run.id: run for run in session.query(WorkflowRun).where(WorkflowRun.id.in_(run_ids)).all()}
        for archive_log in archive_logs:
            run = runs_by_id.get(archive_log.workflow_run_id)
            if run is None:
                result = DeleteResult(
                    run_id=archive_log.workflow_run_id,
                    tenant_id=archive_log.tenant_id,
                    success=False,
                    error=f"Workflow run {archive_log.workflow_run_id} not found",
                )
            else:
                result = self._delete_run(run, archive_log)
            results.append(result)
            if not result.success and not self.skip_bad_archives:
                logger.error("Stopping archived workflow run deletion after failure: %s", result.error)
                break

        return results

    def _delete_run(self, run: WorkflowRun, archive_log: WorkflowArchiveLog | None = None) -> DeleteResult:
        start_time = time.time()
        result = DeleteResult(run_id=run.id, tenant_id=run.tenant_id, success=False)
        if archive_log is None:
            archive_log = self._get_workflow_run_repo().get_archived_log_by_run_id(run.id)
            if archive_log is None:
                result.error = f"Workflow run {run.id} is not archived"
                result.elapsed_time = time.time() - start_time
                return result

        try:
            result.archive_key = self._validate_archive_before_delete(run, archive_log)
            result.validated_counts = self._count_live_related_rows(run)
        except Exception as e:
            result.error = str(e)
            result.elapsed_time = time.time() - start_time
            return result

        if self.dry_run:
            result.success = True
            result.elapsed_time = time.time() - start_time
            return result

        repo = self._get_workflow_run_repo()
        try:
            deleted_counts = repo.delete_runs_with_related(
                [run],
                delete_node_executions=self._delete_node_executions,
                delete_trigger_logs=self._delete_trigger_logs,
            )
            result.deleted_counts = deleted_counts
            self._verify_post_delete(run.id)
            if self._should_run_restore_sample():
                result.restore_sampled = True
                result.restore_sample_success = self._run_restore_dry_run_sample(archive_log)
                if not result.restore_sample_success:
                    raise RuntimeError(f"Restore dry-run sample failed for workflow run {run.id}")
            result.success = True
        except Exception as e:
            result.error = str(e)
        result.elapsed_time = time.time() - start_time
        return result

    def _validate_archive_before_delete(self, run: WorkflowRun, archive_log: WorkflowArchiveLog) -> str:
        storage = self._get_archive_storage()
        archive_key = self._get_archive_key(archive_log)
        if not storage.object_exists(archive_key):
            raise FileNotFoundError(f"Archive bundle not found: {archive_key}")

        archive_data = storage.get_object(archive_key)
        manifest = self._validate_archive_bundle(
            archive_data,
            run_id=run.id,
            tenant_id=run.tenant_id,
            app_id=run.app_id,
            workflow_id=run.workflow_id,
        )
        expected_counts = self._counts_from_manifest(manifest)
        current_counts = self._count_live_related_rows(run)
        if current_counts != expected_counts:
            raise ValueError(
                "Archive row count mismatch before delete: "
                f"run_id={run.id}, expected={expected_counts}, current={current_counts}"
            )
        return archive_key

    @staticmethod
    def _validate_archive_bundle(
        archive_data: bytes,
        *,
        run_id: str,
        tenant_id: str,
        app_id: str,
        workflow_id: str,
    ) -> _ArchiveManifest:
        try:
            with zipfile.ZipFile(io.BytesIO(archive_data), mode="r") as archive:
                bad_member = archive.testzip()
                if bad_member:
                    raise ValueError(f"zip CRC check failed for member {bad_member}")
                try:
                    manifest_data = archive.read("manifest.json")
                except KeyError as e:
                    raise ValueError("manifest.json missing from archive bundle") from e
                loaded = json.loads(manifest_data)
                if not isinstance(loaded, dict):
                    raise ValueError("manifest.json must be an object")
                manifest = loaded

                required_fields = {
                    "schema_version",
                    "workflow_run_id",
                    "tenant_id",
                    "app_id",
                    "workflow_id",
                    "tables",
                }
                missing_fields = sorted(required_fields - set(manifest))
                if missing_fields:
                    raise ValueError(f"manifest missing required fields: {', '.join(missing_fields)}")
                if manifest["schema_version"] != ARCHIVE_SCHEMA_VERSION:
                    raise ValueError(
                        f"unsupported archive schema_version: {manifest['schema_version']} "
                        f"(expected {ARCHIVE_SCHEMA_VERSION})"
                    )
                if manifest["workflow_run_id"] != run_id:
                    raise ValueError("manifest workflow_run_id does not match delete target")
                if manifest["tenant_id"] != tenant_id:
                    raise ValueError("manifest tenant_id does not match delete target")
                if manifest["app_id"] != app_id:
                    raise ValueError("manifest app_id does not match delete target")
                if manifest["workflow_id"] != workflow_id:
                    raise ValueError("manifest workflow_id does not match delete target")

                tables = manifest["tables"]
                if not isinstance(tables, dict):
                    raise ValueError("manifest tables must be an object")
                missing_tables = [table_name for table_name in _ARCHIVED_TABLES if table_name not in tables]
                if missing_tables:
                    raise ValueError(f"manifest missing tables: {', '.join(missing_tables)}")

                for table_name in _ARCHIVED_TABLES:
                    info = tables[table_name]
                    if not isinstance(info, dict):
                        raise ValueError(f"manifest table entry must be an object: {table_name}")
                    for key in ("row_count", "checksum", "size_bytes"):
                        if key not in info:
                            raise ValueError(f"manifest table {table_name} missing {key}")
                    member_path = f"{table_name}.jsonl"
                    try:
                        payload = archive.read(member_path)
                    except KeyError as e:
                        raise ValueError(f"archive member missing: {member_path}") from e
                    if len(payload) != info["size_bytes"]:
                        raise ValueError(
                            f"archive member size mismatch for {member_path}: "
                            f"expected={info['size_bytes']}, actual={len(payload)}"
                        )
                    checksum = ArchiveStorage.compute_checksum(payload)
                    if checksum != info["checksum"]:
                        raise ValueError(
                            f"archive member checksum mismatch for {member_path}: "
                            f"expected={info['checksum']}, actual={checksum}"
                        )
                    row_count = len(ArchiveStorage.deserialize_from_jsonl(payload))
                    if row_count != info["row_count"]:
                        raise ValueError(
                            f"archive row count mismatch for {member_path}: "
                            f"expected={info['row_count']}, actual={row_count}"
                        )

                return manifest  # type: ignore[return-value]
        except zipfile.BadZipFile as e:
            raise ValueError("archive bundle is not a valid zip file") from e

    @staticmethod
    def _counts_from_manifest(manifest: _ArchiveManifest) -> RunsWithRelatedCountsDict:
        counts: RunsWithRelatedCountsDict = {
            "runs": 0,
            "node_executions": 0,
            "offloads": 0,
            "app_logs": 0,
            "trigger_logs": 0,
            "pauses": 0,
            "pause_reasons": 0,
        }
        for table_name, count_key in _TABLE_TO_COUNT_KEY.items():
            counts[count_key] = manifest["tables"][table_name]["row_count"]  # type: ignore[literal-required]
        return counts

    def _count_live_related_rows(self, run: WorkflowRun) -> RunsWithRelatedCountsDict:
        repo = self._get_workflow_run_repo()
        return repo.count_runs_with_related(
            [run],
            count_node_executions=self._count_node_executions,
            count_trigger_logs=self._count_trigger_logs,
        )

    def _verify_post_delete(self, run_id: str) -> None:
        with sessionmaker(bind=db.engine, expire_on_commit=False)() as session:
            if session.get(WorkflowRun, run_id) is not None:
                raise RuntimeError(f"Post-delete verification failed: workflow run {run_id} still exists")

    def _should_run_restore_sample(self) -> bool:
        if self.restore_sample_interval == 0:
            return False
        self._delete_attempt_count += 1
        return self._delete_attempt_count % self.restore_sample_interval == 0

    @staticmethod
    def _run_restore_dry_run_sample(archive_log: WorkflowArchiveLog) -> bool:
        from services.retention.workflow_run.restore_archived_workflow_run import WorkflowRunRestore

        restorer = WorkflowRunRestore(dry_run=True, workers=1)
        # Reuse restore's dry-run path so the runbook exercises the actual restore code.
        result = restorer._restore_from_run(
            archive_log,
            session_maker=sessionmaker(bind=db.engine, expire_on_commit=False),
        )
        return result.success

    @staticmethod
    def _get_archive_key(archive_log: WorkflowArchiveLog) -> str:
        created_at = archive_log.run_created_at
        prefix = (
            f"{archive_log.tenant_id}/app_id={archive_log.app_id}/year={created_at.strftime('%Y')}/"
            f"month={created_at.strftime('%m')}/workflow_run_id={archive_log.workflow_run_id}"
        )
        return f"{prefix}/{ARCHIVE_BUNDLE_NAME}"

    @staticmethod
    def _get_archive_storage() -> ArchiveStorage:
        try:
            return get_archive_storage()
        except ArchiveStorageNotConfiguredError as e:
            raise RuntimeError(f"Archive storage not configured: {e}") from e

    @staticmethod
    def _delete_trigger_logs(session: Session, run_ids: Sequence[str]) -> int:
        trigger_repo = SQLAlchemyWorkflowTriggerLogRepository(session)
        return trigger_repo.delete_by_run_ids(run_ids)

    @staticmethod
    def _count_trigger_logs(session: Session, run_ids: Sequence[str]) -> int:
        trigger_repo = SQLAlchemyWorkflowTriggerLogRepository(session)
        return trigger_repo.count_by_run_ids(run_ids)

    @staticmethod
    def _delete_node_executions(
        session: Session,
        runs: Sequence[WorkflowRun],
    ) -> tuple[int, int]:
        from repositories.factory import DifyAPIRepositoryFactory

        run_ids = [run.id for run in runs]
        repo = DifyAPIRepositoryFactory.create_api_workflow_node_execution_repository(
            session_maker=sessionmaker(bind=session.get_bind(), expire_on_commit=False)
        )
        return repo.delete_by_runs(session, run_ids)

    @staticmethod
    def _count_node_executions(
        session: Session,
        runs: Sequence[WorkflowRun],
    ) -> tuple[int, int]:
        from repositories.factory import DifyAPIRepositoryFactory

        run_ids = [run.id for run in runs]
        repo = DifyAPIRepositoryFactory.create_api_workflow_node_execution_repository(
            session_maker=sessionmaker(bind=session.get_bind(), expire_on_commit=False)
        )
        return repo.count_by_runs(session, run_ids)

    def _get_workflow_run_repo(self) -> APIWorkflowRunRepository:
        if self.workflow_run_repo is not None:
            return self.workflow_run_repo

        from repositories.factory import DifyAPIRepositoryFactory

        self.workflow_run_repo = DifyAPIRepositoryFactory.create_api_workflow_run_repository(
            sessionmaker(bind=db.engine, expire_on_commit=False)
        )
        return self.workflow_run_repo
