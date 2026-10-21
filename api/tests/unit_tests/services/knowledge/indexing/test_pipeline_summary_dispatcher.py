from collections.abc import Callable, Mapping
from dataclasses import dataclass, field

import pytest

from services.knowledge.indexing.adapters import execution as execution_adapters
from services.knowledge.indexing.contracts import DocumentIndexingExecution
from services.knowledge.resource_scope import DatasetRef


@dataclass(slots=True)
class _RecordingSummaryIntents:
    calls: list[tuple[DatasetRef, dict[str, str | None]]] = field(default_factory=list)

    def enqueue_summary_indexes(
        self,
        ref: DatasetRef,
        expected_generations: Mapping[str, str | None],
        *,
        assert_owned: Callable[[], None] | None = None,
    ) -> int:
        if assert_owned is not None:
            assert_owned()
        self.calls.append((ref, dict(expected_generations)))
        return len(expected_generations)


@pytest.mark.parametrize("generation", [None, "generation-1"])
def test_pipeline_summary_dispatcher_preserves_exact_generation(
    generation: str | None,
) -> None:
    intents = _RecordingSummaryIntents()
    ownership_checks = 0

    def assert_owned() -> None:
        nonlocal ownership_checks
        ownership_checks += 1

    ref = DatasetRef("tenant-1", "dataset-1").document("document-1")
    execution = DocumentIndexingExecution(generation, assert_owned)

    execution_adapters.PipelineSummaryIndexDispatcher(
        documents=intents,
        ref=ref,
        execution=execution,
    ).generate_and_vectorize_summary(
        "dataset-1",
        "document-1",
        False,
        expected_generation=generation,
    )

    assert intents.calls == []
    assert ownership_checks == 0
