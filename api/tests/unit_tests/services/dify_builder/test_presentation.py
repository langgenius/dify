"""Scene references survive JSON without rewriting dynamic prose or identifiers."""

import json
import re
from dataclasses import asdict
from pathlib import Path

import pytest
from pydantic import ValidationError

from controllers.console.dify_builder_fields import (
    DifyBuilderConversationItemAppendedEventResponse,
    DifyBuilderStreamEventResponse,
)
from core.dify_builder.contract import AssistantTurnItem
from services.dify_builder.copy_ids import BuilderCopyId
from services.dify_builder.presentation import _PARAMETERS, BuilderCopy, copy_text, stored_text, text_parts


def test_presentation_json_keeps_literal_collisions_and_parameters() -> None:
    text = text_parts(
        copy_text(BuilderCopyId.REPAIR_PROPOSED_FIX),
        "\nGoal",
        copy_text(BuilderCopyId.MODEL_CHANGED, name="Yes {{name}} <tag>"),
    )
    assert stored_text(json.loads(json.dumps(asdict(text)))) == text
    assert text.parts[1] == "\nGoal"
    assert isinstance(text.parts[2], BuilderCopy)
    assert text.parts[2].params["name"] == "Yes {{name}} <tag>"
    assert stored_text("Goal") == "Goal"


@pytest.mark.parametrize("params", [{}, {"name": "model", "extra": "Goal"}])
def test_scene_parameters_are_validated(params: dict[str, str]) -> None:
    with pytest.raises(ValueError, match="incorrect parameters"):
        copy_text(BuilderCopyId.MODEL_CHANGED, **params)


def test_web_owns_all_scene_copy_and_parameter_names() -> None:
    path = Path(__file__).resolve().parents[5] / "web/i18n/locales/en-US/dify-builder.json"
    catalog = json.loads(path.read_text())
    for scene in BuilderCopyId:
        text = catalog["copy." + scene]
        assert set(re.findall(r"\{\{(\w+)\}\}", text)) == _PARAMETERS.get(scene, frozenset())


def test_complete_assistant_event_is_valid_but_native_stream_cannot_duplicate_it() -> None:
    frame = {
        "event": "conversation_item_appended",
        "data": {
            "session_id": "session",
            "command_id": "command",
            "item": {
                "seq": 1,
                "at_version": 2,
                "kind": "assistant_turn",
                "payload": {
                    "turn_id": "operation",
                    "stage_id": "build.execution",
                    "reply_mode": "complete",
                    "reply_language": "ja",
                    "execution": {"status": "completed"},
                    "reply_text": asdict(copy_text(BuilderCopyId.BUILD_GRAPH_APPLIED, count=2, scope="configuration")),
                },
            },
        },
    }
    parsed = DifyBuilderStreamEventResponse.model_validate(frame)
    assert isinstance(parsed.root, DifyBuilderConversationItemAppendedEventResponse)
    assert isinstance(parsed.root.data.item.payload, AssistantTurnItem)
    assert isinstance(parsed.root.data.item.payload.reply_text, BuilderCopy)
    assert parsed.root.data.item.payload.reply_text.params == {"count": 2, "scope": "configuration"}
    frame["data"]["item"]["payload"]["reply_mode"] = "stream"
    with pytest.raises(ValidationError, match="agent_message"):
        DifyBuilderStreamEventResponse.model_validate(frame)
