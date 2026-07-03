import uuid
from collections.abc import Generator, Sequence
from dataclasses import dataclass
from unittest.mock import patch

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session
from werkzeug.exceptions import NotFound

from core.rag.index_processor.constant.index_type import IndexTechniqueType
from models import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole, TenantStatus
from models.dataset import Dataset
from models.enums import DataSourceType, TagType
from models.model import App, Tag, TagBinding
from models.snippet import CustomizedSnippet, SnippetType
from services.tag_service import (
    SaveTagPayload,
    TagBindingCreatePayload,
    TagBindingDeletePayload,
    TagService,
    UpdateTagPayload,
)


@dataclass
class _CurrentUserStub:
    id: str
    current_tenant_id: str


@pytest.fixture
def current_user_stub() -> Generator[_CurrentUserStub, None, None]:
    current_user = _CurrentUserStub(id="test-user-id", current_tenant_id="test-tenant-id")

    with patch("services.tag_service.current_user", current_user):
        yield current_user


def _create_account_with_tenant(db_session_with_containers: Session) -> tuple[Account, Tenant]:
    suffix = uuid.uuid4().hex
    account = Account(
        email=f"tag-service-{suffix}@example.com",
        name=f"Tag Service Account {suffix}",
        interface_language="en-US",
        status=AccountStatus.ACTIVE,
    )

    tenant = Tenant(
        name=f"Tag Service Tenant {suffix}",
        status=TenantStatus.NORMAL,
    )
    db_session_with_containers.add_all([account, tenant])
    db_session_with_containers.flush()

    join = TenantAccountJoin(
        tenant_id=tenant.id,
        account_id=account.id,
        role=TenantAccountRole.OWNER,
        current=True,
    )
    db_session_with_containers.add(join)
    db_session_with_containers.flush()

    return account, tenant


def _set_current_user(current_user_stub: _CurrentUserStub, account: Account, tenant: Tenant) -> None:
    current_user_stub.current_tenant_id = tenant.id
    current_user_stub.id = account.id


def _create_dataset(
    db_session_with_containers: Session,
    *,
    tenant_id: str,
    user_id: str,
) -> Dataset:
    suffix = uuid.uuid4().hex
    dataset = Dataset(
        name=f"Tag Service Dataset {suffix}",
        description="Tag service test dataset",
        provider="vendor",
        permission="only_me",
        data_source_type=DataSourceType.UPLOAD_FILE,
        indexing_technique=IndexTechniqueType.HIGH_QUALITY,
        tenant_id=tenant_id,
        created_by=user_id,
    )

    db_session_with_containers.add(dataset)
    db_session_with_containers.flush()

    return dataset


def _create_app(
    db_session_with_containers: Session,
    *,
    tenant_id: str,
    user_id: str,
) -> App:
    suffix = uuid.uuid4().hex
    app = App(
        name=f"Tag Service App {suffix}",
        description="Tag service test app",
        mode="chat",
        icon_type="emoji",
        icon="🤖",
        icon_background="#FF6B6B",
        enable_site=False,
        enable_api=False,
        tenant_id=tenant_id,
        created_by=user_id,
    )

    db_session_with_containers.add(app)
    db_session_with_containers.flush()

    return app


def _create_snippet(
    db_session_with_containers: Session,
    *,
    tenant_id: str,
    user_id: str,
) -> CustomizedSnippet:
    suffix = uuid.uuid4().hex
    snippet = CustomizedSnippet(
        tenant_id=tenant_id,
        name=f"Tag Service Snippet {suffix}",
        description="Tag service test snippet",
        type=SnippetType.NODE.value,
        created_by=user_id,
        updated_by=user_id,
    )

    db_session_with_containers.add(snippet)
    db_session_with_containers.flush()

    return snippet


