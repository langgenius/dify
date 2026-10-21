"""Integration coverage for the tag application service and repository path."""

import uuid
from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from typing import TypedDict

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from core.db.session_factory import session_factory
from core.rag.index_processor.constant.index_type import IndexTechniqueType
from extensions.ext_application_services import application_services
from machinery.context import RequestContext
from models import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole, TenantStatus
from models.dataset import Dataset
from models.enums import DataSourceType, TagType
from models.model import Tag, TagBinding
from models.skill import Skill
from repositories.tag_repository import TagRepository
from services.skill_management_service import SkillManagementService, SkillMetadataPayload
from services.tag_application_service import CreateTagInput, TagBindingInput, TagNameConflictError


class SkillMetadataResult(TypedDict):
    tags: list[str]


def _create_account_with_tenant(session: Session) -> tuple[Account, Tenant]:
    suffix = uuid.uuid4().hex
    account = Account(
        email=f"tag-service-{suffix}@example.com",
        name=f"Tag Service Account {suffix}",
        interface_language="en-US",
        status=AccountStatus.ACTIVE,
    )
    tenant = Tenant(name=f"Tag Service Tenant {suffix}", status=TenantStatus.NORMAL)
    session.add_all([account, tenant])
    session.flush()
    session.add(
        TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role=TenantAccountRole.OWNER,
            current=True,
        )
    )
    session.flush()
    return account, tenant


def _create_dataset(session: Session, *, tenant_id: str, user_id: str) -> Dataset:
    dataset = Dataset(
        name=f"Tag Service Dataset {uuid.uuid4().hex}",
        description="Tag service test dataset",
        provider="vendor",
        permission="only_me",
        data_source_type=DataSourceType.UPLOAD_FILE,
        indexing_technique=IndexTechniqueType.HIGH_QUALITY,
        tenant_id=tenant_id,
        created_by=user_id,
    )
    session.add(dataset)
    session.flush()
    return dataset


def _create_tags(
    session: Session,
    *,
    tenant_id: str,
    user_id: str,
    tag_type: TagType,
    count: int,
) -> list[Tag]:
    tags: list[Tag] = []
    for index in range(count):
        name = f"tag-{tag_type.value}-{index}-{uuid.uuid4().hex}"
        tags.append(
            Tag(
                name=name,
                normalized_name=name.casefold() if tag_type == TagType.SKILL else None,
                type=tag_type,
                tenant_id=tenant_id,
                created_by=user_id,
            )
        )
    session.add_all(tags)
    session.flush()
    return tags


def _create_tag_bindings(
    session: Session,
    *,
    tags: Sequence[Tag],
    target_id: str,
    tenant_id: str,
    user_id: str,
) -> None:
    session.add_all(
        TagBinding(tag_id=tag.id, target_id=target_id, tenant_id=tenant_id, created_by=user_id) for tag in tags
    )
    session.flush()


def test_concurrent_tag_creation_returns_one_conflict(db_session_with_containers: Session) -> None:
    account, tenant = _create_account_with_tenant(db_session_with_containers)
    db_session_with_containers.commit()
    context = RequestContext("tag-concurrency", None, account.id, tenant.id)
    service = application_services().tags
    ready = Barrier(2)
    name = f"concurrent-{uuid.uuid4().hex}"

    def create_tag() -> str:
        ready.wait()
        try:
            service.create_tag(context, CreateTagInput(name=name, type="knowledge"))
        except TagNameConflictError:
            return "conflict"
        return "created"

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = [future.result() for future in (executor.submit(create_tag), executor.submit(create_tag))]

    assert sorted(results) == ["conflict", "created"]
    db_session_with_containers.expire_all()
    assert (
        db_session_with_containers.scalar(
            select(func.count(Tag.id)).where(
                Tag.tenant_id == tenant.id,
                Tag.type == TagType.KNOWLEDGE,
                Tag.name == name,
            )
        )
        == 1
    )


