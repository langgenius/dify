from __future__ import annotations

from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.dataset import Dataset
from models.model import App, AppMode, IconType
from models.resource_access_token import (
    ResourceAccessToken,
    ResourceAccessTokenRelation,
    ResourceAccessTokenResourceType,
)
from services.resource_access_token_service import (
    ResourceAccessTokenResource,
    ResourceAccessTokenService,
)


def _workspace(session: Session) -> tuple[Tenant, Account]:
    tenant = Tenant(name="Workspace")
    tenant.id = str(uuid4())
    owner = Account(name="Owner", email=f"owner-{tenant.id}@example.com")
    owner.id = str(uuid4())
    session.add_all(
        [
            tenant,
            owner,
            TenantAccountJoin(tenant_id=tenant.id, account_id=owner.id, role=TenantAccountRole.OWNER),
        ]
    )
    session.commit()
    return tenant, owner


def _app(session: Session, tenant_id: str) -> App:
    app = App(
        id=str(uuid4()),
        tenant_id=tenant_id,
        name="Customer FAQ Bot",
        mode=AppMode.CHAT,
        icon_type=IconType.EMOJI,
        icon="🤖",
        icon_background="#ffffff",
        enable_site=False,
        enable_api=True,
    )
    session.add(app)
    session.commit()
    return app


def _dataset(session: Session, tenant_id: str, created_by: str) -> Dataset:
    dataset = Dataset(
        id=str(uuid4()),
        tenant_id=tenant_id,
        name="Customer Support",
        created_by=created_by,
        enable_api=True,
    )
    session.add(dataset)
    session.commit()
    return dataset


@pytest.mark.parametrize(
    "sqlite_session",
    [(Tenant, Account, TenantAccountJoin, App, Dataset, ResourceAccessToken, ResourceAccessTokenRelation)],
    indirect=True,
)
def test_create_token_with_mixed_resources_returns_expanded_rows(sqlite_session: Session) -> None:
    tenant, owner = _workspace(sqlite_session)
    app = _app(sqlite_session, tenant.id)
    dataset = _dataset(sqlite_session, tenant.id, owner.id)

    result = ResourceAccessTokenService.create(
        tenant_id=tenant.id,
        created_by=owner.id,
        name="Production integration",
        resources=[
            ResourceAccessTokenResource(type=ResourceAccessTokenResourceType.APP, id=app.id),
            ResourceAccessTokenResource(type=ResourceAccessTokenResourceType.KNOWLEDGE, id=dataset.id),
        ],
        session=sqlite_session,
    )

    assert result.token.startswith("sk-")
    assert len(result.rows) == 2
    assert {row.resource_type for row in result.rows} == {
        ResourceAccessTokenResourceType.APP,
        ResourceAccessTokenResourceType.KNOWLEDGE,
    }
    assert {row.resource_id for row in result.rows} == {app.id, dataset.id}
    assert {row.name for row in result.rows} == {"Production integration"}


@pytest.mark.parametrize(
    "sqlite_session",
    [(Tenant, Account, TenantAccountJoin, App, Dataset, ResourceAccessToken, ResourceAccessTokenRelation)],
    indirect=True,
)
def test_list_paginates_and_counts_tokens_not_relations(sqlite_session: Session) -> None:
    tenant, owner = _workspace(sqlite_session)
    first_app = _app(sqlite_session, tenant.id)
    second_app = _app(sqlite_session, tenant.id)
    dataset = _dataset(sqlite_session, tenant.id, owner.id)
    ResourceAccessTokenService.create(
        tenant_id=tenant.id,
        created_by=owner.id,
        name="First integration",
        resources=[ResourceAccessTokenResource(type=ResourceAccessTokenResourceType.APP, id=first_app.id)],
        session=sqlite_session,
    )
    newest = ResourceAccessTokenService.create(
        tenant_id=tenant.id,
        created_by=owner.id,
        name="Newest integration",
        resources=[
            ResourceAccessTokenResource(type=ResourceAccessTokenResourceType.APP, id=second_app.id),
            ResourceAccessTokenResource(type=ResourceAccessTokenResourceType.KNOWLEDGE, id=dataset.id),
        ],
        session=sqlite_session,
    )

    rows = ResourceAccessTokenService.list_rows(tenant_id=tenant.id, page=1, limit=1, session=sqlite_session)

    assert ResourceAccessTokenService.count_rows(tenant_id=tenant.id, session=sqlite_session) == 2
    assert {row.token_id for row in rows} == {newest.token_id}
    assert len(rows) == 2


