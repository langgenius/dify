import json
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import httpx
import pytest
from click.testing import CliRunner
from qdrant_client.http.exceptions import UnexpectedResponse

from commands import vector as vector_commands
from models.enums import TidbAuthBindingStatus
from repositories.tidb_orphan_cleanup_repository import OrphanPgState
from services import tidb_orphan_cleanup_service as cleanup_service

TENANT_ID = "49a99e46-bc2c-4885-91fa-47615f6192b5"
DATASET_ID = "e6024578-41b7-4fb5-a81f-9201358e5835"
DATASET_ID_2 = "64bd43a7-8b8f-4e37-845d-2e3cb791a68f"
TENANT_ID_2 = "8d0de8c7-95db-4458-aabe-3e4bb42f970a"


@pytest.fixture
def cleanup_logs(caplog: pytest.LogCaptureFixture) -> pytest.LogCaptureFixture:
    caplog.set_level("INFO", logger=cleanup_service.__name__)
    return caplog


def _collection_name(dataset_id: str = DATASET_ID) -> str:
    return cleanup_service._canonical_collection_name(dataset_id)


def _binding(tenant_id: str = TENANT_ID):
    return SimpleNamespace(
        id="binding-id",
        tenant_id=tenant_id,
        cluster_id="cluster-id",
        account="account",
        password="password",
        qdrant_endpoint="https://qdrant.example.com",
        status=TidbAuthBindingStatus.ACTIVE,
    )


def _ready_inspection() -> cleanup_service._OrphanCollectionInspection:
    return cleanup_service._OrphanCollectionInspection(
        collection_name=_collection_name(),
        dataset_id=DATASET_ID,
        status=cleanup_service._ORPHAN_STATUS_READY,
        reason="verified",
        pg=OrphanPgState(segments=10, indexed_segments=10),
        points=10,
        owner_points=10,
        points_after=10,
    )


def _write_manifest(
    tmp_path: Path,
    *,
    tenant_id: str = TENANT_ID,
    dataset_id: str = DATASET_ID,
    first_seen_at: datetime | None = None,
) -> Path:
    manifest = tmp_path / "ready.jsonl"
    first_seen_at = first_seen_at or datetime.now(UTC) - timedelta(days=2)
    manifest.write_text(
        json.dumps(
            {
                "bucket": dataset_id.replace("-", "")[:2],
                "dataset_id": dataset_id,
                "first_seen_at": first_seen_at.isoformat().replace("+00:00", "Z"),
                "tenant_id": tenant_id,
            }
        )
        + "\n",
        encoding="utf-8",
    )
    _write_manifest_metadata(manifest)
    return manifest


def _write_manifest_metadata(manifest: Path) -> None:
    count = len([line for line in manifest.read_text(encoding="utf-8").splitlines() if line.strip()])
    metadata = {
        "buckets": {f"{bucket:02x}": {} for bucket in range(256)},
        "completed_at": datetime.now(UTC).isoformat(),
        "manifests": {
            "ready": {
                "count": count,
                "file": manifest.name,
                "sha256": sha256(manifest.read_bytes()).hexdigest(),
            }
        },
        "schema_version": 1,
        "summary": {"completed_buckets": 256, "held": 0, "ready": count},
    }
    manifest.with_name("metadata.json").write_text(json.dumps(metadata), encoding="utf-8")


def _patch_run(
    monkeypatch: pytest.MonkeyPatch,
    *,
    binding=None,
    client=None,
) -> tuple[MagicMock, MagicMock]:
    binding = binding or _binding()
    client = client or MagicMock()
    repository = MagicMock()
    monkeypatch.setattr(vector_commands, "current_app", SimpleNamespace(root_path="/tmp"))
    monkeypatch.setattr(
        cleanup_service,
        "create_tidb_orphan_cleanup_repository",
        MagicMock(return_value=repository),
    )
    monkeypatch.setattr(
        cleanup_service,
        "_load_tidb_binding",
        lambda _repository, _tenant_id: binding,
    )
    monkeypatch.setattr(cleanup_service, "_build_tidb_qdrant_client", lambda _binding, _root_path: client)
    monkeypatch.setattr(cleanup_service, "_close_qdrant_client", lambda _client: None)
    monkeypatch.setattr(cleanup_service, "_load_pending_pg_cleanups", lambda: [])
    monkeypatch.setattr(cleanup_service, "_store_pending_pg_cleanup", lambda _pending: None)
    monkeypatch.setattr(cleanup_service, "_clear_pending_pg_cleanup", lambda _pending: None)
    return repository, client