def test_concurrent_identical_tag_bindings_are_idempotent(db_session_with_containers: Session) -> None:
    account, tenant = _create_account_with_tenant(db_session_with_containers)
    dataset = _create_dataset(db_session_with_containers, tenant_id=tenant.id, user_id=account.id)
    tag = _create_tags(
        db_session_with_containers,
        tenant_id=tenant.id,
        user_id=account.id,
        tag_type=TagType.KNOWLEDGE,
        count=1,
    )[0]
    account_id = account.id
    tenant_id = tenant.id
    dataset_id = dataset.id
    tag_id = tag.id
    db_session_with_containers.commit()
    context = RequestContext("tag-binding-concurrency", None, account_id, tenant_id)
    service = application_services().tags
    ready = Barrier(2)

    def create_binding() -> None:
        ready.wait()
        service.create_bindings(
            context,
            TagBindingInput(tag_ids=(tag_id,), target_id=dataset_id, type="knowledge"),
        )

    with ThreadPoolExecutor(max_workers=2) as executor:
        for future in (executor.submit(create_binding), executor.submit(create_binding)):
            future.result()

    db_session_with_containers.expire_all()
    assert (
        db_session_with_containers.scalar(
            select(func.count(TagBinding.id)).where(
                TagBinding.tenant_id == tenant_id,
                TagBinding.tag_id == tag_id,
                TagBinding.target_id == dataset_id,
            )
        )
        == 1
    )


def test_concurrent_skill_tag_creation_reuses_casefolded_winner(db_session_with_containers: Session) -> None:
    account, tenant = _create_account_with_tenant(db_session_with_containers)
    skills = [
        Skill(
            tenant_id=tenant.id,
            name=f"skill-{index}",
            display_name=f"Skill {index}",
            created_by=account.id,
            updated_by=account.id,
        )
        for index in range(2)
    ]
    db_session_with_containers.add_all(skills)
    db_session_with_containers.flush()
    tenant_id = tenant.id
    account_id = account.id
    skill_ids = tuple(skill.id for skill in skills)
    db_session_with_containers.commit()
    ready = Barrier(2)

    def add_tag(skill_id: str, tag_name: str) -> SkillMetadataResult:
        ready.wait()
        response = SkillManagementService(
            skill_tags=TagRepository(session_factory.get_session_maker()),
        ).update_metadata(
            tenant_id=tenant_id,
            user_id=account_id,
            skill_id=skill_id,
            payload=SkillMetadataPayload(tags=[tag_name]),
        )
        raw_tags: object = response.get("tags")
        assert isinstance(raw_tags, list)
        tags: list[str] = []
        for tag in raw_tags:
            assert isinstance(tag, str)
            tags.append(tag)
        return {"tags": tags}

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = (
            executor.submit(add_tag, skill_ids[0], "Shared"),
            executor.submit(add_tag, skill_ids[1], "shared"),
        )
        results = [future.result() for future in futures]

    assert [result["tags"][0].casefold() for result in results] == ["shared", "shared"]
    db_session_with_containers.expire_all()
    tag = db_session_with_containers.scalar(
        select(Tag).where(Tag.tenant_id == tenant_id, Tag.type == TagType.SKILL, Tag.normalized_name == "shared")
    )
    assert tag is not None
    assert (
        db_session_with_containers.scalar(
            select(func.count(TagBinding.id)).where(
                TagBinding.tenant_id == tenant_id,
                TagBinding.tag_id == tag.id,
                TagBinding.target_id.in_(skill_ids),
            )
        )
        == 2
    )


