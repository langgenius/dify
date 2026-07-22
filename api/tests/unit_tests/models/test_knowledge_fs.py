from __future__ import annotations

from collections.abc import Iterable

import sqlalchemy as sa

from models.knowledge_fs import (
    AppKnowledgeFSSpaceJoin,
    KnowledgeFSApiCredential,
    KnowledgeFSAuthorizationRevision,
    KnowledgeFSCapabilityIssuanceAudit,
    KnowledgeFSCapabilityIssuanceReservation,
    KnowledgeFSCapabilityIssuanceReservationStatus,
    KnowledgeFSControlSpace,
    KnowledgeFSControlSpacePermission,
    KnowledgeFSExternalAccessPolicy,
    KnowledgeFSLifecycleOperation,
    KnowledgeFSLifecycleOutbox,
)

_KNOWLEDGE_FS_MODELS = (
    KnowledgeFSControlSpace,
    KnowledgeFSControlSpacePermission,
    KnowledgeFSExternalAccessPolicy,
    KnowledgeFSApiCredential,
    AppKnowledgeFSSpaceJoin,
    KnowledgeFSAuthorizationRevision,
    KnowledgeFSCapabilityIssuanceAudit,
    KnowledgeFSCapabilityIssuanceReservation,
    KnowledgeFSLifecycleOutbox,
)

_FORBIDDEN_DEPENDENCIES = ("datasets", "documents", "dataset_permissions", "api_tokens")


def _constraint_column_names(constraint: sa.UniqueConstraint) -> tuple[str, ...]:
    return tuple(column.name for column in constraint.columns)


def _unique_constraints(table: sa.Table) -> Iterable[sa.UniqueConstraint]:
    return (constraint for constraint in table.constraints if isinstance(constraint, sa.UniqueConstraint))


def test_knowledge_fs_tables_are_independent_from_dataset_and_document_models() -> None:
    assert {model.__tablename__ for model in _KNOWLEDGE_FS_MODELS} == {
        "knowledge_fs_control_spaces",
        "knowledge_fs_control_space_permissions",
        "knowledge_fs_external_access_policies",
        "knowledge_fs_api_credentials",
        "app_knowledge_fs_space_joins",
        "knowledge_fs_authorization_revisions",
        "knowledge_fs_capability_issuance_audits",
        "knowledge_fs_capability_issuance_reservations",
        "knowledge_fs_lifecycle_outbox",
    }

    for model in _KNOWLEDGE_FS_MODELS:
        table = model.__table__
        dependency_text = " ".join(
            [table.name, *(column.name for column in table.columns), *(fk.target_fullname for fk in table.foreign_keys)]
        ).lower()
        assert not any(forbidden in dependency_text for forbidden in _FORBIDDEN_DEPENDENCIES)
        assert not model.__mapper__.relationships


def test_control_space_registration_and_child_tenant_boundaries_are_unique() -> None:
    control_table = KnowledgeFSControlSpace.__table__
    assert any(
        index.unique and tuple(column.name for column in index.columns) == ("tenant_id", "knowledge_space_id")
        for index in control_table.indexes
    )
    assert any(
        _constraint_column_names(constraint) == ("provisioning_key",)
        for constraint in _unique_constraints(control_table)
    )
    assert any(
        index.name == "kfs_control_space_state_updated_idx"
        and tuple(column.name for column in index.columns) == ("state", "updated_at")
        for index in control_table.indexes
    )

    expected_child_identity = {
        KnowledgeFSControlSpacePermission: ("tenant_id", "control_space_id", "account_id"),
        KnowledgeFSExternalAccessPolicy: ("tenant_id", "control_space_id"),
        AppKnowledgeFSSpaceJoin: ("tenant_id", "app_id", "control_space_id", "join_type"),
        KnowledgeFSAuthorizationRevision: ("tenant_id", "control_space_id"),
    }
    for model, columns in expected_child_identity.items():
        assert any(
            _constraint_column_names(constraint) == columns for constraint in _unique_constraints(model.__table__)
        )


def test_external_access_is_fail_closed_and_credentials_never_store_raw_secrets() -> None:
    policy = KnowledgeFSExternalAccessPolicy(tenant_id="tenant-1", control_space_id="space-1")
    assert policy.service_api_enabled is False
    assert policy.agent_enabled is False
    assert policy.workflow_enabled is False
    assert policy.mcp_enabled is False
    assert policy.revision == 0

    credential_columns = set(KnowledgeFSApiCredential.__table__.columns.keys())
    assert {"credential_hash", "credential_prefix", "credential_last4", "allowed_actions"} <= credential_columns
    assert "secret" not in credential_columns
    assert "token" not in credential_columns
    assert "credential_secret" not in credential_columns


def test_lifecycle_outbox_supports_every_p1a_command_and_revision_fences() -> None:
    assert {operation.value for operation in KnowledgeFSLifecycleOperation} == {
        "provision",
        "metadata_update",
        "delete",
        "revoke",
        "repair",
    }
    outbox_columns = set(KnowledgeFSLifecycleOutbox.__table__.columns.keys())
    assert {
        "operation_id",
        "idempotency_key",
        "command_schema_version",
        "command_payload",
        "expected_control_space_version",
        "expected_knowledge_space_revision",
        "attempt_count",
        "next_attempt_at",
        "retain_until",
    } <= outbox_columns

    control_columns = set(KnowledgeFSControlSpace.__table__.columns.keys())
    assert {"knowledge_space_revision", "deletion_irreversible_at"} <= control_columns

    revision_columns = set(KnowledgeFSAuthorizationRevision.__table__.columns.keys())
    assert {
        "membership_epoch",
        "space_acl_epoch",
        "external_access_epoch",
        "content_policy_revision",
        "revoke_sequence",
    } <= revision_columns


def test_capability_audit_persists_only_sanitized_issuance_evidence() -> None:
    audit_columns = set(KnowledgeFSCapabilityIssuanceAudit.__table__.columns.keys())
    assert {
        "tenant_id",
        "control_space_id",
        "trace_id",
        "jti_hash",
        "claims_summary",
    } <= audit_columns
    assert {"token", "raw_jti", "jti"}.isdisjoint(audit_columns)

    reservation_columns = set(KnowledgeFSCapabilityIssuanceReservation.__table__.columns.keys())
    assert {
        "tenant_id",
        "control_space_id",
        "grant_id",
        "trace_id",
        "subject",
        "caller_kind",
        "request_summary",
        "status",
        "cleanup_after",
        "row_version",
    } <= reservation_columns
    assert {"token", "bearer", "private_key", "raw_jti", "jti"}.isdisjoint(reservation_columns)
    reservation = KnowledgeFSCapabilityIssuanceReservation(
        tenant_id="tenant-1",
        control_space_id="space-1",
        grant_id="20000000-0000-4000-8000-000000000001",
        trace_id="trace-1",
        subject="dify-account:account-1",
        caller_kind="interactive",
        request_summary={
            "caller_kind": "interactive",
            "grant_id": "20000000-0000-4000-8000-000000000001",
            "subject": "dify-account:account-1",
        },
    )
    assert reservation.status is KnowledgeFSCapabilityIssuanceReservationStatus.RESERVED


def test_outbox_schema_requires_lease_and_terminal_state_consistency() -> None:
    constraints = {
        str(constraint.sqltext)
        for constraint in KnowledgeFSLifecycleOutbox.__table__.constraints
        if isinstance(constraint, sa.CheckConstraint)
    }
    joined_constraints = " ".join(constraints)
    assert "lease_owner" in joined_constraints
    assert "lease_expires_at" in joined_constraints
    assert "completed_at" in joined_constraints
