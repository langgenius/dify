"""Framework-neutral ownership and grant facts consumed by file lookups."""

from typing import Protocol


class FileAccessScopeView(Protocol):
    """Read-only access facts without execution context or grant mutation.

    Preconditions: the caller supplies a trusted identity and validated file grants.
    Postconditions: consumers can constrain file reads without publishing new grants.
    """

    @property
    def tenant_id(self) -> str:
        """Return the tenant whose files may be read."""
        ...

    @property
    def user_id(self) -> str:
        """Return the user whose ownership markers constrain end-user reads."""
        ...

    @property
    def requires_user_ownership(self) -> bool:
        """Return whether ownership or an explicit grant is required."""
        ...

    @property
    def granted_upload_file_ids(self) -> frozenset[str]:
        """Return upload files explicitly authorized for this read scope."""
        ...

    @property
    def granted_tool_file_ids(self) -> frozenset[str]:
        """Return tool files explicitly authorized for this read scope."""
        ...
