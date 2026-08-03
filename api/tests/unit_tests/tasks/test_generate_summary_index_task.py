"""Unit tests for the summary-index generation task session lifecycle."""

from unittest.mock import MagicMock

import pytest

import tasks.generate_summary_index_task as task_module
from core.rag.index_processor.constant.index_type import IndexTechniqueType
from models.dataset import Dataset, Document
from models.enums import DataSourceType, DocumentCreatedFrom


class _TrackedSessionContext:
    def __init__(self, session: MagicMock) -> None:
        self.session = session
        self.active = False
        self.exited = False

    def __enter__(self) -> MagicMock:
        self.active = True
        return self.session

    def __exit__(self, _exc_type: object, _exc: object, _tb: object) -> None:
        self.active = False
        self.exited = True


def test_generate_summary_index_task_releases_loader_session_before_generation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dataset = Dataset(
        id="dataset-1",
        tenant_id="tenant-1",
        name="Dataset",
        description="",
        provider="vendor",
        permission="only_me",
        data_source_type=DataSourceType.UPLOAD_FILE,
        indexing_technique=IndexTechniqueType.HIGH_QUALITY,
        created_by="00000000-0000-0000-0000-000000000001",
        summary_index_setting={"enable": True},
        chunk_structure="text_model",
    )
    document = Document(
        id="document-1",
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        batch="batch-1",
        name="Document",
        created_from=DocumentCreatedFrom.WEB,
        created_by="00000000-0000-0000-0000-000000000001",
        need_summary=True,
    )
    loader_session = MagicMock()
    loader_statements: list[object] = []

    def scalar(statement: object) -> Dataset | Document:
        loader_statements.append(statement)
        return [dataset, document][len(loader_statements) - 1]

    loader_session.scalar.side_effect = scalar
    loader_context = _TrackedSessionContext(loader_session)
    monkeypatch.setattr(task_module.session_factory, "create_session", MagicMock(return_value=loader_context))

    observed: dict[str, object] = {}

    def generate_summaries_for_document(**kwargs: object) -> list[object]:
        observed["loader_active"] = loader_context.active
        observed["session"] = kwargs.get("session")
        return []

    monkeypatch.setattr(
        task_module.SummaryIndexService,
        "generate_summaries_for_document",
        generate_summaries_for_document,
    )

    task_module.generate_summary_index_task.run("dataset-1", "document-1")

    assert loader_context.exited is True
    assert observed == {"loader_active": False, "session": None}
    assert "documents.dataset_id =" in str(loader_statements[1])
