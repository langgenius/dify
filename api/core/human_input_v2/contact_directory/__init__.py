"""Infrastructure-free Contact Directory domain boundary.

Transport and persistence layers may depend on this package. This package must
not import controllers, Flask, SQLAlchemy, sessions, or ORM records.
"""

from .entities import (
    Contact,
    ContactIdentitySource,
    ContactOwner,
    ContactSnapshot,
    ExternalContactOwner,
    OrganizationAccountOwner,
    PlatformWorkspaceEntry,
    WorkspaceMemberOwner,
)
from .errors import ContactDirectoryError, ContactRejection, ContactRejectionCode
from .policy import ContactDirectoryPolicy, ContactDirectorySnapshot, ContactResolution
from .ports import ContactDirectoryRepository

__all__ = [
    "Contact",
    "ContactDirectoryError",
    "ContactDirectoryPolicy",
    "ContactDirectoryRepository",
    "ContactDirectorySnapshot",
    "ContactIdentitySource",
    "ContactOwner",
    "ContactRejection",
    "ContactRejectionCode",
    "ContactResolution",
    "ContactSnapshot",
    "ExternalContactOwner",
    "OrganizationAccountOwner",
    "PlatformWorkspaceEntry",
    "WorkspaceMemberOwner",
]
