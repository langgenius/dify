from unittest.mock import MagicMock

import pytest
from pytest_mock import MockerFixture
from werkzeug.exceptions import NotFound

from models import Account
from models.enums import TagType
from models.snippet import CustomizedSnippet
from services.tag_service import TagBindingCreatePayload, TagBindingDeletePayload, TagService


@pytest.fixture
def current_user(mocker: MockerFixture):
    user = MagicMock(spec=Account)
    user.id = "user-1"
    user.current_tenant_id = "tenant-1"
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


def test_get_target_ids_by_tag_ids_returns_empty_without_query_for_empty_input(db_session):
    result = TagService.get_target_ids_by_tag_ids(TagType.SNIPPET, "tenant-1", [], db_session)

    assert result == []
    db_session.scalars.assert_not_called()


def test_check_target_exists_accepts_existing_snippet(current_user, db_session):
    snippet = MagicMock(spec=CustomizedSnippet)
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
