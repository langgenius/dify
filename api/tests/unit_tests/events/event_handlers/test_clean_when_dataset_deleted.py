from unittest.mock import patch
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session

from events.event_handlers.clean_when_dataset_deleted import handle
from models.dataset import Dataset, IndexTechniqueType


def _dataset(*, indexing_technique: IndexTechniqueType | None, chunk_structure: str | None) -> Dataset:
    return Dataset(
        tenant_id=str(uuid4()),
        name="Cleanup Dataset",
        created_by=str(uuid4()),
        indexing_technique=indexing_technique,
        chunk_structure=chunk_structure,
    )


def test_requires_caller_session() -> None:
    with pytest.raises(TypeError, match="session"):
        handle(_dataset(indexing_technique=IndexTechniqueType.HIGH_QUALITY, chunk_structure="text_model"))  # pyrefly: ignore[missing-argument]


def test_enqueues_cleanup_with_provided_session(sqlite_session: Session) -> None:
    dataset = _dataset(indexing_technique=IndexTechniqueType.ECONOMY, chunk_structure="text_model")

    with patch("events.event_handlers.clean_when_dataset_deleted.clean_dataset_task.delay") as delay:
        handle(dataset, session=sqlite_session)

    delay.assert_called_once_with(
        dataset.id,
        dataset.tenant_id,
        dataset.indexing_technique,
        dataset.index_struct,
        dataset.collection_binding_id,
        "text_model",
        dataset.pipeline_id,
    )


def test_skips_cleanup_without_indexing_technique(sqlite_session: Session) -> None:
    dataset = _dataset(indexing_technique=None, chunk_structure="text_model")

    with patch("events.event_handlers.clean_when_dataset_deleted.clean_dataset_task.delay") as delay:
        handle(dataset, session=sqlite_session)

    delay.assert_not_called()