def test_concurrent_skill_tag_batches_use_one_lock_order(db_session_with_containers: Session) -> None:
    account, tenant = _create_account_with_tenant(db_session_with_containers)
    skills = [
        Skill(
            tenant_id=tenant.id,
            name=f"skill-order-{index}",
            display_name=f"Skill order {index}",
            created_by=account.id,
            updated_by=account.id,
        )
        for index in range(2)
    ]
    db_session_with_containers.add_all(skills)
    db_session_with_containers.flush()
    tenant_id = tenant.id
    account_id = account.id
    skill_ids = tuple(skill.id for skill in skills)
    db_session_with_containers.commit()
    ready = Barrier(2)

    def replace_tags(skill_id: str, names: list[str]) -> None:
        ready.wait()
        SkillManagementService(
            skill_tags=TagRepository(session_factory.get_session_maker()),
        ).update_metadata(
            tenant_id=tenant_id,
            user_id=account_id,
            skill_id=skill_id,
            payload=SkillMetadataPayload(tags=names),
        )

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = (
            executor.submit(replace_tags, skill_ids[0], ["Alpha", "Beta"]),
            executor.submit(replace_tags, skill_ids[1], ["Beta", "Alpha"]),
        )
        for future in futures:
            future.result()

    db_session_with_containers.expire_all()
    assert set(
        db_session_with_containers.scalars(
            select(Tag.normalized_name).where(Tag.tenant_id == tenant_id, Tag.type == TagType.SKILL)
        )
    ) == {"alpha", "beta"}
    assert (
        db_session_with_containers.scalar(
            select(func.count(TagBinding.id)).where(
                TagBinding.tenant_id == tenant_id,
                TagBinding.target_id.in_(skill_ids),
            )
        )
        == 4
    )


def test_find_target_ids_returns_one_row_per_matching_binding(db_session_with_containers: Session) -> None:
    account, tenant = _create_account_with_tenant(db_session_with_containers)
    tags = _create_tags(
        db_session_with_containers,
        tenant_id=tenant.id,
        user_id=account.id,
        tag_type=TagType.KNOWLEDGE,
        count=3,
    )
    datasets = [_create_dataset(db_session_with_containers, tenant_id=tenant.id, user_id=account.id) for _ in range(2)]
    _create_tag_bindings(
        db_session_with_containers,
        tags=tags[:2],
        target_id=datasets[0].id,
        tenant_id=tenant.id,
        user_id=account.id,
    )
    _create_tag_bindings(
        db_session_with_containers,
        tags=tags[2:],
        target_id=datasets[1].id,
        tenant_id=tenant.id,
        user_id=account.id,
    )
    db_session_with_containers.commit()

    result = application_services().tags.find_target_ids(
        tag_type=TagType.KNOWLEDGE,
        tenant_id=tenant.id,
        tag_ids=[tag.id for tag in tags],
    )

    assert result.count(datasets[0].id) == 2
    assert result.count(datasets[1].id) == 1


def test_find_target_ids_returns_empty_for_empty_tag_ids(db_session_with_containers: Session) -> None:
    _, tenant = _create_account_with_tenant(db_session_with_containers)
    db_session_with_containers.commit()

    assert (
        application_services().tags.find_target_ids(
            tag_type=TagType.KNOWLEDGE,
            tenant_id=tenant.id,
            tag_ids=[],
        )
        == []
    )


def test_find_target_ids_match_all_requires_every_requested_tag(db_session_with_containers: Session) -> None:
    account, tenant = _create_account_with_tenant(db_session_with_containers)
    tags = _create_tags(
        db_session_with_containers,
        tenant_id=tenant.id,
        user_id=account.id,
        tag_type=TagType.KNOWLEDGE,
        count=2,
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
    db_session_with_containers.commit()

    service = application_services().tags
    assert service.find_target_ids(
        tag_type=TagType.KNOWLEDGE,
        tenant_id=tenant.id,
        tag_ids=[tag.id for tag in tags],
        match_all=True,
    ) == [dataset_with_all_tags.id]
    assert (
        service.find_target_ids(
            tag_type=TagType.KNOWLEDGE,
            tenant_id=tenant.id,
            tag_ids=[tags[0].id, str(uuid.uuid4())],
            match_all=True,
        )
        == []
    )


def test_find_target_ids_returns_empty_for_unknown_tags(db_session_with_containers: Session) -> None:
    _, tenant = _create_account_with_tenant(db_session_with_containers)
    db_session_with_containers.commit()

    assert (
        application_services().tags.find_target_ids(
            tag_type=TagType.KNOWLEDGE,
            tenant_id=tenant.id,
            tag_ids=[str(uuid.uuid4()), str(uuid.uuid4())],
        )
        == []
    )
