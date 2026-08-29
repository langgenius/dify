# /Users/qg/.codex/worktrees/5ab7/dify/api/controllers/console/workspace/human_input.py

class ContactType(StrEnum):
    """Workspace-scoped classification of a currently available Contact."""

    WORKSPACE = "workspace"
    PLATFORM = "platform"
    EXTERNAL = "external"


@dataclass(frozen=True, slots=True)
class Contact:
    id: ContactId
    type: ContactType
    name: str
    email: str | None
    avatar_file_id: str | None
    created_at: NaiveDatetime


@dataclass(frozen=True, slots=True)
class ExternalContact:
    """Workspace-soped External Contact data used only by save_external_contact and delete_external_contact."""

    id: ContactId
    name: str
    email: str
    avatar_file_id: str | None
    created_at: NaiveDatetime


@dataclass(frozen=True, slots=True)
class Page[T]:
    """Immutable page returned by repository queries."""

    items: tuple[T, ...]
    page: int
    limit: int


@dataclass(frozen=True, slots=True)
class ContactQuery:
    # empty keyword means keyword is unspecified.
    keyword: str = ""

    # search_contacts = None means no contact type filtering.
    contact_type: ContactType | None = None


class ContactRepository(Protocol):
    """Tenant-scoped current Contact queries and Contact lifecycle writes.

    Query methods return only Contacts currently available in the requested
    tenant and resolve ``Contact.type`` according to these rules:

    - A tenant-owned ``HumanInputExternalContactProfile`` resolves to
      ``ContactType.EXTERNAL``.
    - An active Account with a current ``TenantAccountJoin`` resolves to
      ``ContactType.WORKSPACE``.
    - An active Account with a current
      ``HumanInputPlatformContactWorkspaceEntry`` resolves to
      ``ContactType.PLATFORM``.
    - Current membership takes precedence over a Platform entry, so an Account
      with both resolves to ``ContactType.WORKSPACE``.
    - An inactive Account, or an Account with neither current membership nor a
      Platform entry, is omitted from current Contact results.
    """

    def count_contact(self, tenant_id: TenantId, query: ContactQuery = ContactQuery()) -> int: ...

    def list_contact(
            self, tenant_id: TenantId, page: int, limit: int,
            query: ContactQuery = ContactQuery()) -> Page[Contact]: ...

    def get_contacts_by_id(self, tenant_id: TenantId, contact_id: ContactId) -> Contact | None: ...

    def get_contacts_by_ids(
            self, tenant_id: TenantId, contact_ids: Sequence[ContactId]
        ) -> Sequence[Contact]:
        """Return currently available Contacts for the requested identities.

        Missing or unavailable Contacts are omitted. Repeated Contact IDs
        produce at most one result, and result ordering is unspecified.
        """
        ...

    def available(self, tenant_id: TenantId, contact_ids: Sequence[ContactId]) -> Mapping[ContactId, bool]:
        """Return current tenant availability for the requested Contact identities.

        An External Contact is available only in its owning tenant. An
        Account-backed Contact is available only when its Account is active and
        has either current membership or a Platform entry in the tenant.
        """
        ...

    def save_external_contact(self, tenant_id: TenantId, external_contact: ExternalContact) -> Contact: ...

    def delete_external_contact(self, tenant_id: TenantId, external_contact: ExternalContact): ...

    def provision_account_backed_contact(self, account_id: AccountId) -> ContactId: ...

    # EE Platform visibility mutations.
    def create_platform_entry(
            self, tenant_id: TenantId, account_id: AccountId,
            added_by_account_id: AccountId,
        ): ...

    def delete_platform_entry(self, tenant_id: TenantId, account_id: AccountId): ...

    def query_contacts_by_email(
            self, tenant_id: TenantId, emails: Sequence[str]
        ) -> Sequence[Contact]:
        """Return currently available Contacts matching the requested Emails.

        Emails without a matching Contact are omitted, and result ordering is
        unspecified. If one Email matches both an Account-backed Contact and an
        External Contact, both Contacts are returned.
        """
        ...


@dataclass(frozen=True, slots=True)
class IMBinding:
    id: IMBindingId
    scope: IMBindingScope
    contact_id: ContactId
    identity_id: IMIdentityId
    provider: IMProvider


class ContactIMBindingRepository(Protocol):
    """Tenant-scoped queries for IM bindings associated with Contacts."""

    def get_im_bindings(self, tenant_id: TenantId, contact_ids: Sequence[ContactId]) -> Sequence[IMBinding]: ...
