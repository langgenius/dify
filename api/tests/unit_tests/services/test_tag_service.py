import uuid
from dataclasses import dataclass

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session
from werkzeug.exceptions import NotFound

from models.enums import TagType
from models.model import Tag, TagBinding
from services.tag_service import (
    TagBindingCreatePayload,
    TagBindingDeletePayload,
    TagService,
    UpdateTagPayload,
)


@dataclass
class _CurrentUserStub:
    id: str
    current_tenant_id: str


def test_save_tag_binding_only_creates_bindings_for_valid_snippet_tags(
    db_session_with_containers: Session, current_user_stub: _CurrentUserStub
) -> None:
    account, tenant = _create_account_with_tenant(db_session_with_containers)
    _set_current_user(current_user_stub, account, tenant)
    snippet = _create_snippet(db_session_with_containers, tenant_id=tenant.id, user_id=account.id)
    valid_tag = _create_tags(
        db_session_with_containers, tenant_id=tenant.id, user_id=account.id, tag_type=TagType.SNIPPET, count=1
    )[0]
    app_tag = _create_tags(
        db_session_with_containers, tenant_id=tenant.id, user_id=account.id, tag_type=TagType.APP, count=1
    )[0]
    other_account, other_tenant = _create_account_with_tenant(db_session_with_containers)
    other_tenant_tag = _create_tags(
        db_session_with_containers,
        tenant_id=other_tenant.id,
        user_id=other_account.id,
        tag_type=TagType.SNIPPET,
        count=1,
    )[0]

    binding_payload = TagBindingCreatePayload(
        type=TagType.SNIPPET,
        target_id=snippet.id,
        tag_ids=[valid_tag.id, app_tag.id, other_tenant_tag.id],
    )
    TagService.save_tag_binding(binding_payload, db_session_with_containers)

    bindings = db_session_with_containers.scalars(select(TagBinding).where(TagBinding.target_id == snippet.id)).all()
    assert len(bindings) == 1
    assert bindings[0].tag_id == valid_tag.id
    assert bindings[0].tenant_id == tenant.id
    assert bindings[0].created_by == account.id


def test_delete_tag_binding_limits_deletion_to_valid_snippet_tags(
    db_session_with_containers: Session, current_user_stub: _CurrentUserStub
) -> None:
    account, tenant = _create_account_with_tenant(db_session_with_containers)
    _set_current_user(current_user_stub, account, tenant)
    snippet = _create_snippet(db_session_with_containers, tenant_id=tenant.id, user_id=account.id)
    valid_tag = _create_tags(
        db_session_with_containers, tenant_id=tenant.id, user_id=account.id, tag_type=TagType.SNIPPET, count=1
    )[0]
    app_tag = _create_tags(
        db_session_with_containers, tenant_id=tenant.id, user_id=account.id, tag_type=TagType.APP, count=1
    )[0]
    other_account, other_tenant = _create_account_with_tenant(db_session_with_containers)
    other_tenant_tag = _create_tags(
        db_session_with_containers,
        tenant_id=other_tenant.id,
        user_id=other_account.id,
        tag_type=TagType.SNIPPET,
        count=1,
    )[0]
    _create_tag_bindings(
        db_session_with_containers, tags=[valid_tag], target_id=snippet.id, tenant_id=tenant.id, user_id=account.id
    )
    _create_tag_bindings(
        db_session_with_containers, tags=[app_tag], target_id=snippet.id, tenant_id=tenant.id, user_id=account.id
    )
    _create_tag_bindings(
        db_session_with_containers,
        tags=[other_tenant_tag],
        target_id=snippet.id,
        tenant_id=other_tenant.id,
        user_id=other_account.id,
    )

    delete_payload = TagBindingDeletePayload(
        type=TagType.SNIPPET,
        target_id=snippet.id,
        tag_ids=[valid_tag.id, app_tag.id, other_tenant_tag.id],
    )
    TagService.delete_tag_binding(delete_payload, db_session_with_containers)

    remaining_tag_ids = set(
        db_session_with_containers.scalars(select(TagBinding.tag_id).where(TagBinding.target_id == snippet.id)).all()
    )
    assert remaining_tag_ids == {app_tag.id, other_tenant_tag.id}


