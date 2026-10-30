from dataclasses import dataclass, field
from typing import cast
from unittest.mock import MagicMock

import pytest

from machinery.context import RequestContext
from services.tag_application_service import (
    CreateTagInput,
    TagApplicationService,
    TagBindingInput,
    TagBindingTargetNotFoundError,
    TagStore,
    TagSummary,
    UpdateTagInput,
)


@pytest.fixture
def context() -> RequestContext:
    return RequestContext("request-1", None, "account-1", "workspace-1")


def test_service_passes_stable_identity_to_store(context: RequestContext) -> None:
    store = MagicMock()
    store.list_tags.return_value = [TagSummary("tag-1", "Tag", "app", 1)]
    store.create_tag.return_value = TagSummary("tag-2", "New", "app", 0)
    store.update_tag.return_value = TagSummary("tag-2", "Updated", "app", 0)
    service = TagApplicationService(tags=store)

    assert service.list_tags(context, "app", "search") == (TagSummary("tag-1", "Tag", "app", 1),)
    service.create_tag(context, CreateTagInput("New", "app"))
    service.update_tag(context, "tag-2", UpdateTagInput("Updated"))
    service.delete_tag(context, "tag-2")
    service.create_bindings(context, TagBindingInput(("tag-1",), "app-1", "app"))
    service.delete_bindings(context, TagBindingInput(("tag-1",), "app-1", "app"))

    store.list_tags.assert_called_once_with("workspace-1", "app", "search", target_ids=None)
    store.create_tag.assert_called_once_with("workspace-1", "account-1", CreateTagInput("New", "app"))
    store.update_tag.assert_called_once_with("workspace-1", "tag-2", UpdateTagInput("Updated"))
    store.delete_tag.assert_called_once_with("workspace-1", "tag-2")
    store.create_bindings.assert_called_once_with(
        "workspace-1", "account-1", TagBindingInput(("tag-1",), "app-1", "app")
    )
    store.delete_bindings.assert_called_once_with("workspace-1", TagBindingInput(("tag-1",), "app-1", "app"))


def test_skill_binding_target_error_message() -> None:
    assert str(TagBindingTargetNotFoundError("skill")) == "Skill not found"


@dataclass
class _RecordingTagListStore:
    calls: list[tuple[str, str, str | None, frozenset[str] | None]] = field(default_factory=list)

    def list_tags(
        self,
        workspace_id: str,
        tag_type: str,
        keyword: str | None,
        *,
        target_ids: frozenset[str] | None = None,
    ) -> tuple[TagSummary, ...]:
        self.calls.append((workspace_id, tag_type, keyword, target_ids))
        return (TagSummary("tag-1", "Scoped", tag_type, 1),)


def test_service_passes_resource_dataset_scope_to_tag_query() -> None:
    store = _RecordingTagListStore()
    context = RequestContext(
        "request-1",
        None,
        "account-1",
        "workspace-1",
        resource_dataset_ids=frozenset({"dataset-1"}),
    )
    service = TagApplicationService(tags=cast(TagStore, store))

    assert service.list_tags(context, "knowledge") == (TagSummary("tag-1", "Scoped", "knowledge", 1),)
    assert store.calls == [("workspace-1", "knowledge", None, frozenset({"dataset-1"}))]
