"""SQLAlchemy Contact Directory adapter with aggregate-scoped transactions.

Every consuming query includes the complete deployment/workspace owner
predicate. EE Organization writes require the stable ``DifySetup`` row;
External writes share that lock when the deployment owner exists. ORM instances
never cross this boundary.
"""

from __future__ import annotations

from contextlib import AbstractContextManager
from typing import Protocol

import sqlalchemy as sa
from sqlalchemy import or_, select
from sqlalchemy.dialects.mysql import insert as mysql_insert
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session, selectinload, sessionmaker

from core.human_input_v2.contact_directory import (
    Contact,
    ContactDirectoryError,
    ContactDirectoryPolicy,
    ContactDirectorySnapshot,
    ContactRejectionCode,
    ExternalContactOwner,
    OrganizationAccountOwner,
    PlatformWorkspaceEntry,
    WorkspaceMemberOwner,
)
from core.human_input_v2.shared import (
    AccountId,
    ContactId,
    DeploymentScope,
    DirectoryScope,
    PlatformEntryId,
    TenantId,
    WorkspaceScope,
)
from libs.datetime_utils import naive_utc_now
from libs.uuid_utils import uuidv7
from models.account import Account, AccountStatus, TenantAccountJoin
from models.human_input_v2 import (
    HumanInputContact,
    HumanInputContactIdentitySource,
    HumanInputIMBinding,
    HumanInputPlatformContactWorkspaceEntry,
)
from models.model import DifySetup

from .mappers import contact_from_record, contact_to_record, platform_entry_to_record


class _OrganizationWriteUnitOfWorkFactory(Protocol):
    def __call__(self, scope: DirectoryScope) -> AbstractContextManager[Session]: ...