def test_delete_tag_binding_does_not_commit_when_no_rows_deleted(
    db_session_with_containers: Session, current_user_stub: _CurrentUserStub
) -> None:
    account, tenant = _create_account_with_tenant(db_session_with_containers)
    _set_current_user(current_user_stub, account, tenant)
    snippet = _create_snippet(db_session_with_containers, tenant_id=tenant.id, user_id=account.id)
    tag = _create_tags(
        db_session_with_containers, tenant_id=tenant.id, user_id=account.id, tag_type=TagType.SNIPPET, count=1
    )[0]

    delete_payload = TagBindingDeletePayload(type=TagType.SNIPPET, target_id=snippet.id, tag_ids=[tag.id])
    TagService.delete_tag_binding(delete_payload, db_session_with_containers)

    bindings = db_session_with_containers.scalars(select(TagBinding).where(TagBinding.target_id == snippet.id)).all()
    assert bindings == []


def test_update_tags_scopes_lookup_to_current_tenant_and_type(
    db_session_with_containers: Session, current_user_stub: _CurrentUserStub
) -> None:
    account, tenant = _create_account_with_tenant(db_session_with_containers)
    _set_current_user(current_user_stub, account, tenant)
    app_tag = _create_tags(
        db_session_with_containers, tenant_id=tenant.id, user_id=account.id, tag_type=TagType.APP, count=1
    )[0]
    other_account, other_tenant = _create_account_with_tenant(db_session_with_containers)
    other_tenant_tag = _create_tags(
        db_session_with_containers,
        tenant_id=other_tenant.id,
        user_id=other_account.id,
        tag_type=TagType.KNOWLEDGE,
        count=1,
    )[0]
    app_tag_name = app_tag.name
    other_tenant_tag_name = other_tenant_tag.name
    update_args = UpdateTagPayload(name="should_not_update")

    with pytest.raises(NotFound, match="Tag not found"):
        TagService.update_tags(update_args, app_tag.id, db_session_with_containers, tag_type=TagType.KNOWLEDGE)

    with pytest.raises(NotFound, match="Tag not found"):
        TagService.update_tags(update_args, other_tenant_tag.id, db_session_with_containers, tag_type=TagType.KNOWLEDGE)

    db_session_with_containers.refresh(app_tag)
    db_session_with_containers.refresh(other_tenant_tag)
    assert app_tag.name == app_tag_name
    assert other_tenant_tag.name == other_tenant_tag_name


def test_get_tag_binding_count_scopes_lookup_to_current_tenant_and_type(
    db_session_with_containers: Session, current_user_stub: _CurrentUserStub
) -> None:
    account, tenant = _create_account_with_tenant(db_session_with_containers)
    _set_current_user(current_user_stub, account, tenant)
    tag = _create_tags(
        db_session_with_containers, tenant_id=tenant.id, user_id=account.id, tag_type=TagType.KNOWLEDGE, count=1
    )[0]
    dataset = _create_dataset(db_session_with_containers, tenant_id=tenant.id, user_id=account.id)
    _create_tag_bindings(
        db_session_with_containers, tags=[tag], target_id=dataset.id, tenant_id=tenant.id, user_id=account.id
    )
    other_account, other_tenant = _create_account_with_tenant(db_session_with_containers)
    other_tenant_tag = _create_tags(
        db_session_with_containers,
        tenant_id=other_tenant.id,
        user_id=other_account.id,
        tag_type=TagType.KNOWLEDGE,
        count=1,
    )[0]
    other_tenant_dataset = _create_dataset(
        db_session_with_containers, tenant_id=other_tenant.id, user_id=other_account.id
    )
    _create_tag_bindings(
        db_session_with_containers,
        tags=[other_tenant_tag],
        target_id=other_tenant_dataset.id,
        tenant_id=other_tenant.id,
        user_id=other_account.id,
    )

    assert TagService.get_tag_binding_count(tag.id, db_session_with_containers, tag_type=TagType.KNOWLEDGE) == 1
    assert TagService.get_tag_binding_count(tag.id, db_session_with_containers, tag_type=TagType.APP) == 0
    assert (
        TagService.get_tag_binding_count(other_tenant_tag.id, db_session_with_containers, tag_type=TagType.KNOWLEDGE)
        == 0
    )