def _create_tags(
    db_session_with_containers: Session,
    *,
    tenant_id: str,
    user_id: str,
    tag_type: TagType,
    count: int = 3,
) -> list[Tag]:
    tags = []

    for i in range(count):
        tag = Tag(
            name=f"tag-{tag_type.value}-{i}-{uuid.uuid4().hex}",
            type=tag_type,
            tenant_id=tenant_id,
            created_by=user_id,
        )
        tags.append(tag)

    db_session_with_containers.add_all(tags)
    db_session_with_containers.flush()

    return tags


def _create_tag_bindings(
    db_session_with_containers: Session,
    *,
    tags: Sequence[Tag],
    target_id: str,
    tenant_id: str,
    user_id: str,
) -> list[TagBinding]:
    tag_bindings = []

    for tag in tags:
        tag_binding = TagBinding(
            tag_id=tag.id,
            target_id=target_id,
            tenant_id=tenant_id,
            created_by=user_id,
        )
        tag_bindings.append(tag_binding)

    db_session_with_containers.add_all(tag_bindings)
    db_session_with_containers.flush()

    return tag_bindings


def test_get_tags_success(db_session_with_containers: Session, current_user_stub: _CurrentUserStub) -> None:
    account, tenant = _create_account_with_tenant(db_session_with_containers)
    _set_current_user(current_user_stub, account, tenant)

    tags = _create_tags(
        db_session_with_containers, tenant_id=tenant.id, user_id=account.id, tag_type=TagType.KNOWLEDGE, count=3
    )

    dataset = _create_dataset(db_session_with_containers, tenant_id=tenant.id, user_id=account.id)
    _create_tag_bindings(
        db_session_with_containers, tags=tags[:2], target_id=dataset.id, tenant_id=tenant.id, user_id=account.id
    )

    result = TagService.get_tags(db_session_with_containers, TagType.KNOWLEDGE, tenant.id)

    assert result is not None
    assert len(result) == 3

    for tag_result in result:
        assert hasattr(tag_result, "id")
        assert hasattr(tag_result, "type")
        assert hasattr(tag_result, "name")
        assert hasattr(tag_result, "binding_count")
        assert tag_result.type == TagType.KNOWLEDGE

    tag_with_bindings = next((t for t in result if t.binding_count > 0), None)
    assert tag_with_bindings is not None
    assert tag_with_bindings.binding_count >= 1


def test_get_tags_with_keyword_filter(db_session_with_containers: Session, current_user_stub: _CurrentUserStub) -> None:
    account, tenant = _create_account_with_tenant(db_session_with_containers)
    _set_current_user(current_user_stub, account, tenant)

    tags = _create_tags(
        db_session_with_containers, tenant_id=tenant.id, user_id=account.id, tag_type=TagType.APP, count=3
    )

    tags[0].name = "python_development"
    tags[1].name = "machine_learning"
    tags[2].name = "web_development"
    db_session_with_containers.flush()

    result = TagService.get_tags(db_session_with_containers, TagType.APP, tenant.id, keyword="development")

    assert result is not None
    assert len(result) == 2

    for tag_result in result:
        assert "development" in tag_result.name.lower()

    result_no_match = TagService.get_tags(db_session_with_containers, TagType.APP, tenant.id, keyword="nonexistent")
    assert result_no_match == []


