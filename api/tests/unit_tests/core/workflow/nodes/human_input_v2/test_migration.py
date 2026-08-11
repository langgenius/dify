import inspect
import json
import re
from collections.abc import Sequence
from typing import get_type_hints
from uuid import UUID

import pytest
from pydantic import BaseModel, Field, TypeAdapter, ValidationError, field_validator
from pydantic_core import PydanticUndefined

from core.human_input_v2.shared.values import NormalizedEmail
from core.workflow.nodes.human_input_v2 import migration as migration_module
from core.workflow.nodes.human_input_v2.migration import (
    LegacyHumanInputNodeData,
    MemberEmailSnapshot,
    ResolvedMemberEmail,
    convert_legacy_human_input_node_data,
)
from graphon.enums import BuiltinNodeTypes

_EMAIL_METHOD_ID = "11111111-1111-4111-8111-111111111111"
_WEBAPP_METHOD_ID = "22222222-2222-4222-8222-222222222222"
_SECOND_EMAIL_METHOD_ID = "33333333-3333-4333-8333-333333333333"
_HISTORICAL_USER_ACTION_ID_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class _HistoricalUserActionIdOracle(BaseModel):
    id: str = Field(max_length=20)

    @field_validator("id")
    @classmethod
    def validate_id(cls, value: str) -> str:
        if not _HISTORICAL_USER_ACTION_ID_PATTERN.match(value):
            raise ValueError("invalid historical user action identifier")
        return value


def _accepts_user_action_id(model: type[BaseModel], action_id: str) -> bool:
    try:
        model.model_validate({"id": action_id, "title": "Approve"})
    except ValidationError:
        return False
    return True


def _member_email_snapshot(entries: dict[str, str] | None = None) -> MemberEmailSnapshot:
    return MemberEmailSnapshot(
        tuple(
            ResolvedMemberEmail(member_id=member_id, email=NormalizedEmail(email))
            for member_id, email in (entries or {}).items()
        )
    )


def test_canonical_v1_models_are_exposed() -> None:
    expected_model_names = {
        "LegacyDeliveryChannelConfig",
        "LegacyEmailDeliveryMethod",
        "LegacyEmailRecipients",
        "LegacyExternalRecipient",
        "LegacyFormInput",
        "LegacyFormInputDefault",
        "LegacyMemberRecipient",
        "LegacyUserAction",
        "LegacyWebAppDeliveryMethod",
    }

    assert expected_model_names <= set(dir(migration_module))


@pytest.mark.parametrize(
    "delivery_method_model",
    [migration_module.LegacyWebAppDeliveryMethod, migration_module.LegacyEmailDeliveryMethod],
)
def test_canonical_delivery_method_id_is_required_without_any_default(
    delivery_method_model: type[BaseModel],
) -> None:
    id_field = delivery_method_model.model_fields["id"]

    assert id_field.is_required()
    assert id_field.default is PydanticUndefined
    assert id_field.default_factory is None


@pytest.mark.parametrize(
    ("delivery_method_model", "method_value"),
    [
        (migration_module.LegacyWebAppDeliveryMethod, {"type": "webapp", "config": {}}),
        (
            migration_module.LegacyEmailDeliveryMethod,
            {
                "type": "email",
                "config": {
                    "recipients": {"items": []},
                    "subject": "Review",
                    "body": "Please review",
                },
            },
        ),
    ],
)
def test_canonical_delivery_method_schema_requires_id(
    delivery_method_model: type[BaseModel],
    method_value: dict[str, object],
) -> None:
    schema = delivery_method_model.model_json_schema()

    assert "id" in schema["required"]
    assert "default" not in schema["properties"]["id"]
    with pytest.raises(ValidationError):
        delivery_method_model.model_validate(method_value)


