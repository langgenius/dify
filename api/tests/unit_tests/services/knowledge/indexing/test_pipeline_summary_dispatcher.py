import pytest

from services.knowledge.indexing.adapters import execution as execution_adapters


def test_pipeline_summary_dispatcher_enqueues_committed_document(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[str, str, None]] = []

    class _Task:
        @staticmethod
        def delay(dataset_id: str, document_id: str, generation: None) -> None:
            calls.append((dataset_id, document_id, generation))

    monkeypatch.setattr("tasks.generate_summary_index_task.generate_summary_index_task", _Task())

    execution_adapters.PipelineSummaryIndexDispatcher().generate_and_vectorize_summary(
        "dataset-1",
        "document-1",
        False,
        {"enable": True},
    )

    assert calls == [("dataset-1", "document-1", None)]


def test_pipeline_summary_dispatcher_rejects_preview() -> None:
    with pytest.raises(ValueError, match="unavailable in preview mode"):
        execution_adapters.PipelineSummaryIndexDispatcher().generate_and_vectorize_summary(
            "dataset-1",
            "document-1",
            True,
        )