def _invoke_cleanup(tmp_path: Path, manifest: Path, *extra_args: str):
    output = tmp_path / "cleanup-result.jsonl"
    result = CliRunner().invoke(
        vector_commands.cleanup_orphaned_tidb_collections,
        ["--manifest", str(manifest), "--output", str(output), *extra_args],
    )
    return result, output


def _read_ledger(path: Path) -> list[dict]:
    lines = path.read_text(encoding="utf-8").splitlines()
    assert all(lines)
    return [json.loads(line) for line in lines]


@pytest.mark.parametrize(
    ("state", "expected_status"),
    [
        (OrphanPgState(annotation_exists=True), cleanup_service._ORPHAN_STATUS_PROTECTED),
        (OrphanPgState(annotation_setting_exists=True), cleanup_service._ORPHAN_STATUS_PROTECTED),
        (OrphanPgState(live_document_segments=True), cleanup_service._ORPHAN_STATUS_BLOCKED),
    ],
)
def test_live_owners_are_not_cleanup_candidates(state: OrphanPgState, expected_status: str) -> None:
    status, _ = cleanup_service._classify_orphan_pg_state(TENANT_ID, _collection_name(), state, set())

    assert status == expected_status


@pytest.mark.parametrize(
    ("counts", "expected_status"),
    [
        ((0, 0, 0), cleanup_service._ORPHAN_STATUS_HOLD),
        ((10, 9, 10), cleanup_service._ORPHAN_STATUS_HOLD),
        ((10, 10, 11), cleanup_service._ORPHAN_STATUS_HOLD),
        ((10, 10, 10), cleanup_service._ORPHAN_STATUS_READY),
    ],
)
def test_point_counts_must_be_stable_and_fully_owned(counts: tuple[int, int, int], expected_status: str) -> None:
    status, _ = cleanup_service._classify_orphan_point_counts(*counts)

    assert status == expected_status


def test_manifest_is_strict_and_keeps_all_tenants(tmp_path: Path) -> None:
    manifest = _write_manifest(tmp_path)
    with manifest.open("a", encoding="utf-8") as stream:
        stream.write(
            json.dumps(
                {
                    "bucket": DATASET_ID.replace("-", "")[:2],
                    "dataset_id": DATASET_ID,
                    "first_seen_at": (datetime.now(UTC) - timedelta(days=2)).isoformat(),
                    "tenant_id": TENANT_ID_2,
                }
            )
            + "\n"
        )
    _write_manifest_metadata(manifest)

    entries, _, _ = cleanup_service._load_cleanup_manifest(str(manifest))

    assert [(entry.tenant_id, entry.dataset_id) for entry in entries] == [
        (TENANT_ID, DATASET_ID),
        (TENANT_ID_2, DATASET_ID),
    ]


