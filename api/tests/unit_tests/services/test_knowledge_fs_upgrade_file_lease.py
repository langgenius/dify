from __future__ import annotations

from datetime import timedelta
from unittest.mock import patch

from sqlalchemy.orm import Session, sessionmaker

from extensions.storage.storage_type import StorageType
from libs.datetime_utils import naive_utc_now
from models.dataset import Document
from models.enums import CreatorUserRole, DataSourceType, DocumentCreatedFrom
from models.knowledge_fs import (
    KnowledgeFSUpgradeFileLease,
    KnowledgeFSUpgradeFileLeaseStatus,
    KnowledgeFSUpgradeJob,
)
from models.model import UploadFile
from services.knowledge_fs.upgrade_file_lease import (
    active_upgrade_file_ids,
    cleanup_deferred_upgrade_files,
    release_upgrade_file_lease,
    reserve_upgrade_file_cleanup,
)

_TENANT_ID = "00000000-0000-0000-0000-000000000001"
_ACCOUNT_ID = "00000000-0000-0000-0000-000000000002"
_DATASET_ID = "00000000-0000-0000-0000-000000000003"
_ACTIVE_FILE_ID = "00000000-0000-0000-0000-000000000004"
_EXPIRED_FILE_ID = "00000000-0000-0000-0000-000000000005"


def test_only_active_unexpired_source_files_are_protected(sqlite_session_factory: sessionmaker[Session]) -> None:
    now = naive_utc_now()
    job = KnowledgeFSUpgradeJob(
        tenant_id=_TENANT_ID,
        old_dataset_id=_DATASET_ID,
        requested_by_account_id=_ACCOUNT_ID,
        owner_account_id=_ACCOUNT_ID,
        idempotency_key="upgrade-lease-test",
        snapshot_at=now,
        config_snapshot={},
        permission_snapshot={},
        app_binding_snapshot=[],
        tag_ids_snapshot=[],
    )
    with sqlite_session_factory.begin() as session:
        session.add(job)
        session.flush()
        session.add_all(
            [
                KnowledgeFSUpgradeFileLease(
                    job_id=job.id,
                    old_upload_file_id=_ACTIVE_FILE_ID,
                    expires_at=now + timedelta(minutes=1),
                ),
                KnowledgeFSUpgradeFileLease(
                    job_id=job.id,
                    old_upload_file_id=_EXPIRED_FILE_ID,
                    expires_at=now - timedelta(seconds=1),
                    status=KnowledgeFSUpgradeFileLeaseStatus.ACTIVE,
                ),
            ]
        )

    with sqlite_session_factory() as session:
        assert active_upgrade_file_ids(
            session,
            [_ACTIVE_FILE_ID, _EXPIRED_FILE_ID],
            now=now,
        ) == {_ACTIVE_FILE_ID}


