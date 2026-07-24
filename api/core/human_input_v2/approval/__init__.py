"""Pure recipient resolution for Human Input v2 approval plans.

The package accepts immutable workflow recipient specifications and current
Contact/endpoint capability snapshots. It returns immutable domain decisions;
transport DTOs, provider clients, database sessions, and ORM records remain at
their respective adapters.
"""

from .recipient_resolution import (
    CanonicalSubjectKey,
    ConsoleEndpointPlan,
    ContactApprovalSubject,
    ContactInitiatorSnapshot,
    DebugRecipientReplacement,
    DeliveryCapabilitySnapshot,
    DeliveryEndpointPlan,
    EmailAddressApprovalSubject,
    EmailEndpointPlan,
    EndUserApprovalSubject,
    EndUserInitiatorSnapshot,
    IMEndpointPlan,
    MatchedRecipientSource,
    RecipientRejectionReason,
    RecipientResolutionFailureReason,
    RecipientResolver,
    RecipientSourceKind,
    RejectedRecipient,
    ResolvedApprovalPlan,
    ResolvedApprover,
    SubjectSnapshot,
    WebEndpointPlan,
)
from .recipient_specifications import (
    ContactRecipientSpecification,
    CurrentInitiatorRecipientSpecification,
    DynamicEmailRecipientSpecification,
    DynamicRecipientValue,
    OneTimeEmailRecipientSpecification,
    RecipientSpecification,
    RecipientSpecificationKind,
    UnsupportedDynamicRecipientValue,
    WorkflowRecipientSpecificationAdapter,
)

__all__ = [
    "CanonicalSubjectKey",
    "ConsoleEndpointPlan",
    "ContactApprovalSubject",
    "ContactInitiatorSnapshot",
    "ContactRecipientSpecification",
    "CurrentInitiatorRecipientSpecification",
    "DebugRecipientReplacement",
    "DeliveryCapabilitySnapshot",
    "DeliveryEndpointPlan",
    "DynamicEmailRecipientSpecification",
    "DynamicRecipientValue",
    "EmailAddressApprovalSubject",
    "EmailEndpointPlan",
    "EndUserApprovalSubject",
    "EndUserInitiatorSnapshot",
    "IMEndpointPlan",
    "MatchedRecipientSource",
    "OneTimeEmailRecipientSpecification",
    "RecipientRejectionReason",
    "RecipientResolutionFailureReason",
    "RecipientResolver",
    "RecipientSourceKind",
    "RecipientSpecification",
    "RecipientSpecificationKind",
    "RejectedRecipient",
    "ResolvedApprovalPlan",
    "ResolvedApprover",
    "SubjectSnapshot",
    "UnsupportedDynamicRecipientValue",
    "WebEndpointPlan",
    "WorkflowRecipientSpecificationAdapter",
]
