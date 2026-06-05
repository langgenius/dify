"""Defensive tests for UploadFileTenantValidator (Stage 4 §5.3).

The validator must never raise on pathological inputs: the Agent backend may
hand us garbage in the ``file_id`` slot because the protocol layer only
asserts ``{"type": "string"}``. Anything that isn't a real UUID belonging to
the current tenant should simply return False.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest
from graphon.file import FileTransferMethod

from core.workflow.nodes.agent_v2.file_tenant_validator import UploadFileTenantValidator


def test_empty_inputs_return_false_without_db_hit():
    validator = UploadFileTenantValidator()
    with patch("core.workflow.nodes.agent_v2.file_tenant_validator.session_factory") as factory:
        assert (
            validator.is_accessible_file_mapping(
                file_id="",
                tenant_id="tenant-1",
                transfer_method=FileTransferMethod.LOCAL_FILE,
            )
            is False
        )
        assert (
            validator.is_accessible_file_mapping(
                file_id="abc",
                tenant_id="",
                transfer_method=FileTransferMethod.LOCAL_FILE,
            )
            is False
        )
    factory.create_session.assert_not_called()


@pytest.mark.parametrize(
    "bad_file_id",
    [
        "not-a-uuid",
        "this-id-does-not-exist",
        "0123",
        "🤖🤖🤖",
        "../../etc/passwd",
        "550e8400-e29b-41d4-a716-446655440000-trailing",
    ],
)
def test_non_uuid_file_ids_return_false_without_db_hit(bad_file_id: str):
    validator = UploadFileTenantValidator()
    with patch("core.workflow.nodes.agent_v2.file_tenant_validator.session_factory") as factory:
        assert (
            validator.is_accessible_file_mapping(
                file_id=bad_file_id,
                tenant_id="tenant-1",
                transfer_method=FileTransferMethod.LOCAL_FILE,
            )
            is False
        )
    factory.create_session.assert_not_called()


def test_db_error_swallowed_and_returns_false():
    """Any DB-level fault (timeout, dialect quirk, connection drop) must reject
    the file rather than crash the workflow node."""
    from sqlalchemy.exc import SQLAlchemyError

    validator = UploadFileTenantValidator()
    valid_uuid = "550e8400-e29b-41d4-a716-446655440000"
    with patch("core.workflow.nodes.agent_v2.file_tenant_validator.session_factory") as factory:
        factory.create_session.return_value.__enter__.return_value.scalar.side_effect = SQLAlchemyError("boom")
        assert (
            validator.is_accessible_file_mapping(
                file_id=valid_uuid,
                tenant_id="tenant-1",
                transfer_method=FileTransferMethod.LOCAL_FILE,
            )
            is False
        )


def test_accessible_file_mapping_checks_transfer_method_family():
    validator = UploadFileTenantValidator()
    valid_uuid = "550e8400-e29b-41d4-a716-446655440000"
    with patch("core.workflow.nodes.agent_v2.file_tenant_validator.session_factory") as factory:
        factory.create_session.return_value.__enter__.return_value.scalar.return_value = None
        assert (
            validator.is_accessible_file_mapping(
                file_id=valid_uuid,
                tenant_id="tenant-1",
                transfer_method=FileTransferMethod.LOCAL_FILE,
            )
            is False
        )

    with patch("core.workflow.nodes.agent_v2.file_tenant_validator.session_factory") as factory:
        factory.create_session.return_value.__enter__.return_value.scalar.return_value = "tenant-1"
        assert (
            validator.is_accessible_file_mapping(
                file_id=valid_uuid,
                tenant_id="tenant-1",
                transfer_method=FileTransferMethod.TOOL_FILE,
            )
            is True
        )
