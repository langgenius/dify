from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from sqlalchemy.dialects import postgresql

from models.dataset import DocumentSegment
from models.enums import TidbAuthBindingStatus
from repositories.tidb_orphan_cleanup_repository import (
    OrphanAuditRecord,
    TidbBindingRecord,
    TidbOrphanCleanupRepository,
    TidbOrphanCleanupRepositoryError,
)

TENANT_ID = "49a99e46-bc2c-4885-91fa-47615f6192b5"
DATASET_ID = "e6024578-41b7-4fb5-a81f-9201358e5835"
TENANT_ID_2 = "8d0de8c7-95db-4458-aabe-3e4bb42f970a"
TENANT_ID_3 = "b33434af-0de0-4f01-8f84-20bb98b6cbf1"
DATASET_ID_2 = "e7024578-41b7-4fb5-a81f-9201358e5835"
DATASET_ID_3 = "f6024578-41b7-4fb5-a81f-9201358e5835"


def _result(rows):
    result = MagicMock()
    result.__iter__.return_value = iter(rows)
    result.all.return_value = rows
    return result


def _scalar_result(values):
    result = MagicMock()
    result.__iter__.return_value = iter(values)
    result.all.return_value = values
    return result


def _session_maker(session: MagicMock) -> MagicMock:
    context = MagicMock()
    context.__enter__.return_value = session
    maker = MagicMock(return_value=context)
    return maker


def test_get_active_binding_returns_a_detached_record() -> None:
    session = MagicMock()
    session.scalars.return_value.all.return_value = [
        SimpleNamespace(
            id="binding-id",
            tenant_id=TENANT_ID,
            cluster_id="cluster-id",
            status=TidbAuthBindingStatus.ACTIVE,
            account="account",
            password="password",
            qdrant_endpoint="https://qdrant.example.com",
        )
    ]
    repository = TidbOrphanCleanupRepository(_session_maker(session))

    binding = repository.get_active_binding(TENANT_ID)

    assert binding == TidbBindingRecord(
        id="binding-id",
        tenant_id=TENANT_ID,
        cluster_id="cluster-id",
        status=TidbAuthBindingStatus.ACTIVE,
        account="account",
        password="password",
        qdrant_endpoint="https://qdrant.example.com",
    )
    statement = session.scalars.call_args.args[0]
    compiled = str(statement.compile(dialect=postgresql.dialect())).lower()
    assert compiled.count("not (exists (select") == 1
    assert "tidb_auth_bindings_1.active is true" in compiled
    assert (
        "tidb_auth_bindings_1.tenant_id = tidb_auth_bindings.tenant_id or "
        "tidb_auth_bindings_1.cluster_id = tidb_auth_bindings.cluster_id"
    ) in compiled
    assert compiled.count(".id != tidb_auth_bindings.id") == 1


def test_get_active_binding_rejects_ambiguous_ownership() -> None:
    session = MagicMock()
    session.scalars.return_value.all.return_value = [
        SimpleNamespace(tenant_id=TENANT_ID, status=TidbAuthBindingStatus.ACTIVE),
        SimpleNamespace(tenant_id=TENANT_ID, status=TidbAuthBindingStatus.ACTIVE),
    ]
    repository = TidbOrphanCleanupRepository(_session_maker(session))

    with pytest.raises(TidbOrphanCleanupRepositoryError, match="exclusive cluster ownership"):
        repository.get_active_binding(TENANT_ID)


