"""Service API dataset tag controllers use the shared tag application service."""

from dataclasses import dataclass, field
from inspect import unwrap
from uuid import UUID

import pytest

from controllers.common.errors import NotFoundError
from fields.service_api.dataset import (
    TagBindingPayload,
    TagCreatePayload,
    TagDeletePayload,
    TagUnbindingPayload,
    TagUpdatePayload,
)
from machinery.context import RequestContext
from services.tag_application_service import (
    CreateTagInput,
    TagBindingInput,
    TagBindingTargetNotFoundError,
    TagNameConflictError,
    TagNotFoundError,
    TagSummary,
    UpdateTagInput,
)

DATASET_ID = UUID("11111111-1111-4111-8111-111111111111")
CONTEXT = RequestContext("request", None, "account", "workspace")


@dataclass
class TagServiceFake:
    tags: tuple[TagSummary, ...] = (TagSummary("tag-1", "Tag", "knowledge", 2),)
    error: Exception | None = None
    calls: list[tuple[str, object]] = field(default_factory=list)

    def _raise(self) -> None:
        if self.error is not None:
            raise self.error

    def list_tags(self, context: RequestContext, tag_type: str) -> tuple[TagSummary, ...]:
        self.calls.append(("list", (context, tag_type)))
        return self.tags

    def list_tags_by_target(self, context: RequestContext, target_id: str, tag_type: str) -> tuple[TagSummary, ...]:
        self.calls.append(("bound", (context, target_id, tag_type)))
        return self.tags

    def create_tag(self, context: RequestContext, tag: CreateTagInput) -> TagSummary:
        self.calls.append(("create", (context, tag)))
        self._raise()
        return self.tags[0]

    def update_tag(
        self,
        context: RequestContext,
        tag_id: str,
        tag: UpdateTagInput,
        *,
        expected_type: str | None = None,
    ) -> TagSummary:
        self.calls.append(("update", (context, tag_id, tag, expected_type)))
        self._raise()
        return self.tags[0]

    def delete_tag(self, context: RequestContext, tag_id: str, *, expected_type: str | None = None) -> None:
        self.calls.append(("delete", (context, tag_id, expected_type)))
        self._raise()

    def create_bindings(self, context: RequestContext, binding: TagBindingInput) -> None:
        self.calls.append(("bind", (context, binding)))
        self._raise()

    def delete_bindings(self, context: RequestContext, binding: TagBindingInput) -> None:
        self.calls.append(("unbind", (context, binding)))
        self._raise()


@dataclass
class ApplicationServicesFake:
    tags: TagServiceFake
    knowledge: object = None


@pytest.fixture
def tags(monkeypatch: pytest.MonkeyPatch) -> TagServiceFake:
    from controllers.service_api.dataset import dataset as controller

    service = TagServiceFake()
    monkeypatch.setattr(controller, "application_services", lambda: ApplicationServicesFake(service))
    return service


def test_list_tags_uses_workspace_context(tags: TagServiceFake) -> None:
    from controllers.service_api.dataset.dataset import DatasetTagsApi

    response, status = DatasetTagsApi.get(DatasetTagsApi(), CONTEXT)

    assert status == 200
    assert response == [{"id": "tag-1", "name": "Tag", "type": "knowledge", "binding_count": "2"}]
    assert tags.calls == [("list", (CONTEXT, "knowledge"))]


def test_create_and_update_tags_delegate_typed_commands(tags: TagServiceFake) -> None:
    from controllers.service_api.dataset.dataset import DatasetTagsApi

    unwrap(DatasetTagsApi.post)(DatasetTagsApi(), TagCreatePayload(name="New"), CONTEXT)
    unwrap(DatasetTagsApi.patch)(DatasetTagsApi(), TagUpdatePayload(tag_id="tag-1", name="Updated"), CONTEXT)

    assert tags.calls == [
        ("create", (CONTEXT, CreateTagInput("New", "knowledge"))),
        ("update", (CONTEXT, "tag-1", UpdateTagInput("Updated"), "knowledge")),
    ]


def test_delete_tag_enforces_knowledge_type(tags: TagServiceFake) -> None:
    from controllers.service_api.dataset.dataset import DatasetTagsApi

    result = unwrap(DatasetTagsApi.delete)(DatasetTagsApi(), TagDeletePayload(tag_id="tag-1"), CONTEXT)

    assert result == ("", 204)
    assert tags.calls == [("delete", (CONTEXT, "tag-1", "knowledge"))]


def test_create_tag_preserves_name_conflict_contract(tags: TagServiceFake) -> None:
    from controllers.service_api.dataset.dataset import DatasetTagsApi

    tags.error = TagNameConflictError()
    with pytest.raises(ValueError, match="Tag name already exists"):
        unwrap(DatasetTagsApi.post)(DatasetTagsApi(), TagCreatePayload(name="Duplicate"), CONTEXT)


def test_delete_missing_tag_preserves_not_found_contract(tags: TagServiceFake) -> None:
    from controllers.service_api.dataset.dataset import DatasetTagsApi

    tags.error = TagNotFoundError()
    with pytest.raises(NotFoundError) as error:
        unwrap(DatasetTagsApi.delete)(DatasetTagsApi(), TagDeletePayload(tag_id="missing"), CONTEXT)

    assert error.value.code == 404
    assert error.value.error_code == "not_found"
    assert error.value.description == "Tag not found"


def test_binding_commands_use_knowledge_type(tags: TagServiceFake) -> None:
    from controllers.service_api.dataset.dataset import DatasetTagBindingApi, DatasetTagUnbindingApi

    unwrap(DatasetTagBindingApi.post)(
        DatasetTagBindingApi(), TagBindingPayload(tag_ids=["tag-1"], target_id="dataset"), CONTEXT
    )
    unwrap(DatasetTagUnbindingApi.post)(
        DatasetTagUnbindingApi(), TagUnbindingPayload(tag_id="tag-1", target_id="dataset"), CONTEXT
    )

    command = TagBindingInput(("tag-1",), "dataset", "knowledge")
    assert tags.calls == [("bind", (CONTEXT, command)), ("unbind", (CONTEXT, command))]


def test_missing_binding_target_is_translated(tags: TagServiceFake) -> None:
    from controllers.service_api.dataset.dataset import DatasetTagBindingApi

    tags.error = TagBindingTargetNotFoundError("knowledge")
    with pytest.raises(NotFoundError):
        unwrap(DatasetTagBindingApi.post)(
            DatasetTagBindingApi(), TagBindingPayload(tag_ids=["tag-1"], target_id="missing"), CONTEXT
        )


def test_bound_tag_query_uses_target_and_workspace(tags: TagServiceFake) -> None:
    from controllers.service_api.dataset.dataset import DatasetTagsBindingStatusApi

    response, status = DatasetTagsBindingStatusApi.get(DatasetTagsBindingStatusApi(), CONTEXT, DATASET_ID)

    assert status == 200
    assert response == {"data": [{"id": "tag-1", "name": "Tag"}], "total": 1}
    assert tags.calls == [("bound", (CONTEXT, str(DATASET_ID), "knowledge"))]
