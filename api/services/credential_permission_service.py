from collections.abc import Sequence

from sqlalchemy import or_, select
from sqlalchemy.orm import InstrumentedAttribute, Session

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
    def get_partial_member_list(cls, credential_id: str, credential_type: str, *, session: Session) -> Sequence[str]:
        """Return account_ids that have partial-member access to a credential."""
        return session.scalars(
            select(CredentialPermission.account_id).where(
                CredentialPermission.credential_id == credential_id,
                CredentialPermission.credential_type == credential_type,
            )
        ).all()

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
        return cls.apply_account_visibility_filter(
            query,
            model_id_column=model_id_column,
            model_user_id_column=model_user_id_column,
            model_visibility_column=model_visibility_column,
            credential_type=credential_type,
            account_id=user.id,
        )

    @classmethod
    def apply_account_visibility_filter(
        cls,
        query,
        *,
        model_id_column: InstrumentedAttribute,
        model_user_id_column: InstrumentedAttribute,
        model_visibility_column: InstrumentedAttribute,
        credential_type: str,
        account_id: str | None,
    ):
        """
        ``apply_visibility_filter`` for callers that hold a trusted account id
        rather than a loaded ``Account`` (e.g. a background task acting for
        one member).

        ``account_id`` is the acting member: the same policy as
        ``apply_visibility_filter`` applies. ``None`` means no member is
        acting: only team-shared credentials (all_team_members and legacy
        NULL user_id rows) are visible, never any member's only_me or
        partial_members credential.
        """
        shared = or_(
            # all_team is always visible
            model_visibility_column == PermissionEnum.ALL_TEAM,
            # legacy rows with NULL user_id treated as all_team
            model_user_id_column.is_(None),
        )
        if account_id is None:
            return query.where(shared)

        # Subquery: credential_ids where the account has partial-member permission
        partial_subquery = (
            select(CredentialPermission.credential_id)
            .where(
                CredentialPermission.credential_type == credential_type,
                CredentialPermission.account_id == account_id,
            )
            .correlate_except(CredentialPermission)
        )

        return query.where(
            or_(
                shared,
                # only_me: creator sees their own
                (model_user_id_column == account_id),
                # partial_members: account is in the permission table
                model_id_column.in_(partial_subquery),
            )
        )