def test_get_tags_with_special_characters_in_keyword(
    db_session_with_containers: Session, current_user_stub: _CurrentUserStub
) -> None:
    account, tenant = _create_account_with_tenant(db_session_with_containers)
    _set_current_user(current_user_stub, account, tenant)

    tag_with_percent = Tag(
        name="50% discount",
        type=TagType.APP,
        tenant_id=tenant.id,
        created_by=account.id,
    )
    tag_with_percent.id = str(uuid.uuid4())
    db_session_with_containers.add(tag_with_percent)

    tag_with_underscore = Tag(
        name="test_data_tag",
        type=TagType.APP,
        tenant_id=tenant.id,
        created_by=account.id,
    )
    tag_with_underscore.id = str(uuid.uuid4())
    db_session_with_containers.add(tag_with_underscore)

    tag_with_backslash = Tag(
        name="path\\to\\tag",
        type=TagType.APP,
        tenant_id=tenant.id,
        created_by=account.id,
    )
    tag_with_backslash.id = str(uuid.uuid4())
    db_session_with_containers.add(tag_with_backslash)

    tag_no_match = Tag(
        name="100% different",
        type=TagType.APP,
        tenant_id=tenant.id,
        created_by=account.id,
    )
    tag_no_match.id = str(uuid.uuid4())
    db_session_with_containers.add(tag_no_match)

    db_session_with_containers.flush()

    result = TagService.get_tags(db_session_with_containers, TagType.APP, tenant.id, keyword="50%")
    assert len(result) == 1
    assert result[0].name == "50% discount"

    result = TagService.get_tags(db_session_with_containers, TagType.APP, tenant.id, keyword="test_data")
    assert len(result) == 1
    assert result[0].name == "test_data_tag"

    result = TagService.get_tags(db_session_with_containers, TagType.APP, tenant.id, keyword="path\\to\\tag")
    assert len(result) == 1
    assert result[0].name == "path\\to\\tag"

    result = TagService.get_tags(db_session_with_containers, TagType.APP, tenant.id, keyword="50%")
    assert len(result) == 1
    assert all("50%" in item.name for item in result)


def test_get_tags_empty_result(db_session_with_containers: Session, current_user_stub: _CurrentUserStub) -> None:
    account, tenant = _create_account_with_tenant(db_session_with_containers)
    _set_current_user(current_user_stub, account, tenant)

    result = TagService.get_tags(db_session_with_containers, TagType.KNOWLEDGE, tenant.id)

    assert result == []


def test_get_target_ids_by_tag_ids_success(
    db_session_with_containers: Session, current_user_stub: _CurrentUserStub
) -> None:
    account, tenant = _create_account_with_tenant(db_session_with_containers)
    _set_current_user(current_user_stub, account, tenant)

    tags = _create_tags(
        db_session_with_containers, tenant_id=tenant.id, user_id=account.id, tag_type=TagType.KNOWLEDGE, count=3
    )

    datasets = []
    for i in range(2):
        dataset = _create_dataset(db_session_with_containers, tenant_id=tenant.id, user_id=account.id)
        datasets.append(dataset)
        tags_to_bind = tags[:2] if i == 0 else tags[2:]
        _create_tag_bindings(
            db_session_with_containers, tags=tags_to_bind, target_id=dataset.id, tenant_id=tenant.id, user_id=account.id
        )

    tag_ids = [tag.id for tag in tags]
    result = TagService.get_target_ids_by_tag_ids(TagType.KNOWLEDGE, tenant.id, tag_ids, db_session_with_containers)

    assert result is not None
    assert len(result) == 3

    dataset_ids = [dataset.id for dataset in datasets]
    for target_id in result:
        assert target_id in dataset_ids

    first_dataset_count = result.count(datasets[0].id)
    assert first_dataset_count == 2

    second_dataset_count = result.count(datasets[1].id)
    assert second_dataset_count == 1


def test_get_target_ids_by_tag_ids_empty_tag_ids(
    db_session_with_containers: Session, current_user_stub: _CurrentUserStub
) -> None:
    account, tenant = _create_account_with_tenant(db_session_with_containers)
    _set_current_user(current_user_stub, account, tenant)

    result = TagService.get_target_ids_by_tag_ids(TagType.KNOWLEDGE, tenant.id, [], db_session_with_containers)

    assert result == []


def test_get_target_ids_by_tag_ids_empty_snippet_tag_ids(
    db_session_with_containers: Session, current_user_stub: _CurrentUserStub
) -> None:
    account, tenant = _create_account_with_tenant(db_session_with_containers)
    _set_current_user(current_user_stub, account, tenant)

    result = TagService.get_target_ids_by_tag_ids(TagType.SNIPPET, tenant.id, [], db_session_with_containers)

    assert result == []


