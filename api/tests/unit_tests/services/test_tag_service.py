from unittest.mock import MagicMock

import pytest
from pytest_mock import MockerFixture
from werkzeug.exceptions import NotFound

from models import Account, Tag, TagBinding, Tenant
from models.enums import TagType
from models.snippet import CustomizedSnippet
from services.tag_service import TagBindingCreatePayload, TagBindingDeletePayload, TagService, UpdateTagPayload


@pytest.fixture
def current_user(mocker: MockerFixture):
    user = Account(name="Test User", email="user@example.com")
    user.id = "user-1"
    tenant = Tenant(name="Test Tenant")
    tenant.id = "tenant-1"
    user._current_tenant = tenant
    mocker.patch("services.tag_service.current_user", user)
    return user


@pytest.fixture
def db_session(mocker: MockerFixture):
    mock_db = mocker.Mock()
    return mock_db.session


def test_save_tag_binding_only_creates_bindings_for_valid_snippet_tags(mocker: MockerFixture, current_user, db_session):
    mocker.patch("services.tag_service.TagService.check_target_exists")
    db_session.scalars.return_value.all.return_value = ["tag-1"]
    db_session.scalar.return_value = None

    TagService.save_tag_binding(
        TagBindingCreatePayload(
            tag_ids=["tag-1", "tag-from-other-tenant"],
            target_id="snippet-1",
            type=TagType.SNIPPET,
        ),
        db_session,
    )

    db_session.add.assert_called_once()
    tag_binding = db_session.add.call_args.args[0]
    assert tag_binding.tag_id == "tag-1"
    assert tag_binding.target_id == "snippet-1"
    assert tag_binding.tenant_id == current_user.current_tenant_id
    assert tag_binding.created_by == current_user.id
    db_session.commit.assert_called_once()


def test_delete_tag_binding_limits_deletion_to_valid_snippet_tags(mocker: MockerFixture, current_user, db_session):
    mocker.patch("services.tag_service.TagService.check_target_exists")
    execute_result = MagicMock()
    execute_result.rowcount = 1
    db_session.execute.return_value = execute_result

    TagService.delete_tag_binding(
        TagBindingDeletePayload(
            tag_ids=["tag-1", "tag-from-other-tenant"],
            target_id="snippet-1",
            type=TagType.SNIPPET,
        ),
        db_session,
    )

    db_session.execute.assert_called_once()
    db_session.commit.assert_called_once()


def test_delete_tag_binding_does_not_commit_when_no_rows_deleted(mocker: MockerFixture, current_user, db_session):
    mocker.patch("services.tag_service.TagService.check_target_exists")
    execute_result = MagicMock()
    execute_result.rowcount = 0
    db_session.execute.return_value = execute_result

    TagService.delete_tag_binding(
        TagBindingDeletePayload(
            tag_ids=["tag-1"],
            target_id="snippet-1",
            type=TagType.SNIPPET,
        ),
        db_session,
    )

    db_session.execute.assert_called_once()
    db_session.commit.assert_not_called()


def test_update_tags_scopes_lookup_to_current_tenant_and_type(current_user, db_session):
    tag = Tag(tenant_id="tenant-1", type=TagType.KNOWLEDGE, name="old", created_by="user-1")
    tag.id = "tag-1"
    db_session.scalar.side_effect = [tag, None]

    result = TagService.update_tags(UpdateTagPayload(name="new"), "tag-1", db_session, tag_type=TagType.KNOWLEDGE)

    stmt = db_session.scalar.call_args_list[0].args[0]
    compiled = stmt.compile()
    statement = str(compiled)
    assert "tags.id" in statement
    assert "tags.tenant_id" in statement
    assert "tags.type" in statement
    assert "tag-1" in compiled.params.values()
    assert current_user.current_tenant_id in compiled.params.values()
    assert TagType.KNOWLEDGE in compiled.params.values()
    assert result is tag
    assert tag.name == "new"
    db_session.commit.assert_called_once()


def test_get_tag_binding_count_scopes_lookup_to_current_tenant_and_type(current_user, db_session):
    db_session.scalar.return_value = 3

    result = TagService.get_tag_binding_count("tag-1", db_session, tag_type=TagType.KNOWLEDGE)

    stmt = db_session.scalar.call_args.args[0]
    compiled = stmt.compile()
    statement = str(compiled)
    assert "tag_bindings.tag_id" in statement
    assert "tags.tenant_id" in statement
    assert "tags.type" in statement
    assert "tag-1" in compiled.params.values()
    assert current_user.current_tenant_id in compiled.params.values()
    assert TagType.KNOWLEDGE in compiled.params.values()
    assert result == 3


def test_delete_tag_scopes_lookup_and_bindings_to_current_tenant(current_user, db_session):
    tag = Tag(tenant_id="tenant-1", type=TagType.KNOWLEDGE, name="old", created_by="user-1")
    tag.id = "tag-1"
    binding = TagBinding(tenant_id="tenant-1", tag_id="tag-1", target_id="snippet-1", created_by="user-1")
    binding.id = "binding-1"
    db_session.scalar.return_value = tag
    db_session.scalars.return_value.all.return_value = [binding]

    TagService.delete_tag("tag-1", db_session, tag_type=TagType.KNOWLEDGE)

    tag_stmt = db_session.scalar.call_args.args[0]
    tag_compiled = tag_stmt.compile()
    assert "tags.id" in str(tag_compiled)
    assert "tags.tenant_id" in str(tag_compiled)
    assert "tags.type" in str(tag_compiled)
    assert "tag-1" in tag_compiled.params.values()
    assert current_user.current_tenant_id in tag_compiled.params.values()
    assert TagType.KNOWLEDGE in tag_compiled.params.values()

    binding_stmt = db_session.scalars.call_args.args[0]
    binding_compiled = binding_stmt.compile()
    assert "tag_bindings.tag_id" in str(binding_compiled)
    assert "tag_bindings.tenant_id" in str(binding_compiled)
    assert "tag-1" in binding_compiled.params.values()
    assert current_user.current_tenant_id in binding_compiled.params.values()
    db_session.delete.assert_any_call(tag)
    db_session.delete.assert_any_call(binding)
    db_session.commit.assert_called_once()


def test_get_target_ids_by_tag_ids_returns_empty_without_query_for_empty_input(db_session):
    result = TagService.get_target_ids_by_tag_ids(TagType.SNIPPET, "tenant-1", [], db_session)

    assert result == []
    db_session.scalars.assert_not_called()


def test_check_target_exists_accepts_existing_snippet(current_user, db_session):
    snippet = CustomizedSnippet(tenant_id="tenant-1", name="Test Snippet", type="node")
    snippet.id = "snippet-1"
    db_session.scalar.return_value = snippet

    TagService.check_target_exists("snippet", "snippet-1", db_session)

    db_session.scalar.assert_called_once()


def test_check_target_exists_raises_when_snippet_missing(current_user, db_session):
    db_session.scalar.return_value = None

    with pytest.raises(NotFound, match="Snippet not found"):
        TagService.check_target_exists("snippet", "missing-snippet", db_session)


def test_check_target_exists_raises_for_invalid_binding_type(current_user, db_session):
    with pytest.raises(NotFound, match="Invalid binding type"):
        TagService.check_target_exists("unknown", "target-1", db_session)

    db_session.scalar.assert_not_called()
