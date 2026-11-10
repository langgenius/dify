"""Unit tests for ``core.rag.entities.event`` datasource stream events.

Negative cases go through ``model_validate``: dify's strict
``pyrefly type-check-core`` also checks the test tree, so constructing a
pydantic model with missing arguments is a *static* error even when the
behaviour under test is a ``ValidationError`` at runtime.
"""

import pytest
from pydantic import ValidationError

from core.rag.entities.event import (
    BaseDatasourceEvent,
    DatasourceCompletedEvent,
    DatasourceErrorEvent,
    DatasourceProcessingEvent,
    DatasourceStreamEvent,
)


def test_event_enum_values() -> None:
    assert DatasourceStreamEvent.PROCESSING == "datasource_processing"
    assert DatasourceStreamEvent.COMPLETED == "datasource_completed"
    assert DatasourceStreamEvent.ERROR == "datasource_error"
    assert {e.value for e in DatasourceStreamEvent} == {
        "datasource_processing",
        "datasource_completed",
        "datasource_error",
    }


def test_base_event_is_empty_model() -> None:
    evt = BaseDatasourceEvent()
    assert evt.model_dump() == {}


def test_error_event_defaults_to_error_and_requires_message() -> None:
    with pytest.raises(ValidationError):
        DatasourceErrorEvent.model_validate({})
    evt = DatasourceErrorEvent(error="boom")
    assert evt.event is DatasourceStreamEvent.ERROR
    assert evt.error == "boom"


def test_completed_event_accepts_mapping_and_list() -> None:
    # dict / mapping payload
    evt = DatasourceCompletedEvent(data={"k": "v"})
    assert evt.data == {"k": "v"}
    assert evt.total == 0
    assert evt.completed == 0
    assert evt.time_consuming == 0.0
    # list payload
    evt2 = DatasourceCompletedEvent(data=[1, 2, 3])
    assert evt2.data == [1, 2, 3]


def test_completed_event_rejects_missing_data() -> None:
    with pytest.raises(ValidationError):
        DatasourceCompletedEvent.model_validate({"total": 1})


def test_completed_event_overrides_defaults() -> None:
    evt = DatasourceCompletedEvent(data={"x": 1}, total=10, completed=7, time_consuming=2.5)
    assert evt.total == 10
    assert evt.completed == 7
    assert evt.time_consuming == 2.5


def test_processing_event_requires_total_and_completed() -> None:
    with pytest.raises(ValidationError):
        DatasourceProcessingEvent.model_validate({})
    with pytest.raises(ValidationError):
        DatasourceProcessingEvent.model_validate({"total": 5})
    evt = DatasourceProcessingEvent(total=5, completed=3)
    assert evt.event is DatasourceStreamEvent.PROCESSING
    assert evt.total == 5
    assert evt.completed == 3


def test_model_validate_matches_constructor() -> None:
    assert DatasourceErrorEvent.model_validate({"error": "boom"}) == DatasourceErrorEvent(error="boom")
    assert DatasourceProcessingEvent.model_validate({"total": 5, "completed": 3}) == DatasourceProcessingEvent(
        total=5, completed=3
    )


def test_event_models_are_distinct_subtypes() -> None:
    assert issubclass(DatasourceErrorEvent, BaseDatasourceEvent)
    assert issubclass(DatasourceCompletedEvent, BaseDatasourceEvent)
    assert issubclass(DatasourceProcessingEvent, BaseDatasourceEvent)