def test_audit_orphan_segment_bucket_uses_loose_index_and_excludes_live_datasets() -> None:
    session = MagicMock()
    session.execute.side_effect = [
        _result([(DATASET_ID,), (DATASET_ID_2,), (DATASET_ID_3,)]),
        _result([(DATASET_ID_2, TENANT_ID_2, 0)]),
        _result([(DATASET_ID_3, TENANT_ID_3, 4)]),
    ]
    session.scalars.side_effect = [
        _scalar_result([DATASET_ID]),
        _scalar_result([]),
    ]
    repository = TidbOrphanCleanupRepository(_session_maker(session))
    repository._AUDIT_LOOKUP_BATCH_SIZE = 2

    records = repository.audit_orphan_segment_bucket(10)

    assert records == (
        OrphanAuditRecord(dataset_id=DATASET_ID_2, tenant_id=TENANT_ID_2, documents=0),
        OrphanAuditRecord(dataset_id=DATASET_ID_3, tenant_id=TENANT_ID_3, documents=4),
    )

    distinct_stmt, distinct_params = session.execute.call_args_list[0].args
    distinct_sql = str(distinct_stmt)
    assert "WITH RECURSIVE distinct_dataset_ids" in distinct_sql
    assert "document_segments.dataset_id >= CAST(:bucket_start AS uuid)" in distinct_sql
    assert "ds.dataset_id > distinct_dataset_ids.dataset_id" in distinct_sql
    assert "GROUP BY" not in distinct_sql.upper()
    assert "datasets" not in distinct_sql
    assert distinct_params == {
        "bucket_start": "0a000000-0000-0000-0000-000000000000",
        "bucket_end": "0b000000-0000-0000-0000-000000000000",
    }

    assert session.scalars.call_count == 2
    live_dataset_sql = str(session.scalars.call_args_list[0].args[0].compile(dialect=postgresql.dialect()))
    assert "datasets.id IN" in live_dataset_sql
    assert session.execute.call_args_list[1].args[1] == {"dataset_ids": [DATASET_ID_2]}
    assert session.execute.call_args_list[2].args[1] == {"dataset_ids": [DATASET_ID_3]}

    audit_sql = str(session.execute.call_args_list[1].args[0])
    assert "unnest(CAST(:dataset_ids AS uuid[]))" in audit_sql
    assert "JOIN LATERAL" in audit_sql
    assert "ORDER BY ds.tenant_id" in audit_sql
    assert "SELECT count(*)" in audit_sql


def test_audit_orphan_segment_bucket_handles_last_bucket_without_an_upper_bound() -> None:
    session = MagicMock()
    session.execute.side_effect = [
        _result([(DATASET_ID_3,)]),
        _result([(DATASET_ID_3, TENANT_ID_3, 0)]),
    ]
    session.scalars.return_value = _scalar_result([])
    repository = TidbOrphanCleanupRepository(_session_maker(session))

    records = repository.audit_orphan_segment_bucket(255)

    assert records == (OrphanAuditRecord(dataset_id=DATASET_ID_3, tenant_id=TENANT_ID_3, documents=0),)
    distinct_stmt, distinct_params = session.execute.call_args_list[0].args
    distinct_sql = str(distinct_stmt)
    assert distinct_params == {"bucket_start": "ff000000-0000-0000-0000-000000000000"}
    assert "bucket_end" not in distinct_sql
    assert ":tenant_id" not in distinct_sql

    audit_stmt, audit_params = session.execute.call_args_list[1].args
    assert ":tenant_id" not in str(audit_stmt)
    assert audit_params == {"dataset_ids": [DATASET_ID_3]}


@pytest.mark.parametrize("bucket", [-1, 256])
def test_audit_orphan_segment_bucket_rejects_invalid_bucket(bucket: int) -> None:
    repository = TidbOrphanCleanupRepository(MagicMock())

    with pytest.raises(ValueError, match="between 0 and 255"):
        repository.audit_orphan_segment_bucket(bucket)


def test_load_pg_states_maps_all_cleanup_evidence() -> None:
    session = MagicMock()
    session.execute.side_effect = [
        _result([("current-dataset", '{"type":"tidb_on_qdrant"}')]),
        _result([]),
        _result([]),
        _result([(DATASET_ID, 2)]),
        _result([(DATASET_ID, 3)]),
        _result([(DATASET_ID, 4)]),
        _result([(DATASET_ID, 3)]),
        _result([(DATASET_ID, 5)]),
        _result([(DATASET_ID, 4)]),
        _result([(DATASET_ID, 6)]),
        _result([(DATASET_ID, 6)]),
        _result([(DATASET_ID, 7)]),
    ]
    session.scalars.side_effect = [
        _scalar_result([DATASET_ID]),
        _scalar_result([]),
        _scalar_result([DATASET_ID]),
    ]
    repository = TidbOrphanCleanupRepository(_session_maker(session))

    states, tenant_datasets = repository.load_pg_states(TENANT_ID, {DATASET_ID})

    state = states[DATASET_ID]
    assert state.annotation_setting_exists is True
    assert state.annotation_exists is False
    assert state.documents == 2
    assert state.segments == 3
    assert state.indexed_segments == 3
    assert state.child_chunks == 5
    assert state.indexed_child_chunks == 4
    assert state.summaries == 6
    assert state.indexed_summaries == 6
    assert state.attachment_bindings == 7
    assert state.foreign_tenant_segments is True
    assert state.live_document_segments is True
    assert tenant_datasets[0].id == "current-dataset"


