"""Transport-neutral manual IM binding commands."""

from __future__ import annotations

from collections.abc import Callable, Generator
from contextlib import contextmanager
from types import TracebackType
from typing import Protocol

from pydantic import NaiveDatetime

from core.human_input_v2.im_integration import ContactIMBindingView, IMBinding, IMIntegration
from core.human_input_v2.shared import (
    AccountId,
    ContactId,
    DirectoryScope,
    IMBindingId,
    IMIdentityId,
    IntegrationId,
    TenantId,
)
from libs.datetime_utils import naive_utc_now
from libs.uuid_utils import uuidv7

from .errors import IMWriteUnavailableError
from .locking import OrganizationIMWriteLockLostError, OrganizationIMWriteLockUnavailableError


class _ProtectedIMBindingWriter(Protocol):
    def require_current_integration(self, organization_scope: DirectoryScope) -> IMIntegration: ...

    def create_organization_binding(
        self,
        *,
        organization_scope: DirectoryScope,
        integration_id: IntegrationId,
        contact_id: ContactId,
        identity_id: IMIdentityId,
        binding_id: IMBindingId,
        bound_by_account_id: AccountId | None,
        now: NaiveDatetime,
    ) -> IMBinding: ...

    def delete_organization_binding(
        self,
        *,
        organization_scope: DirectoryScope,
        integration_id: IntegrationId,
        contact_id: ContactId,
        binding_id: IMBindingId,
    ) -> None: ...

    def set_workspace_override(
        self,
        *,
        organization_scope: DirectoryScope,
        tenant_id: TenantId,
        integration_id: IntegrationId,
        contact_id: ContactId,
        identity_id: IMIdentityId,
        binding_id: IMBindingId,
        bound_by_account_id: AccountId | None,
        now: NaiveDatetime,
    ) -> IMBinding: ...

    def reset_workspace_override(
        self,
        *,
        organization_scope: DirectoryScope,
        tenant_id: TenantId,
        integration_id: IntegrationId,
        contact_id: ContactId,
    ) -> None: ...

    def load_contact_im_binding_view(
        self,
        *,
        tenant_id: TenantId,
        integration_id: IntegrationId,
        contact_id: ContactId,
    ) -> ContactIMBindingView: ...


class _OrganizationIMWriteUnitOfWork(Protocol):
    def __enter__(self) -> _ProtectedIMBindingWriter: ...

    def __exit__(
        self,
        exception_type: type[BaseException] | None,
        exception: BaseException | None,
        traceback: TracebackType | None,
    ) -> None: ...


class _OrganizationIMWriteUnitOfWorkFactory(Protocol):
    def __call__(self, scope: DirectoryScope, /) -> _OrganizationIMWriteUnitOfWork: ...


class ContactIMBindingService:
    """Route manual IM binding mutations through a guarded Organization UoW."""

    def __init__(
        self,
        write_unit_of_work_factory: _OrganizationIMWriteUnitOfWorkFactory,
        *,
        binding_id_factory: Callable[[], IMBindingId] = lambda: IMBindingId(str(uuidv7())),
        clock: Callable[[], NaiveDatetime] = naive_utc_now,
    ) -> None:
        self._write_unit_of_work_factory = write_unit_of_work_factory
        self._binding_id_factory = binding_id_factory
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
        with self._protected_repository(organization_scope) as repository:
            integration = repository.require_current_integration(organization_scope)
            repository.create_organization_binding(
                organization_scope=organization_scope,
                integration_id=integration.id,
                contact_id=contact_id,
                identity_id=identity_id,
                binding_id=self._binding_id_factory(),
                bound_by_account_id=bound_by_account_id,
                now=self._clock(),
            )
            return repository.load_contact_im_binding_view(
                tenant_id=tenant_id,
                integration_id=integration.id,
                contact_id=contact_id,
            )

    def delete_organization_binding(
        self,
        *,
        organization_scope: DirectoryScope,
        contact_id: ContactId,
        binding_id: IMBindingId,
    ) -> None:
        with self._protected_repository(organization_scope) as repository:
            integration = repository.require_current_integration(organization_scope)
            repository.delete_organization_binding(
                organization_scope=organization_scope,
                integration_id=integration.id,
                contact_id=contact_id,
                binding_id=binding_id,
            )

    def set_workspace_override(
        self,
        *,
        organization_scope: DirectoryScope,
        tenant_id: TenantId,
        contact_id: ContactId,
        identity_id: IMIdentityId,
        bound_by_account_id: AccountId | None,
    ) -> ContactIMBindingView:
        with self._protected_repository(organization_scope) as repository:
            integration = repository.require_current_integration(organization_scope)
            repository.set_workspace_override(
                organization_scope=organization_scope,
                tenant_id=tenant_id,
                integration_id=integration.id,
                contact_id=contact_id,
                identity_id=identity_id,
                binding_id=self._binding_id_factory(),
                bound_by_account_id=bound_by_account_id,
                now=self._clock(),
            )
            return repository.load_contact_im_binding_view(
                tenant_id=tenant_id,
                integration_id=integration.id,
                contact_id=contact_id,
            )

    def reset_workspace_override(
        self,
        *,
        organization_scope: DirectoryScope,
        tenant_id: TenantId,
        contact_id: ContactId,
    ) -> ContactIMBindingView:
        with self._protected_repository(organization_scope) as repository:
            integration = repository.require_current_integration(organization_scope)
            repository.reset_workspace_override(
                organization_scope=organization_scope,
                tenant_id=tenant_id,
                integration_id=integration.id,
                contact_id=contact_id,
            )
            return repository.load_contact_im_binding_view(
                tenant_id=tenant_id,
                integration_id=integration.id,
                contact_id=contact_id,
            )

    @contextmanager
    def _protected_repository(self, organization_scope: DirectoryScope) -> Generator[_ProtectedIMBindingWriter]:
        try:
            with self._write_unit_of_work_factory(organization_scope) as repository:
                yield repository
        except (OrganizationIMWriteLockUnavailableError, OrganizationIMWriteLockLostError) as error:
            raise IMWriteUnavailableError("IM write is temporarily unavailable") from error


__all__ = ["ContactIMBindingService"]
