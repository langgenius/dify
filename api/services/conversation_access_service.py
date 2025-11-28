"""
Conversation Access Service for Dify.

This module provides utilities for managing conversation access control,
ensuring users can only access their own conversation history and preventing
unauthorized access to other users' conversations.

Related Issue: #18410 - Users should not be able to access other users' conversation history
"""

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field


class AccessLevel(StrEnum):
    """Access levels for conversations."""

    NONE = "none"
    READ = "read"
    WRITE = "write"
    ADMIN = "admin"
    OWNER = "owner"


class AccessDeniedReason(StrEnum):
    """Reasons for access denial."""

    NOT_OWNER = "not_owner"
    NOT_IN_TENANT = "not_in_tenant"
    CONVERSATION_DELETED = "conversation_deleted"
    CONVERSATION_EXPIRED = "conversation_expired"
    INSUFFICIENT_PERMISSIONS = "insufficient_permissions"
    RATE_LIMITED = "rate_limited"
    INVALID_TOKEN = "invalid_token"


@dataclass
class AccessCheckResult:
    """Result of an access check."""

    allowed: bool
    access_level: AccessLevel
    reason: AccessDeniedReason | None = None
    message: str | None = None
    checked_at: datetime = field(default_factory=datetime.now)


@dataclass
class ConversationOwnership:
    """Ownership information for a conversation."""

    conversation_id: str
    owner_id: str
    owner_type: str
    tenant_id: str
    app_id: str
    created_at: datetime
    is_deleted: bool = False
    deleted_at: datetime | None = None
    shared_with: list[str] = field(default_factory=list)
    access_grants: dict[str, AccessLevel] = field(default_factory=dict)


class AccessPolicy(BaseModel):
    """Policy for conversation access control."""

    allow_cross_user_access: bool = Field(default=False)
    allow_admin_access: bool = Field(default=True)
    require_same_tenant: bool = Field(default=True)
    conversation_expiry_days: int = Field(default=0, ge=0)
    max_conversations_per_user: int = Field(default=1000, ge=0)
    enable_sharing: bool = Field(default=False)
    audit_access: bool = Field(default=True)


class AccessAuditEntry(BaseModel):
    """Audit log entry for access attempts."""

    timestamp: datetime = Field(default_factory=datetime.now)
    conversation_id: str
    requester_id: str
    requester_type: str
    action: str
    result: str
    access_level: AccessLevel
    reason: AccessDeniedReason | None = None
    ip_address: str | None = None
    user_agent: str | None = None


