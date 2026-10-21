import sys
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from importlib import import_module
from pathlib import Path
from types import ModuleType
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from extensions.storage.storage_type import StorageType
from machinery.context import RequestContext
from models.dataset import Dataset, Document, DocumentSegment
from models.enums import CreatorUserRole, DataSourceType, DocumentCreatedFrom, IndexingStatus, SegmentStatus
from models.model import UploadFile
from tasks.batch_create_segment_to_index_task import batch_create_segment_to_index_task

batch_task_module = import_module("tasks.batch_create_segment_to_index_task")


class RedisStatusRecorder:
    def __init__(self, current: str | None = "waiting") -> None:
        self.current = current
        self.values: list[tuple[str, int, str]] = []

    def register_script(self, _script: str) -> Callable[..., int]:
        def execute(*, keys: list[str], args: list[object]) -> int:
            if self.current != "waiting":
                return 0
            status = str(args[0])
            ttl = args[1]
            assert isinstance(ttl, int)
            self.current = status
            self.values.append((keys[0], ttl, status))
            return 1

        return execute


class SegmentApplicationRecorder:
    def __init__(self) -> None:
        self.calls: list[tuple[RequestContext, str, str, tuple[dict[str, object], ...], str]] = []

    def create_imported_segments(
        self,
        context: RequestContext,
        *,
        dataset_id: str,
        document_id: str,
        values: Sequence[Mapping[str, object]],
        job_id: str,
    ) -> tuple[()]:
        self.calls.append((context, dataset_id, document_id, tuple(dict(value) for value in values), job_id))
        return ()


@dataclass
class SegmentServices:
    create_imported_segments: Callable[..., tuple[()]]


@dataclass
class KnowledgeServices:
    segments: SegmentServices


@dataclass
class ApplicationServices:
    knowledge: KnowledgeServices


class ApplicationServicesModule(ModuleType):
    application_services: Callable[[], ApplicationServices]


def test_batch_create_marks_every_unhandled_failure_terminal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    redis = RedisStatusRecorder()

    def fail_batch(**_kwargs: object) -> None:
        raise RuntimeError("csv processing failed")

    monkeypatch.setattr(batch_task_module, "_create_batch_segments", fail_batch)
    monkeypatch.setattr(batch_task_module, "redis_client", redis)

    batch_create_segment_to_index_task.run(
        job_id="job-1",
        upload_file_id="file-1",
        dataset_id="dataset-1",
        document_id="document-1",
        tenant_id="tenant-1",
        user_id="user-1",
    )

    assert redis.values == [("segment_batch_import_job-1", 600, "error")]


@pytest.mark.parametrize("current", ["completed", "error", None])
def test_batch_create_replay_does_not_overwrite_terminal_or_expired_status(
    monkeypatch: pytest.MonkeyPatch,
    current: str | None,
) -> None:
    redis = RedisStatusRecorder(current)

    monkeypatch.setattr(
        batch_task_module,
        "_create_batch_segments",
        lambda **_kwargs: (_ for _ in ()).throw(RuntimeError()),
    )
    monkeypatch.setattr(batch_task_module, "redis_client", redis)

    batch_create_segment_to_index_task.run(
        job_id="job-1",
        upload_file_id="file-1",
        dataset_id="dataset-1",
        document_id="document-1",
        tenant_id="tenant-1",
        user_id="user-1",
    )

    assert redis.current == current
    assert redis.values == []


@pytest.mark.parametrize("foreign_owner", [None, "dataset", "document_tenant", "document_dataset", "upload"])
def test_batch_create_segment_to_index_task_validates_scope_and_submits_batch_for_durable_indexing(
    sqlite_session: Session,
    foreign_owner: str | None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tenant_id = str(uuid4())
    user_id = str(uuid4())
    dataset = Dataset(
        id=str(uuid4()),
        tenant_id=tenant_id,
        name="Batch import dataset",
        data_source_type=DataSourceType.UPLOAD_FILE,
        created_by=user_id,
        indexing_technique=IndexTechniqueType.ECONOMY,
    )
    document = Document(
        id=str(uuid4()),
        tenant_id=tenant_id,
        dataset_id=dataset.id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        batch="batch-1",
        name="document.txt",
        created_from=DocumentCreatedFrom.WEB,
        created_by=user_id,
        indexing_status=IndexingStatus.COMPLETED,
        enabled=True,
        archived=False,
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
        word_count=0,
    )
    upload_file = UploadFile(
        tenant_id=tenant_id,
        storage_type=StorageType.LOCAL,
        key="batch-import.csv",
        name="batch-import.csv",
        size=32,
        extension=".csv",
        mime_type="text/csv",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=user_id,
        created_at=datetime.now(UTC),
        used=False,
    )
    existing_segment = DocumentSegment(
        tenant_id=tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        position=7,
        content="existing",
        word_count=1,
        tokens=1,
        created_by=user_id,
        index_node_id="existing-node",
        index_node_hash="existing-hash",
        status=SegmentStatus.COMPLETED,
    )
    if foreign_owner == "dataset":
        dataset.tenant_id = str(uuid4())
    elif foreign_owner == "document_tenant":
        document.tenant_id = str(uuid4())
    elif foreign_owner == "document_dataset":
        document.dataset_id = str(uuid4())
    elif foreign_owner == "upload":
        upload_file.tenant_id = str(uuid4())
    sqlite_session.add_all([dataset, document, upload_file, existing_segment])
    sqlite_session.commit()

    def mock_download(_key: str, file_path: str) -> None:
        downloaded.append(_key)
        Path(file_path).write_text("content\nfirst\nsecond\nthird\n", encoding="utf-8")

    downloaded: list[str] = []
    segments = SegmentApplicationRecorder()
    services = ApplicationServices(KnowledgeServices(SegmentServices(segments.create_imported_segments)))
    ext_services_module = ApplicationServicesModule("extensions.ext_application_services")
    ext_services_module.application_services = lambda: services
    redis = RedisStatusRecorder()
    job_id = str(uuid4())
    monkeypatch.setattr(batch_task_module.storage, "download", mock_download)
    monkeypatch.setattr(batch_task_module, "redis_client", redis)
    monkeypatch.setitem(sys.modules, "extensions.ext_application_services", ext_services_module)

    batch_create_segment_to_index_task(
        job_id=job_id,
        upload_file_id=upload_file.id,
        dataset_id=dataset.id,
        document_id=document.id,
        tenant_id=tenant_id,
        user_id=user_id,
    )

    if foreign_owner is not None:
        assert downloaded == []
        assert segments.calls == []
        assert redis.values == [(f"segment_batch_import_{job_id}", 600, "error")]
        assert sqlite_session.scalars(select(DocumentSegment.id)).all() == [existing_segment.id]
        return

    assert downloaded == [upload_file.key]
    assert len(segments.calls) == 1
    context, called_dataset_id, called_document_id, values, called_job_id = segments.calls[0]
    assert context.account_id == user_id
    assert context.active_workspace_id == tenant_id
    assert called_dataset_id == dataset.id
    assert called_document_id == document.id
    assert called_job_id == job_id
    assert [item["content"] for item in values] == ["first", "second", "third"]
    # Parsing and SQL acceptance do not prove that vectors exist. The durable
    # index task owns the eventual completed/error terminal status.
    assert redis.values == []
    assert sqlite_session.scalars(select(DocumentSegment.id)).all() == [existing_segment.id]
