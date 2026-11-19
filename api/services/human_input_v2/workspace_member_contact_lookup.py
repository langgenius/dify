"""Workspace-scoped Contact lookup for legacy workflow node migration."""

from collections.abc import Callable, Sequence

from sqlalchemy.orm import Session

from core.human_input_v2.shared import AccountId, TenantId
from core.workflow.nodes.human_input_v2.migration import MemberContactSnapshot, ResolvedMemberContact
from repositories.human_input_v2.contact import ContactRepository, ContactType


class SQLAlchemyWorkspaceMemberContactLookup:
    def __init__(
        self, session_factory: Callable[[], Session], contact_repository_factory: Callable[[Session], ContactRepository]
    ) -> None:
        """Bind the factories used for each independent read transaction."""
        self._session_factory = session_factory
        self._contact_repository_factory = contact_repository_factory

    def find_member_contacts(self, tenant_id: TenantId, member_ids: Sequence[str]) -> MemberContactSnapshot:
        """Read existing workspace member identities once; never provision them."""
        if not member_ids:
            return MemberContactSnapshot()
        with self._session_factory() as session, session.no_autoflush:
            contacts = self._contact_repository_factory(session).get_contacts_by_account_ids(
                tenant_id, tuple(AccountId(member_id) for member_id in member_ids)
            )
        return MemberContactSnapshot(
            tuple(
                ResolvedMemberContact(member_id, contact.id)
                for member_id in member_ids
                if (contact := contacts.get(AccountId(member_id))) is not None and contact.type == ContactType.WORKSPACE
            )
        )
