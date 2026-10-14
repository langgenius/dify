from __future__ import annotations

from functools import partial
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from extensions.application_services.resource_access_token import build_resource_access_token_service
from machinery.context import RequestContext
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.dataset import Dataset
from models.model import App, AppMode, IconType
from models.resource_access_token import (
    ResourceAccessToken,
    ResourceAccessTokenRelation,
    ResourceAccessTokenResourceType,
)
from services.auth.resource_access_token_contracts import (
    ResourceAccessTokenResource,
)
from services.resource_access_token_service import ResourceAccessTokenService


@pytest.fixture
def service(sqlite_session_factory: sessionmaker[Session]) -> ResourceAccessTokenService:
    return build_resource_access_token_service(database_client=sqlite_session_factory)


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
def test_create_token_with_mixed_resources_returns_expanded_rows(
    sqlite_session: Session, service: ResourceAccessTokenService
) -> None:
    tenant, owner = _workspace(sqlite_session)
    app = _app(sqlite_session, tenant.id)
    dataset = _dataset(sqlite_session, tenant.id, owner.id)

    result = service.create(
        RequestContext("test", None, owner.id, tenant.id),
        name="Production integration",
        resources=(
            ResourceAccessTokenResource(type=ResourceAccessTokenResourceType.APP, id=app.id),
            ResourceAccessTokenResource(type=ResourceAccessTokenResourceType.KNOWLEDGE, id=dataset.id),
        ),
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
def test_list_paginates_and_counts_tokens_not_relations(
    sqlite_session: Session, service: ResourceAccessTokenService
) -> None:
    tenant, owner = _workspace(sqlite_session)
    first_app = _app(sqlite_session, tenant.id)
    second_app = _app(sqlite_session, tenant.id)
    dataset = _dataset(sqlite_session, tenant.id, owner.id)
    service.create(
        RequestContext("test", None, owner.id, tenant.id),
        name="First integration",
        resources=(ResourceAccessTokenResource(type=ResourceAccessTokenResourceType.APP, id=first_app.id),),
    )
    newest = service.create(
        RequestContext("test", None, owner.id, tenant.id),
        name="Newest integration",
        resources=(
            ResourceAccessTokenResource(type=ResourceAccessTokenResourceType.APP, id=second_app.id),
            ResourceAccessTokenResource(type=ResourceAccessTokenResourceType.KNOWLEDGE, id=dataset.id),
        ),
    )

    rows = service.list_rows(RequestContext("test", None, owner.id, tenant.id), page=1, limit=1)

    assert service.count_rows(RequestContext("test", None, owner.id, tenant.id)) == 2
    assert {row.token_id for row in rows} == {newest.token_id}
    assert len(rows) == 2

    keyword = "Newest integration"
    searched = service.list_rows(RequestContext("test", None, owner.id, tenant.id), page=1, limit=1, keyword=keyword)
    assert {row.token_id for row in searched} == {newest.token_id}
    assert service.count_rows(RequestContext("test", None, owner.id, tenant.id), keyword=keyword) == 1
    resource_search = service.list_rows(
        RequestContext("test", None, owner.id, tenant.id), page=1, limit=20, keyword="Customer Support"
    )
    assert {row.token_id for row in resource_search} == {newest.token_id}


@pytest.mark.parametrize(
    "sqlite_session",
    [(Tenant, Account, TenantAccountJoin, App, ResourceAccessToken, ResourceAccessTokenRelation)],
    indirect=True,
)
def test_update_changes_all_expanded_rows(sqlite_session: Session, service: ResourceAccessTokenService) -> None:
    tenant, owner = _workspace(sqlite_session)
    first_app = _app(sqlite_session, tenant.id)
    second_app = _app(sqlite_session, tenant.id)
    created = service.create(
        RequestContext("test", None, owner.id, tenant.id),
        name="Production integration",
        resources=(
            ResourceAccessTokenResource(type=ResourceAccessTokenResourceType.APP, id=first_app.id),
            ResourceAccessTokenResource(type=ResourceAccessTokenResourceType.APP, id=second_app.id),
        ),
    )

    rows = service.update(
        RequestContext("test", None, owner.id, tenant.id),
        token_id=created.token_id,
        name="Internal integration",
        resources=None,
    )

    assert {row.name for row in rows} == {"Internal integration"}


@pytest.mark.parametrize(
    "sqlite_session",
    [(Tenant, Account, TenantAccountJoin, App, Dataset, ResourceAccessToken, ResourceAccessTokenRelation)],
    indirect=True,
)
def test_update_replaces_resources(sqlite_session: Session, service: ResourceAccessTokenService) -> None:
    tenant, owner = _workspace(sqlite_session)
    first_app = _app(sqlite_session, tenant.id)
    second_app = _app(sqlite_session, tenant.id)
    dataset = _dataset(sqlite_session, tenant.id, owner.id)
    created = service.create(
        RequestContext("test", None, owner.id, tenant.id),
        name="Production integration",
        resources=(
            ResourceAccessTokenResource(type=ResourceAccessTokenResourceType.APP, id=first_app.id),
            ResourceAccessTokenResource(type=ResourceAccessTokenResourceType.KNOWLEDGE, id=dataset.id),
        ),
    )

    rows = service.update(
        RequestContext("test", None, owner.id, tenant.id),
        token_id=created.token_id,
        name="Internal integration",
        resources=(ResourceAccessTokenResource(type=ResourceAccessTokenResourceType.APP, id=second_app.id),),
    )

    assert {row.name for row in rows} == {"Internal integration"}
    assert [(row.resource_type, row.resource_id) for row in rows] == [
        (ResourceAccessTokenResourceType.APP, second_app.id)
    ]
    sqlite_session.expire_all()
    assert sqlite_session.scalars(select(ResourceAccessTokenRelation)).one().app_id == second_app.id


@pytest.mark.parametrize(
    "sqlite_session",
    [(Tenant, Account, TenantAccountJoin, App, Dataset, ResourceAccessToken, ResourceAccessTokenRelation)],
    indirect=True,
)
def test_delete_relation_removes_token_and_all_relations(
    sqlite_session: Session, service: ResourceAccessTokenService
) -> None:
    tenant, owner = _workspace(sqlite_session)
    app = _app(sqlite_session, tenant.id)
    dataset = _dataset(sqlite_session, tenant.id, owner.id)
    created = service.create(
        RequestContext("test", None, owner.id, tenant.id),
        name="Production integration",
        resources=(
            ResourceAccessTokenResource(type=ResourceAccessTokenResourceType.APP, id=app.id),
            ResourceAccessTokenResource(type=ResourceAccessTokenResourceType.KNOWLEDGE, id=dataset.id),
        ),
    )

    service.delete_relation(
        RequestContext("test", None, owner.id, tenant.id),
        token_id=created.token_id,
        relation_id=created.rows[0].relation_id,
    )

    assert sqlite_session.scalar(select(ResourceAccessToken)) is None
    assert sqlite_session.scalar(select(ResourceAccessTokenRelation)) is None


@pytest.mark.parametrize("operation", ["create", "update"])
def test_failed_resource_validation_rolls_back_all_writes(
    sqlite_session: Session, service: ResourceAccessTokenService, operation: str
) -> None:
    from services.auth.resource_access_token_contracts import ResourceAccessTokenNotFoundError

    tenant, owner = _workspace(sqlite_session)
    app = _app(sqlite_session, tenant.id)
    other_tenant, _ = _workspace(sqlite_session)
    foreign_app = _app(sqlite_session, other_tenant.id)
    context = RequestContext("test", None, owner.id, tenant.id)
    resources = (ResourceAccessTokenResource(ResourceAccessTokenResourceType.APP, app.id),)
    created = service.create(context, name="Original", resources=resources) if operation == "update" else None
    invalid_resources = (
        *resources,
        ResourceAccessTokenResource(ResourceAccessTokenResourceType.APP, foreign_app.id),
    )
    invoke = (
        partial(
            service.update, context, token_id=created.token_id, name="Should roll back", resources=invalid_resources
        )
        if created
        else partial(service.create, context, name="Should roll back", resources=invalid_resources)
    )
    with pytest.raises(ResourceAccessTokenNotFoundError):
        invoke()
    sqlite_session.expire_all()
    tokens = sqlite_session.scalars(select(ResourceAccessToken)).all()
    assert [token.name for token in tokens] == (["Original"] if created else [])
    assert len(sqlite_session.scalars(select(ResourceAccessTokenRelation)).all()) == (1 if created else 0)


@pytest.mark.parametrize("operation", ["list", "update", "delete"])
def test_management_is_scoped_to_the_context_workspace(
    sqlite_session: Session, service: ResourceAccessTokenService, operation: str
) -> None:
    from services.auth.resource_access_token_contracts import ResourceAccessTokenNotFoundError

    tenant, owner = _workspace(sqlite_session)
    app = _app(sqlite_session, tenant.id)
    created = service.create(
        RequestContext("test", None, owner.id, tenant.id),
        name="Original",
        resources=(ResourceAccessTokenResource(ResourceAccessTokenResourceType.APP, app.id),),
    )
    foreign = RequestContext("test", None, owner.id, "foreign")
    if operation == "list":
        assert service.list_rows(foreign, page=1, limit=20) == ()
        assert service.count_rows(foreign) == 0
    else:
        invoke = (
            partial(service.update, foreign, token_id=created.token_id, name="Foreign", resources=None)
            if operation == "update"
            else partial(
                service.delete_relation, foreign, token_id=created.token_id, relation_id=created.rows[0].relation_id
            )
        )
        with pytest.raises(ResourceAccessTokenNotFoundError):
            invoke()
    assert sqlite_session.get(ResourceAccessToken, created.token_id) is not None


def test_reads_return_detached_values_and_do_not_expose_secrets(
    sqlite_session: Session, service: ResourceAccessTokenService
) -> None:
    tenant, owner = _workspace(sqlite_session)
    app = _app(sqlite_session, tenant.id)
    context = RequestContext("test", None, owner.id, tenant.id)
    created = service.create(
        context, name="CLI", resources=(ResourceAccessTokenResource(ResourceAccessTokenResourceType.APP, app.id),)
    )
    assert created.rows[0].token == created.token
    rows = service.list_rows(context, page=1, limit=20)
    assert rows[0].token is None
    assert rows[0].masked_token != created.token
    assert rows[0].resource_name == app.name
    assert not hasattr(rows[0], "_sa_instance_state")


@pytest.mark.parametrize("rollback", [False, True])
def test_resource_cleanup_shares_the_callers_transaction(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    service: ResourceAccessTokenService,
    rollback: bool,
) -> None:
    from extensions.application_services.resource_access_token import build_resource_access_token_cleanup_service

    tenant, owner = _workspace(sqlite_session)
    app = _app(sqlite_session, tenant.id)
    second = _app(sqlite_session, tenant.id)
    context = RequestContext("test", None, owner.id, tenant.id)
    only = service.create(
        context, name="Only", resources=(ResourceAccessTokenResource(ResourceAccessTokenResourceType.APP, app.id),)
    )
    shared = service.create(
        context,
        name="Shared",
        resources=(
            ResourceAccessTokenResource(ResourceAccessTokenResourceType.APP, app.id),
            ResourceAccessTokenResource(ResourceAccessTokenResourceType.APP, second.id),
        ),
    )
    with sqlite_session_factory() as session:
        build_resource_access_token_cleanup_service(session=session).delete_resource_relations(
            tenant_id=tenant.id, resource_type=ResourceAccessTokenResourceType.APP, resource_id=app.id
        )
        deleted_app = session.get(App, app.id)
        assert deleted_app is not None
        session.delete(deleted_app)
        session.flush()
        assert session.get(ResourceAccessToken, only.token_id) is None
        if rollback:
            session.rollback()
        else:
            session.commit()
    app_id = app.id
    sqlite_session.expire_all()
    assert (sqlite_session.get(App, app_id) is not None) == rollback
    assert (sqlite_session.get(ResourceAccessToken, only.token_id) is not None) == rollback
    assert sqlite_session.get(ResourceAccessToken, shared.token_id) is not None
    assert len(sqlite_session.scalars(select(ResourceAccessTokenRelation)).all()) == (3 if rollback else 1)


def test_foreign_binding_cannot_expose_resource_name_or_authorize_app(
    sqlite_session: Session, service: ResourceAccessTokenService
) -> None:
    from services.auth.resource_access_token_contracts import ResourceAccessTokenForbiddenError

    tenant, owner = _workspace(sqlite_session)
    app = _app(sqlite_session, tenant.id)
    context = RequestContext("test", None, owner.id, tenant.id)
    created = service.create(
        context, name="CLI", resources=(ResourceAccessTokenResource(ResourceAccessTokenResourceType.APP, app.id),)
    )
    foreign_tenant, _ = _workspace(sqlite_session)
    foreign_app = _app(sqlite_session, foreign_tenant.id)
    relation = sqlite_session.get(ResourceAccessTokenRelation, created.rows[0].relation_id)
    assert relation is not None
    relation.app_id = foreign_app.id
    sqlite_session.commit()
    assert service.list_rows(context, page=1, limit=20)[0].resource_name == ""
    with pytest.raises(ResourceAccessTokenForbiddenError):
        service.authorize_openapi(token_id=created.token_id, workspace_id=tenant.id, app_id=foreign_app.id)


def test_cleanup_cannot_delete_another_workspaces_token(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session], service: ResourceAccessTokenService
) -> None:
    from extensions.application_services.resource_access_token import build_resource_access_token_cleanup_service

    tenant, owner = _workspace(sqlite_session)
    app = _app(sqlite_session, tenant.id)
    context = RequestContext("test", None, owner.id, tenant.id)
    created = service.create(
        context, name="CLI", resources=(ResourceAccessTokenResource(ResourceAccessTokenResourceType.APP, app.id),)
    )
    with sqlite_session_factory.begin() as session:
        build_resource_access_token_cleanup_service(session=session).delete_resource_relations(
            tenant_id="foreign", resource_type=ResourceAccessTokenResourceType.APP, resource_id=app.id
        )
    assert sqlite_session.get(ResourceAccessToken, created.token_id) is not None
    assert sqlite_session.get(ResourceAccessTokenRelation, created.rows[0].relation_id) is not None
