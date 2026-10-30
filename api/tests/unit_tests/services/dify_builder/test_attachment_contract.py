"""Additive request schema and legacy context compatibility."""

import pytest
from pydantic import ValidationError

from services.dify_builder.serde import context_from_dict, context_to_dict

UPLOAD = "11111111-1111-1111-1111-111111111111"


def test_attachment_only_create_and_message_are_admitted() -> None:
    from controllers.console.dify_builder_fields import DifyBuilderCreateSessionPayload, DifyBuilderSubmitMessagePayload

    create = DifyBuilderCreateSessionPayload.model_validate(
        {"app_id": "app", "scenario": "build", "attachments": [{"upload_file_id": UPLOAD}]}
    ).root
    assert create.scenario == "build"
    assert create.goal_text == ""
    assert str(create.attachments[0].upload_file_id) == UPLOAD
    message = DifyBuilderSubmitMessagePayload.model_validate(
        {"attachments": [{"upload_file_id": UPLOAD}], "base_version": 1, "client_turn_id": "turn"}
    )
    assert message.text == ""


@pytest.mark.parametrize(
    "attachment",
    [{"url": "https://unsafe.test/file"}, {"key": "storage/key"}, {"upload_file_id": UPLOAD, "owner_id": "claimed"}],
)
def test_attachment_payload_cannot_supply_authority(attachment: dict[str, str]) -> None:
    from controllers.console.dify_builder_fields import DifyBuilderSubmitMessagePayload

    with pytest.raises(ValidationError):
        DifyBuilderSubmitMessagePayload.model_validate(
            {"text": "rules", "attachments": [attachment], "base_version": 1, "client_turn_id": "turn"}
        )


def test_blank_messages_still_require_material() -> None:
    from controllers.console.dify_builder_fields import DifyBuilderSubmitMessagePayload

    with pytest.raises(ValidationError):
        DifyBuilderSubmitMessagePayload.model_validate({"text": " ", "base_version": 1, "client_turn_id": "turn"})


def test_old_contexts_default_to_no_material_and_roundtrip_bounded_excerpt() -> None:
    old = context_from_dict({"goal_text": "Original"})
    assert old.attachment_material == []
    old.attachment_material = [{"source": "attachment", "text": "Rules", "generation": 0}]
    assert context_from_dict(context_to_dict(old)).attachment_material == old.attachment_material


def test_untrusted_prompt_budget_counts_json_escaping_and_keeps_trusted_source_separate() -> None:
    from services.dify_builder.attachment_context import append_material, material_scope

    trusted = "GOAL: trusted request"
    with material_scope([{"source": "attachment", "text": '"\\\n' * 20000, "generation": 0}], 0):
        prompt = append_material(trusted)
    assert prompt.startswith(trusted)
    assert len(prompt) - len(trusted) <= 40000
    assert "UNTRUSTED ATTACHMENT MATERIAL" in prompt
    assert append_material(trusted) == trusted
