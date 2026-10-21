"""Resolved credential identity, rather than its display alias, binds disclosure."""

from datetime import datetime

from sqlalchemy import update
from sqlalchemy.orm import Session

from graphon.variables import SecretVariable
from models.tools import BuiltinToolProvider
from models.workflow import Workflow
from services.dify_builder.dify_port import _effect_scope_binding, _tool_account_metadata


def _credential(
    *,
    id: str,
    provider: str,
    name: str,
    is_default: bool,
    created_at: datetime,
    updated_at: datetime,
    encrypted_credentials: str | None = None,
) -> BuiltinToolProvider:
    row = BuiltinToolProvider(
        tenant_id="tenant",
        user_id="actor",
        provider=provider,
        name=name,
        is_default=is_default,
        encrypted_credentials=encrypted_credentials,
    )
    row.id = id
    row.created_at, row.updated_at = created_at, updated_at
    return row


def test_default_account_binding_changes_when_same_named_default_changes(sqlite_session: Session):
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
    first = _credential(
        id="credential-1",
        encrypted_credentials=None,
        provider="example/send",
        name="Test account",
        is_default=True,
        created_at=datetime(2026, 1, 1),
        updated_at=datetime(2026, 1, 1),
    )
    second = _credential(
        id="credential-2",
        encrypted_credentials=None,
        provider="example/send",
        name="Test account",
        is_default=False,
        created_at=datetime(2026, 1, 2),
        updated_at=datetime(2026, 1, 2),
    )
    session = sqlite_session
    session.add(first)
    session.flush()
    names, before = _tool_account_metadata(session, "tenant", graph)
    first.is_default, second.is_default = False, True
    # Display aliases are unique per provider; replace the old account with
    # its same-named successor instead of inventing impossible duplicate rows.
    session.delete(first)
    session.flush()
    session.add(second)
    session.flush()
    after_names, after = _tool_account_metadata(session, "tenant", graph)
    assert names == after_names == {"send": "Test account"}
    assert before["send"] != after["send"]


def test_explicit_account_version_changes_binding_without_exposing_credentials(sqlite_session: Session):
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
    account = _credential(
        id="credential-1",
        encrypted_credentials=None,
        provider="example/send",
        name="Test account",
        is_default=False,
        created_at=datetime(2026, 1, 1),
        updated_at=datetime(2026, 1, 1),
    )
    session = sqlite_session
    session.add(account)
    session.flush()
    _, before = _tool_account_metadata(session, "tenant", graph)
    account.updated_at = datetime(2026, 2, 1)
    _, after = _tool_account_metadata(session, "tenant", graph)
    assert before != after
    assert len(before["send"]) == 64
    assert "credential-1" not in before["send"]


def test_legacy_native_provider_row_binds_canonical_plugin_account(sqlite_session: Session):
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
    account = _credential(
        id="credential-1",
        encrypted_credentials=None,
        provider="slack",
        name="Test account",
        is_default=True,
        created_at=datetime(2026, 1, 1),
        updated_at=datetime(2026, 1, 1),
    )
    session = sqlite_session
    session.add(account)
    session.flush()
    names, bindings = _tool_account_metadata(session, "tenant", graph)
    assert names == {"send": "Test account"}
    assert len(bindings["send"]) == 64


def test_same_timestamp_credential_rotation_changes_binding(sqlite_session: Session):
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
    account = _credential(
        id="credential-1",
        provider="example/send",
        name="Test account",
        is_default=True,
        created_at=datetime(2026, 1, 1),
        updated_at=datetime(2026, 1, 1),
        encrypted_credentials="synthetic-ciphertext-before",
    )
    session = sqlite_session
    session.add(account)
    session.flush()
    _, before = _tool_account_metadata(session, "tenant", graph)
    session.execute(
        update(BuiltinToolProvider)
        .where(BuiltinToolProvider.id == account.id)
        .values(encrypted_credentials="synthetic-ciphertext-after", updated_at=datetime(2026, 1, 1))
    )
    session.expire(account)
    _, after = _tool_account_metadata(session, "tenant", graph)
    assert before != after


def test_scope_binding_uses_semantic_variables_instead_of_reencrypted_storage(mocker):
    variable = SecretVariable(name="DESTINATION", value="synthetic-value")
    workflow = Workflow(
        tenant_id="tenant", _environment_variables="synthetic-ciphertext-before", _conversation_variables="{}"
    )
    semantic_variables = mocker.patch("models.workflow.load_environment_variables", return_value=[variable])
    before = _effect_scope_binding(workflow)
    workflow._environment_variables = "synthetic-ciphertext-after"
    assert _effect_scope_binding(workflow) == before
    semantic_variables.return_value = [variable.model_copy(update={"value": "changed-synthetic-value"})]
    assert _effect_scope_binding(workflow) != before