def test_cleanup_request_is_persisted_on_every_active_lease(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    now = naive_utc_now()
    jobs = [
        KnowledgeFSUpgradeJob(
            tenant_id=_TENANT_ID,
            old_dataset_id=_DATASET_ID,
            requested_by_account_id=_ACCOUNT_ID,
            owner_account_id=_ACCOUNT_ID,
            idempotency_key=f"upgrade-cleanup-request-{index}",
            snapshot_at=now,
            config_snapshot={},
            permission_snapshot={},
            app_binding_snapshot=[],
            tag_ids_snapshot=[],
        )
        for index in range(2)
    ]
    with sqlite_session_factory.begin() as session:
        session.add_all(jobs)
        session.flush()
        leases = [
            KnowledgeFSUpgradeFileLease(
                job_id=job.id,
                old_upload_file_id=_ACTIVE_FILE_ID,
                expires_at=now + timedelta(minutes=1),
            )
            for job in jobs
        ]
        session.add_all(leases)

    with sqlite_session_factory.begin() as session:
        assert reserve_upgrade_file_cleanup(session, [_ACTIVE_FILE_ID], now=now) == {_ACTIVE_FILE_ID}

    with sqlite_session_factory() as session:
        persisted = list(
            session.query(KnowledgeFSUpgradeFileLease).filter_by(old_upload_file_id=_ACTIVE_FILE_ID)
        )
        assert len(persisted) == 2
        assert all(lease.cleanup_requested_at == now for lease in persisted)


def test_last_lease_release_deletes_deferred_orphan_file(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    now = naive_utc_now()
    job = KnowledgeFSUpgradeJob(
        tenant_id=_TENANT_ID,
        old_dataset_id=_DATASET_ID,
        requested_by_account_id=_ACCOUNT_ID,
        owner_account_id=_ACCOUNT_ID,
        idempotency_key="upgrade-deferred-file-cleanup",
        snapshot_at=now,
        config_snapshot={},
        permission_snapshot={},
        app_binding_snapshot=[],
        tag_ids_snapshot=[],
    )
    upload_file = UploadFile(
        tenant_id=_TENANT_ID,
        storage_type=StorageType.LOCAL,
        key=f"upload_files/{_TENANT_ID}/orphan.txt",
        name="orphan.txt",
        size=10,
        extension="txt",
        mime_type="text/plain",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=_ACCOUNT_ID,
        created_at=now,
        used=False,
    )
    with sqlite_session_factory.begin() as session:
        session.add_all([job, upload_file])
        session.flush()
        lease = KnowledgeFSUpgradeFileLease(
            job_id=job.id,
            old_upload_file_id=upload_file.id,
            expires_at=now + timedelta(minutes=1),
            cleanup_requested_at=now,
        )
        session.add(lease)

    with patch("services.knowledge_fs.upgrade_file_lease.storage") as storage:
        assert cleanup_deferred_upgrade_files(sqlite_session_factory, now=now) == 0
        storage.delete.assert_not_called()
        with sqlite_session_factory.begin() as session:
            assert release_upgrade_file_lease(
                session,
                job_id=job.id,
                upload_file_id=upload_file.id,
                now=now,
            ) is True

    storage.delete.assert_called_once_with(upload_file.key)
    with sqlite_session_factory() as session:
        assert session.get(UploadFile, upload_file.id) is None
        persisted_lease = session.get(KnowledgeFSUpgradeFileLease, lease.id)
        assert persisted_lease is not None
        assert persisted_lease.status is KnowledgeFSUpgradeFileLeaseStatus.RELEASED


def test_lease_release_keeps_file_referenced_by_another_legacy_document(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    now = naive_utc_now()
    job = KnowledgeFSUpgradeJob(
        tenant_id=_TENANT_ID,
        old_dataset_id=_DATASET_ID,
        requested_by_account_id=_ACCOUNT_ID,
        owner_account_id=_ACCOUNT_ID,
        idempotency_key="upgrade-shared-legacy-file",
        snapshot_at=now,
        config_snapshot={},
        permission_snapshot={},
        app_binding_snapshot=[],
        tag_ids_snapshot=[],
    )
    upload_file = UploadFile(
        tenant_id=_TENANT_ID,
        storage_type=StorageType.LOCAL,
        key=f"upload_files/{_TENANT_ID}/shared.txt",
        name="shared.txt",
        size=10,
        extension="txt",
        mime_type="text/plain",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=_ACCOUNT_ID,
        created_at=now,
        used=False,
    )
    with sqlite_session_factory.begin() as session:
        session.add_all([job, upload_file])
        session.flush()
        document = Document(
            tenant_id=_TENANT_ID,
            dataset_id="00000000-0000-0000-0000-000000000020",
            position=1,
            data_source_type=DataSourceType.UPLOAD_FILE,
            data_source_info=f'{{"upload_file_id":"{upload_file.id}"}}',
            batch="shared-file-test",
            name="shared.txt",
            created_from=DocumentCreatedFrom.WEB,
            created_by=_ACCOUNT_ID,
            enabled=True,
            archived=False,
            indexing_status="completed",
        )
        lease = KnowledgeFSUpgradeFileLease(
            job_id=job.id,
            old_upload_file_id=upload_file.id,
            expires_at=now + timedelta(minutes=1),
            cleanup_requested_at=now,
        )
        session.add_all([document, lease])

    with patch("services.knowledge_fs.upgrade_file_lease.storage") as storage:
        with sqlite_session_factory.begin() as session:
            assert release_upgrade_file_lease(
                session,
                job_id=job.id,
                upload_file_id=upload_file.id,
                now=now,
            ) is False

    storage.delete.assert_not_called()
    with sqlite_session_factory() as session:
        assert session.get(UploadFile, upload_file.id) is not None


def test_expired_lease_sweeper_deletes_deferred_orphan_file(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    now = naive_utc_now()
    job = KnowledgeFSUpgradeJob(
        tenant_id=_TENANT_ID,
        old_dataset_id=_DATASET_ID,
        requested_by_account_id=_ACCOUNT_ID,
        owner_account_id=_ACCOUNT_ID,
        idempotency_key="upgrade-expired-file-cleanup",
        snapshot_at=now,
        config_snapshot={},
        permission_snapshot={},
        app_binding_snapshot=[],
        tag_ids_snapshot=[],
    )
    upload_file = UploadFile(
        tenant_id=_TENANT_ID,
        storage_type=StorageType.LOCAL,
        key=f"upload_files/{_TENANT_ID}/expired-orphan.txt",
        name="expired-orphan.txt",
        size=10,
        extension="txt",
        mime_type="text/plain",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=_ACCOUNT_ID,
        created_at=now,
        used=False,
    )
    with sqlite_session_factory.begin() as session:
        session.add_all([job, upload_file])
        session.flush()
        lease = KnowledgeFSUpgradeFileLease(
            job_id=job.id,
            old_upload_file_id=upload_file.id,
            expires_at=now - timedelta(seconds=1),
            cleanup_requested_at=now - timedelta(minutes=1),
        )
        session.add(lease)

    with patch("services.knowledge_fs.upgrade_file_lease.storage") as storage:
        assert cleanup_deferred_upgrade_files(sqlite_session_factory, now=now) == 1

    storage.delete.assert_called_once_with(upload_file.key)
    with sqlite_session_factory() as session:
        assert session.get(UploadFile, upload_file.id) is None
        persisted_lease = session.get(KnowledgeFSUpgradeFileLease, lease.id)
        assert persisted_lease is not None
        assert persisted_lease.status is KnowledgeFSUpgradeFileLeaseStatus.EXPIRED
