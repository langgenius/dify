"""Audit and clean orphaned TiDB-on-Qdrant collections."""

import json
import logging
import os
from collections import Counter
from contextlib import suppress
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from hashlib import sha256
from pathlib import Path
from typing import Any, TextIO
from uuid import UUID, uuid4

from configs import dify_config
from extensions.ext_redis import redis_client
from models.dataset import Dataset
from repositories.tidb_orphan_cleanup_repository import (
    OrphanPgState as _OrphanPgState,
)
from repositories.tidb_orphan_cleanup_repository import (
    TidbBindingRecord,
    TidbOrphanCleanupRepository,
    TidbOrphanCleanupRepositoryError,
    create_tidb_orphan_cleanup_repository,
)
from tasks.refresh_billing_vector_space_task import schedule_billing_vector_space_refresh

logger = logging.getLogger(__name__)


class OrphanCleanupError(RuntimeError):
    pass


class _QdrantDeleteError(OrphanCleanupError):
    def __init__(self, message: str, qdrant_state: str) -> None:
        super().__init__(message)
        self.qdrant_state = qdrant_state


_ORPHAN_STATUS_ALIVE = "ALIVE"
_ORPHAN_STATUS_BLOCKED = "BLOCKED"
_ORPHAN_STATUS_CANDIDATE = "CANDIDATE"
_ORPHAN_STATUS_HOLD = "HOLD"
_ORPHAN_STATUS_PROTECTED = "PROTECTED"
_ORPHAN_STATUS_READY = "READY"
_ORPHAN_PG_CLEANUP_JOURNAL_KEY = "orphan_tidb_pg_cleanup_pending"
_ORPHAN_PG_DELETE_BATCH_SIZE = 5000
_ORPHAN_AUDIT_BUCKET_COUNT = 256
_QDRANT_STATE_ABSENT = "absent"
_QDRANT_STATE_PRESENT = "present"
_QDRANT_STATE_UNKNOWN = "unknown"


@dataclass(frozen=True)
class _OrphanCollectionInspection:
    collection_name: str
    dataset_id: str | None
    status: str
    reason: str
    pg: _OrphanPgState = _OrphanPgState()
    points: int | None = None
    owner_points: int | None = None
    points_after: int | None = None


@dataclass(frozen=True)
class _OrphanTenantScan:
    tenant_id: str
    cluster_id: str
    binding_fingerprint: tuple[str, str, str]
    binding_ownership_digest: str
    inspections: tuple[_OrphanCollectionInspection, ...]
    remote_collections: frozenset[str]
    pg_only_collections: frozenset[str] = frozenset()


@dataclass(frozen=True)
class _OrphanManifestEntry:
    tenant_id: str
    dataset_id: str
    first_seen_at: datetime
    bucket: str


@dataclass(frozen=True)
class _PendingPgCleanup:
    tenant_id: str
    dataset_id: str
    collection_name: str
    binding_id: str
    cluster_id: str
    binding_ownership_digest: str

    @property
    def field(self) -> str:
        return f"{self.tenant_id}:{self.dataset_id}"


def _canonical_collection_name(owner_id: str) -> str:
    return Dataset.gen_collection_name_by_id(owner_id)


def _parse_tidb_dataset_collection_name(collection_name: str) -> str | None:
    prefix = f"{dify_config.VECTOR_INDEX_NAME_PREFIX}_"
    suffix = "_Node"
    if not collection_name.startswith(prefix) or not collection_name.endswith(suffix):
        return None

    raw_id = collection_name[len(prefix) : -len(suffix)]
    try:
        dataset_id = str(UUID(raw_id.replace("_", "-")))
    except ValueError:
        return None

    if _canonical_collection_name(dataset_id) != collection_name:
        return None
    return dataset_id


def _parse_manifest_entry(value: Any, source: Path, line_number: int) -> _OrphanManifestEntry:
    try:
        if not isinstance(value, dict) or set(value) != {"tenant_id", "dataset_id", "first_seen_at", "bucket"}:
            raise ValueError
        if not isinstance(value["tenant_id"], str) or not isinstance(value["dataset_id"], str):
            raise ValueError
        tenant_id = str(UUID(value["tenant_id"]))
        dataset_uuid = UUID(value["dataset_id"])
        dataset_id = str(dataset_uuid)
        if tenant_id != value["tenant_id"] or dataset_id != value["dataset_id"]:
            raise ValueError
        if not isinstance(value["first_seen_at"], str):
            raise ValueError
        first_seen_at = datetime.fromisoformat(value["first_seen_at"])
        if first_seen_at.tzinfo is None or first_seen_at.astimezone(UTC) > datetime.now(UTC):
            raise ValueError
        bucket = value["bucket"]
        if not isinstance(bucket, str) or bucket.lower() != dataset_uuid.hex[:2]:
            raise ValueError
    except (AttributeError, KeyError, TypeError, ValueError) as exc:
        raise OrphanCleanupError(f"Invalid manifest entry at {source}:{line_number}.") from exc
    return _OrphanManifestEntry(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        first_seen_at=first_seen_at.astimezone(UTC),
        bucket=bucket.lower(),
    )


