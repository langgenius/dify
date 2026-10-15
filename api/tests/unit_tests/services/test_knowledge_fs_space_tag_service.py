from dataclasses import dataclass, field

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

from models.enums import TagType
from models.knowledge_fs import (
    KnowledgeFSControlSpace,
    KnowledgeFSControlSpaceState,
    KnowledgeFSControlSpaceVisibility,
    KnowledgeFSSpaceTagBinding,
)
from models.model import Tag
from services.knowledge_fs.product_operations import KnowledgeFSProductPermission
from services.knowledge_fs.space_tag_service import (
    KnowledgeFSSpaceTagService,
    KnowledgeFSSpaceTagValidationError,
)


def _space() -> KnowledgeFSControlSpace:
    space = KnowledgeFSControlSpace(
        tenant_id="tenant-1",
        owner_account_id="account-1",
        provisioning_key="space-1",
        knowledge_space_id="remote-1",
        state=KnowledgeFSControlSpaceState.ACTIVE,
        visibility=KnowledgeFSControlSpaceVisibility.ONLY_ME,
    )
    space.id = "control-1"
    return space


def _tag(tag_id: str, *, tenant_id: str = "tenant-1", tag_type: TagType = TagType.KNOWLEDGE) -> Tag:
    tag = Tag(name=tag_id, type=tag_type, tenant_id=tenant_id, created_by="account-1")
    tag.id = tag_id
    return tag


@dataclass
class _RecordingAuthorization:
    permissions: list[KnowledgeFSProductPermission] = field(default_factory=list)

    def authorize_control_space_in_session(
        self,
        *,
        session: Session,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        permission: KnowledgeFSProductPermission,
        require_active: bool = False,
    ) -> object:
        assert session.is_active
        assert (tenant_id, account_id, control_space_id) == ("tenant-1", "account-1", "control-1")
        assert require_active is False
        self.permissions.append(permission)
        return object()


def _service(factory: sessionmaker[Session]) -> tuple[KnowledgeFSSpaceTagService, _RecordingAuthorization]:
    product = _RecordingAuthorization()
    return KnowledgeFSSpaceTagService(factory, product=product), product


def test_replace_tags_is_idempotent_and_lists_final_set(sqlite_session_factory: sessionmaker[Session]) -> None:
    with sqlite_session_factory.begin() as session:
        session.add_all([_space(), _tag("tag-1"), _tag("tag-2")])
    service, product = _service(sqlite_session_factory)

    first = service.replace_tags(
        tenant_id="tenant-1",
        account_id="account-1",
        control_space_id="control-1",
        tag_ids=["tag-2", "tag-1", "tag-2"],
    )
    second = service.replace_tags(
        tenant_id="tenant-1",
        account_id="account-1",
        control_space_id="control-1",
        tag_ids=["tag-1"],
    )

    assert [tag.id for tag in first] == ["tag-2", "tag-1"]
    assert [tag.id for tag in second] == ["tag-1"]
    assert [
        tag.id for tag in service.list_tags(tenant_id="tenant-1", account_id="account-1", control_space_id="control-1")
    ] == ["tag-1"]
    with sqlite_session_factory() as session:
        assert session.scalar(sa.select(sa.func.count(KnowledgeFSSpaceTagBinding.id))) == 1
    assert product.permissions[0] is KnowledgeFSProductPermission.EDIT


@pytest.mark.parametrize(
    "invalid_tag",
    [_tag("cross-tenant", tenant_id="tenant-2"), _tag("app-tag", tag_type=TagType.APP)],
)
def test_replace_tags_rejects_cross_tenant_and_non_knowledge_tags_atomically(
    sqlite_session_factory: sessionmaker[Session], invalid_tag: Tag
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add_all([_space(), _tag("valid-tag"), invalid_tag])
    service, _ = _service(sqlite_session_factory)

    with pytest.raises(KnowledgeFSSpaceTagValidationError):
        service.replace_tags(
            tenant_id="tenant-1",
            account_id="account-1",
            control_space_id="control-1",
            tag_ids=["valid-tag", invalid_tag.id],
        )

    with sqlite_session_factory() as session:
        assert session.scalar(sa.select(sa.func.count(KnowledgeFSSpaceTagBinding.id))) == 0