def test_get_target_ids_by_tag_ids_match_all(
    db_session_with_containers: Session, current_user_stub: _CurrentUserStub
) -> None:
    account, tenant = _create_account_with_tenant(db_session_with_containers)
    _set_current_user(current_user_stub, account, tenant)
    tags = _create_tags(
        db_session_with_containers, tenant_id=tenant.id, user_id=account.id, tag_type=TagType.KNOWLEDGE, count=2
    )
    dataset_with_all_tags = _create_dataset(db_session_with_containers, tenant_id=tenant.id, user_id=account.id)
    dataset_with_one_tag = _create_dataset(db_session_with_containers, tenant_id=tenant.id, user_id=account.id)
    _create_tag_bindings(
        db_session_with_containers,
        tags=tags,
        target_id=dataset_with_all_tags.id,
        tenant_id=tenant.id,
        user_id=account.id,
    )
    _create_tag_bindings(
        db_session_with_containers,
        tags=tags[:1],
        target_id=dataset_with_one_tag.id,
        tenant_id=tenant.id,
        user_id=account.id,
    )

    tag_ids = [tag.id for tag in tags]
    result = TagService.get_target_ids_by_tag_ids(
        TagType.KNOWLEDGE, tenant.id, tag_ids, db_session_with_containers, match_all=True
    )

    assert result == [dataset_with_all_tags.id]

    missing_tag_result = TagService.get_target_ids_by_tag_ids(
        TagType.KNOWLEDGE,
        tenant.id,
        [tags[0].id, str(uuid.uuid4())],
        db_session_with_containers,
        match_all=True,
    )
    assert missing_tag_result == []


def test_get_target_ids_by_tag_ids_no_matching_tags(
    db_session_with_containers: Session, current_user_stub: _CurrentUserStub
) -> None:
    account, tenant = _create_account_with_tenant(db_session_with_containers)
    _set_current_user(current_user_stub, account, tenant)

    non_existent_tag_ids = [str(uuid.uuid4()), str(uuid.uuid4())]

    result = TagService.get_target_ids_by_tag_ids(
        TagType.KNOWLEDGE, tenant.id, non_existent_tag_ids, db_session_with_containers
    )

    assert result == []


def test_get_tag_by_tag_name_success(db_session_with_containers: Session, current_user_stub: _CurrentUserStub) -> None:
    account, tenant = _create_account_with_tenant(db_session_with_containers)
    _set_current_user(current_user_stub, account, tenant)

    tags = _create_tags(
        db_session_with_containers, tenant_id=tenant.id, user_id=account.id, tag_type=TagType.APP, count=2
    )

    tags[0].name = "python_tag"
    tags[1].name = "ml_tag"
    db_session_with_containers.flush()

    result = TagService.get_tag_by_tag_name(TagType.APP, tenant.id, "python_tag", db_session_with_containers)

    assert result is not None
    assert len(result) == 1
    assert result[0].name == "python_tag"
    assert result[0].type == TagType.APP
    assert result[0].tenant_id == tenant.id


def test_get_tag_by_tag_name_no_matches(
    db_session_with_containers: Session, current_user_stub: _CurrentUserStub
) -> None:
    account, tenant = _create_account_with_tenant(db_session_with_containers)
    _set_current_user(current_user_stub, account, tenant)

    result = TagService.get_tag_by_tag_name(TagType.KNOWLEDGE, tenant.id, "nonexistent_tag", db_session_with_containers)

    assert result == []


def test_get_tag_by_tag_name_empty_parameters(
    db_session_with_containers: Session, current_user_stub: _CurrentUserStub
) -> None:
    account, tenant = _create_account_with_tenant(db_session_with_containers)
    _set_current_user(current_user_stub, account, tenant)

    result_empty_type = TagService.get_tag_by_tag_name("", tenant.id, "test_tag", db_session_with_containers)
    result_empty_name = TagService.get_tag_by_tag_name(TagType.KNOWLEDGE, tenant.id, "", db_session_with_containers)

    assert result_empty_type is not None
    assert len(result_empty_type) == 0
    assert result_empty_name is not None
    assert len(result_empty_name) == 0


