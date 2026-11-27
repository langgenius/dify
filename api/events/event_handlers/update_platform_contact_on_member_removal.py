"""Apply Platform Contact retention in the workspace member-removal transaction."""

from sqlalchemy.orm import Session

from core.human_input_v2.shared import AccountId, TenantId
from events.tenant_event import workspace_member_will_be_removed
from repositories.human_input_v2.sqlalchemy_contact_repository import SQLAlchemyContactRepository
from services.errors.base import NoPermissionError
from services.feature_service import FeatureService
from services.workspace.contracts import WorkspaceMemberRemovalRequest


@workspace_member_will_be_removed.connect
def handle(sender: WorkspaceMemberRemovalRequest, *, session: Session) -> None:
    """Apply the requested visibility change while the membership still exists."""
    if not FeatureService.is_im_centrally_managed():
        return

    tenant_id = TenantId(sender.workspace_id)
    account_id = AccountId(sender.account_id)
    contacts = SQLAlchemyContactRepository(session)
    if sender.keep_as_platform_contact:
        if sender.permission_keys is not None and "contact.manage" not in sender.permission_keys:
            raise NoPermissionError("No permission to manage contacts.")
        if sender.account_status != "active":
            raise NoPermissionError("Only active members can be kept as Platform Contacts.")
        contacts.retain_platform_entry_for_account(tenant_id, account_id, AccountId(sender.actor_account_id))
    else:
        contacts.delete_platform_entry_for_account(tenant_id, account_id)
