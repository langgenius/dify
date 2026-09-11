from collections.abc import Sequence

from sqlalchemy.orm import InstrumentedAttribute, Session

from models.account import Account
from repositories.credential_permission_repository import (
    apply_credential_visibility_filter_for_actor,
    list_partial_member_ids,
)


class CredentialPermissionService:
    """Compatibility facade for credential permission reads and filtering."""

    @classmethod
    def get_partial_member_list(cls, credential_id: str, credential_type: str, *, session: Session) -> Sequence[str]:
        """Return account_ids that have partial-member access to a credential."""
        return list_partial_member_ids(credential_id, credential_type, session=session)

    @classmethod
    def apply_visibility_filter(
        cls,
        query,
        *,
        tenant_id: str,
        model_id_column: InstrumentedAttribute,
        model_user_id_column: InstrumentedAttribute,
        model_visibility_column: InstrumentedAttribute,
        credential_type: str,
        user: Account,
    ):
        return apply_credential_visibility_filter_for_actor(
            query,
            tenant_id=tenant_id,
            model_id_column=model_id_column,
            model_user_id_column=model_user_id_column,
            model_visibility_column=model_visibility_column,
            credential_type=credential_type,
            actor_id=user.id,
        )