def test_get_tags_by_target_id_success(
    db_session_with_containers: Session, current_user_stub: _CurrentUserStub
) -> None:
    account, tenant = _create_account_with_tenant(db_session_with_containers)
    _set_current_user(current_user_stub, account, tenant)

    tags = _create_tags(
        db_session_with_containers, tenant_id=tenant.id, user_id=account.id, tag_type=TagType.APP, count=3
    )

    app = _create_app(db_session_with_containers, tenant_id=tenant.id, user_id=account.id)
    _create_tag_bindings(
        db_session_with_containers, tags=tags, target_id=app.id, tenant_id=tenant.id, user_id=account.id
    )

    result = TagService.get_tags_by_target_id(TagType.APP, tenant.id, app.id, db_session_with_containers)

    assert result is not None
    assert len(result) == 3

    for tag in result:
        assert tag.type == TagType.APP
        assert tag.tenant_id == tenant.id
        assert tag.id in [t.id for t in tags]


def test_get_tags_by_target_id_no_bindings(
    db_session_with_containers: Session, current_user_stub: _CurrentUserStub
) -> None:
    account, tenant = _create_account_with_tenant(db_session_with_containers)
    _set_current_user(current_user_stub, account, tenant)

    app = _create_app(db_session_with_containers, tenant_id=tenant.id, user_id=account.id)

    result = TagService.get_tags_by_target_id(TagType.APP, tenant.id, app.id, db_session_with_containers)

    assert result is not None
    assert len(result) == 0
    assert isinstance(result, list)


def test_save_tags_success(db_session_with_containers: Session, current_user_stub: _CurrentUserStub) -> None:
    account, tenant = _create_account_with_tenant(db_session_with_containers)
    _set_current_user(current_user_stub, account, tenant)

    tag_args = SaveTagPayload(name="test_tag_name", type=TagType.KNOWLEDGE)

    result = TagService.save_tags(tag_args, db_session_with_containers)

    assert result is not None
    assert result.name == "test_tag_name"
    assert result.type == TagType.KNOWLEDGE
    assert result.tenant_id == tenant.id
    assert result.created_by == account.id
    assert result.id is not None

    db_session_with_containers.refresh(result)
    assert result.id is not None

    saved_tag = db_session_with_containers.scalar(select(Tag).where(Tag.id == result.id))
    assert saved_tag is not None
    assert saved_tag.name == "test_tag_name"


def test_save_tags_duplicate_name_error(
    db_session_with_containers: Session, current_user_stub: _CurrentUserStub
) -> None:
    account, tenant = _create_account_with_tenant(db_session_with_containers)
    _set_current_user(current_user_stub, account, tenant)

    tag_args = SaveTagPayload(name="duplicate_tag", type=TagType.APP)
    TagService.save_tags(tag_args, db_session_with_containers)

    with pytest.raises(ValueError, match="Tag name already exists"):
        TagService.save_tags(tag_args, db_session_with_containers)


def test_update_tags_success(db_session_with_containers: Session, current_user_stub: _CurrentUserStub) -> None:
    account, tenant = _create_account_with_tenant(db_session_with_containers)
    _set_current_user(current_user_stub, account, tenant)

    tag_args = SaveTagPayload(name="original_name", type=TagType.KNOWLEDGE)
    tag = TagService.save_tags(tag_args, db_session_with_containers)

    update_args = UpdateTagPayload(name="updated_name")

    result = TagService.update_tags(update_args, tag.id, db_session_with_containers, tag_type=TagType.KNOWLEDGE)

    assert result is not None
    assert result.name == "updated_name"
    assert result.type == TagType.KNOWLEDGE
    assert result.id == tag.id

    db_session_with_containers.refresh(result)
    assert result.name == "updated_name"

    updated_tag = db_session_with_containers.scalar(select(Tag).where(Tag.id == tag.id))
    assert updated_tag is not None
    assert updated_tag.name == "updated_name"