def test_canonical_v1_schema_matches_historical_base_form_and_action_fields() -> None:
    node_data = LegacyHumanInputNodeData.model_validate(
        {
            "title": "Manager approval",
            "desc": "Preserve historical fields",
            "version": "1",
            "error_strategy": "fail-branch",
            "default_value": [{"key": "reason", "type": "string", "value": "fallback"}],
            "retry_config": {"retry_enabled": True, "max_retries": 2, "retry_interval": 1000},
            "delivery_methods": [{"id": _WEBAPP_METHOD_ID, "type": "webapp", "config": {}}],
            "form_content": "Decision: {{#$output.reason#}}",
            "inputs": [
                {
                    "type": "text_input",
                    "output_variable_name": "reason",
                    "default": {"type": "variable", "selector": ["start", "reason"], "value": "fallback"},
                }
            ],
            "user_actions": [{"id": "approve", "title": "Approve", "button_style": "primary"}],
            "timeout": 2,
            "timeout_unit": "day",
        }
    )

    assert set(LegacyHumanInputNodeData.model_fields) == {
        "title",
        "desc",
        "version",
        "error_strategy",
        "default_value",
        "retry_config",
        "delivery_methods",
        "form_content",
        "inputs",
        "user_actions",
        "timeout",
        "timeout_unit",
    }
    assert isinstance(node_data.inputs[0], migration_module.LegacyFormInput)
    assert isinstance(node_data.inputs[0].default, migration_module.LegacyFormInputDefault)
    assert isinstance(node_data.user_actions[0], migration_module.LegacyUserAction)
    assert node_data.model_dump(mode="json")["inputs"] == [
        {
            "type": "text_input",
            "output_variable_name": "reason",
            "default": {"type": "variable", "selector": ["start", "reason"], "value": "fallback"},
        }
    ]


def test_canonical_v1_form_default_preserves_historical_selector_annotation() -> None:
    annotations = get_type_hints(migration_module.LegacyFormInputDefault)

    assert annotations["selector"] == Sequence[str]


@pytest.mark.parametrize(
    "action_id",
    [
        "approve",
        "_approve1",
        "approve\n",
        f"{'a' * 19}\n",
        "a" * 20,
        "",
        "1approve",
        "approve-action",
        "approve\nnext",
        "a" * 20 + "\n",
        "\n",
        "approve\r\n",
    ],
)
def test_canonical_user_action_id_acceptance_matches_historical_field_validator(action_id: str) -> None:
    assert _accepts_user_action_id(migration_module.LegacyUserAction, action_id) is _accepts_user_action_id(
        _HistoricalUserActionIdOracle,
        action_id,
    )


def test_canonical_v1_delivery_and_recipient_discriminators_are_exact() -> None:
    email_method = TypeAdapter(migration_module.LegacyDeliveryChannelConfig).validate_python(
        {
            "id": _EMAIL_METHOD_ID,
            "type": "email",
            "config": {
                "recipients": {
                    "whole_workspace": True,
                    "items": [
                        {"type": "member", "user_id": "member-1"},
                        {"type": "external", "email": "approver@example.com"},
                    ],
                },
                "subject": "Review",
                "body": "Please review",
            },
        }
    )
    webapp_method = TypeAdapter(migration_module.LegacyDeliveryChannelConfig).validate_python(
        {"id": _WEBAPP_METHOD_ID, "type": "webapp", "config": {}}
    )

    assert isinstance(email_method, migration_module.LegacyEmailDeliveryMethod)
    assert isinstance(email_method.id, UUID)
    assert isinstance(email_method.config.recipients, migration_module.LegacyEmailRecipients)
    assert isinstance(email_method.config.recipients.items[0], migration_module.LegacyMemberRecipient)
    assert isinstance(email_method.config.recipients.items[1], migration_module.LegacyExternalRecipient)
    assert isinstance(webapp_method, migration_module.LegacyWebAppDeliveryMethod)
    assert set(migration_module.LegacyEmailRecipients.model_fields) == {"whole_workspace", "items"}
    assert set(migration_module.LegacyMemberRecipient.model_fields) == {"type", "user_id"}
    assert set(migration_module.LegacyExternalRecipient.model_fields) == {"type", "email"}

    delivery_schema = TypeAdapter(migration_module.LegacyDeliveryChannelConfig).json_schema()
    assert delivery_schema["discriminator"]["mapping"] == {
        "email": "#/$defs/LegacyEmailDeliveryMethod",
        "webapp": "#/$defs/LegacyWebAppDeliveryMethod",
    }
    recipient_schema = migration_module.LegacyEmailRecipients.model_json_schema()
    assert recipient_schema["$defs"]["LegacyMemberRecipient"]["required"] == ["user_id"]
    assert recipient_schema["$defs"]["LegacyExternalRecipient"]["required"] == ["email"]

    with pytest.raises(ValidationError):
        migration_module.LegacyMemberRecipient.model_validate({"type": "member", "reference_id": "member-1"})


