"""Nominal identifiers shared across bounded-context integration contracts."""

from typing import NewType

AccountId = NewType("AccountId", str)
ApproverGrantKey = NewType("ApproverGrantKey", str)
EmailChallengeId = NewType("EmailChallengeId", str)
EndUserId = NewType("EndUserId", str)
FormInstanceId = NewType("FormInstanceId", str)
OrganizationId = NewType("OrganizationId", str)
WorkspaceId = NewType("WorkspaceId", str)
