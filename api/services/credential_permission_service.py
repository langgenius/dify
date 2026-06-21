from collections.abc import Sequence

from sqlalchemy import delete, or_, select
from sqlalchemy.orm import InstrumentedAttribute, Session, scoped_session

from models.account import Account
from models.credential_permission import CredentialPermission
from models.enums import PermissionEnum


class CredentialPermissionService:
    """
    Shared service for per-credential access control.
    Mirrors DatasetPermissionService but supports all credential types
    via a credential_type discriminator.
    """

    @classmethod
    def get_partial_member_list(
        cls, session: Session | scoped_session, credential_id: str, credential_type: str
    ) -> Sequence[str]:
        """Return account_ids that have partial-member access to a credential."""
        return session.scalars(
            select(CredentialPermission.account_id).where(
                CredentialPermission.credential_id == credential_id,
                CredentialPermission.credential_type == credential_type,
            )
        ).all()

    @classmethod
    def replace_partial_member_list(
        cls,
        *,
        session,
        credential_id: str,
        credential_type: str,
        tenant_id: str,
        account_ids: Sequence[str],
    ) -> None:
        """Replace the partial-member access list of a credential.

        Mirrors DatasetPermissionService.update_partial_member_list. The caller owns
        the transaction (``session``) so this stays consistent with the visibility update.
        """
        session.execute(
            delete(CredentialPermission).where(
                CredentialPermission.credential_id == credential_id,
                CredentialPermission.credential_type == credential_type,
            )
        )
        for account_id in dict.fromkeys(account_ids):
            session.add(
                CredentialPermission(
                    credential_id=credential_id,
                    credential_type=credential_type,
                    account_id=account_id,
                    tenant_id=tenant_id,
                )
            )

    @classmethod
    def clear_partial_member_list(cls, *, session, credential_id: str, credential_type: str) -> None:
        """Remove all partial-member access rows of a credential (caller owns the transaction)."""
        session.execute(
            delete(CredentialPermission).where(
                CredentialPermission.credential_id == credential_id,
                CredentialPermission.credential_type == credential_type,
            )
        )

    @classmethod
    def apply_visibility_filter(
        cls,
        query,
        *,
        model_id_column: InstrumentedAttribute,
        model_user_id_column: InstrumentedAttribute,
        model_visibility_column: InstrumentedAttribute,
        credential_type: str,
        user: Account,
    ):
        """
        Add WHERE clauses to a SQLAlchemy query so it only returns credentials
        visible to the given user.

        - all_team_members: always visible
        - only_me: visible only to the creator (user.id matches)
        - partial_members: visible to the creator OR users in credential_permissions
        - Legacy rows with NULL user_id are treated as all_team_members
        - No admin bypass: personal credentials are private regardless of role
        """
        # Subquery: credential_ids where user has partial-member permission
        partial_subquery = (
            select(CredentialPermission.credential_id)
            .where(
                CredentialPermission.credential_type == credential_type,
                CredentialPermission.account_id == user.id,
            )
            .correlate_except(CredentialPermission)
        )

        return query.where(
            or_(
                # all_team is always visible
                model_visibility_column == PermissionEnum.ALL_TEAM,
                # legacy rows with NULL user_id treated as all_team
                model_user_id_column.is_(None),
                # only_me: creator sees their own
                (model_user_id_column == user.id),
                # partial_members: user is in the permission table
                model_id_column.in_(partial_subquery),
            )
        )