def test_canonical_v1_and_pure_converter_have_no_raw_json_annotations_or_schema() -> None:
    canonical_schema = json.dumps(LegacyHumanInputNodeData.model_json_schema(), sort_keys=True)
    converter_annotations = repr(get_type_hints(convert_legacy_human_input_node_data))
    converter_signature = str(inspect.signature(convert_legacy_human_input_node_data))
    default_value_annotation = repr(LegacyHumanInputNodeData.model_fields["default_value"].annotation)

    assert "LegacyDefaultValue" in default_value_annotation
    assert "MemberEmailSnapshot" in converter_annotations
    for forbidden_name in ("Any", "JsonValue", "Mapping", "reference_id", "include_bound_group"):
        assert forbidden_name not in canonical_schema
        assert forbidden_name not in converter_annotations
        assert forbidden_name not in converter_signature


@pytest.mark.parametrize(
    ("default_type", "value", "normalized_value"),
    [
        ("string", "fallback", "fallback"),
        ("number", 7, 7),
        ("number", 1.5, 1.5),
        ("number", True, True),
        ("number", "7", 7.0),
        ("object", {"nested": [None, True, 7, 1.5, "value"]}, {"nested": [None, True, 7, 1.5, "value"]}),
        ("object", '{"nested": [null, true, 7, 1.5, "value"]}', {"nested": [None, True, 7, 1.5, "value"]}),
        ("array[number]", [1, 2.5, True], [1, 2.5, True]),
        ("array[number]", "[1, 2.5, true]", [1, 2.5, True]),
        ("array[string]", ["first", "second"], ["first", "second"]),
        ("array[string]", '["first", "second"]', ["first", "second"]),
        ("array[object]", [{"first": 1}, {"second": False}], [{"first": 1}, {"second": False}]),
        ("array[object]", '[{"first": 1}, {"second": false}]', [{"first": 1}, {"second": False}]),
        (
            "array[file]",
            {
                "nested": [None, True, 7, 1.5, "value", {"deep": [False]}],
            },
            {
                "nested": [None, True, 7, 1.5, "value", {"deep": [False]}],
            },
        ),
        ("array[file]", False, False),
    ],
)
def test_canonical_default_value_matches_historical_normalization_and_converts_totally(
    default_type: str,
    value: object,
    normalized_value: object,
) -> None:
    raw_default = {"key": "fallback", "type": default_type, "value": value}
    normalized_default = {"key": "fallback", "type": default_type, "value": normalized_value}

    default_value = migration_module.LegacyDefaultValue.model_validate(raw_default)
    node_data = LegacyHumanInputNodeData.model_validate(
        {
            "title": "Approval",
            "default_value": [raw_default],
            "delivery_methods": [{"id": _WEBAPP_METHOD_ID, "type": "webapp", "config": {}}],
        }
    )
    conversion = convert_legacy_human_input_node_data(node_data, _member_email_snapshot())

    assert default_value.model_dump(mode="json") == normalized_default
    assert node_data.model_dump(mode="json")["default_value"] == [normalized_default]
    assert conversion.blockers == ()
    assert conversion.node_data is not None
    assert conversion.node_data.model_dump(mode="json")["default_value"] == [normalized_default]
    schema_text = json.dumps(migration_module.LegacyDefaultValue.model_json_schema(), sort_keys=True)
    assert '"root"' not in schema_text


