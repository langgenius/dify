from unittest.mock import MagicMock

import pytest

from machinery.context import RequestContext
from services.tag_application_service import (
    CreateTagInput,
    TagApplicationService,
    TagBindingInput,
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

    store.list_tags.assert_called_once_with("workspace-1", "app", "search")
    store.create_tag.assert_called_once_with("workspace-1", "account-1", CreateTagInput("New", "app"))
    store.update_tag.assert_called_once_with("workspace-1", "tag-2", UpdateTagInput("Updated"))
    store.delete_tag.assert_called_once_with("workspace-1", "tag-2")
    store.create_bindings.assert_called_once_with(
        "workspace-1", "account-1", TagBindingInput(("tag-1",), "app-1", "app")
    )
    store.delete_bindings.assert_called_once_with("workspace-1", TagBindingInput(("tag-1",), "app-1", "app"))


def test_service_rejects_context_without_active_workspace() -> None:
    context = RequestContext("request-1", None, "account-1", None)
    service = TagApplicationService(tags=MagicMock())

    with pytest.raises(RuntimeError, match="active workspace"):
        service.list_tags(context, "app")