def test_dataset_ids_select_entries_after_complete_manifest_validation(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    manifest = _write_manifest(tmp_path)
    with manifest.open("a", encoding="utf-8") as stream:
        stream.write(
            json.dumps(
                {
                    "bucket": DATASET_ID.replace("-", "")[:2],
                    "dataset_id": DATASET_ID,
                    "first_seen_at": (datetime.now(UTC) - timedelta(days=2)).isoformat(),
                    "tenant_id": TENANT_ID_2,
                }
            )
            + "\n"
        )
        stream.write(
            json.dumps(
                {
                    "bucket": DATASET_ID_2.replace("-", "")[:2],
                    "dataset_id": DATASET_ID_2,
                    "first_seen_at": (datetime.now(UTC) - timedelta(days=2)).isoformat(),
                    "tenant_id": TENANT_ID,
                }
            )
            + "\n"
        )
    _write_manifest_metadata(manifest)
    captured_entries = []

    def fake_run(**kwargs):
        captured_entries.extend(kwargs["manifest_entries"])
        return {}, None

    monkeypatch.setattr(vector_commands, "current_app", SimpleNamespace(root_path="/tmp"))
    monkeypatch.setattr(cleanup_service, "_run_tidb_orphan_cleanup", fake_run)

    result, output = _invoke_cleanup(
        tmp_path,
        manifest,
        "--dry-run",
        "--dataset-id",
        DATASET_ID,
        "--dataset-id",
        DATASET_ID,
    )

    assert result.exit_code == 0, (result.output, result.exception)
    assert {(entry.tenant_id, entry.dataset_id) for entry in captured_entries} == {
        (TENANT_ID, DATASET_ID),
        (TENANT_ID_2, DATASET_ID),
    }
    started = _read_ledger(output)[0]
    assert started["manifest_entries"] == 3
    assert started["manifest_sha256"] == sha256(manifest.read_bytes()).hexdigest()
    assert started["metadata_sha256"] == sha256(manifest.with_name("metadata.json").read_bytes()).hexdigest()
    assert started["selection"] == {
        "scope": "dataset_ids",
        "dataset_ids": [DATASET_ID],
        "entries": 2,
    }


def test_dataset_id_selection_still_validates_unselected_manifest_entries(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    manifest = _write_manifest(tmp_path)
    with manifest.open("a", encoding="utf-8") as stream:
        stream.write(
            json.dumps(
                {
                    "bucket": "00",
                    "dataset_id": DATASET_ID_2,
                    "first_seen_at": (datetime.now(UTC) - timedelta(days=2)).isoformat(),
                    "tenant_id": TENANT_ID,
                }
            )
            + "\n"
        )
    _write_manifest_metadata(manifest)
    run_cleanup = MagicMock()
    monkeypatch.setattr(vector_commands, "current_app", SimpleNamespace(root_path="/tmp"))
    monkeypatch.setattr(cleanup_service, "_run_tidb_orphan_cleanup", run_cleanup)

    result, output = _invoke_cleanup(tmp_path, manifest, "--dry-run", "--dataset-id", DATASET_ID)

    assert result.exit_code != 0
    assert "Invalid manifest entry" in result.output
    assert not output.exists()
    run_cleanup.assert_not_called()


def test_dataset_id_selection_rejects_ids_outside_the_manifest(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    manifest = _write_manifest(tmp_path)
    run_cleanup = MagicMock()
    monkeypatch.setattr(vector_commands, "current_app", SimpleNamespace(root_path="/tmp"))
    monkeypatch.setattr(cleanup_service, "_run_tidb_orphan_cleanup", run_cleanup)

    result, output = _invoke_cleanup(
        tmp_path,
        manifest,
        "--dry-run",
        "--dataset-id",
        DATASET_ID,
        "--dataset-id",
        DATASET_ID_2,
    )

    assert result.exit_code != 0
    assert "not present in the manifest" in result.output
    assert not output.exists()
    run_cleanup.assert_not_called()


@pytest.mark.parametrize(
    "mutation",
    [
        lambda value: value.update(bucket="00"),
        lambda value: value.update(collection_name="injected"),
        lambda value: value.update(first_seen_at=(datetime.now(UTC) + timedelta(days=1)).isoformat()),
    ],
)
def test_manifest_rejects_untrusted_fields_and_values(tmp_path: Path, mutation) -> None:
    value = {
        "bucket": DATASET_ID.replace("-", "")[:2],
        "dataset_id": DATASET_ID,
        "first_seen_at": (datetime.now(UTC) - timedelta(days=2)).isoformat(),
        "tenant_id": TENANT_ID,
    }
    mutation(value)
    manifest = tmp_path / "ready.jsonl"
    manifest.write_text(json.dumps(value) + "\n", encoding="utf-8")

    with pytest.raises(cleanup_service.OrphanCleanupError, match="Invalid manifest entry"):
        cleanup_service._load_cleanup_manifest(str(manifest))


def test_manifest_rejects_duplicate_entries(tmp_path: Path) -> None:
    manifest = _write_manifest(tmp_path)
    manifest.write_text(manifest.read_text() * 2, encoding="utf-8")

    with pytest.raises(cleanup_service.OrphanCleanupError, match="duplicate entry"):
        cleanup_service._load_cleanup_manifest(str(manifest))


@pytest.mark.parametrize("failure", ["incomplete", "digest"])
def test_manifest_requires_a_completed_unchanged_audit(tmp_path: Path, failure: str) -> None:
    manifest = _write_manifest(tmp_path)
    if failure == "incomplete":
        metadata_path = manifest.with_name("metadata.json")
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        metadata["completed_at"] = None
        metadata_path.write_text(json.dumps(metadata), encoding="utf-8")
    else:
        manifest.write_text(manifest.read_text(encoding="utf-8") + "\n", encoding="utf-8")

    with pytest.raises(cleanup_service.OrphanCleanupError, match="complete, unchanged audit output"):
        cleanup_service._load_cleanup_manifest(str(manifest))


def test_delete_collection_accepts_404_only_when_collection_is_absent(monkeypatch: pytest.MonkeyPatch) -> None:
    response = httpx.Response(404, request=httpx.Request("DELETE", "https://qdrant.example.com"))
    client = MagicMock()
    client.delete_collection.side_effect = UnexpectedResponse.for_response(response)
    monkeypatch.setattr(cleanup_service, "_qdrant_collection_exists", lambda _client, _name: False)

    cleanup_service._delete_tidb_collection(client, _collection_name())


def test_delete_collection_fails_when_collection_still_exists(monkeypatch: pytest.MonkeyPatch) -> None:
    client = MagicMock()
    monkeypatch.setattr(cleanup_service, "_qdrant_collection_exists", lambda _client, _name: True)

    with pytest.raises(cleanup_service._QdrantDeleteError, match="still exists") as exc_info:
        cleanup_service._delete_tidb_collection(client, _collection_name())

    assert exc_info.value.qdrant_state == "present"


def test_delete_collection_reports_unknown_when_verification_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    client = MagicMock()
    monkeypatch.setattr(
        cleanup_service,
        "_qdrant_collection_exists",
        MagicMock(side_effect=RuntimeError("verification failed")),
    )

    with pytest.raises(cleanup_service._QdrantDeleteError, match="Could not verify") as exc_info:
        cleanup_service._delete_tidb_collection(client, _collection_name())

    assert exc_info.value.qdrant_state == "unknown"


def test_cleanup_journal_reads_redis_bytes(monkeypatch: pytest.MonkeyPatch) -> None:
    binding = _binding()
    pending = cleanup_service._PendingPgCleanup(
        tenant_id=TENANT_ID,
        dataset_id=DATASET_ID,
        collection_name=_collection_name(),
        binding_id=binding.id,
        cluster_id=binding.cluster_id,
        binding_ownership_digest=cleanup_service._tidb_binding_ownership_digest(binding),
    )
    fake_redis = MagicMock()
    fake_redis.hgetall.return_value = {
        pending.field.encode(): cleanup_service._pending_pg_cleanup_payload(pending).encode()
    }
    monkeypatch.setattr(cleanup_service, "redis_client", fake_redis)

    assert cleanup_service._load_pending_pg_cleanups() == [pending]


def test_completed_entry_is_held_on_a_later_full_run(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        cleanup_service,
        "_load_orphan_pg_states",
        lambda _repository, _tenant_id, _names: ({DATASET_ID: OrphanPgState()}, set()),
    )

    inspection = cleanup_service._inspect_missing_candidate_collections(
        MagicMock(),
        TENANT_ID,
        [_collection_name()],
    )[0]

    assert inspection.status == cleanup_service._ORPHAN_STATUS_HOLD


def test_targeted_success_is_not_deleted_again_by_a_later_full_run(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    manifest = _write_manifest(tmp_path)
    inspection = _ready_inspection()
    _patch_run(monkeypatch)
    lock = MagicMock()
    lock.__enter__.return_value = lock
    lock.owned.return_value = True
    lock.reacquire.return_value = True
    fake_redis = MagicMock()
    fake_redis.lock.return_value = lock
    monkeypatch.setattr(cleanup_service, "redis_client", fake_redis)
    collection_exists = iter([True, True, False])
    monkeypatch.setattr(
        cleanup_service,
        "_qdrant_collection_exists",
        lambda _client, _name: next(collection_exists),
    )
    monkeypatch.setattr(cleanup_service, "_inspect_tidb_orphan_collections", lambda *_args: [inspection])
    monkeypatch.setattr(
        cleanup_service,
        "_inspect_missing_candidate_collections",
        lambda *_args: [
            replace(
                inspection,
                status=cleanup_service._ORPHAN_STATUS_HOLD,
                reason="Already absent.",
                points=None,
                owner_points=None,
                points_after=None,
            )
        ],
    )
    delete_collection = MagicMock()
    delete_pg_rows = MagicMock(return_value={"child_chunks": 0, "summaries": 0, "segments": 1})
    monkeypatch.setattr(cleanup_service, "_delete_tidb_collection", delete_collection)
    monkeypatch.setattr(cleanup_service, "_delete_orphan_pg_rows", delete_pg_rows)
    monkeypatch.setattr(cleanup_service, "schedule_billing_vector_space_refresh", MagicMock())
    first_output = tmp_path / "targeted.jsonl"
    second_output = tmp_path / "full.jsonl"

    first = CliRunner().invoke(
        vector_commands.cleanup_orphaned_tidb_collections,
        [
            "--manifest",
            str(manifest),
            "--output",
            str(first_output),
            "--dataset-id",
            DATASET_ID,
        ],
    )
    second = CliRunner().invoke(
        vector_commands.cleanup_orphaned_tidb_collections,
        ["--manifest", str(manifest), "--output", str(second_output)],
    )

    assert first.exit_code == 0, (first.output, first.exception)
    assert second.exit_code == 0, (second.output, second.exception)
    delete_collection.assert_called_once()
    delete_pg_rows.assert_called_once()
    second_records = _read_ledger(second_output)
    assert second_records[0]["selection"]["scope"] == "all"
    assert [record["record_type"] for record in second_records] == [
        "run_started",
        "inspection",
        "run_finished",
    ]
    assert second_records[1]["outcome"] == cleanup_service._ORPHAN_STATUS_HOLD


def test_recent_manifest_entry_is_scanned_without_age_gate(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    cleanup_logs: pytest.LogCaptureFixture,
) -> None:
    manifest = _write_manifest(tmp_path, first_seen_at=datetime.now(UTC) - timedelta(hours=1))
    _, client = _patch_run(monkeypatch)
    exists = MagicMock(return_value=True)
    inspect = MagicMock(return_value=[_ready_inspection()])
    monkeypatch.setattr(cleanup_service, "_qdrant_collection_exists", exists)
    monkeypatch.setattr(cleanup_service, "_inspect_tidb_orphan_collections", inspect)

    result, _ = _invoke_cleanup(tmp_path, manifest, "--dry-run")

    assert result.exit_code == 0, result.output
    exists.assert_called_once()
    inspect.assert_called_once()
    client.delete_collection.assert_not_called()
    assert "ready=1" in cleanup_logs.text
    assert "24 hours" not in cleanup_logs.text


def test_dry_run_has_no_mutating_side_effects(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    cleanup_logs: pytest.LogCaptureFixture,
) -> None:
    manifest = _write_manifest(tmp_path)
    inspection = _ready_inspection()
    _, client = _patch_run(monkeypatch)
    monkeypatch.setattr(cleanup_service, "_qdrant_collection_exists", lambda _client, _name: True)
    monkeypatch.setattr(
        cleanup_service,
        "_inspect_tidb_orphan_collections",
        lambda _repository, _tenant_id, _client, _names: [inspection],
    )
    delete_collection = MagicMock()
    delete_pg_rows = MagicMock()
    refresh = MagicMock()
    monkeypatch.setattr(cleanup_service, "_delete_tidb_collection", delete_collection)
    monkeypatch.setattr(cleanup_service, "_delete_orphan_pg_rows", delete_pg_rows)
    monkeypatch.setattr(cleanup_service, "schedule_billing_vector_space_refresh", refresh)

    result, output = _invoke_cleanup(tmp_path, manifest, "--dry-run")

    assert result.exit_code == 0, (result.output, result.exception)
    assert "mode=DRY_RUN" in cleanup_logs.text
    assert "ready=1" in cleanup_logs.text
    delete_collection.assert_not_called()
    delete_pg_rows.assert_not_called()
    refresh.assert_not_called()
    client.delete_collection.assert_not_called()
    records = _read_ledger(output)
    assert [record["record_type"] for record in records] == ["run_started", "inspection", "run_finished"]
    assert {record["run_id"] for record in records} == {records[0]["run_id"]}
    assert {record["mode"] for record in records} == {"dry_run"}
    assert records[0]["manifest_sha256"] == sha256(manifest.read_bytes()).hexdigest()
    assert records[0]["metadata_sha256"] == sha256(manifest.with_name("metadata.json").read_bytes()).hexdigest()
    assert records[0]["manifest_entries"] == 1
    assert records[0]["selection"] == {"scope": "all", "dataset_ids": [], "entries": 1}
    assert records[1]["outcome"] == "READY"
    assert records[1]["observed_only"] is True
    assert records[-1]["status"] == "completed"
    assert "password" not in output.read_text(encoding="utf-8")
    assert "qdrant.example.com" not in output.read_text(encoding="utf-8")


def test_execute_deletes_qdrant_before_postgres(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    cleanup_logs: pytest.LogCaptureFixture,
) -> None:
    events: list[str] = []
    manifest = _write_manifest(tmp_path)
    inspection = _ready_inspection()
    _patch_run(monkeypatch)

    class FakeLock:
        def __enter__(self):
            events.append("lock")
            return self

        def __exit__(self, exc_type, exc_value, traceback):
            events.append("unlock")

        def owned(self):
            events.append("owned")
            return True

        def reacquire(self):
            events.append("reacquire")
            return True

    class FakeRedis:
        def lock(self, *_args, **_kwargs):
            return FakeLock()

        def delete(self, _key):
            events.append("redis")

    monkeypatch.setattr(cleanup_service, "redis_client", FakeRedis())
    monkeypatch.setattr(cleanup_service, "_qdrant_collection_exists", lambda _client, _name: True)
    monkeypatch.setattr(
        cleanup_service,
        "_inspect_tidb_orphan_collections",
        lambda _repository, _tenant_id, _client, _names: [inspection],
    )
    monkeypatch.setattr(cleanup_service, "_store_pending_pg_cleanup", lambda _pending: events.append("journal"))
    monkeypatch.setattr(cleanup_service, "_delete_tidb_collection", lambda _client, _name: events.append("qdrant"))
    monkeypatch.setattr(
        cleanup_service,
        "_delete_orphan_pg_rows",
        lambda _repository, _tenant_id, _dataset_id, _batch_size: (
            events.append("postgres") or {"child_chunks": 1, "summaries": 2, "segments": 4}
        ),
    )
    monkeypatch.setattr(cleanup_service, "_clear_pending_pg_cleanup", lambda _pending: events.append("clear"))
    monkeypatch.setattr(
        cleanup_service,
        "schedule_billing_vector_space_refresh",
        lambda _tenant_id: events.append("refresh"),
    )

    result, output = _invoke_cleanup(tmp_path, manifest)

    assert result.exit_code == 0, (result.output, result.exception)
    assert events == [
        "lock",
        "journal",
        "owned",
        "reacquire",
        "qdrant",
        "unlock",
        "redis",
        "postgres",
        "clear",
        "refresh",
    ]
    assert "status=DELETED" in cleanup_logs.text
    action_result = next(record for record in _read_ledger(output) if record["record_type"] == "action_result")
    assert action_result["outcome"] == "DELETED"
    assert action_result["qdrant_state"] == "absent"
    assert action_result["pg_state"] == "cleaned"
    assert action_result["pg_deleted"] == {"child_chunks": 1, "segments": 4, "summaries": 2}


def test_final_state_change_prevents_deletion(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    cleanup_logs: pytest.LogCaptureFixture,
) -> None:
    manifest = _write_manifest(tmp_path)
    initial = _ready_inspection()
    changed = replace(initial, points=11, owner_points=11, points_after=11)
    inspections = iter([[initial], [changed]])
    _patch_run(monkeypatch)
    monkeypatch.setattr(cleanup_service, "redis_client", MagicMock())
    monkeypatch.setattr(cleanup_service, "_qdrant_collection_exists", lambda _client, _name: True)
    monkeypatch.setattr(cleanup_service, "_inspect_tidb_orphan_collections", lambda *_args: next(inspections))
    delete_collection = MagicMock()
    monkeypatch.setattr(cleanup_service, "_delete_tidb_collection", delete_collection)

    result, output = _invoke_cleanup(tmp_path, manifest)

    assert result.exit_code != 0
    delete_collection.assert_not_called()
    assert "state changed" in cleanup_logs.text
    action_result = next(record for record in _read_ledger(output) if record["record_type"] == "action_result")
    assert action_result["outcome"] == "FAILED"
    assert action_result["qdrant_state"] == "present"


def test_journal_write_failure_prevents_qdrant_deletion(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    manifest = _write_manifest(tmp_path)
    inspection = _ready_inspection()
    _patch_run(monkeypatch)
    monkeypatch.setattr(cleanup_service, "redis_client", MagicMock())
    monkeypatch.setattr(cleanup_service, "_qdrant_collection_exists", lambda _client, _name: True)
    monkeypatch.setattr(cleanup_service, "_inspect_tidb_orphan_collections", lambda *_args: [inspection])
    monkeypatch.setattr(
        cleanup_service,
        "_store_pending_pg_cleanup",
        MagicMock(side_effect=cleanup_service.OrphanCleanupError("journal failed")),
    )
    delete_collection = MagicMock()
    monkeypatch.setattr(cleanup_service, "_delete_tidb_collection", delete_collection)

    result, output = _invoke_cleanup(tmp_path, manifest)

    assert result.exit_code != 0
    delete_collection.assert_not_called()
    action_result = next(record for record in _read_ledger(output) if record["record_type"] == "action_result")
    assert action_result["outcome"] == "FAILED"
    assert action_result["phase"] == "journal"
    assert action_result["qdrant_state"] == "present"
    assert action_result["pg_state"] == "unchanged"
    assert action_result["journal_state"] == "unknown"


def test_pending_manifest_entry_resumes_postgres_only(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    cleanup_logs: pytest.LogCaptureFixture,
) -> None:
    manifest = _write_manifest(tmp_path, first_seen_at=datetime.now(UTC))
    binding = _binding()
    pending = cleanup_service._PendingPgCleanup(
        tenant_id=TENANT_ID,
        dataset_id=DATASET_ID,
        collection_name=_collection_name(),
        binding_id=binding.id,
        cluster_id=binding.cluster_id,
        binding_ownership_digest=cleanup_service._tidb_binding_ownership_digest(binding),
    )
    inspection = _ready_inspection()
    _patch_run(monkeypatch, binding=binding)
    monkeypatch.setattr(cleanup_service, "_load_pending_pg_cleanups", lambda: [pending])
    monkeypatch.setattr(cleanup_service, "redis_client", MagicMock())
    monkeypatch.setattr(cleanup_service, "_qdrant_collection_exists", lambda _client, _name: False)
    monkeypatch.setattr(cleanup_service, "_inspect_pg_only_orphan_collections", lambda *_args: [inspection])
    delete_collection = MagicMock()
    delete_pg_rows = MagicMock(return_value={"child_chunks": 1, "summaries": 0, "segments": 1})
    monkeypatch.setattr(cleanup_service, "_delete_tidb_collection", delete_collection)
    monkeypatch.setattr(cleanup_service, "_delete_orphan_pg_rows", delete_pg_rows)
    monkeypatch.setattr(cleanup_service, "schedule_billing_vector_space_refresh", MagicMock())

    result, output = _invoke_cleanup(tmp_path, manifest)

    assert result.exit_code == 0, (result.output, result.exception)
    delete_collection.assert_not_called()
    delete_pg_rows.assert_called_once()
    assert "status=PG_CLEANED" in cleanup_logs.text
    action_result = next(record for record in _read_ledger(output) if record["record_type"] == "action_result")
    assert action_result["outcome"] == "PG_CLEANED"


@pytest.mark.parametrize(
    ("failure_stage", "expected_outcome", "expected_qdrant_state", "expected_pg_state"),
    [
        ("qdrant", "FAILED", "unknown", "unchanged"),
        ("postgres", "PARTIAL", "absent", "partial_or_unknown"),
    ],
)
def test_execute_ledger_preserves_uncertain_partial_results(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    failure_stage: str,
    expected_outcome: str,
    expected_qdrant_state: str,
    expected_pg_state: str,
) -> None:
    manifest = _write_manifest(tmp_path)
    inspection = _ready_inspection()
    _patch_run(monkeypatch)
    lock = MagicMock()
    lock.__enter__.return_value = lock
    lock.owned.return_value = True
    lock.reacquire.return_value = True
    fake_redis = MagicMock()
    fake_redis.lock.return_value = lock
    monkeypatch.setattr(cleanup_service, "redis_client", fake_redis)
    monkeypatch.setattr(cleanup_service, "_qdrant_collection_exists", lambda _client, _name: True)
    monkeypatch.setattr(cleanup_service, "_inspect_tidb_orphan_collections", lambda *_args: [inspection])
    if failure_stage == "qdrant":
        monkeypatch.setattr(
            cleanup_service,
            "_delete_tidb_collection",
            MagicMock(
                side_effect=cleanup_service._QdrantDeleteError(
                    "Could not verify deletion.",
                    cleanup_service._QDRANT_STATE_UNKNOWN,
                )
            ),
        )
    else:
        monkeypatch.setattr(cleanup_service, "_delete_tidb_collection", lambda *_args: None)
        monkeypatch.setattr(
            cleanup_service,
            "_delete_orphan_pg_rows",
            MagicMock(side_effect=RuntimeError("postgres failed")),
        )

    result, output = _invoke_cleanup(tmp_path, manifest)

    assert result.exit_code != 0
    records = _read_ledger(output)
    action_result = next(record for record in records if record["record_type"] == "action_result")
    assert action_result["outcome"] == expected_outcome
    assert action_result["qdrant_state"] == expected_qdrant_state
    assert action_result["pg_state"] == expected_pg_state
    assert records[-1]["record_type"] == "run_finished"
    assert records[-1]["status"] == "completed_with_failures"


@pytest.mark.parametrize("warning_stage", ["cache", "journal"])
def test_execute_ledger_keeps_successful_outcome_with_cleanup_warning(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    warning_stage: str,
) -> None:
    manifest = _write_manifest(tmp_path)
    inspection = _ready_inspection()
    _patch_run(monkeypatch)
    lock = MagicMock()
    lock.__enter__.return_value = lock
    lock.owned.return_value = True
    lock.reacquire.return_value = True
    fake_redis = MagicMock()
    fake_redis.lock.return_value = lock
    if warning_stage == "cache":
        fake_redis.delete.side_effect = RuntimeError("cache response lost")
    else:
        monkeypatch.setattr(
            cleanup_service,
            "_clear_pending_pg_cleanup",
            MagicMock(side_effect=RuntimeError("journal response lost")),
        )
    monkeypatch.setattr(cleanup_service, "redis_client", fake_redis)
    monkeypatch.setattr(cleanup_service, "_qdrant_collection_exists", lambda _client, _name: True)
    monkeypatch.setattr(cleanup_service, "_inspect_tidb_orphan_collections", lambda *_args: [inspection])
    monkeypatch.setattr(cleanup_service, "_delete_tidb_collection", lambda *_args: None)
    monkeypatch.setattr(
        cleanup_service,
        "_delete_orphan_pg_rows",
        lambda *_args: {"child_chunks": 1, "summaries": 2, "segments": 4},
    )

    result, output = _invoke_cleanup(tmp_path, manifest)

    assert result.exit_code != 0
    records = _read_ledger(output)
    action_result = next(record for record in records if record["record_type"] == "action_result")
    assert action_result["outcome"] == "DELETED"
    assert action_result["qdrant_state"] == "absent"
    assert action_result["pg_state"] == "cleaned"
    assert action_result["warnings"]
    if warning_stage == "cache":
        assert action_result["cache_cleanup"] == "unknown"
        assert action_result["journal_state"] == "cleared"
    else:
        assert action_result["cache_cleanup"] == "succeeded"
        assert action_result["journal_state"] == "unknown"
    assert records[-1]["status"] == "completed_with_failures"


def test_action_started_ledger_failure_stops_before_mutation(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    manifest = _write_manifest(tmp_path)
    inspection = _ready_inspection()
    _patch_run(monkeypatch)
    monkeypatch.setattr(cleanup_service, "_qdrant_collection_exists", lambda _client, _name: True)
    monkeypatch.setattr(cleanup_service, "_inspect_tidb_orphan_collections", lambda *_args: [inspection])
    delete_collection = MagicMock()
    delete_pg_rows = MagicMock()
    monkeypatch.setattr(cleanup_service, "_delete_tidb_collection", delete_collection)
    monkeypatch.setattr(cleanup_service, "_delete_orphan_pg_rows", delete_pg_rows)
    write_ledger = cleanup_service._write_cleanup_ledger

    def fail_on_action_started(stream, record):
        if record["record_type"] == "action_started":
            raise cleanup_service.OrphanCleanupError("ledger unavailable")
        write_ledger(stream, record)

    monkeypatch.setattr(cleanup_service, "_write_cleanup_ledger", fail_on_action_started)

    result, output = _invoke_cleanup(tmp_path, manifest)

    assert result.exit_code != 0
    delete_collection.assert_not_called()
    delete_pg_rows.assert_not_called()
    records = _read_ledger(output)
    assert [record["record_type"] for record in records] == ["run_started", "inspection", "run_aborted"]


def test_cleanup_output_is_exclusive(tmp_path: Path) -> None:
    manifest = _write_manifest(tmp_path)
    output = tmp_path / "cleanup-result.jsonl"
    output.write_text("existing\n", encoding="utf-8")

    result = CliRunner().invoke(
        vector_commands.cleanup_orphaned_tidb_collections,
        ["--manifest", str(manifest), "--output", str(output), "--dry-run"],
    )

    assert result.exit_code != 0
    assert output.read_text(encoding="utf-8") == "existing\n"
    assert "could not be created exclusively" in result.output


def test_cleanup_requires_output(tmp_path: Path) -> None:
    manifest = _write_manifest(tmp_path)

    result = CliRunner().invoke(
        vector_commands.cleanup_orphaned_tidb_collections,
        ["--manifest", str(manifest), "--dry-run"],
    )

    assert result.exit_code == 2
    assert "Missing option '--output'" in result.output


def test_scan_failure_is_recorded_for_the_manifest_entry(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    manifest = _write_manifest(tmp_path)
    _patch_run(monkeypatch)
    monkeypatch.setattr(
        cleanup_service,
        "_load_tidb_binding",
        MagicMock(side_effect=cleanup_service.OrphanCleanupError("binding unavailable")),
    )

    result, output = _invoke_cleanup(tmp_path, manifest, "--dry-run")

    assert result.exit_code != 0
    records = _read_ledger(output)
    inspection = next(record for record in records if record["record_type"] == "inspection")
    assert inspection["outcome"] == "FAILED"
    assert inspection["phase"] == "scan"
    assert inspection["dataset_id"] == DATASET_ID
    assert records[-1]["record_type"] == "run_finished"
    assert records[-1]["status"] == "completed_with_failures"


def test_cleanup_help_exposes_manifest_output_and_dry_run() -> None:
    result = CliRunner().invoke(vector_commands.cleanup_orphaned_tidb_collections, ["--help"])

    assert result.exit_code == 0
    assert "--manifest" in result.output
    assert "--output" in result.output
    assert "--dataset-id" in result.output
    assert "--tenant-id" not in result.output
    assert "--dry-run" in result.output
    for removed_option in ("--source", "--scan-limit", "--cursor", "--batch-size", "--force", "--execute"):
        assert removed_option not in result.output


def test_audit_help_exposes_only_output_directory() -> None:
    result = CliRunner().invoke(vector_commands.audit_orphaned_tidb_collections, ["--help"])

    assert result.exit_code == 0
    assert "--output-dir" in result.output
    assert "--tenant-id" not in result.output
    assert "--dry-run" not in result.output
