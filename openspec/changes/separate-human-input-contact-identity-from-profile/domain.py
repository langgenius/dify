# /Users/qg/.codex/worktrees/5ab7/dify/api/controllers/console/workspace/human_input.py

class ContactType(StrEnum):
    """Workspace-relative availability of one canonical Contact."""

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
    """This model should only be used for save_external_contact / delete_external_contact"""
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


class ContactRepository(Protocol):
    def count_contact(self, tenant_id: TenantId) -> int: ...

    def list_contact(self, tenant_id: TenantId, page: int, limit: int) -> Page[Contact]: ...

    def get_contacts_by_id(self, tenant_id: TenantId, contact_id: ContactId) -> Contact | None: ...

    def get_contacts_by_ids(
            self, tenant_id:ContactIMBIndingRepository TenantId, contact_ids: Sequence[ContactId]
        ) -> Sequence[Contact]: ...
        """Query contacts by their identities.

        missing / invisible contacts are not included in the result.

        repeated ids will only be returned once.

        The order in returned value is undetermined.

        For example, an account has no member nor HumanInputPlatformContactWorkspaceEntry will not be incluced.

        """

    def available(self, tenant_id: TenantId, contact_ids: Sequence[ContactId]) -> Mapping[ContactId, bool]: ...
        """available check whether a given contact is available in the given workspace (tenant).

        External contacts are always available in the correspond workspace. Availability of account-backed
        contacts are determined by workspace membership (TenantAccountJoin) and PlatformEntry existence. (
        whether HumanInputPlatformContactWorkspaceEntry in given tenant exists.)
        """

    def save_external_contact(self, tenant_id: TenantId, external_contact: ExternalContact) -> Contact: ...

    def delete_external_contact(self, tenant_id: TenantId, external_contact: ExternalContact): ...

    def provision_account_backed_contact(self, account_id: AccountId) -> ContactId: ...

    # API for EE platform contact
    def create_platform_entry(
            self, tenant_id: TenantId, account_id: AccountId,
            added_by_account_id: AccountId,
        ): ...

    def delete_platform_entry(self, tenant_id: TenantId, account_id: AccountId): ...

    def query_contacts_by_email(
            self, tenant_id: TenantId, emails: Sequence[str]
        ) -> Sequence[Contact]: ...
        """The order in returned value is undetermined.

        Missing emails are omitted from the result.

        This
        """

    def search_contacts(
            self, tenant_id: TenantId, keyword: str,
            contact_type: ContactType | None = None
        ) -> Sequence[Contact]: ...


@dataclass(frozen=True, slots=True)
class IMBinding:
    id: IMBindingId
    scope: IMBindingScope
    contact_id: ContactId
    identity_id: IMIdentityId
    provider: IMProvider


class ContactImBIndingRepository(Protocol):
    def get_im_bindings(self, tenant_id: TenantId, contact_ids: Sequence[ContactId]) -> Sequence[IMBinding]: ...