def test_update_tags_not_found_error(db_session_with_containers: Session, current_user_stub: _CurrentUserStub) -> None:
    account, tenant = _create_account_with_tenant(db_session_with_containers)
    _set_current_user(current_user_stub, account, tenant)

    non_existent_tag_id = str(uuid.uuid4())

    update_args = UpdateTagPayload(name="updated_name")

    with pytest.raises(NotFound, match="Tag not found"):
        TagService.update_tags(update_args, non_existent_tag_id, db_session_with_containers)


def test_update_tags_duplicate_name_error(
    db_session_with_containers: Session, current_user_stub: _CurrentUserStub
) -> None:
    account, tenant = _create_account_with_tenant(db_session_with_containers)
    _set_current_user(current_user_stub, account, tenant)

    tag1_args = SaveTagPayload(name="first_tag", type=TagType.APP)
    TagService.save_tags(tag1_args, db_session_with_containers)

    tag2_args = SaveTagPayload(name="second_tag", type=TagType.APP)
    tag2 = TagService.save_tags(tag2_args, db_session_with_containers)

    update_args = UpdateTagPayload(name="first_tag")

    with pytest.raises(ValueError, match="Tag name already exists"):
        TagService.update_tags(update_args, tag2.id, db_session_with_containers)


def test_update_tags_requires_current_tenant_and_type(
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


def test_get_tag_binding_count_success(
    db_session_with_containers: Session, current_user_stub: _CurrentUserStub
) -> None:
    account, tenant = _create_account_with_tenant(db_session_with_containers)
    _set_current_user(current_user_stub, account, tenant)

    tags = _create_tags(
        db_session_with_containers, tenant_id=tenant.id, user_id=account.id, tag_type=TagType.KNOWLEDGE, count=2
    )

    dataset = _create_dataset(db_session_with_containers, tenant_id=tenant.id, user_id=account.id)
    _create_tag_bindings(
        db_session_with_containers, tags=[tags[0]], target_id=dataset.id, tenant_id=tenant.id, user_id=account.id
    )

    result_tag_with_bindings = TagService.get_tag_binding_count(
        tags[0].id, db_session_with_containers, tag_type=TagType.KNOWLEDGE
    )
    result_tag_without_bindings = TagService.get_tag_binding_count(
        tags[1].id, db_session_with_containers, tag_type=TagType.KNOWLEDGE
    )

    assert result_tag_with_bindings == 1
    assert result_tag_without_bindings == 0


def test_get_tag_binding_count_scopes_to_current_tenant_and_type(
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


def test_get_tag_binding_count_non_existent_tag(
    db_session_with_containers: Session, current_user_stub: _CurrentUserStub
) -> None:
    account, tenant = _create_account_with_tenant(db_session_with_containers)
    _set_current_user(current_user_stub, account, tenant)

    non_existent_tag_id = str(uuid.uuid4())

    result = TagService.get_tag_binding_count(non_existent_tag_id, db_session_with_containers)

    assert result == 0


def test_delete_tag_success(db_session_with_containers: Session, current_user_stub: _CurrentUserStub) -> None:
    account, tenant = _create_account_with_tenant(db_session_with_containers)
    _set_current_user(current_user_stub, account, tenant)

    tag = _create_tags(
        db_session_with_containers, tenant_id=tenant.id, user_id=account.id, tag_type=TagType.APP, count=1
    )[0]

    app = _create_app(db_session_with_containers, tenant_id=tenant.id, user_id=account.id)
    _create_tag_bindings(
        db_session_with_containers, tags=[tag], target_id=app.id, tenant_id=tenant.id, user_id=account.id
    )

    tag_before = db_session_with_containers.scalar(select(Tag).where(Tag.id == tag.id))
    assert tag_before is not None

    binding_before = db_session_with_containers.scalar(select(TagBinding).where(TagBinding.tag_id == tag.id))
    assert binding_before is not None

    TagService.delete_tag(tag.id, db_session_with_containers, tag_type=TagType.APP)

    tag_after = db_session_with_containers.scalar(select(Tag).where(Tag.id == tag.id))
    assert tag_after is None

    binding_after = db_session_with_containers.scalar(select(TagBinding).where(TagBinding.tag_id == tag.id))
    assert binding_after is None


def test_delete_tag_not_found_error(db_session_with_containers: Session, current_user_stub: _CurrentUserStub) -> None:
    account, tenant = _create_account_with_tenant(db_session_with_containers)
    _set_current_user(current_user_stub, account, tenant)

    non_existent_tag_id = str(uuid.uuid4())

    with pytest.raises(NotFound, match="Tag not found"):
        TagService.delete_tag(non_existent_tag_id, db_session_with_containers)


def test_delete_tag_requires_current_tenant_and_type(
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


def test_save_tag_binding_success(db_session_with_containers: Session, current_user_stub: _CurrentUserStub) -> None:
    account, tenant = _create_account_with_tenant(db_session_with_containers)
    _set_current_user(current_user_stub, account, tenant)

    tags = _create_tags(
        db_session_with_containers, tenant_id=tenant.id, user_id=account.id, tag_type=TagType.KNOWLEDGE, count=2
    )

    dataset = _create_dataset(db_session_with_containers, tenant_id=tenant.id, user_id=account.id)

    binding_payload = TagBindingCreatePayload(
        type=TagType.KNOWLEDGE, target_id=dataset.id, tag_ids=[tag.id for tag in tags]
    )
    TagService.save_tag_binding(binding_payload, db_session_with_containers)

    for tag in tags:
        binding = db_session_with_containers.scalar(
            select(TagBinding).where(TagBinding.tag_id == tag.id, TagBinding.target_id == dataset.id)
        )
        assert binding is not None
        assert binding.tenant_id == tenant.id
        assert binding.created_by == account.id


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


def test_save_tag_binding_duplicate_handling(
    db_session_with_containers: Session, current_user_stub: _CurrentUserStub
) -> None:
    account, tenant = _create_account_with_tenant(db_session_with_containers)
    _set_current_user(current_user_stub, account, tenant)

    tag = _create_tags(
        db_session_with_containers, tenant_id=tenant.id, user_id=account.id, tag_type=TagType.APP, count=1
    )[0]

    app = _create_app(db_session_with_containers, tenant_id=tenant.id, user_id=account.id)

    binding_payload = TagBindingCreatePayload(type=TagType.APP, target_id=app.id, tag_ids=[tag.id])
    TagService.save_tag_binding(binding_payload, db_session_with_containers)

    TagService.save_tag_binding(binding_payload, db_session_with_containers)

    bindings = db_session_with_containers.scalars(
        select(TagBinding).where(TagBinding.tag_id == tag.id, TagBinding.target_id == app.id)
    ).all()
    assert len(bindings) == 1


def test_delete_tag_binding_success(db_session_with_containers: Session, current_user_stub: _CurrentUserStub) -> None:
    account, tenant = _create_account_with_tenant(db_session_with_containers)
    _set_current_user(current_user_stub, account, tenant)

    tags = _create_tags(
        db_session_with_containers, tenant_id=tenant.id, user_id=account.id, tag_type=TagType.KNOWLEDGE, count=2
    )

    dataset = _create_dataset(db_session_with_containers, tenant_id=tenant.id, user_id=account.id)
    _create_tag_bindings(
        db_session_with_containers, tags=tags, target_id=dataset.id, tenant_id=tenant.id, user_id=account.id
    )

    bindings_before = db_session_with_containers.scalars(
        select(TagBinding).where(TagBinding.tag_id.in_([tag.id for tag in tags]), TagBinding.target_id == dataset.id)
    ).all()
    assert len(bindings_before) == 2

    delete_payload = TagBindingDeletePayload(
        type=TagType.KNOWLEDGE, target_id=dataset.id, tag_ids=[tag.id for tag in tags]
    )
    TagService.delete_tag_binding(delete_payload, db_session_with_containers)

    bindings_after = db_session_with_containers.scalars(
        select(TagBinding).where(TagBinding.tag_id.in_([tag.id for tag in tags]), TagBinding.target_id == dataset.id)
    ).all()
    assert bindings_after == []


def test_delete_tag_binding_preserves_wrong_type_and_other_tenant_snippet_bindings(
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


def test_delete_tag_binding_succeeds_when_no_snippet_rows_match(
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


def test_delete_tag_binding_non_existent_binding(
    db_session_with_containers: Session, current_user_stub: _CurrentUserStub
) -> None:
    account, tenant = _create_account_with_tenant(db_session_with_containers)
    _set_current_user(current_user_stub, account, tenant)

    tag = _create_tags(
        db_session_with_containers, tenant_id=tenant.id, user_id=account.id, tag_type=TagType.APP, count=1
    )[0]
    app = _create_app(db_session_with_containers, tenant_id=tenant.id, user_id=account.id)

    delete_payload = TagBindingDeletePayload(type=TagType.APP, target_id=app.id, tag_ids=[tag.id])
    TagService.delete_tag_binding(delete_payload, db_session_with_containers)

    bindings = db_session_with_containers.scalars(
        select(TagBinding).where(TagBinding.tag_id == tag.id, TagBinding.target_id == app.id)
    ).all()
    assert bindings == []


def test_check_target_exists_knowledge_success(
    db_session_with_containers: Session, current_user_stub: _CurrentUserStub
) -> None:
    account, tenant = _create_account_with_tenant(db_session_with_containers)
    _set_current_user(current_user_stub, account, tenant)

    dataset = _create_dataset(db_session_with_containers, tenant_id=tenant.id, user_id=account.id)

    TagService.check_target_exists(TagType.KNOWLEDGE, dataset.id, db_session_with_containers)


def test_check_target_exists_knowledge_not_found(
    db_session_with_containers: Session, current_user_stub: _CurrentUserStub
) -> None:
    account, tenant = _create_account_with_tenant(db_session_with_containers)
    _set_current_user(current_user_stub, account, tenant)

    non_existent_dataset_id = str(uuid.uuid4())

    with pytest.raises(NotFound, match="Dataset not found"):
        TagService.check_target_exists(TagType.KNOWLEDGE, non_existent_dataset_id, db_session_with_containers)


def test_check_target_exists_app_success(
    db_session_with_containers: Session, current_user_stub: _CurrentUserStub
) -> None:
    account, tenant = _create_account_with_tenant(db_session_with_containers)
    _set_current_user(current_user_stub, account, tenant)

    app = _create_app(db_session_with_containers, tenant_id=tenant.id, user_id=account.id)

    TagService.check_target_exists(TagType.APP, app.id, db_session_with_containers)


def test_check_target_exists_app_not_found(
    db_session_with_containers: Session, current_user_stub: _CurrentUserStub
) -> None:
    account, tenant = _create_account_with_tenant(db_session_with_containers)
    _set_current_user(current_user_stub, account, tenant)

    non_existent_app_id = str(uuid.uuid4())

    with pytest.raises(NotFound, match="App not found"):
        TagService.check_target_exists(TagType.APP, non_existent_app_id, db_session_with_containers)


def test_check_target_exists_snippet_success(
    db_session_with_containers: Session, current_user_stub: _CurrentUserStub
) -> None:
    account, tenant = _create_account_with_tenant(db_session_with_containers)
    _set_current_user(current_user_stub, account, tenant)

    snippet = _create_snippet(db_session_with_containers, tenant_id=tenant.id, user_id=account.id)

    TagService.check_target_exists(TagType.SNIPPET, snippet.id, db_session_with_containers)


def test_check_target_exists_snippet_not_found_for_missing_id(
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


def test_check_target_exists_invalid_type(db_session_with_containers: Session) -> None:
    with pytest.raises(NotFound, match="Invalid binding type"):
        TagService.check_target_exists("invalid_type", "target-id", db_session_with_containers)
