"""Session-bound SQLAlchemy Contact and Contact-IM read adapters.

This module is the only production owner allowed to combine Contact identity,
Account, membership, Platform visibility, and External profile tables. The
repositories may flush but never create, commit, or roll back a Session.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.dialects.mysql import insert as mysql_insert
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.engine import Row, RowMapping
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, aliased

from core.human_input_v2.entities import IMBindingScope, IMProvider
from core.human_input_v2.shared import AccountId, ContactId, IMBindingId, IMIdentityId, NormalizedEmail, TenantId
from libs.datetime_utils import ensure_naive_utc, naive_utc_now
from libs.uuid_utils import uuidv7
from models.account import Account, AccountStatus, TenantAccountJoin
from models.human_input_v2 import (
    ContactSubjectType,
    HumanInputContactIdentity,
    HumanInputExternalContactProfile,
    HumanInputIMBinding,
    HumanInputIMIntegration,
    HumanInputPlatformContactWorkspaceEntry,
)
from models.model import UploadFile
from repositories.human_input_v2.contact import (
    CandidateId,
    Contact,
    ContactError,
    ContactErrorCode,
    ContactQuery,
    ContactType,
    ExternalContact,
    IMBinding,
    OrganizationCandidate,
    Page,
)

_CONTACT_ID = "contact_id"
_CONTACT_TYPE = "contact_type"
_NAME = "name"
_EMAIL = "email"
_AVATAR_FILE_ID = "avatar_file_id"
_CREATED_AT = "created_at"
_DEFAULT_CONTACT_QUERY = ContactQuery()


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


class SQLAlchemyContactRepository:
    """One concrete implementation of core and enterprise Contact ports."""

    def __init__(self, session: Session) -> None:
        self._session = session

    def count_contact(self, tenant_id: TenantId, query: ContactQuery = _DEFAULT_CONTACT_QUERY) -> int:
        current_contacts = self._current_contacts_query(tenant_id, query).subquery()
        return self._session.scalar(sa.select(sa.func.count()).select_from(current_contacts)) or 0

    def list_contact(
        self,
        tenant_id: TenantId,
        page: int,
        limit: int,
        query: ContactQuery = _DEFAULT_CONTACT_QUERY,
    ) -> Page[Contact]:
        if page < 1:
            raise ValueError("page must be positive")
        if limit < 1:
            raise ValueError("limit must be positive")
        rows = self._session.execute(
            self._current_contacts_query(tenant_id, query)
            .order_by(sa.column(_CREATED_AT), sa.column(_CONTACT_ID))
            .offset((page - 1) * limit)
            .limit(limit)
        ).mappings()
        return Page(tuple(self._contact_from_row(row) for row in rows), page, limit)

    def get_contacts_by_id(self, tenant_id: TenantId, contact_id: ContactId) -> Contact | None:
        contacts = self._get_contacts_by_distinct_ids(tenant_id, (contact_id,))
        return contacts[0] if contacts else None

    def get_contacts_by_ids(
        self,
        tenant_id: TenantId,
        contact_ids: Sequence[ContactId],
    ) -> Sequence[Contact]:
        return self._get_contacts_by_distinct_ids(tenant_id, tuple(dict.fromkeys(contact_ids)))

    def available(
        self,
        tenant_id: TenantId,
        contact_ids: Sequence[ContactId],
    ) -> Mapping[ContactId, bool]:
        distinct_ids = tuple(dict.fromkeys(contact_ids))
        available_ids = {contact.id for contact in self._get_contacts_by_distinct_ids(tenant_id, distinct_ids)}
        return {contact_id: contact_id in available_ids for contact_id in distinct_ids}

    def query_contacts_by_email(
        self,
        tenant_id: TenantId,
        emails: Sequence[str],
    ) -> Sequence[Contact]:
        normalized_emails = tuple(dict.fromkeys(str(NormalizedEmail(email)) for email in emails))
        if not normalized_emails:
            return ()
        current_contacts = self._current_contacts_subquery(tenant_id)
        rows = self._session.execute(
            sa.select(current_contacts)
            .where(sa.func.lower(current_contacts.c.email).in_(normalized_emails))
            .order_by(current_contacts.c.contact_id)
        ).mappings()
        return tuple(self._contact_from_row(row) for row in rows)

    def provision_account_backed_contact(self, account_id: AccountId) -> ContactId:
        """Idempotently allocate the globally stable Contact ID for one Account."""

        if self._session.get(Account, str(account_id)) is None:
            raise ContactError(ContactErrorCode.ACCOUNT_NOT_FOUND, "Account does not exist")
        existing_id = self._session.scalar(
            sa.select(HumanInputContactIdentity.id).where(
                HumanInputContactIdentity.subject_type == ContactSubjectType.ACCOUNT,
                HumanInputContactIdentity.account_id == str(account_id),
            )
        )
        if existing_id is not None:
            return ContactId(existing_id)

        contact_id = str(uuidv7())
        now = naive_utc_now()
        values = {
            "id": contact_id,
            "subject_type": ContactSubjectType.ACCOUNT,
            "account_id": str(account_id),
            "created_at": now,
            "updated_at": now,
        }
        dialect_name = self._session.get_bind().dialect.name
        try:
            if dialect_name == "postgresql":
                postgresql_statement = postgresql_insert(HumanInputContactIdentity).values(**values)
                self._session.execute(
                    postgresql_statement.on_conflict_do_nothing(
                        constraint="human_input_contact_identities_account_id_uq",
                    )
                )
            elif dialect_name == "mysql":
                mysql_statement = mysql_insert(HumanInputContactIdentity).values(**values)
                self._session.execute(
                    mysql_statement.on_duplicate_key_update(account_id=mysql_statement.inserted.account_id)
                )
            elif dialect_name == "sqlite":
                sqlite_statement = sqlite_insert(HumanInputContactIdentity).values(**values)
                self._session.execute(sqlite_statement.on_conflict_do_nothing(index_elements=["account_id"]))
            else:
                identity = HumanInputContactIdentity(
                    subject_type=ContactSubjectType.ACCOUNT,
                    account_id=str(account_id),
                )
                identity.id = contact_id
                identity.created_at = now
                identity.updated_at = now
                self._session.add(identity)
                self._session.flush()
        except IntegrityError as error:
            raise ContactError(ContactErrorCode.CONFLICT, "Account Contact provisioning conflicted") from error

        stored_identity_statement = sa.select(HumanInputContactIdentity.id).where(
            HumanInputContactIdentity.subject_type == ContactSubjectType.ACCOUNT,
            HumanInputContactIdentity.account_id == str(account_id),
        )
        if dialect_name == "mysql":
            # InnoDB locking reads are current reads, so the transaction that
            # waited on the duplicate key can see the committed winning row
            # despite an earlier REPEATABLE READ snapshot.
            stored_identity_statement = stored_identity_statement.with_for_update()
        stored_id = self._session.scalar(stored_identity_statement)
        if stored_id is None:
            raise RuntimeError("Account Contact provisioning did not produce an identity")
        return ContactId(stored_id)

    def delete_account_identity_after_failed_creation(self, account_id: AccountId) -> None:
        """Remove an identity only while its authoritative Account creation is being compensated."""

        self._session.execute(
            sa.delete(HumanInputContactIdentity).where(
                HumanInputContactIdentity.subject_type == ContactSubjectType.ACCOUNT,
                HumanInputContactIdentity.account_id == str(account_id),
            )
        )
        self._session.flush()

    def save_external_contact(self, tenant_id: TenantId, external_contact: ExternalContact) -> Contact:
        """Create identity/profile together or update only the existing profile."""

        self._ensure_external_avatar_owned(tenant_id, external_contact.avatar_file_id)
        identity = self._session.get(HumanInputContactIdentity, str(external_contact.id))
        profile = self._session.scalar(
            sa.select(HumanInputExternalContactProfile).where(
                HumanInputExternalContactProfile.contact_id == str(external_contact.id),
                HumanInputExternalContactProfile.tenant_id == str(tenant_id),
            )
        )
        if identity is None and profile is None:
            identity = HumanInputContactIdentity(subject_type=ContactSubjectType.EXTERNAL)
            identity.id = str(external_contact.id)
            identity.created_at = external_contact.created_at
            identity.updated_at = external_contact.created_at
            profile = HumanInputExternalContactProfile(
                contact_id=str(external_contact.id),
                tenant_id=str(tenant_id),
                name=external_contact.name,
                normalized_name=external_contact.name.casefold(),
                email=external_contact.email,
                normalized_email=str(NormalizedEmail(external_contact.email)),
                avatar_file_id=external_contact.avatar_file_id,
            )
            profile.created_at = external_contact.created_at
            profile.updated_at = external_contact.created_at
            self._session.add_all((identity, profile))
        elif (
            identity is None
            or identity.subject_type is not ContactSubjectType.EXTERNAL
            or identity.account_id is not None
            or profile is None
        ):
            raise ContactError(ContactErrorCode.INVALID_OWNER, "External Contact is not owned by this tenant")
        else:
            profile.name = external_contact.name
            profile.normalized_name = external_contact.name.casefold()
            profile.email = external_contact.email
            profile.normalized_email = str(NormalizedEmail(external_contact.email))
            profile.avatar_file_id = external_contact.avatar_file_id
            profile.updated_at = naive_utc_now()

        try:
            self._session.flush()
        except IntegrityError as error:
            raise ContactError(ContactErrorCode.CONFLICT, "External Contact email already exists") from error
        stored = self.get_contacts_by_id(tenant_id, external_contact.id)
        if stored is None or stored.type is not ContactType.EXTERNAL:
            raise RuntimeError("External Contact write did not produce a current Contact")
        return stored

    def delete_external_contact(self, tenant_id: TenantId, external_contact: ExternalContact) -> None:
        profile = self._session.scalar(
            sa.select(HumanInputExternalContactProfile).where(
                HumanInputExternalContactProfile.contact_id == str(external_contact.id),
                HumanInputExternalContactProfile.tenant_id == str(tenant_id),
            )
        )
        identity = self._session.scalar(
            sa.select(HumanInputContactIdentity).where(
                HumanInputContactIdentity.id == str(external_contact.id),
                HumanInputContactIdentity.subject_type == ContactSubjectType.EXTERNAL,
                HumanInputContactIdentity.account_id.is_(None),
            )
        )
        if profile is None or identity is None:
            raise ContactError(ContactErrorCode.NOT_FOUND, "External Contact was not found")
        self._session.delete(profile)
        self._session.delete(identity)
        self._session.flush()

    def list_organization_candidates(
        self,
        page: int,
        limit: int,
        keyword: str = "",
    ) -> Sequence[OrganizationCandidate]:
        if page < 1:
            raise ValueError("page must be positive")
        if limit < 1:
            raise ValueError("limit must be positive")
        rows = self._session.execute(
            self._organization_candidates_query(keyword)
            .order_by(Account.created_at, HumanInputContactIdentity.id)
            .offset((page - 1) * limit)
            .limit(limit)
        ).all()
        return tuple(self._candidate_from_row(row) for row in rows)

    def count_organization_candidates(self, keyword: str = "") -> int:
        candidates = self._organization_candidates_query(keyword).subquery()
        return self._session.scalar(sa.select(sa.func.count()).select_from(candidates)) or 0

    def create_platform_entry(
        self,
        tenant_id: TenantId,
        candidate_id: ContactId,
        added_by_account_id: AccountId,
    ) -> None:
        candidate = self._session.execute(
            self._organization_candidates_query("").where(
                HumanInputContactIdentity.id == str(candidate_id),
            )
        ).one_or_none()
        if candidate is None:
            raise ContactError(ContactErrorCode.NOT_FOUND, "Organization candidate was not found")
        now = naive_utc_now()
        values = {
            "id": str(uuidv7()),
            "tenant_id": str(tenant_id),
            "contact_id": str(candidate_id),
            "added_by_account_id": str(added_by_account_id),
            "created_at": now,
            "updated_at": now,
        }
        dialect_name = self._session.get_bind().dialect.name
        try:
            if dialect_name == "postgresql":
                postgresql_statement = postgresql_insert(HumanInputPlatformContactWorkspaceEntry).values(**values)
                self._session.execute(
                    postgresql_statement.on_conflict_do_nothing(constraint="hipcwe_tenant_contact_uq")
                )
            elif dialect_name == "mysql":
                mysql_statement = mysql_insert(HumanInputPlatformContactWorkspaceEntry).values(**values)
                self._session.execute(
                    mysql_statement.on_duplicate_key_update(contact_id=mysql_statement.inserted.contact_id)
                )
            elif dialect_name == "sqlite":
                sqlite_statement = sqlite_insert(HumanInputPlatformContactWorkspaceEntry).values(**values)
                self._session.execute(
                    sqlite_statement.on_conflict_do_nothing(index_elements=["tenant_id", "contact_id"])
                )
            else:
                existing_id = self._session.scalar(
                    sa.select(HumanInputPlatformContactWorkspaceEntry.id).where(
                        HumanInputPlatformContactWorkspaceEntry.tenant_id == str(tenant_id),
                        HumanInputPlatformContactWorkspaceEntry.contact_id == str(candidate_id),
                    )
                )
                if existing_id is None:
                    self._session.add(
                        HumanInputPlatformContactWorkspaceEntry(
                            tenant_id=str(tenant_id),
                            contact_id=str(candidate_id),
                            added_by_account_id=str(added_by_account_id),
                        )
                    )
                    self._session.flush()
        except IntegrityError as error:
            raise ContactError(ContactErrorCode.CONFLICT, "Platform Contact entry conflicted") from error

    def delete_platform_entry(self, tenant_id: TenantId, contact_id: ContactId) -> None:
        self._session.execute(
            sa.delete(HumanInputPlatformContactWorkspaceEntry).where(
                HumanInputPlatformContactWorkspaceEntry.tenant_id == str(tenant_id),
                HumanInputPlatformContactWorkspaceEntry.contact_id == str(contact_id),
            )
        )
        self._session.flush()

    def _ensure_external_avatar_owned(self, tenant_id: TenantId, avatar_file_id: str | None) -> None:
        if avatar_file_id is None:
            return
        owned_avatar_id = self._session.scalar(
            sa.select(UploadFile.id).where(
                UploadFile.id == avatar_file_id,
                UploadFile.tenant_id == str(tenant_id),
            )
        )
        if owned_avatar_id is None:
            raise ContactError(ContactErrorCode.NOT_FOUND, "External Contact avatar was not found")

    def _get_contacts_by_distinct_ids(
        self,
        tenant_id: TenantId,
        contact_ids: Sequence[ContactId],
    ) -> tuple[Contact, ...]:
        if not contact_ids:
            return ()
        current_contacts = self._current_contacts_subquery(tenant_id)
        rows = self._session.execute(
            sa.select(current_contacts)
            .where(current_contacts.c.contact_id.in_([str(contact_id) for contact_id in contact_ids]))
            .order_by(current_contacts.c.contact_id)
        ).mappings()
        return tuple(self._contact_from_row(row) for row in rows)

    def _current_contacts_query(self, tenant_id: TenantId, query: ContactQuery):
        current_contacts = self._current_contacts_subquery(tenant_id)
        statement = sa.select(current_contacts)
        if query.contact_type is not None:
            statement = statement.where(current_contacts.c.contact_type == query.contact_type.value)
        normalized_keyword = query.keyword.strip().casefold()
        if normalized_keyword:
            pattern = f"%{_escape_like(normalized_keyword)}%"
            statement = statement.where(
                sa.or_(
                    sa.func.lower(current_contacts.c.name).like(pattern, escape="\\"),
                    sa.func.lower(current_contacts.c.email).like(pattern, escape="\\"),
                )
            )
        return statement

    @staticmethod
    def _current_contacts_subquery(tenant_id: TenantId):
        membership = aliased(TenantAccountJoin)
        platform_entry = aliased(HumanInputPlatformContactWorkspaceEntry)
        account_contacts = (
            sa.select(
                HumanInputContactIdentity.id.label(_CONTACT_ID),
                sa.case(
                    (membership.id.is_not(None), ContactType.WORKSPACE.value),
                    else_=ContactType.PLATFORM.value,
                ).label(_CONTACT_TYPE),
                Account.name.label(_NAME),
                Account.email.label(_EMAIL),
                sa.cast(Account.avatar, sa.String(255)).label(_AVATAR_FILE_ID),
                HumanInputContactIdentity.created_at.label(_CREATED_AT),
            )
            .join(Account, Account.id == HumanInputContactIdentity.account_id)
            .outerjoin(
                membership,
                sa.and_(
                    membership.tenant_id == str(tenant_id),
                    membership.account_id == HumanInputContactIdentity.account_id,
                ),
            )
            .outerjoin(
                platform_entry,
                sa.and_(
                    platform_entry.tenant_id == str(tenant_id),
                    platform_entry.contact_id == HumanInputContactIdentity.id,
                ),
            )
            .where(
                HumanInputContactIdentity.subject_type == ContactSubjectType.ACCOUNT,
                Account.status == AccountStatus.ACTIVE,
                sa.or_(membership.id.is_not(None), platform_entry.id.is_not(None)),
            )
        )
        external_contacts = (
            sa.select(
                HumanInputContactIdentity.id.label(_CONTACT_ID),
                sa.literal(ContactType.EXTERNAL.value).label(_CONTACT_TYPE),
                HumanInputExternalContactProfile.name.label(_NAME),
                HumanInputExternalContactProfile.email.label(_EMAIL),
                sa.cast(HumanInputExternalContactProfile.avatar_file_id, sa.String(255)).label(_AVATAR_FILE_ID),
                HumanInputContactIdentity.created_at.label(_CREATED_AT),
            )
            .join(
                HumanInputExternalContactProfile,
                HumanInputExternalContactProfile.contact_id == HumanInputContactIdentity.id,
            )
            .where(
                HumanInputContactIdentity.subject_type == ContactSubjectType.EXTERNAL,
                HumanInputContactIdentity.account_id.is_(None),
                HumanInputExternalContactProfile.tenant_id == str(tenant_id),
            )
        )
        return sa.union_all(account_contacts, external_contacts).subquery("current_contacts")

    @staticmethod
    def _organization_candidates_query(keyword: str):
        statement = (
            sa.select(HumanInputContactIdentity, Account)
            .join(Account, Account.id == HumanInputContactIdentity.account_id)
            .where(
                HumanInputContactIdentity.subject_type == ContactSubjectType.ACCOUNT,
                Account.status == AccountStatus.ACTIVE,
            )
        )
        normalized_keyword = keyword.strip().casefold()
        if normalized_keyword:
            pattern = f"%{_escape_like(normalized_keyword)}%"
            statement = statement.where(
                sa.or_(
                    sa.func.lower(Account.name).like(pattern, escape="\\"),
                    sa.func.lower(Account.email).like(pattern, escape="\\"),
                )
            )
        return statement

    @staticmethod
    def _contact_from_row(row: RowMapping) -> Contact:
        created_at = row[_CREATED_AT]
        if not isinstance(created_at, datetime):
            raise TypeError("Contact creation time is not a datetime")
        return Contact(
            id=ContactId(row[_CONTACT_ID]),
            type=ContactType(row[_CONTACT_TYPE]),
            name=row[_NAME],
            email=row[_EMAIL],
            avatar_file_id=row[_AVATAR_FILE_ID],
            created_at=ensure_naive_utc(created_at),
        )

    @staticmethod
    def _candidate_from_row(row: Row[tuple[HumanInputContactIdentity, Account]]) -> OrganizationCandidate:
        identity, account = row
        return OrganizationCandidate(
            id=CandidateId(identity.id),
            name=account.name,
            email=account.email,
            avatar_file_id=account.avatar,
            created_at=ensure_naive_utc(identity.created_at),
        )


class SQLAlchemyContactIMBindingRepository:
    """Explicit current-binding batch reader using a caller-provided Session."""

    def __init__(self, session: Session) -> None:
        self._session = session

    def get_im_bindings(
        self,
        tenant_id: TenantId,
        contact_ids: Sequence[ContactId],
    ) -> Sequence[IMBinding]:
        distinct_ids = tuple(dict.fromkeys(contact_ids))
        if not distinct_ids:
            return ()
        contact_repository = SQLAlchemyContactRepository(self._session)
        current_account_contact_ids = {
            contact.id
            for contact in contact_repository.get_contacts_by_ids(tenant_id, distinct_ids)
            if contact.type is not ContactType.EXTERNAL
        }
        if not current_account_contact_ids:
            return ()
        priority = sa.case((HumanInputIMBinding.scope == IMBindingScope.WORKSPACE, 0), else_=1)
        records = self._session.scalars(
            sa.select(HumanInputIMBinding)
            .join(HumanInputIMIntegration, HumanInputIMIntegration.id == HumanInputIMBinding.integration_id)
            .where(
                HumanInputIMBinding.contact_id.in_([str(contact_id) for contact_id in current_account_contact_ids]),
                sa.or_(
                    HumanInputIMIntegration.tenant_id == str(tenant_id),
                    HumanInputIMIntegration.tenant_id.is_(None),
                ),
                sa.or_(
                    sa.and_(
                        HumanInputIMBinding.scope == IMBindingScope.WORKSPACE,
                        HumanInputIMBinding.scope_id == str(tenant_id),
                    ),
                    sa.and_(
                        HumanInputIMBinding.scope == IMBindingScope.ORGANIZATION,
                        HumanInputIMBinding.scope_id == HumanInputIMBinding.integration_id,
                    ),
                ),
            )
            .order_by(HumanInputIMBinding.contact_id, HumanInputIMBinding.provider, priority, HumanInputIMBinding.id)
        ).all()
        effective_records: dict[tuple[str, IMProvider], HumanInputIMBinding] = {}
        for record in records:
            effective_records.setdefault((record.contact_id, record.provider), record)
        return tuple(
            IMBinding(
                id=IMBindingId(record.id),
                scope=record.scope,
                contact_id=ContactId(record.contact_id),
                identity_id=IMIdentityId(record.im_identity_id),
                provider=record.provider,
            )
            for record in effective_records.values()
        )


__all__ = ["SQLAlchemyContactIMBindingRepository", "SQLAlchemyContactRepository"]
