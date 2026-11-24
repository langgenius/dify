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
from sqlalchemy.orm import Session

from core.human_input_v2.entities import IMBindingScope
from core.human_input_v2.shared import AccountId, ContactId, IMBindingId, NormalizedEmail, TenantId
from libs.datetime_utils import ensure_naive_utc, naive_utc_now
from libs.uuid_utils import uuidv7
from models.account import Account, AccountStatus, TenantAccountJoin
from models.human_input_v2 import (
    ContactSubjectType,
    HumanInputContactIdentity,
    HumanInputExternalContactProfile,
    HumanInputPlatformContactWorkspaceEntry,
)
from models.model import UploadFile
from repositories.account.avatar import validated_account_avatar
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
from repositories.human_input_v2.im_binding_repository import IMBindingKind
from repositories.human_input_v2.im_channel_repository import IMChannel
from repositories.human_input_v2.sqlalchemy_im_binding_repository import SQLAlchemyIMBindingRepository

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

    def get_contact_by_account_id(self, tenant_id: TenantId, account_id: AccountId) -> Contact | None:
        current_contacts = self._current_contacts_subquery(tenant_id)
        row = (
            self._session.execute(
                sa.select(current_contacts)
                .join(HumanInputContactIdentity, HumanInputContactIdentity.id == current_contacts.c.contact_id)
                .where(
                    HumanInputContactIdentity.subject_type == ContactSubjectType.ACCOUNT,
                    HumanInputContactIdentity.account_id == str(account_id),
                )
            )
            .mappings()
            .one_or_none()
        )
        return self._contact_from_row(row) if row is not None else None

    def get_contacts_by_account_ids(
        self, tenant_id: TenantId, account_ids: Sequence[AccountId]
    ) -> Mapping[AccountId, Contact]:
        """Return current Contacts for the supplied Accounts without any writes.

        The caller owns the Session. Unavailable identities are omitted; all
        returned identities are visible in the requested workspace.
        """
        if not account_ids:
            return {}
        current_contacts = self._current_contacts_subquery(tenant_id)
        rows = self._session.execute(
            sa.select(current_contacts, HumanInputContactIdentity.account_id)
            .join(HumanInputContactIdentity, HumanInputContactIdentity.id == current_contacts.c.contact_id)
            .where(
                HumanInputContactIdentity.subject_type == ContactSubjectType.ACCOUNT,
                HumanInputContactIdentity.account_id.in_(account_ids),
            )
        ).mappings()
        return {AccountId(row["account_id"]): self._contact_from_row(row) for row in rows}

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
        """Filter and page eligible candidates before validating their display avatars."""
        if page < 1:
            raise ValueError("page must be positive")
        if limit < 1:
            raise ValueError("limit must be positive")
        candidate_page = (
            self._organization_candidates_query(keyword)
            .add_columns(
                HumanInputContactIdentity.account_id,
                HumanInputContactIdentity.created_at.label("contact_created_at"),
                Account.created_at.label("account_created_at"),
            )
            .order_by(Account.created_at, HumanInputContactIdentity.id)
            .offset((page - 1) * limit)
            .limit(limit)
            .subquery()
        )
        rows = self._session.execute(
            sa.select(
                candidate_page.c.id,
                Account.name,
                Account.email,
                validated_account_avatar(),
                candidate_page.c.contact_created_at,
            )
            .join(Account, Account.id == candidate_page.c.account_id)
            .order_by(candidate_page.c.account_created_at, candidate_page.c.id)
        ).all()
        return tuple(self._candidate_from_row(row) for row in rows)

    def get_organization_candidate_avatars(self, contact_ids: Sequence[ContactId]) -> Mapping[ContactId, str | None]:
        """Read current avatars for the requested active Organization candidates without writing.

        Unavailable identities are omitted. Available candidates without an eligible avatar map to None.
        """
        statement = (
            self._organization_candidates_query("")
            .where(HumanInputContactIdentity.id.in_(contact_ids))
            .add_columns(validated_account_avatar())
        )
        return {ContactId(contact_id): avatar for contact_id, avatar in self._session.execute(statement).tuples()}

    def count_organization_candidates(self, keyword: str = "") -> int:
        candidates = self._organization_candidates_query(keyword).subquery()
        return self._session.scalar(sa.select(sa.func.count()).select_from(candidates)) or 0

    def create_platform_entry(
        self,
        tenant_id: TenantId,
        candidate_id: ContactId,
        added_by_account_id: AccountId,
    ) -> None:
        matched_id = self._session.scalar(
            self._organization_candidates_query("").where(
                HumanInputContactIdentity.id == str(candidate_id),
            )
        )
        if matched_id is None:
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
        """Build a read-only projection of current Contacts for the supplied tenant.

        Each Contact occurs once, with membership taking precedence over a
        Platform entry. Account subjects must be active; External profiles must
        belong to the tenant. No query executes until the caller uses the result.
        """
        # Start each visibility path from tenant-scoped rows so directory reads
        # do not scan every Account identity to test membership or Platform access.
        workspace_contacts = (
            sa.select(
                HumanInputContactIdentity.id.label(_CONTACT_ID),
                sa.literal(ContactType.WORKSPACE.value).label(_CONTACT_TYPE),
                Account.name.label(_NAME),
                Account.email.label(_EMAIL),
                sa.cast(validated_account_avatar(), sa.String(255)).label(_AVATAR_FILE_ID),
                HumanInputContactIdentity.created_at.label(_CREATED_AT),
            )
            .select_from(TenantAccountJoin)
            .join(HumanInputContactIdentity, HumanInputContactIdentity.account_id == TenantAccountJoin.account_id)
            .join(Account, Account.id == HumanInputContactIdentity.account_id)
            .where(
                TenantAccountJoin.tenant_id == str(tenant_id),
                HumanInputContactIdentity.subject_type == ContactSubjectType.ACCOUNT,
                Account.status == AccountStatus.ACTIVE,
            )
        )
        platform_contacts = (
            sa.select(
                HumanInputContactIdentity.id.label(_CONTACT_ID),
                sa.literal(ContactType.PLATFORM.value).label(_CONTACT_TYPE),
                Account.name.label(_NAME),
                Account.email.label(_EMAIL),
                sa.cast(validated_account_avatar(), sa.String(255)).label(_AVATAR_FILE_ID),
                HumanInputContactIdentity.created_at.label(_CREATED_AT),
            )
            .select_from(HumanInputPlatformContactWorkspaceEntry)
            .join(
                HumanInputContactIdentity,
                HumanInputContactIdentity.id == HumanInputPlatformContactWorkspaceEntry.contact_id,
            )
            .join(Account, Account.id == HumanInputContactIdentity.account_id)
            .where(
                HumanInputPlatformContactWorkspaceEntry.tenant_id == str(tenant_id),
                HumanInputContactIdentity.subject_type == ContactSubjectType.ACCOUNT,
                Account.status == AccountStatus.ACTIVE,
                ~sa.exists().where(
                    TenantAccountJoin.tenant_id == str(tenant_id),
                    TenantAccountJoin.account_id == HumanInputContactIdentity.account_id,
                ),
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
            .select_from(HumanInputExternalContactProfile)
            .join(
                HumanInputContactIdentity,
                HumanInputContactIdentity.id == HumanInputExternalContactProfile.contact_id,
            )
            .where(
                HumanInputContactIdentity.subject_type == ContactSubjectType.EXTERNAL,
                HumanInputContactIdentity.account_id.is_(None),
                HumanInputExternalContactProfile.tenant_id == str(tenant_id),
            )
        )
        return sa.union_all(workspace_contacts, platform_contacts, external_contacts).subquery("current_contacts")

    @staticmethod
    def _organization_candidates_query(keyword: str) -> sa.Select[tuple[str]]:
        """Select matching active account identity IDs for listing, counting, or creating entries."""
        statement = (
            sa.select(HumanInputContactIdentity.id)
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
    def _candidate_from_row(
        row: Row[tuple[str, str, str, str | None, datetime]],
    ) -> OrganizationCandidate:
        contact_id, name, email, avatar_file_id, created_at = row
        return OrganizationCandidate(
            id=CandidateId(contact_id),
            name=name,
            email=email,
            avatar_file_id=avatar_file_id,
            created_at=ensure_naive_utc(created_at),
        )


class SQLAlchemyContactIMBindingRepository:
    """Contact projection over one already-resolved current IM Channel."""

    # TODO(QuantumGhost): channel should not be None here.
    def __init__(self, session: Session, channel: IMChannel | None) -> None:
        self._session = session
        self._channel = channel

    def get_im_bindings(
        self,
        tenant_id: TenantId,
        contact_ids: Sequence[ContactId],
    ) -> Sequence[IMBinding]:
        distinct_ids = tuple(dict.fromkeys(contact_ids))
        if not distinct_ids or self._channel is None:
            return ()
        contact_repository = SQLAlchemyContactRepository(self._session)
        current_account_contact_ids = {
            contact.id
            for contact in contact_repository.get_contacts_by_ids(tenant_id, distinct_ids)
            if contact.type is not ContactType.EXTERNAL
        }
        if not current_account_contact_ids:
            return ()
        records = SQLAlchemyIMBindingRepository(self._session, self._channel.id).get_effective_many(
            tenant_id,
            tuple(current_account_contact_ids),
        )
        return tuple(
            IMBinding(
                id=IMBindingId(record.id),
                scope=(
                    IMBindingScope.WORKSPACE
                    if record.kind is IMBindingKind.WORKSPACE_OVERRIDE
                    else IMBindingScope.ORGANIZATION
                ),
                contact_id=record.contact_id,
                identity_id=record.identity_id,
                provider=self._channel.provider,
            )
            for record in records
        )


__all__ = ["SQLAlchemyContactIMBindingRepository", "SQLAlchemyContactRepository"]