@pytest.mark.parametrize(
    ("default_type", "value"),
    [
        ("string", None),
        ("string", 7),
        ("number", None),
        ("number", "not-a-number"),
        ("object", False),
        ("object", []),
        ("object", "false"),
        ("object", "not-json"),
        ("array[number]", 7),
        ("array[number]", [1, "2"]),
        ("array[number]", "7"),
        ("array[string]", 1.5),
        ("array[string]", ["first", 2]),
        ("array[object]", "fallback"),
        ("array[object]", [{"valid": True}, False]),
    ],
)
def test_canonical_default_value_rejects_historically_invalid_type_value_pairs(
    default_type: str,
    value: object,
) -> None:
    with pytest.raises(ValidationError):
        migration_module.LegacyDefaultValue.model_validate({"key": "fallback", "type": default_type, "value": value})


def test_complete_canonical_v1_shared_fields_convert_to_typed_v2() -> None:
    legacy_node_data = LegacyHumanInputNodeData.model_validate(
        {
            "title": "Manager approval",
            "desc": "Preserve historical fields",
            "version": "1",
            "error_strategy": "fail-branch",
            "default_value": [{"key": "reason", "type": "string", "value": "fallback"}],
            "retry_config": {"retry_enabled": True, "max_retries": 2, "retry_interval": 1000},
            "delivery_methods": [{"id": _WEBAPP_METHOD_ID, "type": "webapp", "config": {}}],
            "form_content": "Decision: {{#$output.reason#}}",
            "inputs": [
                {
                    "type": "text_input",
                    "output_variable_name": "reason",
                    "default": {"type": "constant", "value": "fallback"},
                }
            ],
            "user_actions": [{"id": "approve", "title": "Approve", "button_style": "primary"}],
            "timeout": 2,
            "timeout_unit": "day",
        }
    )

    conversion = convert_legacy_human_input_node_data(legacy_node_data, _member_email_snapshot())

    assert conversion.blockers == ()
    assert conversion.node_data is not None
    assert conversion.node_data.model_dump(mode="json") == {
        "type": "human-input",
        "title": "Manager approval",
        "desc": "Preserve historical fields",
        "version": "2",
        "error_strategy": "fail-branch",
        "default_value": [{"key": "reason", "type": "string", "value": "fallback"}],
        "retry_config": {"retry_enabled": True, "max_retries": 2, "retry_interval": 1000},
        "recipients_spec": [{"type": "initiator"}],
        "message_template": {"subject": "", "body": ""},
        "debug_mode": {"enabled": False, "channels": []},
        "form_content": "Decision: {{#$output.reason#}}",
        "inputs": [
            {
                "type": "paragraph",
                "output_variable_name": "reason",
                "default": {"type": "constant", "selector": [], "value": "fallback"},
            }
        ],
        "user_actions": [{"id": "approve", "title": "Approve", "button_style": "primary"}],
        "timeout": 2,
        "timeout_unit": "day",
    }


def test_converter_preserves_historically_accepted_action_id_with_trailing_line_feed() -> None:
    historical_action_id = f"{'a' * 19}\n"
    legacy_node_data = LegacyHumanInputNodeData.model_validate(
        {
            "title": "Manager approval",
            "delivery_methods": [{"id": _WEBAPP_METHOD_ID, "type": "webapp", "config": {}}],
            "user_actions": [{"id": historical_action_id, "title": "Approve"}],
        }
    )

    conversion = convert_legacy_human_input_node_data(legacy_node_data, _member_email_snapshot())

    assert conversion.blockers == ()
    assert conversion.node_data is not None
    assert conversion.node_data.user_actions[0].id == historical_action_id


def test_historical_text_inputs_explicitly_map_to_the_only_v2_string_input_representation() -> None:
    assert "TEXT_INPUT" not in migration_module.FormInputType.__members__
    legacy_node_data = LegacyHumanInputNodeData.model_validate(
        {
            "title": "Approval",
            "delivery_methods": [{"id": _WEBAPP_METHOD_ID, "type": "webapp", "config": {}}],
            "inputs": [
                {"type": "text_input", "output_variable_name": "short_text"},
                {"type": "paragraph", "output_variable_name": "long_text"},
            ],
        }
    )

    conversion = convert_legacy_human_input_node_data(
        legacy_node_data,
        migration_module.MemberEmailSnapshot(),
    )

    assert conversion.node_data is not None
    assert [form_input.type for form_input in conversion.node_data.inputs] == ["paragraph", "paragraph"]


