"""Application boundary for Console tag management."""

from collections.abc import Sequence
from typing import Literal, NamedTuple, Protocol

from machinery.context import RequestContext

type TagKind = Literal["knowledge", "app", "snippet"]


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


class TagStore(Protocol):
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
        target_name = {"knowledge": "Dataset", "app": "App", "snippet": "Snippet"}[target_type]
        super().__init__(f"{target_name} not found")


class InvalidTagBindingTypeError(TagApplicationError):
    def __init__(self) -> None:
        super().__init__("Invalid binding type")


class TagApplicationService:
    def __init__(self, *, tags: TagStore) -> None:
        self._tags = tags

    def list_tags(self, context: RequestContext, tag_type: str, keyword: str | None = None) -> tuple[TagSummary, ...]:
        return tuple(self._tags.list_tags(self._workspace_id(context), tag_type, keyword))

    def get_tag_type(self, context: RequestContext, tag_id: str) -> str | None:
        return self._tags.get_tag_type(self._workspace_id(context), tag_id)

    def create_tag(self, context: RequestContext, tag: CreateTagInput) -> TagSummary:
        return self._tags.create_tag(self._workspace_id(context), context.account_id, tag)

    def update_tag(self, context: RequestContext, tag_id: str, tag: UpdateTagInput) -> TagSummary:
        return self._tags.update_tag(self._workspace_id(context), tag_id, tag)

    def delete_tag(self, context: RequestContext, tag_id: str) -> None:
        self._tags.delete_tag(self._workspace_id(context), tag_id)

    def create_bindings(self, context: RequestContext, binding: TagBindingInput) -> None:
        self._tags.create_bindings(self._workspace_id(context), context.account_id, binding)

    def delete_bindings(self, context: RequestContext, binding: TagBindingInput) -> None:
        self._tags.delete_bindings(self._workspace_id(context), binding)

    @staticmethod
    def _workspace_id(context: RequestContext) -> str:
        if context.active_workspace_id is None:
            raise RuntimeError("Console account admission did not resolve an active workspace")
        return context.active_workspace_id
