"""Application boundary for Console tag management."""

from collections.abc import Sequence
from typing import Literal, NamedTuple, Protocol
from unicodedata import normalize

from machinery.context import RequestContext

type TagKind = Literal["knowledge", "app", "snippet", "skill"]


def normalize_tag_name(tag_type: TagKind, name: str) -> str:
    """Return the persisted identity key for one tag name.

    Skill tags have always been matched case-insensitively by their consumer.
    NFC makes canonically equivalent Unicode spellings share that identity.
    Other tag domains retain their existing case-sensitive identity.
    """
    return normalize("NFC", name).casefold() if tag_type == "skill" else name


class TagSummary(NamedTuple):
    id: str
    name: str
    type: str
    binding_count: int


class CreateTagInput(NamedTuple):
    name: str
    type: TagKind


class UpdateTagInput(NamedTuple):
    name: str


class TagBindingInput(NamedTuple):
    tag_ids: tuple[str, ...]
    target_id: str
    type: TagKind


class TagTargetQuery(Protocol):
    def find_target_ids(
        self, *, tenant_id: str, tag_type: str, tag_ids: list[str], match_all: bool = False
    ) -> list[str]: ...


class SkillTagMutations[TransactionT](Protocol):
    def replace_skill_bindings(
        self,
        session: TransactionT,
        *,
        workspace_id: str,
        actor_id: str,
        skill_id: str,
        names: Sequence[str],
    ) -> None: ...


class TagStore(TagTargetQuery, Protocol):
    def list_tags(
        self,
        workspace_id: str,
        tag_type: str,
        keyword: str | None,
        *,
        target_ids: frozenset[str] | None = None,
    ) -> Sequence[TagSummary]: ...

    def list_tags_by_target(self, workspace_id: str, target_id: str, tag_type: str) -> Sequence[TagSummary]: ...

    def get_tag_type(self, workspace_id: str, tag_id: str) -> str | None: ...

    def create_tag(self, workspace_id: str, actor_id: str, tag: CreateTagInput) -> TagSummary: ...

    def update_tag(
        self,
        workspace_id: str,
        tag_id: str,
        tag: UpdateTagInput,
        *,
        expected_type: TagKind | None = None,
    ) -> TagSummary: ...

    def delete_tag(self, workspace_id: str, tag_id: str, *, expected_type: TagKind | None = None) -> None: ...

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
        target_name = {"knowledge": "Dataset", "app": "App", "snippet": "Snippet", "skill": "Skill"}[target_type]
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
        return tuple(
            self._tags.list_tags(
                context.active_workspace_id,
                tag_type,
                keyword,
                target_ids=context.resource_dataset_ids,
            )
        )

    def list_tags_by_target(self, context: RequestContext, target_id: str, tag_type: str) -> tuple[TagSummary, ...]:
        return tuple(self._tags.list_tags_by_target(context.active_workspace_id, target_id, tag_type))

    def get_tag_type(self, context: RequestContext, tag_id: str) -> str | None:
        return self._tags.get_tag_type(context.active_workspace_id, tag_id)

    def create_tag(self, context: RequestContext, tag: CreateTagInput) -> TagSummary:
        return self._tags.create_tag(context.active_workspace_id, context.account_id, tag)

    def update_tag(
        self,
        context: RequestContext,
        tag_id: str,
        tag: UpdateTagInput,
        *,
        expected_type: TagKind | None = None,
    ) -> TagSummary:
        if expected_type is None:
            return self._tags.update_tag(context.active_workspace_id, tag_id, tag)
        return self._tags.update_tag(
            context.active_workspace_id,
            tag_id,
            tag,
            expected_type=expected_type,
        )

    def delete_tag(self, context: RequestContext, tag_id: str, *, expected_type: TagKind | None = None) -> None:
        if expected_type is None:
            self._tags.delete_tag(context.active_workspace_id, tag_id)
            return
        self._tags.delete_tag(context.active_workspace_id, tag_id, expected_type=expected_type)

    def create_bindings(self, context: RequestContext, binding: TagBindingInput) -> None:
        self._tags.create_bindings(context.active_workspace_id, context.account_id, binding)

    def delete_bindings(self, context: RequestContext, binding: TagBindingInput) -> None:
        self._tags.delete_bindings(context.active_workspace_id, binding)