class SQLAlchemyContactDirectoryRepository:
    """Transactional adapter for coherent Contact Directory operations."""

    _session_maker: sessionmaker[Session]

    def __init__(
        self,
        session_maker: sessionmaker[Session],
        write_unit_of_work_factory: _OrganizationWriteUnitOfWorkFactory,
    ) -> None:
        self._session_maker = session_maker
        self._write_unit_of_work_factory = write_unit_of_work_factory

    def load_snapshot(self, tenant_id: TenantId) -> ContactDirectorySnapshot:
        """Load one coherent contacts, membership, allow-list, and Account view."""

        try:
            with self._session_maker() as session, session.begin():
                self._configure_snapshot_transaction(session)
                return self._load_snapshot(session, tenant_id)
        except ContactDirectoryError:
            raise
        except SQLAlchemyError as error:
            raise self._persistence_error() from error

    def save_organization_contact(
        self,
        contact: Contact,
        *,
        organization_scope: DirectoryScope,
    ) -> Contact:
        """Persist one deployment-owned Organization Contact after a serialized identity claim."""

        if not isinstance(contact.owner, OrganizationAccountOwner):
            raise self._domain_error(ContactRejectionCode.INVALID_OWNER)
        if not isinstance(organization_scope, DeploymentScope):
            raise ValueError("Organization write scope does not match Contact owner")
        return self._save_account_backed_contact(
            contact,
            organization_scope=organization_scope,
            workspace_owner=None,
        )

    def save_workspace_member_contact(
        self,
        contact: Contact,
        *,
        organization_scope: DirectoryScope,
    ) -> Contact:
        """Persist one Contact only while its owning workspace membership exists."""

        if not isinstance(contact.owner, WorkspaceMemberOwner):
            raise self._domain_error(ContactRejectionCode.INVALID_OWNER)
        if not isinstance(organization_scope, WorkspaceScope) or organization_scope.id != contact.owner.tenant_id:
            raise ValueError("Organization write scope does not match Contact owner")
        return self._save_account_backed_contact(
            contact,
            organization_scope=organization_scope,
            workspace_owner=contact.owner,
        )

    def _save_account_backed_contact(
        self,
        contact: Contact,
        *,
        organization_scope: DirectoryScope,
        workspace_owner: WorkspaceMemberOwner | None,
    ) -> Contact:
        """Persist an already source-validated Account-backed Contact."""

        try:
            with self._write_unit_of_work_factory(organization_scope) as session:
                if workspace_owner is None:
                    self._lock_deployment_owner(session, require_setup_row=True)
                else:
                    self._ensure_workspace_membership(session, workspace_owner)
                self._ensure_account_available(session, contact)
                self._ensure_identity_available(session, contact)
                record = self._find_owned_record(session, contact)
                if record is None:
                    record = contact_to_record(contact)
                    session.add(record)
                else:
                    if not self._record_has_same_identity(record, contact):
                        raise self._domain_error(ContactRejectionCode.INVALID_OWNER)
                    self._copy_mutable_values(record, contact)
                session.flush()
                return contact_from_record(record)
        except ContactDirectoryError:
            raise
        except IntegrityError as error:
            raise self._domain_error(ContactRejectionCode.CONFLICTING_IDENTITY) from error
        except SQLAlchemyError as error:
            raise self._persistence_error() from error

    def admit_external(self, tenant_id: TenantId, *, name: str, email: str) -> Contact:
        """Atomically validate and create a new External Contact.

        External and Organization Email claims share the deployment lock when
        deployment-wide Organization semantics exist. The lock is acquired
        before the first Contact read so a waiter observes the transaction that
        won the claim instead of retaining an older snapshot. SaaS deployments
        without a setup row retain tenant-scoped External identity semantics.
        """

        try:
            with self._session_maker() as session, session.begin():
                self._lock_deployment_owner(session, require_setup_row=False)
                snapshot = self._load_snapshot(session, tenant_id)
                contact = ContactDirectoryPolicy.admit_external(
                    snapshot,
                    contact_id=ContactId(str(uuidv7())),
                    name=name,
                    email=email,
                    now=naive_utc_now(),
                )
                self._ensure_identity_available(session, contact)
                record = contact_to_record(contact)
                session.add(record)
                session.flush()
                return contact_from_record(record)
        except ContactDirectoryError:
            raise
        except IntegrityError as error:
            raise self._domain_error(ContactRejectionCode.CONFLICTING_IDENTITY) from error
        except SQLAlchemyError as error:
            raise self._persistence_error() from error

    def set_platform_availability(
        self,
        tenant_id: TenantId,
        contact_id: ContactId,
        *,
        added_by_account_id: AccountId,
        enabled: bool,
    ) -> None:
        """Idempotently mutate one workspace allow-list entry in a transaction."""

        try:
            with self._session_maker() as session, session.begin():
                contact_record = session.scalar(
                    select(HumanInputContact).where(
                        HumanInputContact.id == str(contact_id),
                        or_(
                            HumanInputContact.tenant_id.is_(None),
                            HumanInputContact.tenant_id == str(tenant_id),
                        ),
                    )
                )
                if contact_record is None:
                    raise self._domain_error(ContactRejectionCode.CONTACT_NOT_FOUND)
                if (
                    contact_record.identity_source is not HumanInputContactIdentitySource.ORGANIZATION_ACCOUNT
                    or contact_record.tenant_id is not None
                ):
                    raise self._domain_error(ContactRejectionCode.INVALID_OWNER)

                if enabled:
                    now = naive_utc_now()
                    self._insert_platform_entry_idempotently(
                        session,
                        PlatformWorkspaceEntry(
                            id=PlatformEntryId(str(uuidv7())),
                            tenant_id=tenant_id,
                            contact_id=contact_id,
                            added_by_account_id=added_by_account_id,
                            created_at=now,
                            updated_at=now,
                        ),
                    )
                else:
                    session.execute(
                        sa.delete(HumanInputPlatformContactWorkspaceEntry).where(
                            HumanInputPlatformContactWorkspaceEntry.tenant_id == str(tenant_id),
                            HumanInputPlatformContactWorkspaceEntry.contact_id == str(contact_id),
                        )
                    )
                session.flush()
        except ContactDirectoryError:
            raise
        except IntegrityError as error:
            raise self._domain_error(ContactRejectionCode.CONFLICTING_IDENTITY) from error
        except SQLAlchemyError as error:
            raise self._persistence_error() from error

    def hard_delete_external(self, tenant_id: TenantId, contact_id: ContactId) -> None:
        """Hard-delete an External Contact and every referencing IM binding atomically."""

        try:
            with self._write_unit_of_work_factory(WorkspaceScope(id=tenant_id)) as session:
                record = session.scalar(
                    select(HumanInputContact).where(
                        HumanInputContact.id == str(contact_id),
                        HumanInputContact.tenant_id == str(tenant_id),
                        HumanInputContact.identity_source == HumanInputContactIdentitySource.EXTERNAL,
                    )
                )
                if record is None:
                    raise self._domain_error(ContactRejectionCode.CONTACT_NOT_FOUND)
                session.execute(sa.delete(HumanInputIMBinding).where(HumanInputIMBinding.contact_id == str(contact_id)))
                session.delete(record)
                session.flush()
        except ContactDirectoryError:
            raise
        except SQLAlchemyError as error:
            raise self._persistence_error() from error

    def _load_snapshot(self, session: Session, tenant_id: TenantId) -> ContactDirectorySnapshot:
        contact_records = session.scalars(
            select(HumanInputContact)
            .options(
                selectinload(
                    HumanInputContact.platform_workspace_entries.and_(
                        HumanInputPlatformContactWorkspaceEntry.tenant_id == str(tenant_id)
                    )
                )
            )
            .where(
                or_(
                    HumanInputContact.tenant_id.is_(None),
                    HumanInputContact.tenant_id == str(tenant_id),
                )
            )
            .order_by(HumanInputContact.id)
        ).all()
        contacts = tuple(contact_from_record(record) for record in contact_records)
        member_account_ids = frozenset(
            AccountId(account_id)
            for account_id in session.scalars(
                select(TenantAccountJoin.account_id).where(TenantAccountJoin.tenant_id == str(tenant_id))
            ).all()
        )
        contact_account_ids = {contact.account_id for contact in contacts if contact.account_id is not None}
        active_account_ids = frozenset(
            AccountId(account_id)
            for account_id in session.scalars(
                select(Account.id).where(
                    Account.id.in_([str(account_id) for account_id in contact_account_ids]),
                    Account.status == AccountStatus.ACTIVE,
                )
            ).all()
        )
        platform_contact_ids = frozenset(
            ContactId(record.id) for record in contact_records if record.platform_workspace_entries
        )
        return ContactDirectorySnapshot(
            tenant_id=tenant_id,
            contacts=contacts,
            member_account_ids=member_account_ids,
            platform_contact_ids=platform_contact_ids,
            unavailable_account_ids=frozenset(contact_account_ids - active_account_ids),
        )

    @staticmethod
    def _lock_deployment_owner(session: Session, *, require_setup_row: bool) -> None:
        """Lock the deployment identity owner when its semantics apply.

        Organization writes require this owner. External writes use it when
        present, while SaaS deployments without a deployment Organization keep
        their existing tenant-local admission boundary.
        """

        setup_version = session.scalars(select(DifySetup.version).with_for_update()).one_or_none()
        if setup_version is None and require_setup_row:
            raise SQLAlchemyContactDirectoryRepository._domain_error(ContactRejectionCode.SETUP_ROW_MISSING)

    @staticmethod
    def _configure_snapshot_transaction(session: Session) -> None:
        """Use one MVCC snapshot for all facts loaded by the directory query."""

        if session.get_bind().dialect.name in {"mysql", "postgresql"}:
            session.connection(execution_options={"isolation_level": "REPEATABLE READ"})

    @staticmethod
    def _ensure_workspace_membership(session: Session, owner: WorkspaceMemberOwner) -> None:
        membership_id = session.scalar(
            select(TenantAccountJoin.id)
            .where(
                TenantAccountJoin.tenant_id == str(owner.tenant_id),
                TenantAccountJoin.account_id == str(owner.account_id),
            )
            .with_for_update()
        )
        if membership_id is None:
            raise SQLAlchemyContactDirectoryRepository._domain_error(ContactRejectionCode.INVALID_OWNER)

    @staticmethod
    def _ensure_account_available(session: Session, contact: Contact) -> None:
        account_id = contact.account_id
        if account_id is None:
            return
        status = session.scalar(select(Account.status).where(Account.id == str(account_id)))
        if status is not AccountStatus.ACTIVE:
            raise SQLAlchemyContactDirectoryRepository._domain_error(ContactRejectionCode.ACCOUNT_UNAVAILABLE)

    @staticmethod
    def _ensure_identity_available(session: Session, contact: Contact) -> None:
        identity_predicates: list[sa.ColumnElement[bool]] = []
        if contact.account_id is not None:
            identity_predicates.append(
                sa.and_(
                    SQLAlchemyContactDirectoryRepository._owner_predicate(contact),
                    HumanInputContact.account_id == str(contact.account_id),
                )
            )
        if contact.normalized_email is not None:
            identity_predicates.append(
                sa.and_(
                    SQLAlchemyContactDirectoryRepository._email_identity_scope_predicate(contact),
                    HumanInputContact.normalized_email == str(contact.normalized_email),
                )
            )
        if not identity_predicates:
            return
        conflict_id = session.scalar(
            select(HumanInputContact.id).where(
                HumanInputContact.id != str(contact.id),
                or_(*identity_predicates),
            )
        )
        if conflict_id is not None:
            raise SQLAlchemyContactDirectoryRepository._domain_error(ContactRejectionCode.CONFLICTING_IDENTITY)

    @staticmethod
    def _email_identity_scope_predicate(contact: Contact) -> sa.ColumnElement[bool]:
        if isinstance(contact.owner, OrganizationAccountOwner):
            return or_(
                HumanInputContact.tenant_id.is_(None),
                HumanInputContact.identity_source == HumanInputContactIdentitySource.EXTERNAL,
            )
        if isinstance(contact.owner, ExternalContactOwner):
            return or_(
                HumanInputContact.tenant_id == str(contact.owner.tenant_id),
                sa.and_(
                    HumanInputContact.tenant_id.is_(None),
                    HumanInputContact.identity_source == HumanInputContactIdentitySource.ORGANIZATION_ACCOUNT,
                ),
            )
        return HumanInputContact.tenant_id == str(contact.owner.tenant_id)

    @staticmethod
    def _insert_platform_entry_idempotently(session: Session, entry: PlatformWorkspaceEntry) -> None:
        record = platform_entry_to_record(entry)
        values = {
            "id": record.id,
            "tenant_id": record.tenant_id,
            "contact_id": record.contact_id,
            "added_by_account_id": record.added_by_account_id,
            "created_at": record.created_at,
            "updated_at": record.updated_at,
        }
        dialect_name = session.get_bind().dialect.name
        if dialect_name == "postgresql":
            postgresql_statement = postgresql_insert(HumanInputPlatformContactWorkspaceEntry).values(**values)
            session.execute(postgresql_statement.on_conflict_do_nothing(constraint="hipcwe_tenant_contact_uq"))
            return
        if dialect_name == "mysql":
            mysql_statement = mysql_insert(HumanInputPlatformContactWorkspaceEntry).values(**values)
            session.execute(mysql_statement.on_duplicate_key_update(contact_id=mysql_statement.inserted.contact_id))
            return
        if dialect_name == "sqlite":
            sqlite_statement = sqlite_insert(HumanInputPlatformContactWorkspaceEntry).values(**values)
            session.execute(sqlite_statement.on_conflict_do_nothing(index_elements=["tenant_id", "contact_id"]))
            return
        raise SQLAlchemyContactDirectoryRepository._persistence_error()

    @staticmethod
    def _find_owned_record(session: Session, contact: Contact) -> HumanInputContact | None:
        return session.scalar(
            select(HumanInputContact).where(
                HumanInputContact.id == str(contact.id),
                SQLAlchemyContactDirectoryRepository._owner_predicate(contact),
            )
        )

    @staticmethod
    def _owner_predicate(contact: Contact) -> sa.ColumnElement[bool]:
        if isinstance(contact.owner, OrganizationAccountOwner):
            return HumanInputContact.tenant_id.is_(None)
        return HumanInputContact.tenant_id == str(contact.owner.tenant_id)

    @staticmethod
    def _record_has_same_identity(record: HumanInputContact, contact: Contact) -> bool:
        expected_source = HumanInputContactIdentitySource(contact.identity_source.value)
        expected_account_id = str(contact.account_id) if contact.account_id is not None else None
        return record.identity_source is expected_source and record.account_id == expected_account_id

    @staticmethod
    def _copy_mutable_values(record: HumanInputContact, contact: Contact) -> None:
        record.name = contact.name
        record.normalized_name = contact.normalized_name
        record.email = contact.email
        record.normalized_email = str(contact.normalized_email) if contact.normalized_email is not None else None
        record.avatar_file_id = contact.avatar_file_id
        record.updated_at = contact.updated_at

    @staticmethod
    def _domain_error(code: ContactRejectionCode) -> ContactDirectoryError:
        from core.human_input_v2.contact_directory import ContactRejection

        return ContactDirectoryError(ContactRejection(code))

    @staticmethod
    def _persistence_error() -> ContactDirectoryError:
        return SQLAlchemyContactDirectoryRepository._domain_error(ContactRejectionCode.PERSISTENCE_FAILURE)
