"""Persistence-owned query policy shared by all credential domains."""

from collections.abc import Sequence

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import InstrumentedAttribute, Session

from models.credential_permission import CredentialPermission
from models.enums import PermissionEnum


def list_partial_member_ids(
    credential_id: str,
    credential_type: str,
    *,
    session: Session,
) -> Sequence[str]:
    """Return account IDs explicitly associated with a credential."""
    return session.scalars(
        select(CredentialPermission.account_id).where(
            CredentialPermission.credential_id == credential_id,
            CredentialPermission.credential_type == credential_type,
        )
    ).all()


def apply_credential_visibility_filter_for_actor(
    query,
    *,
    tenant_id: str,
    model_id_column: InstrumentedAttribute,
    model_user_id_column: InstrumentedAttribute,
    model_visibility_column: InstrumentedAttribute,
    credential_type: str,
    actor_id: str,
):
    """Apply the canonical tenant- and actor-scoped credential visibility policy.

    Team credentials and legacy rows without an owner are visible to all tenant
    members. Personal credentials are visible to their owner, while partially
    shared credentials additionally require an enabled permission row for the
    same tenant and credential type. Administrator roles do not bypass this
    policy.
    """
    partial_member_ids = (
        select(CredentialPermission.credential_id)
        .where(
            CredentialPermission.tenant_id == tenant_id,
            CredentialPermission.credential_type == credential_type,
            CredentialPermission.account_id == actor_id,
            CredentialPermission.has_permission.is_(True),
        )
        .correlate_except(CredentialPermission)
    )
    return query.where(
        or_(
            model_visibility_column == PermissionEnum.ALL_TEAM,
            model_user_id_column.is_(None),
            model_user_id_column == actor_id,
            and_(
                model_visibility_column == PermissionEnum.PARTIAL_TEAM,
                model_id_column.in_(partial_member_ids),
            ),
        )
    )
