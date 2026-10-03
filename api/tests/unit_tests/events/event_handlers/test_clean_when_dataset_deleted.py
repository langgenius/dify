from unittest.mock import MagicMock, patch

import pytest

from events.event_handlers.clean_when_dataset_deleted import handle
from models.dataset import Dataset

MODULE = "events.event_handlers.clean_when_dataset_deleted"


def _dataset(**overrides: str | None) -> Dataset:
    values: dict[str, str | None] = {
        "id": "dataset-1",
        "tenant_id": "tenant-1",
        "indexing_technique": "high_quality",
        "index_struct": '{"type": "paragraph"}',
        "collection_binding_id": "binding-1",
        "pipeline_id": "pipeline-1",
    }
    values.update(overrides)
    return Dataset(**values)


@pytest.mark.parametrize(
    ("indexing_technique", "doc_form"),
    [
        ("high_quality", "text_model"),
        (None, "text_model"),
        ("high_quality", None),
        (None, None),
    ],
)
def test_handler_always_dispatches_cleanup(indexing_technique: str | None, doc_form: str | None) -> None:
    dataset = _dataset(indexing_technique=indexing_technique)

    with (
        patch(f"{MODULE}.db", MagicMock()),
        patch(f"{MODULE}.get_dataset_doc_form", return_value=doc_form),
        patch(f"{MODULE}.clean_dataset_task.delay") as delay,
    ):
        handle(dataset)

    delay.assert_called_once_with(
        "dataset-1",
        "tenant-1",
        indexing_technique,
        '{"type": "paragraph"}',
        "binding-1",
        doc_form,
        "pipeline-1",
    )


def test_handler_dispatches_for_empty_pipeline_dataset() -> None:
    # A knowledge pipeline dataset created from scratch has no indexing technique,
    # no chunk structure and no documents, but still owns a Pipeline row.
    dataset = _dataset(indexing_technique=None, index_struct=None, collection_binding_id=None)

    with (
        patch(f"{MODULE}.db", MagicMock()),
        patch(f"{MODULE}.get_dataset_doc_form", return_value=None),
        patch(f"{MODULE}.clean_dataset_task.delay") as delay,
    ):
        handle(dataset)

    delay.assert_called_once_with("dataset-1", "tenant-1", None, None, None, None, "pipeline-1")