def test_converter_preserves_repeated_historical_output_slots() -> None:
    legacy_node_data = LegacyHumanInputNodeData.model_validate(
        {
            "title": "Approval",
            "delivery_methods": [{"id": _WEBAPP_METHOD_ID, "type": "webapp", "config": {}}],
            "form_content": "{{#$output.reason#}} / {{#$output.reason#}}",
            "inputs": [{"type": "paragraph", "output_variable_name": "reason"}],
        }
    )

    conversion = convert_legacy_human_input_node_data(legacy_node_data, _member_email_snapshot())

    assert conversion.blockers == ()
    assert conversion.node_data is not None
    assert conversion.node_data.form_content == "{{#$output.reason#}} / {{#$output.reason#}}"
    assert conversion.node_data.output_variable_names() == ("reason", "reason")


def test_external_and_member_email_sources_become_normalized_onetime_email() -> None:
    legacy_node_data = LegacyHumanInputNodeData.model_validate(
        {
            "title": "Approval",
            "delivery_methods": [
                {
                    "id": _EMAIL_METHOD_ID,
                    "type": "email",
                    "enabled": True,
                    "config": {
                        "recipients": {
                            "items": [
                                {"type": "external", "email": "  APPROVER@Example.COM "},
                                {"type": "member", "user_id": "member-1"},
                            ]
                        },
                        "subject": "Review request",
                        "body": "Please review {{#url#}}",
                    },
                }
            ],
        }
    )

    conversion = convert_legacy_human_input_node_data(
        legacy_node_data,
        _member_email_snapshot({"member-1": "  MEMBER@Example.COM "}),
    )

    assert conversion.blockers == ()
    assert conversion.node_data is not None
    assert [recipient.model_dump(mode="json") for recipient in conversion.node_data.recipients_spec] == [
        {"type": "onetime_email", "email": "approver@example.com"},
        {"type": "onetime_email", "email": "member@example.com"},
    ]


def test_member_user_id_has_safe_resolution_blocker_value() -> None:
    legacy_node_data = LegacyHumanInputNodeData.model_validate(
        {
            "title": "Approval",
            "delivery_methods": [
                {
                    "id": _EMAIL_METHOD_ID,
                    "type": "email",
                    "config": {
                        "subject": "Review",
                        "body": "Please review",
                        "recipients": {
                            "items": [{"type": "member", "user_id": "member-1"}],
                        },
                    },
                }
            ],
        }
    )

    resolved = convert_legacy_human_input_node_data(
        legacy_node_data,
        _member_email_snapshot({"member-1": "member@example.com"}),
    )
    unresolved = convert_legacy_human_input_node_data(legacy_node_data, _member_email_snapshot())

    assert resolved.blockers == ()
    assert resolved.node_data is not None
    assert resolved.node_data.recipients_spec[0].model_dump(mode="json") == {
        "type": "onetime_email",
        "email": "member@example.com",
    }
    assert [(blocker.code, blocker.method_id, blocker.value) for blocker in unresolved.blockers] == [
        ("unresolved-member", _EMAIL_METHOD_ID, "member-1"),
        ("missing-recipients", None, None),
    ]


def test_external_email_conversion_is_independent_of_unrelated_directory_state() -> None:
    legacy_node_data = LegacyHumanInputNodeData.model_validate(
        {
            "title": "Approval",
            "delivery_methods": [
                {
                    "id": _EMAIL_METHOD_ID,
                    "type": "email",
                    "config": {
                        "recipients": {
                            "items": [{"type": "external", "email": "approver@example.com"}],
                        },
                        "subject": "Review request",
                        "body": "Please review",
                    },
                }
            ],
        }
    )

    without_directory_entries = convert_legacy_human_input_node_data(legacy_node_data, _member_email_snapshot())
    with_unrelated_entries = convert_legacy_human_input_node_data(
        legacy_node_data,
        _member_email_snapshot({"unrelated-account": "approver@example.com"}),
    )

    assert without_directory_entries == with_unrelated_entries


