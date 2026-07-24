"""Contact Directory policy boundary over existing core and persistence types.

Contact rows, workspace projections, IM identities, bindings, integrations, and
sync runs already exist. This context adds no parallel entities; it specifies the
domain operations and the current-state projection consumed by other contexts.
"""

from dataclasses import dataclass
from typing import Protocol

from core.human_input_v2.entities import ContactId, HumanInputContactType, IMIdentityId

from domain_model.shared.identifiers import WorkspaceId
from domain_model.shared.value_objects import EmailAddress


@dataclass(frozen=True, slots=True)
class ContactIdentitySnapshot:
    """Current authorization-relevant Contact state at a context boundary.

    This is a read projection, not another Contact entity. Historical task
    snapshots preserve old values, while selection and access checks request a
    fresh projection every time current state matters.
    """

    contact_id: ContactId
    workspace_id: WorkspaceId
    contact_type: HumanInputContactType
    email: EmailAddress | None
    effective_im_identity_id: IMIdentityId | None
    selectable: bool


class ContactDirectoryService(Protocol):
    """Domain operations implemented against existing Contact persistence models."""

    def get_current_identity(
        self,
        *,
        workspace_id: WorkspaceId,
        contact_id: ContactId,
    ) -> ContactIdentitySnapshot | None:
        """Read current scoped identity without consulting historical task snapshots."""

        ...

    def find_current_identity_by_email(
        self,
        *,
        workspace_id: WorkspaceId,
        email: EmailAddress,
    ) -> ContactIdentitySnapshot | None:
        """Match normalized email inside the current Organization boundary only."""

        ...

    def handle_workspace_membership_removed(
        self,
        *,
        workspace_id: WorkspaceId,
        contact_id: ContactId,
        keep_as_platform_contact: bool,
    ) -> None:
        """Update only workspace classification; never convert to External Contact."""

        ...

    def remove_platform_contact(
        self, *, workspace_id: WorkspaceId, contact_id: ContactId
    ) -> None:
        """Remove the workspace projection without deleting Organization identity."""

        ...

    def set_workspace_im_override(
        self,
        *,
        workspace_id: WorkspaceId,
        contact_id: ContactId,
        im_identity_id: IMIdentityId,
    ) -> None:
        """Select an existing synced identity without replacing integration credentials."""

        ...

    def reset_workspace_im_override(
        self, *, workspace_id: WorkspaceId, contact_id: ContactId
    ) -> None:
        """Restore Organization binding resolution for future tasks."""

        ...