def test_load_pg_states_still_returns_live_datasets_without_canonical_ids() -> None:
    session = MagicMock()
    session.execute.return_value = _result([("current-dataset", '{"vector_store":{"class_prefix":"legacy"}}')])
    repository = TidbOrphanCleanupRepository(_session_maker(session))

    states, tenant_datasets = repository.load_pg_states(TENANT_ID, set())

    assert states == {}
    assert tenant_datasets[0].id == "current-dataset"
    assert tenant_datasets[0].index_struct == '{"vector_store":{"class_prefix":"legacy"}}'
    session.execute.assert_called_once()


def test_delete_orphan_rows_uses_dependency_order(monkeypatch: pytest.MonkeyPatch) -> None:
    repository = TidbOrphanCleanupRepository(MagicMock())
    deleted_tables: list[str] = []

    def delete_rows(model, *_args):
        deleted_tables.append(model.__tablename__)
        return 1

    verify = MagicMock()
    monkeypatch.setattr(repository, "_delete_rows_in_batches", delete_rows)
    monkeypatch.setattr(repository, "verify_orphan_rows_deleted", verify)

    counts = repository.delete_orphan_rows(TENANT_ID, DATASET_ID, 5000)

    assert deleted_tables == ["child_chunks", "document_segment_summaries", "document_segments"]
    assert counts == {"child_chunks": 1, "summaries": 1, "segments": 1}
    verify.assert_called_once_with(TENANT_ID, DATASET_ID)


def test_ownership_guard_blocks_row_deletion() -> None:
    session = MagicMock()
    session.execute.return_value.one.return_value = (False, True, False, False, False, False)
    repository = TidbOrphanCleanupRepository(MagicMock())

    with pytest.raises(TidbOrphanCleanupRepositoryError, match="ownership changed"):
        repository._assert_cleanup_is_safe(session, TENANT_ID, DATASET_ID)


def test_ownership_guard_blocks_foreign_segment() -> None:
    session = MagicMock()
    session.execute.return_value.one.return_value = (False, False, False, False, False, True)
    repository = TidbOrphanCleanupRepository(MagicMock())

    with pytest.raises(TidbOrphanCleanupRepositoryError, match="ownership changed"):
        repository._assert_cleanup_is_safe(session, TENANT_ID, DATASET_ID)


def test_ownership_guard_blocks_segment_linked_to_a_live_document() -> None:
    session = MagicMock()
    session.execute.return_value.one.return_value = (False, False, False, False, False, False, True)
    repository = TidbOrphanCleanupRepository(MagicMock())

    with pytest.raises(TidbOrphanCleanupRepositoryError, match="ownership changed"):
        repository._assert_cleanup_is_safe(session, TENANT_ID, DATASET_ID)

    compiled_sql = str(session.execute.call_args.args[0].compile(dialect=postgresql.dialect()))
    assert "JOIN documents ON documents.id = document_segments.document_id" in compiled_sql


def test_delete_rows_rechecks_ownership_in_every_batch(monkeypatch: pytest.MonkeyPatch) -> None:
    sessions = [MagicMock(), MagicMock(), MagicMock()]
    row_batches = [["row-1", "row-2"], ["row-3"], []]
    for session, row_ids in zip(sessions, row_batches, strict=True):
        session.scalars.return_value = row_ids
        session.execute.return_value = SimpleNamespace(rowcount=len(row_ids))

    contexts = []
    for session in sessions:
        context = MagicMock()
        context.__enter__.return_value = session
        contexts.append(context)
    session_maker = MagicMock()
    session_maker.begin.side_effect = contexts
    repository = TidbOrphanCleanupRepository(session_maker)
    ownership_guard = MagicMock()
    monkeypatch.setattr(repository, "_assert_cleanup_is_safe", ownership_guard)

    deleted = repository._delete_rows_in_batches(
        DocumentSegment,
        (DocumentSegment.tenant_id == TENANT_ID, DocumentSegment.dataset_id == DATASET_ID),
        TENANT_ID,
        DATASET_ID,
        batch_size=2,
    )

    assert deleted == 3
    assert session_maker.begin.call_count == 3
    assert [call.args for call in ownership_guard.call_args_list] == [
        (sessions[0], TENANT_ID, DATASET_ID),
        (sessions[1], TENANT_ID, DATASET_ID),
        (sessions[2], TENANT_ID, DATASET_ID),
    ]
    sessions[0].execute.assert_called_once()
    sessions[1].execute.assert_called_once()
    sessions[2].execute.assert_not_called()
