"""Transport-neutral Contact Directory rejection contracts."""

from dataclasses import dataclass
from enum import StrEnum


class ContactRejectionCode(StrEnum):
    """Stable machine-readable reasons returned by Contact Directory operations."""

    INVALID_OWNER = "invalid_owner"
    INVALID_EMAIL = "invalid_email"
    INVALID_NAME = "invalid_name"
    CONFLICTING_IDENTITY = "conflicting_identity"
    CROSS_ORGANIZATION = "cross_organization"
    ACCOUNT_UNAVAILABLE = "account_unavailable"
    CONTACT_NOT_FOUND = "contact_not_found"
    SETUP_ROW_MISSING = "setup_row_missing"
    PERSISTENCE_FAILURE = "persistence_failure"


@dataclass(frozen=True, slots=True)
class ContactRejection:
    """Serializable domain rejection without HTTP or RPC semantics."""

    reason: ContactRejectionCode

    def to_primitive(self) -> dict[str, str]:
        return {"reason": self.reason.value}


class ContactDirectoryError(Exception):
    """Exception carrier for one transport-neutral Contact rejection."""

    rejection: ContactRejection

    def __init__(self, rejection: ContactRejection) -> None:
        self.rejection = rejection
        super().__init__(rejection.reason.value)

    @property
    def code(self) -> ContactRejectionCode:
        return self.rejection.reason


def reject(reason: ContactRejectionCode) -> ContactDirectoryError:
    """Build a domain exception while keeping reason construction consistent."""

    return ContactDirectoryError(ContactRejection(reason))