def test_whole_workspace_marker_preserves_overlap_source_order_and_deduplicates() -> None:
    legacy_node_data = LegacyHumanInputNodeData.model_validate(
        {
            "title": "Approval",
            "delivery_methods": [
                {
                    "id": _EMAIL_METHOD_ID,
                    "type": "email",
                    "config": {
                        "recipients": {
                            "whole_workspace": True,
                            "items": [{"type": "member", "user_id": "member-1"}],
                        },
                        "subject": "Review request",
                        "body": "Please review",
                    },
                },
                {"id": _WEBAPP_METHOD_ID, "type": "webapp", "config": {}},
                {
                    "id": _SECOND_EMAIL_METHOD_ID,
                    "type": "email",
                    "config": {
                        "recipients": {"whole_workspace": True},
                        "subject": "Review request",
                        "body": "Please review",
                    },
                },
            ],
        }
    )

    conversion = convert_legacy_human_input_node_data(
        legacy_node_data,
        _member_email_snapshot({"member-1": "member@example.com"}),
    )

    assert conversion.blockers == ()
    assert conversion.node_data is not None
    assert [recipient.model_dump(mode="json") for recipient in conversion.node_data.recipients_spec] == [
        {"type": "onetime_email", "email": "member@example.com"},
        {"type": "all_workspace_contacts"},
        {"type": "initiator"},
    ]


def test_matching_email_templates_debug_mode_and_canonical_dedupe_are_deterministic() -> None:
    legacy_node_data = LegacyHumanInputNodeData.model_validate(
        {
            "title": "Approval",
            "delivery_methods": [
                {
                    "id": _EMAIL_METHOD_ID,
                    "type": "email",
                    "config": {
                        "recipients": {
                            "items": [{"type": "external", "email": " First@Example.com "}],
                        },
                        "subject": "  Review request  ",
                        "body": "  Please review {{#url#}}  ",
                    },
                },
                {
                    "id": _SECOND_EMAIL_METHOD_ID,
                    "type": "email",
                    "config": {
                        "recipients": {
                            "items": [
                                {"type": "external", "email": "first@example.COM"},
                                {"type": "external", "email": "second@example.com"},
                            ],
                        },
                        "subject": "  Review request  ",
                        "body": "  Please review {{#url#}}  ",
                        "debug_mode": True,
                    },
                },
            ],
        }
    )

    conversion = convert_legacy_human_input_node_data(legacy_node_data, _member_email_snapshot())

    assert conversion.blockers == ()
    assert conversion.node_data is not None
    assert conversion.node_data.message_template.model_dump() == {
        "subject": "  Review request  ",
        "body": "  Please review {{#url#}}  ",
    }
    assert conversion.node_data.debug_mode.model_dump(mode="json") == {
        "enabled": True,
        "channels": ["email"],
    }
    assert [recipient.model_dump(mode="json") for recipient in conversion.node_data.recipients_spec] == [
        {"type": "onetime_email", "email": "first@example.com"},
        {"type": "onetime_email", "email": "second@example.com"},
    ]


