"""Confirmed config reads keep the claimed operation and published asset scope."""

from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from runtime_contracts.builder.execution import BuilderExecutionPolicyError
from services.dify_builder.native_testing.agent_config_access import validate_config_read


def fixture():
    context = SimpleNamespace(
        native_test_profile="confirmed",
        ref="ref",
        config=SimpleNamespace(
            config={
                "composition": {
                    "layers": [
                        {"name": "execution_context", "config": {"tenant_id": "t", "user_id": "u"}},
                        {
                            "name": "config",
                            "config": {
                                "agent_id": "a",
                                "config_version": {"id": "snapshot", "kind": "snapshot"},
                                "skills": [{"name": "check"}],
                                "files": [{"name": "input.txt"}],
                                "mentioned_skill_names": ["check"],
                                "mentioned_file_names": ["input.txt"],
                            },
                        },
                    ]
                }
            }
        ),
    )
    envelope = SimpleNamespace(ref="ref", intent=SimpleNamespace(kind="shell", target={"kind": "file"}))
    service = Mock()
    service.validate_claimed_shell.return_value = context
    query = {
        "tenant_id": "t",
        "user_id": "u",
        "agent_id": "a",
        "config_version_id": "snapshot",
        "config_version_kind": "snapshot",
    }
    return context, envelope, service, query


def test_selected_asset_requires_current_claimed_operation():
    context, envelope, service, query = fixture()
    validate_config_read(
        context=context, envelope=envelope, operations=service, source={"kind": "file", "name": "input.txt"}, **query
    )
    service.validate_claimed_shell.assert_called_once_with(envelope=envelope)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("tenant_id", "other"),
        ("user_id", "other"),
        ("agent_id", "other"),
        ("config_version_id", "other"),
        ("config_version_kind", "draft"),
    ],
)
def test_owner_or_snapshot_substitution_stops_before_config_service(field, value):
    context, envelope, service, query = fixture()
    query[field] = value
    with pytest.raises(BuilderExecutionPolicyError):
        validate_config_read(context=context, envelope=envelope, operations=service, **query)


def test_other_declared_kind_or_unknown_asset_is_not_a_file_pull():
    context, envelope, service, query = fixture()
    for source in ({"kind": "file", "name": "secret.txt"}, {"kind": "skill", "name": "check"}):
        with pytest.raises(BuilderExecutionPolicyError):
            validate_config_read(context=context, envelope=envelope, operations=service, source=source, **query)


def test_revoked_or_completed_claim_never_falls_back_to_ordinary_access():
    context, envelope, service, query = fixture()
    service.validate_claimed_shell.side_effect = BuilderExecutionPolicyError("native_effect_owner_mismatch")
    with pytest.raises(BuilderExecutionPolicyError):
        validate_config_read(context=context, envelope=envelope, operations=service, **query)


def test_changed_protected_context_rejected_after_claim_validation():
    context, envelope, service, query = fixture()
    service.validate_claimed_shell.return_value = SimpleNamespace(
        ref="ref", native_test_profile="confirmed", config=None
    )
    with pytest.raises(BuilderExecutionPolicyError):
        validate_config_read(context=context, envelope=envelope, operations=service, **query)