def _load_cleanup_manifest(path: str) -> tuple[list[_OrphanManifestEntry], str, str]:
    manifest_path = Path(path)
    if manifest_path.name != "ready.jsonl" or not manifest_path.is_file():
        raise OrphanCleanupError(f"Cleanup manifest does not exist: {manifest_path}.")

    entries: dict[tuple[str, str], _OrphanManifestEntry] = {}
    try:
        manifest_bytes = manifest_path.read_bytes()
        for line_number, line in enumerate(manifest_bytes.decode("utf-8").splitlines(), start=1):
            if not line.strip():
                continue
            entry = _parse_manifest_entry(json.loads(line), manifest_path, line_number)
            key = (entry.tenant_id, entry.dataset_id)
            if key in entries:
                raise OrphanCleanupError(
                    f"Manifest contains a duplicate entry for tenant {entry.tenant_id}, dataset {entry.dataset_id}."
                )
            entries[key] = entry
    except OrphanCleanupError:
        raise
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise OrphanCleanupError(f"Cleanup manifest could not be read safely: {manifest_path}.") from exc

    try:
        metadata_bytes = manifest_path.with_name("metadata.json").read_bytes()
        metadata = json.loads(metadata_bytes.decode("utf-8"))
        ready_metadata = metadata["manifests"]["ready"]
        summary = metadata["summary"]
        buckets = metadata["buckets"]
        expected_buckets = {f"{bucket:02x}" for bucket in range(_ORPHAN_AUDIT_BUCKET_COUNT)}
        manifest_digest = sha256(manifest_bytes).hexdigest()
        if (
            metadata["schema_version"] != 1
            or not isinstance(metadata["completed_at"], str)
            or not metadata["completed_at"]
            or not isinstance(buckets, dict)
            or set(buckets) != expected_buckets
            or summary["completed_buckets"] != _ORPHAN_AUDIT_BUCKET_COUNT
            or summary["ready"] != len(entries)
            or ready_metadata["file"] != manifest_path.name
            or ready_metadata["count"] != len(entries)
            or ready_metadata["sha256"] != manifest_digest
        ):
            raise ValueError
    except (KeyError, OSError, TypeError, ValueError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise OrphanCleanupError(
            f"Cleanup manifest is not a complete, unchanged audit output: {manifest_path}."
        ) from exc
    return [entries[key] for key in sorted(entries)], manifest_digest, sha256(metadata_bytes).hexdigest()


def _utc_timestamp() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _open_cleanup_ledger(path: str) -> TextIO:
    ledger_path = Path(path)
    try:
        descriptor = os.open(ledger_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        return os.fdopen(descriptor, "w", encoding="utf-8")
    except OSError as exc:
        raise OrphanCleanupError(f"Cleanup output could not be created exclusively: {ledger_path}.") from exc


def _write_cleanup_ledger(stream: TextIO, record: dict[str, Any]) -> None:
    try:
        stream.write(json.dumps(record, sort_keys=True, separators=(",", ":")) + "\n")
        stream.flush()
        os.fsync(stream.fileno())
    except OSError as exc:
        raise OrphanCleanupError("Cleanup output could not be written safely.") from exc


def _cleanup_entry_record(
    *,
    run_id: str,
    mode: str,
    record_type: str,
    entry: _OrphanManifestEntry,
    collection_name: str,
    binding_id: str | None,
    cluster_id: str | None,
    **values: Any,
) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "record_type": record_type,
        "run_id": run_id,
        "recorded_at": _utc_timestamp(),
        "mode": mode,
        "tenant_id": entry.tenant_id,
        "dataset_id": entry.dataset_id,
        "collection_name": collection_name,
        "bucket": entry.bucket,
        "first_seen_at": entry.first_seen_at.isoformat().replace("+00:00", "Z"),
        "binding_id": binding_id,
        "cluster_id": cluster_id,
        **values,
    }


def _index_struct_collection_name(dataset_id: str, index_struct: str | None) -> str | None:
    if not index_struct:
        return None
    try:
        value = json.loads(index_struct)
    except (TypeError, json.JSONDecodeError) as exc:
        raise OrphanCleanupError(f"Dataset {dataset_id} has an invalid index_struct; cleanup was stopped.") from exc

    if not isinstance(value, dict):
        raise OrphanCleanupError(f"Dataset {dataset_id} has an invalid index_struct; cleanup was stopped.")
    vector_store = value.get("vector_store")
    if vector_store is None:
        return None
    if not isinstance(vector_store, dict):
        raise OrphanCleanupError(f"Dataset {dataset_id} has an invalid vector_store; cleanup was stopped.")
    collection_name = vector_store.get("class_prefix")
    if collection_name is None:
        return None
    if not isinstance(collection_name, str):
        raise OrphanCleanupError(f"Dataset {dataset_id} has an invalid class_prefix; cleanup was stopped.")
    return collection_name


def _load_orphan_pg_states(
    repository: TidbOrphanCleanupRepository,
    tenant_id: str,
    collection_names: list[str],
) -> tuple[dict[str, _OrphanPgState], set[str]]:
    dataset_ids = {
        dataset_id
        for collection_name in collection_names
        if (dataset_id := _parse_tidb_dataset_collection_name(collection_name)) is not None
    }
    states, tenant_datasets = repository.load_pg_states(tenant_id, dataset_ids)
    current_collection_names: set[str] = set()
    for dataset in tenant_datasets:
        current_collection_names.add(_canonical_collection_name(dataset.id))
        if collection_name := _index_struct_collection_name(dataset.id, dataset.index_struct):
            current_collection_names.add(collection_name)
    return states, current_collection_names


def _classify_orphan_pg_state(
    tenant_id: str,
    collection_name: str,
    state: _OrphanPgState,
    current_collection_names: set[str],
    *,
    require_indexed_evidence: bool = True,
) -> tuple[str, str]:
    if state.dataset_tenant_id == tenant_id or collection_name in current_collection_names:
        return _ORPHAN_STATUS_ALIVE, "A current dataset owns this collection."
    if state.dataset_tenant_id is not None:
        return _ORPHAN_STATUS_PROTECTED, "The decoded dataset ID belongs to another tenant."
    if state.app_tenant_id is not None:
        return _ORPHAN_STATUS_PROTECTED, "The collection ID belongs to an app and may contain Annotation Reply data."
    if state.annotation_setting_exists or state.annotation_exists:
        return _ORPHAN_STATUS_PROTECTED, "Annotation Reply records still reference this collection ID."
    if state.foreign_tenant_segments:
        return _ORPHAN_STATUS_HOLD, "Document segments with this dataset ID belong to more than one tenant."
    if state.documents or state.live_document_segments:
        return _ORPHAN_STATUS_BLOCKED, "A live Document still owns rows in this dataset cleanup scope."
    if require_indexed_evidence and not (
        state.indexed_segments or state.indexed_child_chunks or state.indexed_summaries
    ):
        return _ORPHAN_STATUS_HOLD, "No indexed PostgreSQL rows prove that this was a dataset collection."
    return _ORPHAN_STATUS_CANDIDATE, "PostgreSQL ownership guards passed."


def _count_owned_tidb_points(client: Any, collection_name: str, dataset_id: str) -> tuple[int, int, int]:
    from qdrant_client.http import models as qdrant_models

    from core.rag.datasource.vdb.field import Field

    points = int(client.count(collection_name, exact=True).count)
    owner_filter = qdrant_models.Filter(
        must=[
            qdrant_models.FieldCondition(
                key=Field.GROUP_KEY,
                match=qdrant_models.MatchValue(value=dataset_id),
            )
        ]
    )
    owner_points = int(client.count(collection_name, count_filter=owner_filter, exact=True).count)
    points_after = int(client.count(collection_name, exact=True).count)
    return points, owner_points, points_after


def _classify_orphan_point_counts(points: int, owner_points: int, points_after: int) -> tuple[str, str]:
    if points <= 0:
        return _ORPHAN_STATUS_HOLD, "The collection is empty, so vector ownership cannot be verified."
    if points != points_after:
        return _ORPHAN_STATUS_HOLD, "The collection changed while ownership was being checked."
    if owner_points != points:
        return _ORPHAN_STATUS_HOLD, "Not every point belongs to the decoded dataset ID."
    return _ORPHAN_STATUS_READY, "The dataset is gone and every point belongs to its decoded dataset ID."


def _inspect_tidb_orphan_collections(
    repository: TidbOrphanCleanupRepository,
    tenant_id: str,
    client: Any,
    collection_names: list[str],
) -> list[_OrphanCollectionInspection]:
    states, current_collection_names = _load_orphan_pg_states(repository, tenant_id, collection_names)

    inspections: list[_OrphanCollectionInspection] = []
    for collection_name in collection_names:
        dataset_id = _parse_tidb_dataset_collection_name(collection_name)
        if collection_name in current_collection_names:
            state = states.get(dataset_id, _OrphanPgState()) if dataset_id is not None else _OrphanPgState()
            inspections.append(
                _OrphanCollectionInspection(
                    collection_name=collection_name,
                    dataset_id=dataset_id,
                    status=_ORPHAN_STATUS_ALIVE,
                    reason="A current dataset owns this collection.",
                    pg=state,
                )
            )
            continue
        if dataset_id is None:
            inspections.append(
                _OrphanCollectionInspection(
                    collection_name=collection_name,
                    dataset_id=None,
                    status=_ORPHAN_STATUS_HOLD,
                    reason="The custom or legacy collection name cannot be mapped to a PostgreSQL owner safely.",
                )
            )
            continue

        state = states[dataset_id]
        status, reason = _classify_orphan_pg_state(tenant_id, collection_name, state, current_collection_names)
        if status != _ORPHAN_STATUS_CANDIDATE:
            inspections.append(_OrphanCollectionInspection(collection_name, dataset_id, status, reason, pg=state))
            continue

        try:
            points, owner_points, points_after = _count_owned_tidb_points(client, collection_name, dataset_id)
        except Exception as exc:
            raise OrphanCleanupError(
                f"Qdrant point counting failed for collection {collection_name} ({type(exc).__name__})."
            ) from exc
        if points != points_after:
            raise OrphanCleanupError(f"Collection {collection_name} changed while it was being scanned.")

        status, reason = _classify_orphan_point_counts(points, owner_points, points_after)
        inspections.append(
            _OrphanCollectionInspection(
                collection_name,
                dataset_id,
                status,
                reason,
                pg=state,
                points=points,
                owner_points=owner_points,
                points_after=points_after,
            )
        )
    return inspections


def _inspect_missing_candidate_collections(
    repository: TidbOrphanCleanupRepository,
    tenant_id: str,
    collection_names: list[str],
) -> list[_OrphanCollectionInspection]:
    states, current_collection_names = _load_orphan_pg_states(repository, tenant_id, collection_names)
    inspections: list[_OrphanCollectionInspection] = []
    for collection_name in collection_names:
        dataset_id = _parse_tidb_dataset_collection_name(collection_name)
        if dataset_id is None:
            raise OrphanCleanupError(f"Invalid PostgreSQL orphan candidate collection name: {collection_name}.")
        state = states[dataset_id]
        status, reason = _classify_orphan_pg_state(tenant_id, collection_name, state, current_collection_names)
        if status == _ORPHAN_STATUS_CANDIDATE:
            status = _ORPHAN_STATUS_HOLD
            reason = (
                "No canonical collection exists; a custom legacy collection or completed cleanup cannot be ruled out."
            )
        inspections.append(_OrphanCollectionInspection(collection_name, dataset_id, status, reason, pg=state))
    return inspections


def _inspect_pg_only_orphan_collections(
    repository: TidbOrphanCleanupRepository,
    tenant_id: str,
    collection_names: list[str],
) -> list[_OrphanCollectionInspection]:
    states, current_collection_names = _load_orphan_pg_states(repository, tenant_id, collection_names)

    inspections: list[_OrphanCollectionInspection] = []
    for collection_name in collection_names:
        dataset_id = _parse_tidb_dataset_collection_name(collection_name)
        if dataset_id is None:
            raise OrphanCleanupError(f"Invalid collection name in the PostgreSQL cleanup journal: {collection_name}.")
        state = states[dataset_id]
        status, reason = _classify_orphan_pg_state(
            tenant_id,
            collection_name,
            state,
            current_collection_names,
            require_indexed_evidence=False,
        )
        if status == _ORPHAN_STATUS_CANDIDATE:
            status = _ORPHAN_STATUS_READY
            reason = "The cleanup journal proves the collection was removed and PostgreSQL guards passed."
        inspections.append(_OrphanCollectionInspection(collection_name, dataset_id, status, reason, pg=state))
    return inspections


def _pending_pg_cleanup_payload(pending: _PendingPgCleanup) -> str:
    return json.dumps(
        {
            "binding_id": pending.binding_id,
            "cluster_id": pending.cluster_id,
            "collection_name": pending.collection_name,
            "dataset_id": pending.dataset_id,
            "binding_ownership_digest": pending.binding_ownership_digest,
            "tenant_id": pending.tenant_id,
        },
        sort_keys=True,
        separators=(",", ":"),
    )


def _load_pending_pg_cleanups() -> list[_PendingPgCleanup]:
    """Load cleanup intents written before Qdrant deletion.

    A manifest proves only that a dataset was a cleanup candidate. This journal
    proves that this command started Qdrant deletion on a specific binding, so a
    retry may finish PostgreSQL cleanup after the collection is already absent.
    """
    try:
        raw_entries = redis_client.hgetall(_ORPHAN_PG_CLEANUP_JOURNAL_KEY)
        pending_entries: list[_PendingPgCleanup] = []
        for raw_field, raw_payload in raw_entries.items():
            field = raw_field.decode() if isinstance(raw_field, bytes) else str(raw_field)
            payload_text = raw_payload.decode() if isinstance(raw_payload, bytes) else str(raw_payload)
            payload = json.loads(payload_text)
            pending = _PendingPgCleanup(
                tenant_id=str(payload["tenant_id"]),
                dataset_id=str(payload["dataset_id"]),
                collection_name=str(payload["collection_name"]),
                binding_id=str(payload["binding_id"]),
                cluster_id=str(payload["cluster_id"]),
                binding_ownership_digest=str(payload["binding_ownership_digest"]),
            )
            if (
                pending.field != field
                or str(UUID(pending.tenant_id)) != pending.tenant_id
                or str(UUID(pending.dataset_id)) != pending.dataset_id
                or _parse_tidb_dataset_collection_name(pending.collection_name) != pending.dataset_id
            ):
                raise ValueError("invalid cleanup journal entry")
            pending_entries.append(pending)
        return sorted(pending_entries, key=lambda pending: pending.field)
    except Exception as exc:
        raise OrphanCleanupError("The orphan cleanup journal could not be read safely.") from exc


def _store_pending_pg_cleanup(pending: _PendingPgCleanup) -> None:
    if redis_client.hexists(_ORPHAN_PG_CLEANUP_JOURNAL_KEY, pending.field):
        existing = {entry.field: entry for entry in _load_pending_pg_cleanups()}.get(pending.field)
        if existing != pending:
            raise OrphanCleanupError("A conflicting PostgreSQL cleanup journal entry already exists.")
    redis_client.hset(_ORPHAN_PG_CLEANUP_JOURNAL_KEY, pending.field, _pending_pg_cleanup_payload(pending))


def _clear_pending_pg_cleanup(pending: _PendingPgCleanup) -> None:
    redis_client.hdel(_ORPHAN_PG_CLEANUP_JOURNAL_KEY, pending.field)


def _load_tidb_binding(
    repository: TidbOrphanCleanupRepository,
    tenant_id: str,
) -> TidbBindingRecord:
    try:
        return repository.get_active_binding(tenant_id)
    except TidbOrphanCleanupRepositoryError as exc:
        raise OrphanCleanupError(str(exc)) from exc


def _tidb_binding_fingerprint(binding: TidbBindingRecord) -> tuple[str, str, str]:
    endpoint = binding.qdrant_endpoint or dify_config.TIDB_ON_QDRANT_URL or ""
    credential_digest = sha256(f"{binding.account}\0{binding.password}\0{endpoint}".encode()).hexdigest()
    return binding.id, binding.cluster_id, credential_digest


def _tidb_binding_ownership_digest(binding: TidbBindingRecord) -> str:
    endpoint = binding.qdrant_endpoint or dify_config.TIDB_ON_QDRANT_URL or ""
    return sha256(f"{binding.account}\0{endpoint}".encode()).hexdigest()


def _build_tidb_qdrant_client(binding: TidbBindingRecord, root_path: str) -> Any:
    import qdrant_client
    from dify_vdb_tidb_on_qdrant.tidb_on_qdrant_vector import TidbOnQdrantConfig

    endpoint = binding.qdrant_endpoint or dify_config.TIDB_ON_QDRANT_URL or ""
    if not endpoint:
        raise OrphanCleanupError("The active TiDB binding has no Qdrant endpoint.")
    config = TidbOnQdrantConfig(
        endpoint=endpoint,
        api_key=f"{binding.account}:{binding.password}",
        root_path=root_path,
        timeout=dify_config.TIDB_ON_QDRANT_CLIENT_TIMEOUT,
        grpc_port=dify_config.TIDB_ON_QDRANT_GRPC_PORT,
        prefer_grpc=False,
        replication_factor=dify_config.QDRANT_REPLICATION_FACTOR,
    )
    params: Any = config.to_qdrant_params()
    return qdrant_client.QdrantClient(**params)


def _close_qdrant_client(client: Any) -> None:
    close = getattr(client, "close", None)
    if callable(close):
        with suppress(Exception):
            close()


def _qdrant_collection_exists(client: Any, collection_name: str) -> bool:
    from qdrant_client.http.exceptions import UnexpectedResponse

    try:
        client.get_collection(collection_name)
    except UnexpectedResponse as exc:
        if exc.status_code == 404:
            return False
        raise
    return True


def _delete_tidb_collection(client: Any, collection_name: str) -> None:
    from qdrant_client.http.exceptions import UnexpectedResponse

    deletion_error: Exception | None = None
    try:
        client.delete_collection(
            collection_name,
            timeout=int(dify_config.TIDB_ON_QDRANT_CLIENT_TIMEOUT),
        )
    except UnexpectedResponse as exc:
        if exc.status_code != 404:
            deletion_error = exc
    except Exception as exc:
        deletion_error = exc

    try:
        collection_exists = _qdrant_collection_exists(client, collection_name)
    except Exception as exc:
        raise _QdrantDeleteError(
            f"Could not verify deletion of collection {collection_name} ({type(exc).__name__}).",
            _QDRANT_STATE_UNKNOWN,
        ) from exc

    if collection_exists:
        if deletion_error is not None:
            raise _QdrantDeleteError(
                f"Collection {collection_name} still exists after deletion failed ({type(deletion_error).__name__}).",
                _QDRANT_STATE_PRESENT,
            ) from deletion_error
        raise _QdrantDeleteError(
            f"Collection {collection_name} still exists after deletion.",
            _QDRANT_STATE_PRESENT,
        )


def _delete_orphan_pg_rows(
    repository: TidbOrphanCleanupRepository,
    tenant_id: str,
    dataset_id: str,
    batch_size: int,
) -> dict[str, int]:
    try:
        return repository.delete_orphan_rows(tenant_id, dataset_id, batch_size)
    except TidbOrphanCleanupRepositoryError as exc:
        raise OrphanCleanupError(str(exc)) from exc


def _optional_count(value: int | None) -> str:
    return "-" if value is None else str(value)


def _log_orphan_inspection(tenant_id: str, inspection: _OrphanCollectionInspection) -> None:
    logger.info(
        " ".join(
            [
                f"status={inspection.status}",
                f"tenant={tenant_id}",
                f"collection={inspection.collection_name}",
                f"dataset_id={inspection.dataset_id or '-'}",
                f"documents={inspection.pg.documents}",
                f"live_document_segments={str(inspection.pg.live_document_segments).lower()}",
                f"segments={inspection.pg.segments}",
                f"indexed_segments={inspection.pg.indexed_segments}",
                f"child_chunks={inspection.pg.child_chunks}",
                f"indexed_child_chunks={inspection.pg.indexed_child_chunks}",
                f"summaries={inspection.pg.summaries}",
                f"indexed_summaries={inspection.pg.indexed_summaries}",
                f"attachment_bindings={inspection.pg.attachment_bindings}",
                f"points={_optional_count(inspection.points)}",
                f"owner_points={_optional_count(inspection.owner_points)}",
                f"reason={json.dumps(inspection.reason)}",
            ]
        )
    )


def _safe_cleanup_error(exc: Exception) -> str:
    if isinstance(exc, (OrphanCleanupError, TidbOrphanCleanupRepositoryError)):
        return str(exc)
    return type(exc).__name__


def _run_tidb_orphan_cleanup(
    *,
    manifest_path: str,
    manifest_entries: list[_OrphanManifestEntry],
    dry_run: bool,
    root_path: str,
    ledger: TextIO,
    run_id: str,
) -> tuple[dict[str, int], OrphanCleanupError | None]:
    repository = create_tidb_orphan_cleanup_repository()
    mode = "DRY_RUN" if dry_run else "EXECUTE"
    ledger_mode = "dry_run" if dry_run else "execute"
    manifest_by_collection = {
        (entry.tenant_id, _canonical_collection_name(entry.dataset_id)): entry for entry in manifest_entries
    }
    manifest_keys = {(entry.tenant_id, entry.dataset_id) for entry in manifest_entries}
    pending_pg_cleanups = [
        pending for pending in _load_pending_pg_cleanups() if (pending.tenant_id, pending.dataset_id) in manifest_keys
    ]
    pending_by_tenant: dict[str, list[_PendingPgCleanup]] = {}
    for pending in pending_pg_cleanups:
        pending_by_tenant.setdefault(pending.tenant_id, []).append(pending)

    candidate_names_by_tenant: dict[str, set[str]] = {}
    for entry in manifest_entries:
        candidate_names_by_tenant.setdefault(entry.tenant_id, set()).add(_canonical_collection_name(entry.dataset_id))

    required_tenant_ids = set(candidate_names_by_tenant) | set(pending_by_tenant)
    scans: list[_OrphanTenantScan] = []
    scan_failures: dict[str, str] = {}
    for position, selected_tenant in enumerate(sorted(required_tenant_ids), start=1):
        logger.info(
            "status=SCANNING tenant=%s position=%s/%s",
            selected_tenant,
            position,
            len(required_tenant_ids),
        )
        try:
            binding = _load_tidb_binding(repository, selected_tenant)
            client = _build_tidb_qdrant_client(binding, root_path)
            try:
                tenant_pending = pending_by_tenant.get(selected_tenant, [])
                for pending in tenant_pending:
                    if (
                        pending.binding_id != binding.id
                        or pending.cluster_id != binding.cluster_id
                        or pending.binding_ownership_digest != _tidb_binding_ownership_digest(binding)
                    ):
                        raise OrphanCleanupError("A pending PostgreSQL cleanup belongs to a different binding.")
                candidate_names = candidate_names_by_tenant.get(selected_tenant, set())
                pending_names = {pending.collection_name for pending in tenant_pending}
                remote_collection_names = {
                    collection_name
                    for collection_name in candidate_names | pending_names
                    if _qdrant_collection_exists(client, collection_name)
                }
                target_names = sorted((candidate_names | pending_names) & remote_collection_names)
                inspections = (
                    _inspect_tidb_orphan_collections(repository, selected_tenant, client, target_names)
                    if target_names
                    else []
                )
                pg_only_collections = frozenset(
                    pending.collection_name
                    for pending in tenant_pending
                    if pending.collection_name not in remote_collection_names
                )
                missing_candidate_names = sorted(candidate_names - remote_collection_names - pg_only_collections)
                if missing_candidate_names:
                    inspections.extend(
                        _inspect_missing_candidate_collections(repository, selected_tenant, missing_candidate_names)
                    )
                if pg_only_collections:
                    inspections.extend(
                        _inspect_pg_only_orphan_collections(repository, selected_tenant, sorted(pg_only_collections))
                    )
                inspections_by_name = {inspection.collection_name: inspection for inspection in inspections}
                for pending in tenant_pending:
                    if inspections_by_name[pending.collection_name].status != _ORPHAN_STATUS_READY:
                        raise OrphanCleanupError(
                            f"Pending cleanup {pending.dataset_id} is no longer safe to continue automatically."
                        )
            finally:
                _close_qdrant_client(client)
            scans.append(
                _OrphanTenantScan(
                    tenant_id=selected_tenant,
                    cluster_id=binding.cluster_id,
                    binding_fingerprint=_tidb_binding_fingerprint(binding),
                    binding_ownership_digest=_tidb_binding_ownership_digest(binding),
                    inspections=tuple(inspections),
                    remote_collections=frozenset(remote_collection_names),
                    pg_only_collections=pg_only_collections,
                )
            )
        except Exception as exc:
            scan_failures[selected_tenant] = _safe_cleanup_error(exc)

    logger.info(
        "mode=%s manifest=%s entries=%s tenants=%s tenant_failures=%s collections=%s",
        mode,
        manifest_path,
        len(manifest_entries),
        len(scans),
        len(scan_failures),
        sum(len(scan.inspections) for scan in scans),
    )
    for failed_scope, reason in sorted(scan_failures.items()):
        failed_tenant = failed_scope if not failed_scope.startswith("binding:") else "-"
        logger.error("status=FAILED tenant=%s phase=scan reason=%s", failed_tenant, json.dumps(reason))
    for scan in scans:
        logger.info(
            "status=SCANNED tenant=%s cluster=%s collections=%s",
            scan.tenant_id,
            scan.cluster_id,
            len(scan.inspections),
        )
        for inspection in scan.inspections:
            _log_orphan_inspection(scan.tenant_id, inspection)

    for entry in manifest_entries:
        if entry.tenant_id in scan_failures:
            reason = scan_failures[entry.tenant_id]
            _write_cleanup_ledger(
                ledger,
                _cleanup_entry_record(
                    run_id=run_id,
                    mode=ledger_mode,
                    record_type="inspection",
                    entry=entry,
                    collection_name=_canonical_collection_name(entry.dataset_id),
                    binding_id=None,
                    cluster_id=None,
                    outcome="FAILED",
                    phase="scan",
                    observed_only=True,
                    reason=reason,
                    qdrant_state=_QDRANT_STATE_UNKNOWN,
                    pg_state="not_checked",
                ),
            )
    for scan in scans:
        for inspection in scan.inspections:
            entry = manifest_by_collection[(scan.tenant_id, inspection.collection_name)]
            qdrant_state = (
                _QDRANT_STATE_PRESENT if inspection.collection_name in scan.remote_collections else _QDRANT_STATE_ABSENT
            )
            _write_cleanup_ledger(
                ledger,
                _cleanup_entry_record(
                    run_id=run_id,
                    mode=ledger_mode,
                    record_type="inspection",
                    entry=entry,
                    collection_name=inspection.collection_name,
                    binding_id=scan.binding_fingerprint[0],
                    cluster_id=scan.cluster_id,
                    outcome=inspection.status,
                    phase="inspection",
                    observed_only=True,
                    reason=inspection.reason,
                    qdrant_state=qdrant_state,
                    pg_state="unchanged",
                    pg=asdict(inspection.pg),
                    qdrant={
                        "points": inspection.points,
                        "owner_points": inspection.owner_points,
                        "points_after": inspection.points_after,
                    },
                ),
            )
    status_counts = Counter(inspection.status for scan in scans for inspection in scan.inspections)
    ready = [
        (scan, inspection)
        for scan in scans
        for inspection in scan.inspections
        if inspection.status == _ORPHAN_STATUS_READY
    ]
    completed = 0
    failed_collections: set[tuple[str, str]] = set()
    absent_collections: set[tuple[str, str]] = set()
    tenants_to_refresh: set[str] = set()
    pg_deleted: Counter[str] = Counter()
    attachment_bindings_left = 0

    if not dry_run:
        for scan, initial in ready:
            tenant_id_str = scan.tenant_id
            entry = manifest_by_collection[(tenant_id_str, initial.collection_name)]
            dataset_id = initial.dataset_id
            if dataset_id is None:
                failed_collections.add((tenant_id_str, initial.collection_name))
                reason = "The collection name no longer resolves to a dataset ID."
                logger.error(
                    "status=FAILED tenant=%s collection=%s "
                    'phase=validation_or_qdrant collection_absent=false reason="The collection name no longer '
                    'resolves to a dataset ID."',
                    tenant_id_str,
                    initial.collection_name,
                )
                _write_cleanup_ledger(
                    ledger,
                    _cleanup_entry_record(
                        run_id=run_id,
                        mode=ledger_mode,
                        record_type="action_result",
                        entry=entry,
                        collection_name=initial.collection_name,
                        binding_id=scan.binding_fingerprint[0],
                        cluster_id=scan.cluster_id,
                        outcome="FAILED",
                        phase="validation",
                        observed_only=False,
                        reason=reason,
                        qdrant_state=_QDRANT_STATE_UNKNOWN,
                        pg_state="not_checked",
                    ),
                )
                continue
            pg_only_cleanup = initial.collection_name in scan.pg_only_collections
            pending_cleanup = _PendingPgCleanup(
                tenant_id=tenant_id_str,
                dataset_id=dataset_id,
                collection_name=initial.collection_name,
                binding_id=scan.binding_fingerprint[0],
                cluster_id=scan.cluster_id,
                binding_ownership_digest=scan.binding_ownership_digest,
            )

            qdrant_state = (
                _QDRANT_STATE_PRESENT if initial.collection_name in scan.remote_collections else _QDRANT_STATE_ABSENT
            )
            journal_state = "pending" if pg_only_cleanup else "not_written"
            cache_cleanup = "not_attempted"
            warnings: list[str] = []
            collection_removed = False
            phase = "lock"
            validation_error: Exception | None = None
            _write_cleanup_ledger(
                ledger,
                _cleanup_entry_record(
                    run_id=run_id,
                    mode=ledger_mode,
                    record_type="action_started",
                    entry=entry,
                    collection_name=initial.collection_name,
                    binding_id=scan.binding_fingerprint[0],
                    cluster_id=scan.cluster_id,
                    qdrant_state=qdrant_state,
                    pg_state="unchanged",
                    journal_state=journal_state,
                ),
            )
            try:
                with redis_client.lock(
                    f"vector_indexing_lock_{initial.collection_name}",
                    timeout=120,
                    blocking_timeout=10,
                ) as collection_lock:
                    phase = "validation"
                    current_binding = _load_tidb_binding(repository, tenant_id_str)
                    if _tidb_binding_fingerprint(current_binding) != scan.binding_fingerprint:
                        raise OrphanCleanupError("The tenant TiDB binding changed after the initial scan.")

                    current_client = _build_tidb_qdrant_client(current_binding, root_path)
                    try:
                        try:
                            collection_exists = _qdrant_collection_exists(current_client, initial.collection_name)
                        except Exception:
                            qdrant_state = _QDRANT_STATE_UNKNOWN
                            raise
                        qdrant_state = _QDRANT_STATE_PRESENT if collection_exists else _QDRANT_STATE_ABSENT
                        if pg_only_cleanup and collection_exists:
                            raise OrphanCleanupError("The collection reappeared before final validation.")
                        if not pg_only_cleanup and not collection_exists:
                            raise OrphanCleanupError("The collection disappeared before final validation.")
                        if pg_only_cleanup:
                            current = _inspect_pg_only_orphan_collections(
                                repository, tenant_id_str, [initial.collection_name]
                            )[0]
                        else:
                            current = _inspect_tidb_orphan_collections(
                                repository,
                                tenant_id_str,
                                current_client,
                                [initial.collection_name],
                            )[0]
                        if current != initial:
                            raise OrphanCleanupError("Collection or PostgreSQL state changed after the initial scan.")
                        phase = "journal"
                        journal_state = "unknown"
                        _store_pending_pg_cleanup(pending_cleanup)
                        journal_state = "pending"
                        phase = "lock"
                        if not collection_lock.owned() or not collection_lock.reacquire():
                            raise OrphanCleanupError("The collection lock expired before deletion.")
                        if not pg_only_cleanup:
                            phase = "qdrant"
                            try:
                                _delete_tidb_collection(current_client, initial.collection_name)
                            except _QdrantDeleteError as exc:
                                qdrant_state = exc.qdrant_state
                                raise
                            qdrant_state = _QDRANT_STATE_ABSENT
                        collection_removed = True
                    finally:
                        _close_qdrant_client(current_client)
            except Exception as exc:
                validation_error = exc

            if collection_removed:
                collection_key = (tenant_id_str, initial.collection_name)
                absent_collections.add(collection_key)
                tenants_to_refresh.add(tenant_id_str)
                try:
                    redis_client.delete(f"vector_indexing_{initial.collection_name}")
                    cache_cleanup = "succeeded"
                except Exception as exc:
                    failed_collections.add(collection_key)
                    warning = (
                        f"Collection is absent, but Redis cache cleanup could not be confirmed ({type(exc).__name__})."
                    )
                    warnings.append(warning)
                    cache_cleanup = "unknown"
                    logger.warning(
                        "status=WARNING tenant=%s collection=%s reason=%s",
                        tenant_id_str,
                        initial.collection_name,
                        json.dumps(warning),
                    )

            if validation_error is not None:
                failed_collections.add((tenant_id_str, initial.collection_name))
                failure_phase = "after_qdrant" if collection_removed else phase
                reason = _safe_cleanup_error(validation_error)
                logger.error(
                    "status=FAILED tenant=%s collection=%s phase=%s qdrant_state=%s reason=%s",
                    tenant_id_str,
                    initial.collection_name,
                    failure_phase,
                    qdrant_state,
                    json.dumps(reason),
                )
                _write_cleanup_ledger(
                    ledger,
                    _cleanup_entry_record(
                        run_id=run_id,
                        mode=ledger_mode,
                        record_type="action_result",
                        entry=entry,
                        collection_name=initial.collection_name,
                        binding_id=scan.binding_fingerprint[0],
                        cluster_id=scan.cluster_id,
                        outcome="PARTIAL" if collection_removed else "FAILED",
                        phase=failure_phase,
                        observed_only=False,
                        reason=reason,
                        qdrant_state=qdrant_state,
                        pg_state="unchanged",
                        cache_cleanup=cache_cleanup,
                        journal_state=journal_state,
                        warnings=warnings,
                    ),
                )
                continue

            try:
                row_counts = _delete_orphan_pg_rows(
                    repository,
                    tenant_id_str,
                    dataset_id,
                    _ORPHAN_PG_DELETE_BATCH_SIZE,
                )
            except Exception as exc:
                failed_collections.add((tenant_id_str, initial.collection_name))
                reason = _safe_cleanup_error(exc)
                logger.error(  # noqa: TRY400 -- deliberately log only the sanitized error reason
                    "status=FAILED tenant=%s collection=%s phase=postgres qdrant_state=%s reason=%s",
                    tenant_id_str,
                    initial.collection_name,
                    _QDRANT_STATE_ABSENT,
                    json.dumps(reason),
                )
                _write_cleanup_ledger(
                    ledger,
                    _cleanup_entry_record(
                        run_id=run_id,
                        mode=ledger_mode,
                        record_type="action_result",
                        entry=entry,
                        collection_name=initial.collection_name,
                        binding_id=scan.binding_fingerprint[0],
                        cluster_id=scan.cluster_id,
                        outcome="PARTIAL",
                        phase="postgres",
                        observed_only=False,
                        reason=reason,
                        qdrant_state=_QDRANT_STATE_ABSENT,
                        pg_state="partial_or_unknown",
                        cache_cleanup=cache_cleanup,
                        journal_state=journal_state,
                        warnings=warnings,
                    ),
                )
                continue

            try:
                journal_state = "unknown"
                _clear_pending_pg_cleanup(pending_cleanup)
                journal_state = "cleared"
            except Exception as exc:
                failed_collections.add((tenant_id_str, initial.collection_name))
                warning = (
                    "PostgreSQL rows were cleaned, but the recovery journal could not be cleared "
                    f"({type(exc).__name__})."
                )
                warnings.append(warning)
                logger.warning(
                    "status=WARNING tenant=%s collection=%s reason=%s",
                    tenant_id_str,
                    initial.collection_name,
                    json.dumps(warning),
                )

            completed += 1
            pg_deleted.update(row_counts)
            attachment_bindings_left += initial.pg.attachment_bindings
            result_status = "PG_CLEANED" if pg_only_cleanup else "DELETED"
            logger.info(
                "status=%s tenant=%s collection=%s pg_rows=%s",
                result_status,
                tenant_id_str,
                initial.collection_name,
                sum(row_counts.values()),
            )
            _write_cleanup_ledger(
                ledger,
                _cleanup_entry_record(
                    run_id=run_id,
                    mode=ledger_mode,
                    record_type="action_result",
                    entry=entry,
                    collection_name=initial.collection_name,
                    binding_id=scan.binding_fingerprint[0],
                    cluster_id=scan.cluster_id,
                    outcome=result_status,
                    phase="complete",
                    observed_only=False,
                    reason="Cleanup completed.",
                    qdrant_state=_QDRANT_STATE_ABSENT,
                    pg_state="cleaned",
                    pg_deleted=row_counts,
                    cache_cleanup=cache_cleanup,
                    journal_state=journal_state,
                    warnings=warnings,
                ),
            )

        for tenant_to_refresh in sorted(tenants_to_refresh):
            schedule_billing_vector_space_refresh(tenant_to_refresh)

    failed = len(scan_failures) + len(failed_collections)
    summary_counts = {
        "alive": status_counts[_ORPHAN_STATUS_ALIVE],
        "protected": status_counts[_ORPHAN_STATUS_PROTECTED],
        "blocked": status_counts[_ORPHAN_STATUS_BLOCKED],
        "hold": status_counts[_ORPHAN_STATUS_HOLD],
        "ready": status_counts[_ORPHAN_STATUS_READY],
        "collections_absent": len(absent_collections),
        "completed": completed,
        "tenant_failures": len(scan_failures),
        "failed": failed,
        "pg_child_chunks_deleted": pg_deleted["child_chunks"],
        "pg_summaries_deleted": pg_deleted["summaries"],
        "pg_segments_deleted": pg_deleted["segments"],
        "pg_attachment_bindings_left": attachment_bindings_left,
    }
    summary = " ".join(f"{name}={value}" for name, value in summary_counts.items())
    logger.info("summary %s", summary)
    logger.info(
        "progress processed=%s total=%s completed=%s failed=%s",
        sum(len(scan.inspections) for scan in scans),
        len(manifest_entries),
        completed,
        failed,
    )

    if scan_failures:
        return summary_counts, OrphanCleanupError(f"The TiDB scan failed for {len(scan_failures)} scope(s).")
    if not dry_run and failed_collections:
        return summary_counts, OrphanCleanupError(
            f"Cleanup did not complete for {len(failed_collections)} collection(s)."
        )
    return summary_counts, None


def run_tidb_orphan_cleanup(
    *,
    manifest_path: str,
    dry_run: bool,
    output_path: str,
    dataset_ids: tuple[str, ...],
    root_path: str,
) -> None:
    all_manifest_entries, manifest_digest, metadata_digest = _load_cleanup_manifest(manifest_path)
    try:
        selected_dataset_ids = {str(UUID(dataset_id)) for dataset_id in dataset_ids}
    except ValueError as exc:
        raise OrphanCleanupError("A selected Dataset ID is invalid.") from exc
    manifest_dataset_ids = {entry.dataset_id for entry in all_manifest_entries}
    unknown_dataset_ids = selected_dataset_ids - manifest_dataset_ids
    if unknown_dataset_ids:
        unknown = ", ".join(sorted(unknown_dataset_ids))
        raise OrphanCleanupError(f"Selected Dataset IDs are not present in the manifest: {unknown}.")
    manifest_entries = [
        entry for entry in all_manifest_entries if not selected_dataset_ids or entry.dataset_id in selected_dataset_ids
    ]
    manifest = Path(manifest_path)
    run_id = str(uuid4())
    ledger_mode = "dry_run" if dry_run else "execute"
    ledger = _open_cleanup_ledger(output_path)

    with ledger:
        try:
            _write_cleanup_ledger(
                ledger,
                {
                    "schema_version": 1,
                    "record_type": "run_started",
                    "run_id": run_id,
                    "recorded_at": _utc_timestamp(),
                    "mode": ledger_mode,
                    "manifest": str(manifest),
                    "manifest_sha256": manifest_digest,
                    "metadata_sha256": metadata_digest,
                    "manifest_entries": len(all_manifest_entries),
                    "selection": {
                        "scope": "dataset_ids" if selected_dataset_ids else "all",
                        "dataset_ids": sorted(selected_dataset_ids),
                        "entries": len(manifest_entries),
                    },
                },
            )
            summary_counts, run_error = _run_tidb_orphan_cleanup(
                manifest_path=manifest_path,
                manifest_entries=manifest_entries,
                dry_run=dry_run,
                root_path=root_path,
                ledger=ledger,
                run_id=run_id,
            )
            _write_cleanup_ledger(
                ledger,
                {
                    "schema_version": 1,
                    "record_type": "run_finished",
                    "run_id": run_id,
                    "recorded_at": _utc_timestamp(),
                    "mode": ledger_mode,
                    "status": "completed_with_failures" if run_error is not None else "completed",
                    "counts": summary_counts,
                },
            )
        except Exception as exc:
            with suppress(Exception):
                _write_cleanup_ledger(
                    ledger,
                    {
                        "schema_version": 1,
                        "record_type": "run_aborted",
                        "run_id": run_id,
                        "recorded_at": _utc_timestamp(),
                        "mode": ledger_mode,
                        "reason": _safe_cleanup_error(exc),
                    },
                )
            raise

    if run_error is not None:
        raise run_error