@pytest.mark.parametrize(
    "sqlite_session",
    [(Tenant, Account, TenantAccountJoin, App, ResourceAccessToken, ResourceAccessTokenRelation)],
    indirect=True,
)
def test_update_changes_all_expanded_rows(sqlite_session: Session) -> None:
    tenant, owner = _workspace(sqlite_session)
    first_app = _app(sqlite_session, tenant.id)
    second_app = _app(sqlite_session, tenant.id)
    created = ResourceAccessTokenService.create(
        tenant_id=tenant.id,
        created_by=owner.id,
        name="Production integration",
        resources=[
            ResourceAccessTokenResource(type=ResourceAccessTokenResourceType.APP, id=first_app.id),
            ResourceAccessTokenResource(type=ResourceAccessTokenResourceType.APP, id=second_app.id),
        ],
        session=sqlite_session,
    )

    rows = ResourceAccessTokenService.update(
        tenant_id=tenant.id,
        token_id=created.token_id,
        name="Internal integration",
        session=sqlite_session,
    )

    assert {row.name for row in rows} == {"Internal integration"}


@pytest.mark.parametrize(
    "sqlite_session",
    [(Tenant, Account, TenantAccountJoin, App, Dataset, ResourceAccessToken, ResourceAccessTokenRelation)],
    indirect=True,
)
def test_update_replaces_resources(sqlite_session: Session) -> None:
    tenant, owner = _workspace(sqlite_session)
    first_app = _app(sqlite_session, tenant.id)
    second_app = _app(sqlite_session, tenant.id)
    dataset = _dataset(sqlite_session, tenant.id, owner.id)
    created = ResourceAccessTokenService.create(
        tenant_id=tenant.id,
        created_by=owner.id,
        name="Production integration",
        resources=[
            ResourceAccessTokenResource(type=ResourceAccessTokenResourceType.APP, id=first_app.id),
            ResourceAccessTokenResource(type=ResourceAccessTokenResourceType.KNOWLEDGE, id=dataset.id),
        ],
        session=sqlite_session,
    )

    rows = ResourceAccessTokenService.update(
        tenant_id=tenant.id,
        token_id=created.token_id,
        name="Internal integration",
        resources=[ResourceAccessTokenResource(type=ResourceAccessTokenResourceType.APP, id=second_app.id)],
        session=sqlite_session,
    )

    assert {row.name for row in rows} == {"Internal integration"}
    assert [(row.resource_type, row.resource_id) for row in rows] == [
        (ResourceAccessTokenResourceType.APP, second_app.id)
    ]
    assert sqlite_session.scalars(select(ResourceAccessTokenRelation)).one().app_id == second_app.id


@pytest.mark.parametrize(
    "sqlite_session",
    [(Tenant, Account, TenantAccountJoin, App, Dataset, ResourceAccessToken, ResourceAccessTokenRelation)],
    indirect=True,
)
def test_delete_relation_removes_token_and_all_relations(sqlite_session: Session) -> None:
    tenant, owner = _workspace(sqlite_session)
    app = _app(sqlite_session, tenant.id)
    dataset = _dataset(sqlite_session, tenant.id, owner.id)
    created = ResourceAccessTokenService.create(
        tenant_id=tenant.id,
        created_by=owner.id,
        name="Production integration",
        resources=[
            ResourceAccessTokenResource(type=ResourceAccessTokenResourceType.APP, id=app.id),
            ResourceAccessTokenResource(type=ResourceAccessTokenResourceType.KNOWLEDGE, id=dataset.id),
        ],
        session=sqlite_session,
    )

    ResourceAccessTokenService.delete_relation(
        tenant_id=tenant.id,
        token_id=created.token_id,
        relation_id=created.rows[0].relation_id,
        session=sqlite_session,
    )

    assert sqlite_session.scalar(select(ResourceAccessToken)) is None
    assert sqlite_session.scalar(select(ResourceAccessTokenRelation)) is None
