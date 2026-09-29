import io
import json
import zipfile
from datetime import UTC, datetime

import pytest

from libs.archive_storage import ArchiveStorage
from services.retention.workflow_run.constants import ARCHIVE_SCHEMA_VERSION
from services.retention.workflow_run.delete_archived_workflow_run import ArchivedWorkflowRunDeletion

ARCHIVED_TABLES = [
    "workflow_runs",
    "workflow_app_logs",
    "workflow_node_executions",
    "workflow_node_execution_offload",
    "workflow_pauses",
    "workflow_pause_reasons",
    "workflow_trigger_logs",
]


def _build_archive_bundle(
    *,
    run_id: str = "run-1",
    tenant_id: str = "tenant-1",
    app_id: str = "app-1",
    workflow_id: str = "workflow-1",
    corrupt_checksum_for: str | None = None,
) -> bytes:
    table_payloads: dict[str, bytes] = {}
    for table_name in ARCHIVED_TABLES:
        records = [{"id": run_id}] if table_name == "workflow_runs" else []
        table_payloads[table_name] = ArchiveStorage.serialize_to_jsonl(records)

    manifest = {
        "schema_version": ARCHIVE_SCHEMA_VERSION,
        "workflow_run_id": run_id,
        "tenant_id": tenant_id,
        "app_id": app_id,
        "workflow_id": workflow_id,
        "created_at": datetime.now(UTC).isoformat(),
        "archived_at": datetime.now(UTC).isoformat(),
        "tables": {
            table_name: {
                "row_count": 1 if table_name == "workflow_runs" else 0,
                "checksum": ArchiveStorage.compute_checksum(payload),
                "size_bytes": len(payload),
            }
            for table_name, payload in table_payloads.items()
        },
    }
    if corrupt_checksum_for:
        manifest["tables"][corrupt_checksum_for]["checksum"] = "bad-checksum"

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("manifest.json", json.dumps(manifest).encode("utf-8"))
        for table_name, payload in table_payloads.items():
            archive.writestr(f"{table_name}.jsonl", payload)
    return buffer.getvalue()


def test_validate_archive_bundle_accepts_valid_archive() -> None:
    manifest = ArchivedWorkflowRunDeletion._validate_archive_bundle(
        _build_archive_bundle(),
        run_id="run-1",
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
    )

    assert manifest["schema_version"] == ARCHIVE_SCHEMA_VERSION
    assert manifest["tables"]["workflow_runs"]["row_count"] == 1


def test_validate_archive_bundle_rejects_checksum_mismatch() -> None:
    with pytest.raises(ValueError, match="archive member checksum mismatch"):
        ArchivedWorkflowRunDeletion._validate_archive_bundle(
            _build_archive_bundle(corrupt_checksum_for="workflow_runs"),
            run_id="run-1",
            tenant_id="tenant-1",
            app_id="app-1",
            workflow_id="workflow-1",
        )


def test_validate_archive_bundle_rejects_manifest_target_mismatch() -> None:
    with pytest.raises(ValueError, match="manifest tenant_id does not match delete target"):
        ArchivedWorkflowRunDeletion._validate_archive_bundle(
            _build_archive_bundle(),
            run_id="run-1",
            tenant_id="different-tenant",
            app_id="app-1",
            workflow_id="workflow-1",
        )
