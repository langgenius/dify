import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from models.enums import TagType
from models.model import Tag, TagBinding
from models.snippet import CustomizedSnippet, SnippetType
from repositories.tag_repository import TagRepository
from services.tag_application_service import (
    CreateTagInput,
    TagBindingInput,
    TagBindingTargetNotFoundError,
    TagNameConflictError,
    TagNotFoundError,
    UpdateTagInput,
)


def _tag(tag_id: str, *, workspace_id: str, tag_type: TagType, name: str) -> Tag:
    tag = Tag(tenant_id=workspace_id, type=tag_type, name=name, created_by="account-1")
    tag.id = tag_id
    return tag


def _snippet(snippet_id: str, *, workspace_id: str) -> CustomizedSnippet:
    snippet = CustomizedSnippet(
        tenant_id=workspace_id,
        name="Snippet",
        description="",
        type=SnippetType.NODE.value,
        created_by="account-1",
        updated_by="account-1",
    )
    snippet.id = snippet_id
    return snippet


def test_list_tags_scopes_binding_counts_and_escapes_keyword(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _tag("tag-1", workspace_id="workspace-1", tag_type=TagType.APP, name="50% discount"),
                _tag("tag-2", workspace_id="workspace-1", tag_type=TagType.APP, name="500 discount"),
                _tag("tag-3", workspace_id="workspace-2", tag_type=TagType.APP, name="50% other"),
                TagBinding(tenant_id="workspace-1", tag_id="tag-1", target_id="app-1", created_by="account-1"),
                TagBinding(tenant_id="workspace-2", tag_id="tag-1", target_id="app-2", created_by="account-2"),
            ]
        )

    result = TagRepository(sqlite_session_factory).list_tags("workspace-1", "app", "50%")

    assert result == (("tag-1", "50% discount", "app", 1),)


def test_tag_lifecycle_uses_owned_transactions_and_workspace_scope(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    repository = TagRepository(sqlite_session_factory)
    created = repository.create_tag("workspace-1", "account-1", CreateTagInput("Original", "knowledge"))

    with sqlite_session_factory.begin() as session:
        session.add(
            TagBinding(
                tenant_id="workspace-1",
                tag_id=created.id,
                target_id="dataset-1",
                created_by="account-1",
            )
        )

    assert repository.get_tag_type("workspace-1", created.id) == "knowledge"
    assert repository.get_tag_type("workspace-2", created.id) is None

    updated = repository.update_tag("workspace-1", created.id, UpdateTagInput("Updated"))
    assert updated.name == "Updated"
    assert updated.binding_count == 1

    with pytest.raises(TagNameConflictError):
        repository.create_tag("workspace-1", "account-1", CreateTagInput("Updated", "knowledge"))

    with pytest.raises(TagNotFoundError):
        repository.update_tag("workspace-2", created.id, UpdateTagInput("Leaked"))

    repository.delete_tag("workspace-1", created.id)
    with sqlite_session_factory() as session:
        assert session.scalar(select(Tag.id).where(Tag.id == created.id)) is None
        assert session.scalar(select(TagBinding.id).where(TagBinding.tag_id == created.id)) is None


def test_binding_mutations_validate_target_type_and_workspace(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _snippet("snippet-1", workspace_id="workspace-1"),
                _tag("tag-1", workspace_id="workspace-1", tag_type=TagType.SNIPPET, name="Valid"),
                _tag("tag-2", workspace_id="workspace-1", tag_type=TagType.APP, name="Wrong type"),
                _tag("tag-3", workspace_id="workspace-2", tag_type=TagType.SNIPPET, name="Wrong workspace"),
            ]
        )

    repository = TagRepository(sqlite_session_factory)
    binding = TagBindingInput(("tag-1", "tag-1", "tag-2", "tag-3"), "snippet-1", "snippet")
    repository.create_bindings("workspace-1", "account-1", binding)
    repository.create_bindings("workspace-1", "account-1", binding)

    with sqlite_session_factory() as session:
        bindings = session.scalars(select(TagBinding).where(TagBinding.target_id == "snippet-1")).all()
        assert len(bindings) == 1
        assert bindings[0].tag_id == "tag-1"
        assert bindings[0].tenant_id == "workspace-1"

    repository.delete_bindings("workspace-1", binding)
    with sqlite_session_factory() as session:
        assert session.scalars(select(TagBinding).where(TagBinding.target_id == "snippet-1")).all() == []


def test_binding_mutation_rejects_missing_target(sqlite_session_factory: sessionmaker[Session]) -> None:
    repository = TagRepository(sqlite_session_factory)

    with pytest.raises(TagBindingTargetNotFoundError, match="Snippet not found"):
        repository.create_bindings(
            "workspace-1",
            "account-1",
            TagBindingInput(("tag-1",), "missing", "snippet"),
        )