class ConversationAccessService:
    """
    Service for managing conversation access control.

    Provides functionality for:
    - Verifying user access to conversations
    - Managing conversation ownership
    - Enforcing access policies
    - Auditing access attempts
    """

    def __init__(self, policy: AccessPolicy | None = None):
        """Initialize the access service."""
        self.policy = policy or AccessPolicy()
        self._ownership_cache: dict[str, ConversationOwnership] = {}
        self._audit_log: list[AccessAuditEntry] = []
        self._rate_limits: dict[str, list[datetime]] = {}

    def register_conversation(
        self,
        conversation_id: str,
        owner_id: str,
        owner_type: str,
        tenant_id: str,
        app_id: str,
    ) -> ConversationOwnership:
        """
        Register a new conversation with ownership information.

        Args:
            conversation_id: ID of the conversation
            owner_id: ID of the owner (user or end_user)
            owner_type: Type of owner ('user' or 'end_user')
            tenant_id: ID of the tenant
            app_id: ID of the application

        Returns:
            ConversationOwnership record
        """
        ownership = ConversationOwnership(
            conversation_id=conversation_id,
            owner_id=owner_id,
            owner_type=owner_type,
            tenant_id=tenant_id,
            app_id=app_id,
            created_at=datetime.now(),
        )
        self._ownership_cache[conversation_id] = ownership
        return ownership

    def get_ownership(self, conversation_id: str) -> ConversationOwnership | None:
        """Get ownership information for a conversation."""
        return self._ownership_cache.get(conversation_id)

    def check_access(
        self,
        conversation_id: str,
        requester_id: str,
        requester_type: str,
        tenant_id: str,
        required_level: AccessLevel = AccessLevel.READ,
        ip_address: str | None = None,
        user_agent: str | None = None,
    ) -> AccessCheckResult:
        """
        Check if a requester has access to a conversation.

        Args:
            conversation_id: ID of the conversation
            requester_id: ID of the requester
            requester_type: Type of requester ('user', 'end_user', 'admin')
            tenant_id: Tenant ID of the requester
            required_level: Minimum access level required
            ip_address: IP address for audit logging
            user_agent: User agent for audit logging

        Returns:
            AccessCheckResult with access decision
        """
        ownership = self._ownership_cache.get(conversation_id)

        if not ownership:
            result = AccessCheckResult(
                allowed=False,
                access_level=AccessLevel.NONE,
                reason=AccessDeniedReason.CONVERSATION_DELETED,
                message="Conversation not found",
            )
            self._log_access(
                conversation_id, requester_id, requester_type,
                "check_access", result, ip_address, user_agent
            )
            return result

        if ownership.is_deleted:
            result = AccessCheckResult(
                allowed=False,
                access_level=AccessLevel.NONE,
                reason=AccessDeniedReason.CONVERSATION_DELETED,
                message="Conversation has been deleted",
            )
            self._log_access(
                conversation_id, requester_id, requester_type,
                "check_access", result, ip_address, user_agent
            )
            return result

        if self.policy.require_same_tenant and tenant_id != ownership.tenant_id:
            result = AccessCheckResult(
                allowed=False,
                access_level=AccessLevel.NONE,
                reason=AccessDeniedReason.NOT_IN_TENANT,
                message="Conversation belongs to a different tenant",
            )
            self._log_access(
                conversation_id, requester_id, requester_type,
                "check_access", result, ip_address, user_agent
            )
            return result

        if self._is_conversation_expired(ownership):
            result = AccessCheckResult(
                allowed=False,
                access_level=AccessLevel.NONE,
                reason=AccessDeniedReason.CONVERSATION_EXPIRED,
                message="Conversation has expired",
            )
            self._log_access(
                conversation_id, requester_id, requester_type,
                "check_access", result, ip_address, user_agent
            )
            return result

        access_level = self._determine_access_level(
            ownership, requester_id, requester_type
        )

        if self._compare_access_levels(access_level, required_level) < 0:
            result = AccessCheckResult(
                allowed=False,
                access_level=access_level,
                reason=AccessDeniedReason.INSUFFICIENT_PERMISSIONS,
                message=f"Required access level: {required_level.value}, "
                        f"actual: {access_level.value}",
            )
            self._log_access(
                conversation_id, requester_id, requester_type,
                "check_access", result, ip_address, user_agent
            )
            return result

        result = AccessCheckResult(
            allowed=True,
            access_level=access_level,
        )
        self._log_access(
            conversation_id, requester_id, requester_type,
            "check_access", result, ip_address, user_agent
        )
        return result

    def _determine_access_level(
        self,
        ownership: ConversationOwnership,
        requester_id: str,
        requester_type: str,
    ) -> AccessLevel:
        """Determine the access level for a requester."""
        if requester_id == ownership.owner_id:
            return AccessLevel.OWNER

        if requester_type == "admin" and self.policy.allow_admin_access:
            return AccessLevel.ADMIN

        if requester_id in ownership.access_grants:
            return ownership.access_grants[requester_id]

        if self.policy.enable_sharing and requester_id in ownership.shared_with:
            return AccessLevel.READ

        if self.policy.allow_cross_user_access:
            return AccessLevel.READ

        return AccessLevel.NONE

    def _compare_access_levels(self, level1: AccessLevel, level2: AccessLevel) -> int:
        """Compare two access levels. Returns -1, 0, or 1."""
        order = [
            AccessLevel.NONE,
            AccessLevel.READ,
            AccessLevel.WRITE,
            AccessLevel.ADMIN,
            AccessLevel.OWNER,
        ]
        idx1 = order.index(level1)
        idx2 = order.index(level2)
        if idx1 < idx2:
            return -1
        if idx1 > idx2:
            return 1
        return 0

    def _is_conversation_expired(self, ownership: ConversationOwnership) -> bool:
        """Check if a conversation has expired."""
        if self.policy.conversation_expiry_days <= 0:
            return False

        expiry_date = ownership.created_at + timedelta(
            days=self.policy.conversation_expiry_days
        )
        return datetime.now() > expiry_date

    def _log_access(
        self,
        conversation_id: str,
        requester_id: str,
        requester_type: str,
        action: str,
        result: AccessCheckResult,
        ip_address: str | None,
        user_agent: str | None,
    ) -> None:
        """Log an access attempt."""
        if not self.policy.audit_access:
            return

        entry = AccessAuditEntry(
            conversation_id=conversation_id,
            requester_id=requester_id,
            requester_type=requester_type,
            action=action,
            result="allowed" if result.allowed else "denied",
            access_level=result.access_level,
            reason=result.reason,
            ip_address=ip_address,
            user_agent=user_agent,
        )
        self._audit_log.append(entry)

    def grant_access(
        self,
        conversation_id: str,
        grantee_id: str,
        access_level: AccessLevel,
        granter_id: str,
    ) -> bool:
        """
        Grant access to a conversation.

        Args:
            conversation_id: ID of the conversation
            grantee_id: ID of the user to grant access to
            access_level: Level of access to grant
            granter_id: ID of the user granting access

        Returns:
            True if access was granted successfully
        """
        ownership = self._ownership_cache.get(conversation_id)
        if not ownership:
            return False

        if granter_id != ownership.owner_id:
            return False

        if not self.policy.enable_sharing:
            return False

        ownership.access_grants[grantee_id] = access_level
        if grantee_id not in ownership.shared_with:
            ownership.shared_with.append(grantee_id)

        return True

    def revoke_access(
        self,
        conversation_id: str,
        revokee_id: str,
        revoker_id: str,
    ) -> bool:
        """
        Revoke access from a conversation.

        Args:
            conversation_id: ID of the conversation
            revokee_id: ID of the user to revoke access from
            revoker_id: ID of the user revoking access

        Returns:
            True if access was revoked successfully
        """
        ownership = self._ownership_cache.get(conversation_id)
        if not ownership:
            return False

        if revoker_id != ownership.owner_id:
            return False

        ownership.access_grants.pop(revokee_id, None)
        if revokee_id in ownership.shared_with:
            ownership.shared_with.remove(revokee_id)

        return True

    def mark_deleted(self, conversation_id: str, deleter_id: str) -> bool:
        """
        Mark a conversation as deleted.

        Args:
            conversation_id: ID of the conversation
            deleter_id: ID of the user deleting the conversation

        Returns:
            True if deletion was successful
        """
        ownership = self._ownership_cache.get(conversation_id)
        if not ownership:
            return False

        if deleter_id != ownership.owner_id:
            return False

        ownership.is_deleted = True
        ownership.deleted_at = datetime.now()
        return True

    def get_user_conversations(
        self,
        user_id: str,
        tenant_id: str,
        include_shared: bool = True,
    ) -> list[str]:
        """
        Get all conversation IDs accessible by a user.

        Args:
            user_id: ID of the user
            tenant_id: Tenant ID
            include_shared: Whether to include shared conversations

        Returns:
            List of conversation IDs
        """
        conversations: list[str] = []

        for conv_id, ownership in self._ownership_cache.items():
            if ownership.is_deleted:
                continue

            if ownership.tenant_id != tenant_id:
                continue

            if ownership.owner_id == user_id or (
                include_shared and user_id in ownership.shared_with
            ):
                conversations.append(conv_id)

        return conversations

    def get_audit_log(
        self,
        conversation_id: str | None = None,
        requester_id: str | None = None,
        limit: int = 100,
    ) -> list[AccessAuditEntry]:
        """
        Get audit log entries.

        Args:
            conversation_id: Filter by conversation ID
            requester_id: Filter by requester ID
            limit: Maximum number of entries to return

        Returns:
            List of audit log entries
        """
        entries = self._audit_log

        if conversation_id:
            entries = [e for e in entries if e.conversation_id == conversation_id]

        if requester_id:
            entries = [e for e in entries if e.requester_id == requester_id]

        return sorted(entries, key=lambda x: x.timestamp, reverse=True)[:limit]

    def get_access_statistics(self, tenant_id: str) -> dict[str, Any]:
        """
        Get access statistics for a tenant.

        Args:
            tenant_id: ID of the tenant

        Returns:
            Dictionary of statistics
        """
        tenant_conversations = [
            o for o in self._ownership_cache.values()
            if o.tenant_id == tenant_id and not o.is_deleted
        ]

        total = len(tenant_conversations)
        shared = sum(1 for o in tenant_conversations if o.shared_with)
        with_grants = sum(1 for o in tenant_conversations if o.access_grants)

        recent_audits = [
            e for e in self._audit_log
            if e.conversation_id in [o.conversation_id for o in tenant_conversations]
        ]
        denied_count = sum(1 for e in recent_audits if e.result == "denied")

        return {
            "total_conversations": total,
            "shared_conversations": shared,
            "conversations_with_grants": with_grants,
            "total_audit_entries": len(recent_audits),
            "denied_access_attempts": denied_count,
            "denial_rate": denied_count / len(recent_audits) if recent_audits else 0,
        }

    def cleanup_expired_conversations(self, tenant_id: str) -> int:
        """
        Clean up expired conversations for a tenant.

        Args:
            tenant_id: ID of the tenant

        Returns:
            Number of conversations cleaned up
        """
        if self.policy.conversation_expiry_days <= 0:
            return 0

        cleaned = 0
        for _, ownership in list(self._ownership_cache.items()):
            if ownership.tenant_id != tenant_id:
                continue

            if self._is_conversation_expired(ownership):
                ownership.is_deleted = True
                ownership.deleted_at = datetime.now()
                cleaned += 1

        return cleaned

    def transfer_ownership(
        self,
        conversation_id: str,
        new_owner_id: str,
        current_owner_id: str,
    ) -> bool:
        """
        Transfer ownership of a conversation.

        Args:
            conversation_id: ID of the conversation
            new_owner_id: ID of the new owner
            current_owner_id: ID of the current owner

        Returns:
            True if transfer was successful
        """
        ownership = self._ownership_cache.get(conversation_id)
        if not ownership:
            return False

        if ownership.owner_id != current_owner_id:
            return False

        ownership.access_grants[current_owner_id] = AccessLevel.READ
        ownership.owner_id = new_owner_id

        return True
