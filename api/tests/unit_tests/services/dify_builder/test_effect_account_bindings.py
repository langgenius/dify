"""Resolved credential identity, rather than its display alias, binds disclosure."""

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock

from graphon.variables import SecretVariable
from services.dify_builder.dify_port import _effect_scope_binding, _tool_account_metadata


def test_default_account_binding_changes_when_same_named_default_changes():
    graph = {
        "nodes": [
            {
                "id": "send",
                "data": {
                    "type": "tool",
                    "provider_type": "builtin",
                    "provider_id": "example/send",
                },
            }
        ]
    }
    first = SimpleNamespace(
        id="credential-1",
        encrypted_credentials=None,
        provider="example/send",
        name="Test account",
        is_default=True,
        created_at=datetime(2026, 1, 1),
        updated_at=datetime(2026, 1, 1),
    )
    second = SimpleNamespace(
        id="credential-2",
        encrypted_credentials=None,
        provider="example/send",
        name="Test account",
        is_default=False,
        created_at=datetime(2026, 1, 2),
        updated_at=datetime(2026, 1, 2),
    )
    session = MagicMock()
    session.scalars.return_value.all.return_value = [first, second]
    names, before = _tool_account_metadata(session, "tenant", graph)
    first.is_default, second.is_default = False, True
    after_names, after = _tool_account_metadata(session, "tenant", graph)
    assert names == after_names == {"send": "Test account"}
    assert before["send"] != after["send"]


def test_explicit_account_version_changes_binding_without_exposing_credentials():
    graph = {
        "nodes": [
            {
                "id": "send",
                "data": {
                    "type": "tool",
                    "provider_type": "plugin",
                    "provider_id": "example/send",
                    "credential_id": "credential-1",
                },
            }
        ]
    }
    account = SimpleNamespace(
        id="credential-1",
        encrypted_credentials=None,
        provider="example/send",
        name="Test account",
        is_default=False,
        created_at=datetime(2026, 1, 1),
        updated_at=datetime(2026, 1, 1),
    )
    session = MagicMock()
    session.scalars.return_value.all.return_value = [account]
    _, before = _tool_account_metadata(session, "tenant", graph)
    account.updated_at = datetime(2026, 2, 1)
    _, after = _tool_account_metadata(session, "tenant", graph)
    assert before != after
    assert len(before["send"]) == 64
    assert "credential-1" not in before["send"]


def test_legacy_native_provider_row_binds_canonical_plugin_account():
    graph = {
        "nodes": [
            {
                "id": "send",
                "data": {
                    "type": "tool",
                    "provider_type": "builtin",
                    "provider_id": "langgenius/slack/slack",
                },
            }
        ]
    }
    account = SimpleNamespace(
        id="credential-1",
        encrypted_credentials=None,
        provider="slack",
        name="Test account",
        is_default=True,
        created_at=datetime(2026, 1, 1),
        updated_at=datetime(2026, 1, 1),
    )
    session = MagicMock()
    session.scalars.return_value.all.return_value = [account]
    names, bindings = _tool_account_metadata(session, "tenant", graph)
    assert names == {"send": "Test account"}
    assert len(bindings["send"]) == 64


def test_same_timestamp_credential_rotation_changes_binding():
    graph = {
        "nodes": [
            {
                "id": "send",
                "data": {
                    "type": "tool",
                    "provider_type": "builtin",
                    "provider_id": "example/send",
                },
            }
        ]
    }
    account = SimpleNamespace(
        id="credential-1",
        provider="example/send",
        name="Test account",
        is_default=True,
        created_at=datetime(2026, 1, 1),
        updated_at=datetime(2026, 1, 1),
        encrypted_credentials="synthetic-ciphertext-before",
    )
    session = MagicMock()
    session.scalars.return_value.all.return_value = [account]
    _, before = _tool_account_metadata(session, "tenant", graph)
    account.encrypted_credentials = "synthetic-ciphertext-after"
    _, after = _tool_account_metadata(session, "tenant", graph)
    assert before != after


def test_scope_binding_uses_semantic_variables_instead_of_reencrypted_storage():
    variable = SecretVariable(name="DESTINATION", value="synthetic-value")
    workflow = SimpleNamespace(
        _environment_variables="synthetic-ciphertext-before",
        _conversation_variables="{}",
        environment_variables=[variable],
        conversation_variables=[],
    )
    before = _effect_scope_binding(workflow)
    workflow._environment_variables = "synthetic-ciphertext-after"
    assert _effect_scope_binding(workflow) == before
    workflow.environment_variables = [variable.model_copy(update={"value": "changed-synthetic-value"})]
    assert _effect_scope_binding(workflow) != before