def test_delete_tag_scopes_lookup_and_bindings_to_current_tenant(
    db_session_with_containers: Session, current_user_stub: _CurrentUserStub
) -> None:
    account, tenant = _create_account_with_tenant(db_session_with_containers)
    _set_current_user(current_user_stub, account, tenant)
    app_tag = _create_tags(
        db_session_with_containers, tenant_id=tenant.id, user_id=account.id, tag_type=TagType.APP, count=1
    )[0]
    other_account, other_tenant = _create_account_with_tenant(db_session_with_containers)
    other_tenant_tag = _create_tags(
        db_session_with_containers,
        tenant_id=other_tenant.id,
        user_id=other_account.id,
        tag_type=TagType.KNOWLEDGE,
        count=1,
    )[0]

    with pytest.raises(NotFound, match="Tag not found"):
        TagService.delete_tag(app_tag.id, db_session_with_containers, tag_type=TagType.KNOWLEDGE)

    with pytest.raises(NotFound, match="Tag not found"):
        TagService.delete_tag(other_tenant_tag.id, db_session_with_containers, tag_type=TagType.KNOWLEDGE)

    assert db_session_with_containers.scalar(select(Tag).where(Tag.id == app_tag.id)) is not None
    assert db_session_with_containers.scalar(select(Tag).where(Tag.id == other_tenant_tag.id)) is not None


def test_get_target_ids_by_tag_ids_returns_empty_without_query_for_empty_input(
    db_session_with_containers: Session, current_user_stub: _CurrentUserStub
) -> None:
    account, tenant = _create_account_with_tenant(db_session_with_containers)
    _set_current_user(current_user_stub, account, tenant)

    result = TagService.get_target_ids_by_tag_ids(TagType.SNIPPET, tenant.id, [], db_session_with_containers)

    assert result == []


def test_check_target_exists_accepts_existing_snippet(
    db_session_with_containers: Session, current_user_stub: _CurrentUserStub
) -> None:
    account, tenant = _create_account_with_tenant(db_session_with_containers)
    _set_current_user(current_user_stub, account, tenant)

    snippet = _create_snippet(db_session_with_containers, tenant_id=tenant.id, user_id=account.id)

    TagService.check_target_exists(TagType.SNIPPET, snippet.id, db_session_with_containers)


def test_check_target_exists_raises_when_snippet_missing(
    db_session_with_containers: Session, current_user_stub: _CurrentUserStub
) -> None:
    account, tenant = _create_account_with_tenant(db_session_with_containers)
    _set_current_user(current_user_stub, account, tenant)

    with pytest.raises(NotFound, match="Snippet not found"):
        TagService.check_target_exists(TagType.SNIPPET, str(uuid.uuid4()), db_session_with_containers)


def test_check_target_exists_snippet_not_found_for_other_tenant(
    db_session_with_containers: Session, current_user_stub: _CurrentUserStub
) -> None:
    account, tenant = _create_account_with_tenant(db_session_with_containers)
    _set_current_user(current_user_stub, account, tenant)
    other_account, other_tenant = _create_account_with_tenant(db_session_with_containers)
    other_tenant_snippet = _create_snippet(
        db_session_with_containers, tenant_id=other_tenant.id, user_id=other_account.id
    )

    with pytest.raises(NotFound, match="Snippet not found"):
        TagService.check_target_exists(TagType.SNIPPET, other_tenant_snippet.id, db_session_with_containers)


def test_check_target_exists_raises_for_invalid_binding_type(db_session_with_containers: Session) -> None:
    with pytest.raises(NotFound, match="Invalid binding type"):
        TagService.check_target_exists("invalid_type", "target-id", db_session_with_containers)
