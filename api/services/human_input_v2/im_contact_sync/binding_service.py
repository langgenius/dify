"""Transport-neutral manual IM binding commands."""

from __future__ import annotations

from collections.abc import Callable

from pydantic import NaiveDatetime
from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.entities import HumanInputContactType, IMBindingScope
from core.human_input_v2.im_integration import ContactIMBindingView, IMBindingCommandError, IMBindingCommandErrorCode
from core.human_input_v2.shared import AccountId, ContactId, DirectoryScope, IMBindingId, IMIdentityId, TenantId
from libs.datetime_utils import naive_utc_now
from repositories.human_input_v2.contact import IMBinding as ContactIMBinding
from repositories.human_input_v2.im_binding_repository import (
    IMBindingAssignment,
    IMBindingConflictError,
    IMBindingIdentityNotFoundError,
    IMBindingKind,
)
from repositories.human_input_v2.im_channel_repository import IMChannel
from repositories.human_input_v2.sqlalchemy_contact_repository import SQLAlchemyContactRepository
from repositories.human_input_v2.sqlalchemy_im_binding_repository import SQLAlchemyIMBindingRepository

# TODO(QuantumGhost): this abstraction is problematic.
type ChannelResolver = Callable[[Session, DirectoryScope], IMChannel | None]


class ContactIMBindingService:
    """Own transactions while repositories remain bound to one trusted Channel."""

    def __init__(
        self,
        session_factory: sessionmaker[Session],
        channel_resolver: ChannelResolver,
        *,
        clock: Callable[[], NaiveDatetime] = naive_utc_now,
    ) -> None:
        self._session_factory = session_factory
        self._channel_resolver = channel_resolver
        self._clock = clock

    def create_organization_binding(
        self,
        *,
        organization_scope: DirectoryScope,
        tenant_id: TenantId,
        contact_id: ContactId,
        identity_id: IMIdentityId,
        bound_by_account_id: AccountId | None,
    ) -> ContactIMBindingView:
        return self._mutate(
            organization_scope,
            tenant_id,
            contact_id,
            lambda repository: repository.create(
                IMBindingAssignment(contact_id, identity_id, self._clock()),
                bound_by_account_id=bound_by_account_id,
            ),
        )

    def delete_organization_binding(
        self,
        *,
        organization_scope: DirectoryScope,
        contact_id: ContactId,
        binding_id: IMBindingId,
    ) -> None:
        tenant_id = _tenant_id(organization_scope)
        with self._session_factory() as session, session.begin():
            channel = self._require_channel(session, organization_scope)
            repository = SQLAlchemyIMBindingRepository(session, channel.id)
            binding = repository.get(binding_id)
            if binding is None or binding.contact_id != contact_id:
                raise IMBindingCommandError(
                    IMBindingCommandErrorCode.BINDING_NOT_FOUND,
                    "IM Binding was not found",
                )
            repository.delete(binding.id, expected_identity_id=binding.identity_id)
            self._require_contact(session, tenant_id, contact_id)

    def set_workspace_override(
        self,
        *,
        organization_scope: DirectoryScope,
        tenant_id: TenantId,
        contact_id: ContactId,
        identity_id: IMIdentityId,
        bound_by_account_id: AccountId | None,
    ) -> ContactIMBindingView:
        return self._mutate(
            organization_scope,
            tenant_id,
            contact_id,
            lambda repository: repository.set_workspace_override(
                tenant_id,
                IMBindingAssignment(contact_id, identity_id, self._clock()),
                bound_by_account_id=bound_by_account_id,
            ),
        )

    def reset_workspace_override(
        self,
        *,
        organization_scope: DirectoryScope,
        tenant_id: TenantId,
        contact_id: ContactId,
    ) -> ContactIMBindingView:
        return self._mutate(
            organization_scope,
            tenant_id,
            contact_id,
            lambda repository: repository.reset_workspace_override(tenant_id, contact_id),
        )

    def _mutate[T](
        self,
        owner_scope: DirectoryScope,
        tenant_id: TenantId,
        contact_id: ContactId,
        mutation: Callable[[SQLAlchemyIMBindingRepository], T],
    ) -> ContactIMBindingView:
        try:
            with self._session_factory() as session, session.begin():
                channel = self._require_channel(session, owner_scope)
                contact = self._require_contact(session, tenant_id, contact_id)
                repository = SQLAlchemyIMBindingRepository(session, channel.id)
                mutation(repository)
                effective = repository.get_effective(tenant_id, contact_id)
                bindings = (
                    (
                        ContactIMBinding(
                            id=effective.id,
                            scope=(
                                IMBindingScope.WORKSPACE
                                if effective.kind is IMBindingKind.WORKSPACE_OVERRIDE
                                else IMBindingScope.ORGANIZATION
                            ),
                            contact_id=effective.contact_id,
                            identity_id=effective.identity_id,
                            provider=channel.provider,
                        ),
                    )
                    if effective is not None
                    else ()
                )
                return ContactIMBindingView(
                    id=contact.id,
                    type=HumanInputContactType(contact.type.value),
                    name=contact.name,
                    email=contact.email,
                    avatar_file_id=contact.avatar_file_id,
                    im_bindings=bindings,
                    created_at=contact.created_at,
                )
        except IMBindingIdentityNotFoundError:
            raise IMBindingCommandError(
                IMBindingCommandErrorCode.IDENTITY_NOT_FOUND, "IM Identity was not found"
            ) from None
        except IMBindingConflictError:
            raise IMBindingCommandError(IMBindingCommandErrorCode.BINDING_CONFLICT, "IM Binding conflicts") from None

    def _require_channel(self, session: Session, owner_scope: DirectoryScope) -> IMChannel:
        channel = self._channel_resolver(session, owner_scope)
        if channel is None:
            raise IMBindingCommandError(
                IMBindingCommandErrorCode.INTEGRATION_NOT_CONFIGURED,
                "IM Channel is not configured",
            )
        return channel

    @staticmethod
    def _require_contact(session: Session, tenant_id: TenantId, contact_id: ContactId):
        contact = SQLAlchemyContactRepository(session).get_contacts_by_id(tenant_id, contact_id)
        if contact is None:
            raise IMBindingCommandError(IMBindingCommandErrorCode.CONTACT_NOT_FOUND, "Contact was not found")
        return contact


def _tenant_id(scope: DirectoryScope) -> TenantId:
    from core.human_input_v2.shared import WorkspaceScope

    if isinstance(scope, WorkspaceScope):
        return scope.id
    raise IMBindingCommandError(IMBindingCommandErrorCode.INVALID_SCOPE, "Workspace tenant is required")


__all__ = ["ContactIMBindingService"]
