"""Complete KnowledgeFS test ports; unexpected external operations fail immediately."""

from __future__ import annotations

from services.knowledge_fs.lifecycle_port import (
    KnowledgeFSCapabilityGrantRevokeAck,
    KnowledgeFSCapabilityGrantRevokeRequest,
    KnowledgeFSDeletionProgress,
    KnowledgeFSDifyIntegrationActivationAck,
    KnowledgeFSDifyIntegrationActivationRequest,
    KnowledgeFSDifyIntegrationFreezeAck,
    KnowledgeFSDifyIntegrationFreezeRequest,
    KnowledgeFSIntegratedDeletionRequest,
    KnowledgeFSIntegratedProvisionRequest,
    KnowledgeFSRemoteSpace,
)


class UnexpectedLifecycleRemote:
    def provision_integrated_space(self, request: KnowledgeFSIntegratedProvisionRequest) -> KnowledgeFSRemoteSpace:
        del request
        raise AssertionError("Unexpected KnowledgeFS operation: provision_integrated_space")

    def request_integrated_deletion(self, request: KnowledgeFSIntegratedDeletionRequest) -> KnowledgeFSDeletionProgress:
        del request
        raise AssertionError("Unexpected KnowledgeFS operation: request_integrated_deletion")

    def revoke_capability_grant(
        self, request: KnowledgeFSCapabilityGrantRevokeRequest
    ) -> KnowledgeFSCapabilityGrantRevokeAck:
        del request
        raise AssertionError("Unexpected KnowledgeFS operation: revoke_capability_grant")

    def activate_dify_workspace_integration(
        self, request: KnowledgeFSDifyIntegrationActivationRequest
    ) -> KnowledgeFSDifyIntegrationActivationAck:
        del request
        raise AssertionError("Unexpected KnowledgeFS operation: activate_dify_workspace_integration")

    def freeze_dify_workspace_integration(
        self, request: KnowledgeFSDifyIntegrationFreezeRequest
    ) -> KnowledgeFSDifyIntegrationFreezeAck:
        del request
        raise AssertionError("Unexpected KnowledgeFS operation: freeze_dify_workspace_integration")

    def find_by_provisioning_key(
        self, *, provisioning_key: str, control_space_id: str
    ) -> KnowledgeFSRemoteSpace | None:
        del provisioning_key, control_space_id
        raise AssertionError("Unexpected KnowledgeFS operation: find_by_provisioning_key")

    def list_spaces(self, *, namespace_id: str, control_space_id: str) -> tuple[KnowledgeFSRemoteSpace, ...]:
        del namespace_id, control_space_id
        raise AssertionError("Unexpected KnowledgeFS operation: list_spaces")


from typing import cast

from services.knowledge_fs.capability_broker import (
    KnowledgeFSIssuedProductCapability,
)
from services.knowledge_fs.service_api_authorization import KnowledgeFSServiceApiProfile


class UnexpectedCapabilityIssuer:
    def issue_interactive(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        operation_id: str,
        resource_id: str | None = None,
        trace_id: str | None = None,
    ) -> KnowledgeFSIssuedProductCapability:
        del tenant_id, account_id, control_space_id, operation_id, resource_id, trace_id
        raise AssertionError("Unexpected KnowledgeFS operation: issue_interactive")

    def issue_namespace_interactive(
        self, *, tenant_id: str, account_id: str, operation_id: str, trace_id: str | None = None
    ) -> KnowledgeFSIssuedProductCapability:
        del tenant_id, account_id, operation_id, trace_id
        raise AssertionError("Unexpected KnowledgeFS operation: issue_namespace_interactive")

    def issue_service(
        self,
        *,
        profile: KnowledgeFSServiceApiProfile,
        operation_id: str,
        resource_id: str | None = None,
        trace_id: str | None = None,
    ) -> KnowledgeFSIssuedProductCapability:
        del profile, operation_id, resource_id, trace_id
        raise AssertionError("Unexpected KnowledgeFS operation: issue_service")


from models.knowledge_fs import (
    KnowledgeFSLifecycleOperation,
    KnowledgeFSLifecycleOutbox,
    KnowledgeFSProvisionCommandPayload,
    KnowledgeFSRevokeCommandPayload,
)


def revoke_payload(command: KnowledgeFSLifecycleOutbox) -> KnowledgeFSRevokeCommandPayload:
    assert command.operation is KnowledgeFSLifecycleOperation.REVOKE
    assert "grant_id" in command.command_payload
    return cast(KnowledgeFSRevokeCommandPayload, command.command_payload)


def provision_payload(command: KnowledgeFSLifecycleOutbox) -> KnowledgeFSProvisionCommandPayload:
    assert command.operation is KnowledgeFSLifecycleOperation.PROVISION
    assert "provisioning_key" in command.command_payload
    return cast(KnowledgeFSProvisionCommandPayload, command.command_payload)


from models.knowledge_fs import KnowledgeFSCapabilityClaimsSummary, KnowledgeFSCapabilityReservationSummary


def reservation_summary(
    *, tenant_id: str, control_space_id: str, grant_id: str, subject: str, caller_kind: str, trace_id: str = "trace-1"
) -> KnowledgeFSCapabilityReservationSummary:
    return {
        "action": "query",
        "actor": subject,
        "authz_revision": {
            "membership_epoch": 1,
            "space_acl_epoch": 1,
            "external_access_epoch": 1,
            "credential_revision": None,
        },
        "caller_kind": caller_kind,
        "content_policy_revision": 1,
        "content_scope_ids": [],
        "control_space_id": control_space_id,
        "grant_id": grant_id,
        "namespace_id": tenant_id,
        "operation_id": "query",
        "resource_id": "space-1",
        "resource_parent_id": None,
        "resource_type": "knowledge_space",
        "subject": subject,
        "trace_id": trace_id,
    }


def claims_summary(
    *, tenant_id: str, control_space_id: str, grant_id: str, subject: str, caller_kind: str
) -> KnowledgeFSCapabilityClaimsSummary:
    return {
        "action": "query",
        "actor": subject,
        "authz_revision": {
            "membership_epoch": 1,
            "space_acl_epoch": 1,
            "external_access_epoch": 1,
            "credential_revision": None,
        },
        "caller_kind": caller_kind,
        "content_policy_revision": 1,
        "content_scope_ids": [],
        "control_space_id": control_space_id,
        "grant_id": grant_id,
        "namespace_id": tenant_id,
        "operation_id": "query",
        "resource_id": "space-1",
        "resource_parent_id": None,
        "resource_type": "knowledge_space",
        "subject": subject,
        "issued_at": "2026-01-01T00:00:00Z",
        "expires_at": "2030-01-01T00:00:00Z",
    }
