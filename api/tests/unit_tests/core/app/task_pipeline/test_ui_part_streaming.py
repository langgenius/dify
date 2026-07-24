from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from core.app.entities.queue_entities import QueueUIPartEvent
from core.app.entities.task_entities import TaskStateMetadata
from core.app.task_pipeline.easy_ui_based_generate_task_pipeline import EasyUIBasedGenerateTaskPipeline
from core.tools.entities.ui_entities import A2UI_CATALOG_ID, MessageUIPart, ToolUIMessage


def _part(sequence: int, text: str) -> MessageUIPart:
    ui_message = ToolUIMessage.model_validate(
        {
            "protocol": "a2ui",
            "protocol_version": "v0.9.1",
            "messages": [
                {
                    "version": "v0.9.1",
                    "createSurface": {
                        "surfaceId": "clock",
                        "catalogId": A2UI_CATALOG_ID,
                    },
                },
                {
                    "version": "v0.9.1",
                    "updateComponents": {
                        "surfaceId": "clock",
                        "components": [{"id": "root", "component": "Text", "text": text}],
                    },
                },
            ],
        }
    )
    return MessageUIPart.from_tool_ui_message(
        part_id="call-1:clock",
        sequence=sequence,
        ui_message=ui_message,
    )


def _distinct_part(index: int, *, large: bool = False) -> MessageUIPart:
    surface_id = f"surface-{index}"
    messages = [
        {
            "version": "v0.9.1",
            "createSurface": {"surfaceId": surface_id, "catalogId": A2UI_CATALOG_ID},
        }
    ]
    if large:
        messages.append(
            {
                "version": "v0.9.1",
                "updateDataModel": {
                    "surfaceId": surface_id,
                    "value": ["x" * 4096] * 20,
                },
            }
        )
    messages.append(
        {
            "version": "v0.9.1",
            "updateComponents": {
                "surfaceId": surface_id,
                "components": [{"id": "root", "component": "Text", "text": str(index)}],
            },
        }
    )
    ui_message = ToolUIMessage(messages=messages)
    return MessageUIPart.from_tool_ui_message(
        part_id=f"call-{index}:{surface_id}",
        sequence=1,
        ui_message=ui_message,
    )


def test_ui_part_stream_response_upserts_only_newer_revision() -> None:
    pipeline = object.__new__(EasyUIBasedGenerateTaskPipeline)
    pipeline._application_generate_entity = SimpleNamespace(task_id="task-1")
    pipeline._message_id = "message-1"
    pipeline._task_state = SimpleNamespace(metadata=TaskStateMetadata())

    first = pipeline._ui_part_to_stream_response(QueueUIPartEvent(part=_part(1, "10:30")))
    stale = pipeline._ui_part_to_stream_response(QueueUIPartEvent(part=_part(1, "stale")))
    newer = pipeline._ui_part_to_stream_response(QueueUIPartEvent(part=_part(2, "10:31")))

    assert first is not None
    assert first.id == "message-1"
    assert first.part.sequence == 1
    payload = first.model_dump(mode="json")
    first_message = payload["part"]["messages"][0]
    assert "createSurface" in first_message
    assert "create_surface" not in first_message
    assert first_message["createSurface"]["surfaceId"] == "clock"
    assert first_message["createSurface"]["catalogId"] == A2UI_CATALOG_ID
    component = payload["part"]["messages"][1]["updateComponents"]["components"][0]
    assert component == {"id": "root", "component": "Text", "text": "10:30"}
    assert stale is None
    assert newer is not None
    assert newer.part.sequence == 2
    assert len(pipeline._task_state.metadata.ui_parts) == 1
    assert pipeline._task_state.metadata.ui_parts[0].sequence == 2


def test_ui_part_stream_response_drops_parts_over_message_budgets() -> None:
    pipeline = object.__new__(EasyUIBasedGenerateTaskPipeline)
    pipeline._application_generate_entity = SimpleNamespace(task_id="task-1")
    pipeline._message_id = "message-1"
    pipeline._task_state = SimpleNamespace(metadata=TaskStateMetadata())

    responses = [
        pipeline._ui_part_to_stream_response(QueueUIPartEvent(part=_distinct_part(index))) for index in range(17)
    ]

    assert all(response is not None for response in responses[:16])
    assert responses[16] is None
    assert len(pipeline._task_state.metadata.ui_parts) == 16
    with pytest.raises(ValidationError, match="more than 16"):
        TaskStateMetadata(ui_parts=[_distinct_part(index) for index in range(17)])

    large_pipeline = object.__new__(EasyUIBasedGenerateTaskPipeline)
    large_pipeline._application_generate_entity = SimpleNamespace(task_id="task-1")
    large_pipeline._message_id = "message-2"
    large_pipeline._task_state = SimpleNamespace(metadata=TaskStateMetadata())
    large_responses = [
        large_pipeline._ui_part_to_stream_response(QueueUIPartEvent(part=_distinct_part(index, large=True)))
        for index in range(7)
    ]

    assert any(response is None for response in large_responses)
    assert 0 < len(large_pipeline._task_state.metadata.ui_parts) < 7