def test_lossy_delivery_configuration_produces_stably_ordered_blockers() -> None:
    legacy_node_data = LegacyHumanInputNodeData.model_validate(
        {
            "title": "Approval",
            "delivery_methods": [
                {
                    "id": _SECOND_EMAIL_METHOD_ID,
                    "type": "email",
                    "enabled": False,
                    "config": {
                        "subject": "Configured",
                        "body": "Configured",
                        "recipients": {"items": []},
                    },
                },
                {
                    "id": _EMAIL_METHOD_ID,
                    "type": "email",
                    "enabled": True,
                    "config": {
                        "subject": " ",
                        "body": "7",
                        "recipients": {
                            "items": [
                                {"type": "external", "email": "not-an-email"},
                                {"type": "member", "user_id": "missing-member"},
                            ]
                        },
                    },
                },
            ],
        }
    )

    conversion = convert_legacy_human_input_node_data(legacy_node_data, _member_email_snapshot())

    assert conversion.node_data is None
    assert [(blocker.code, blocker.method_id, blocker.value) for blocker in conversion.blockers] == [
        ("configured-disabled-method", _SECOND_EMAIL_METHOD_ID, "email"),
        ("invalid-email-configuration", _EMAIL_METHOD_ID, "subject"),
        ("invalid-email", _EMAIL_METHOD_ID, "not-an-email"),
        ("unresolved-member", _EMAIL_METHOD_ID, "missing-member"),
        ("missing-recipients", None, None),
    ]


def test_conversion_forces_untrusted_legacy_node_type_to_human_input() -> None:
    legacy_node_data = LegacyHumanInputNodeData.model_validate(
        {
            "title": "Approval",
            "type": "code",
            "delivery_methods": [{"id": _WEBAPP_METHOD_ID, "type": "webapp", "config": {}}],
        }
    )

    conversion = convert_legacy_human_input_node_data(legacy_node_data, _member_email_snapshot())

    assert conversion.blockers == ()
    assert conversion.node_data is not None
    assert conversion.node_data.type == BuiltinNodeTypes.HUMAN_INPUT
    assert conversion.node_data.model_dump(mode="json")["type"] == "human-input"


def test_conflicting_email_templates_block_after_recipient_preflight() -> None:
    legacy_node_data = LegacyHumanInputNodeData.model_validate(
        {
            "title": "Approval",
            "delivery_methods": [
                {
                    "id": _EMAIL_METHOD_ID,
                    "type": "email",
                    "config": {
                        "recipients": {"items": [{"type": "external", "email": "first@example.com"}]},
                        "subject": "First subject",
                        "body": "Shared body",
                    },
                },
                {
                    "id": _SECOND_EMAIL_METHOD_ID,
                    "type": "email",
                    "config": {
                        "recipients": {"items": [{"type": "external", "email": "invalid-email"}]},
                        "subject": "Second subject",
                        "body": "Shared body",
                    },
                },
            ],
        }
    )

    conversion = convert_legacy_human_input_node_data(legacy_node_data, _member_email_snapshot())

    assert conversion.node_data is None
    assert [(blocker.code, blocker.method_id) for blocker in conversion.blockers] == [
        ("invalid-email", _SECOND_EMAIL_METHOD_ID),
        ("conflicting-email-templates", _SECOND_EMAIL_METHOD_ID),
    ]


def test_shared_fields_input_immutability_and_repeated_conversion_are_preserved() -> None:
    legacy_node_data = LegacyHumanInputNodeData.model_validate(
        {
            "title": "Manager approval",
            "desc": "Preserve this description",
            "form_content": "Decision: {{#$output.reason#}}",
            "inputs": [{"type": "paragraph", "output_variable_name": "reason"}],
            "user_actions": [{"id": "approve", "title": "Approve", "button_style": "primary"}],
            "timeout": 2,
            "timeout_unit": "day",
            "future_legacy_field": "ignored",
            "delivery_methods": [{"id": _WEBAPP_METHOD_ID, "type": "webapp", "config": {}}],
        }
    )
    original_legacy_value = legacy_node_data.model_dump(mode="json")

    first = convert_legacy_human_input_node_data(legacy_node_data, _member_email_snapshot())
    second = convert_legacy_human_input_node_data(legacy_node_data, _member_email_snapshot())

    assert first == second
    assert legacy_node_data.model_dump(mode="json") == original_legacy_value
    assert first.node_data is not None
    assert first.node_data.model_dump(mode="json") == {
        **{key: value for key, value in original_legacy_value.items() if key not in {"delivery_methods", "version"}},
        "type": "human-input",
        "version": "2",
        "recipients_spec": [{"type": "initiator"}],
        "message_template": {"subject": "", "body": ""},
        "debug_mode": {"enabled": False, "channels": []},
    }
