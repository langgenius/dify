"""Application boundary for Console tag management."""

from collections.abc import Sequence
from enum import StrEnum
from typing import NamedTuple, Protocol

from machinery.context import RequestContext

# String.prototype.trim uses ECMAScript whitespace and line terminators on the Console.
_TAG_NAME_PADDING = (
    "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008"
    "\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
)


def normalize_tag_name(name: str) -> str:
    """Accept a raw Console tag name and remove only surrounding whitespace, preserving case and internal text."""
    return name.strip(_TAG_NAME_PADDING)


class TagKind(StrEnum):
    """Application-owned tag pools with the Console's existing wire values."""

    KNOWLEDGE = "knowledge"
    APP = "app"
    AGENT = "agent"
    SNIPPET = "snippet"
    SKILL = "skill"


class TagSummary(NamedTuple):
    id: str
    name: str
    type: str
    binding_count: int


class CreateTagInput(NamedTuple):
    """Create a named tag in the application pool admitted by the transport."""

    name: str
    type: TagKind


class UpdateTagInput(NamedTuple):
    name: str


class TagBindingInput(NamedTuple):
    """Bind tags in an admitted application pool; Agent targets use canonical roster ids."""

    tag_ids: tuple[str, ...]
    target_id: str
    type: TagKind


class TagTargetQuery(Protocol):
    def find_target_ids(
        self, *, tenant_id: str, tag_type: str, tag_ids: list[str], match_all: bool = False
    ) -> list[str]: ...


class TagStore(TagTargetQuery, Protocol):
    """Persist tags within their workspace and resource pool.

    Names admitted by the Console are trimmed and 1–50 characters long. Legacy
    padded names also reserve their normalized name in the same workspace/pool.
    Agent writes serialize on the existing workspace row before checking names,
    reading targets or changing bindings. That lock lives through the bounded
    transaction and makes names unique and binding creation idempotent against
    concurrent Agent-pool mutations; deleting a tag cannot leave new bindings.
    Callers provide a persisted workspace admitted by the Console boundary.
    Other pools retain their existing transaction behavior.
    """

    def list_tags(self, workspace_id: str, tag_type: str, keyword: str | None) -> Sequence[TagSummary]: ...

    def get_tag_type(self, workspace_id: str, tag_id: str) -> str | None: ...

    def create_tag(self, workspace_id: str, actor_id: str, tag: CreateTagInput) -> TagSummary: ...

    def update_tag(self, workspace_id: str, tag_id: str, tag: UpdateTagInput) -> TagSummary: ...

    def delete_tag(self, workspace_id: str, tag_id: str) -> None: ...

    def create_bindings(self, workspace_id: str, actor_id: str, binding: TagBindingInput) -> None: ...

    def delete_bindings(self, workspace_id: str, binding: TagBindingInput) -> None: ...


class TagApplicationError(Exception):
    """Base class for framework-neutral tag failures."""


class TagNotFoundError(TagApplicationError):
    def __init__(self) -> None:
        super().__init__("Tag not found")


class TagNameConflictError(TagApplicationError):
    def __init__(self) -> None:
        super().__init__("Tag name already exists")


class TagBindingTargetNotFoundError(TagApplicationError):
    def __init__(self, target_type: TagKind) -> None:
        """Accept a supported target pool; report its missing resource without leaking other tenants."""
        target_name = {
            "knowledge": "Dataset",
            "app": "App",
            "agent": "Agent",
            "snippet": "Snippet",
            "skill": "Skill",
        }[target_type]
        super().__init__(f"{target_name} not found")


class InvalidTagBindingTypeError(TagApplicationError):
    def __init__(self) -> None:
        super().__init__("Invalid binding type")


class TagApplicationService:
    def __init__(self, *, tags: TagStore) -> None:
        self._tags = tags

    def find_target_ids(
        self, *, tenant_id: str, tag_type: str, tag_ids: list[str], match_all: bool = False
    ) -> list[str]:
        return self._tags.find_target_ids(tenant_id=tenant_id, tag_type=tag_type, tag_ids=tag_ids, match_all=match_all)

    def list_tags(self, context: RequestContext, tag_type: str, keyword: str | None = None) -> tuple[TagSummary, ...]:
        return tuple(self._tags.list_tags(context.active_workspace_id, tag_type, keyword))

    def get_tag_type(self, context: RequestContext, tag_id: str) -> str | None:
        return self._tags.get_tag_type(context.active_workspace_id, tag_id)

    def create_tag(self, context: RequestContext, tag: CreateTagInput) -> TagSummary:
        return self._tags.create_tag(context.active_workspace_id, context.account_id, tag)

    def update_tag(self, context: RequestContext, tag_id: str, tag: UpdateTagInput) -> TagSummary:
        return self._tags.update_tag(context.active_workspace_id, tag_id, tag)

    def delete_tag(self, context: RequestContext, tag_id: str) -> None:
        self._tags.delete_tag(context.active_workspace_id, tag_id)

    def create_bindings(self, context: RequestContext, binding: TagBindingInput) -> None:
        self._tags.create_bindings(context.active_workspace_id, context.account_id, binding)

    def delete_bindings(self, context: RequestContext, binding: TagBindingInput) -> None:
        self._tags.delete_bindings(context.active_workspace_id, binding)
