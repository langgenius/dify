"""PostgreSQL persistence regressions that SQLite's permissive VARCHAR cannot cover."""

from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from libs.datetime_utils import naive_utc_now
from models.account import TenantAccountJoin, TenantAccountRole
from repositories.personal_access_token_repository import PersonalAccessTokenRepository
from services.personal_access_token_service import (
    PersonalAccessTokenRecord,
    PersonalAccessTokenResourceRef,
    PersonalAccessTokenResourceView,
    PersonalAccessTokenScopes,
    PersonalAccessTokenSummary,
)
from tests.unit_tests.model_factories import make_account, make_app, make_tenant


def test_long_deployment_name_survives_creation_edit_and_parent_deletion(db_session_with_containers: Session) -> None:
    session = db_session_with_containers
    workspace = make_tenant(tenant_id=str(uuid4()))
    account = make_account(account_id=str(uuid4()), tenant=None)
    app = make_app(app_id=str(uuid4()), tenant_id=workspace.id, name="A" * 255)
    session.add_all(
        [
            workspace,
            account,
            app,
            TenantAccountJoin(
                tenant_id=workspace.id,
                account_id=account.id,
                role=TenantAccountRole.OWNER,
                current=True,
            ),
        ]
    )
    session.commit()
    repository = PersonalAccessTokenRepository(
        session_factory=sessionmaker(bind=session.get_bind(), expire_on_commit=False)
    )
    deployment_id = str(uuid4())
    name = f"{app.name} / Production"
    resource = PersonalAccessTokenResourceView(
        resource_type="app_runner",
        resource_id=deployment_id,
        workspace_id=workspace.id,
        display_name=name,
        workspace_name=workspace.name,
        available=True,
        reason=None,
        parent_app_id=app.id,
        display_name_snapshot=name,
        workspace_name_snapshot=workspace.name,
    )
    scopes = PersonalAccessTokenScopes(
        resource_mode="selected",
        resources=(PersonalAccessTokenResourceRef("app_runner", deployment_id),),
        workspace_mode="none",
    )
    created = repository.create(
        PersonalAccessTokenRecord(
            summary=PersonalAccessTokenSummary(
                id=str(uuid4()),
                name="Long deployment",
                secret_last_four="test",
                created_at=naive_utc_now(),
                expires_at=None,
                resource_scope_mode="selected",
                workspace_scope_mode="none",
            ),
            account_id=account.id,
            secret_digest=uuid4().hex * 2,
            secret_ciphertext=b"test-ciphertext",
            scopes=scopes,
            validated_resources=(resource,),
        )
    )
    assert repository.details(account.id, created.id).resources[0].display_name_snapshot == name
    edited = repository.update(
        account.id,
        created.id,
        name="Renamed token",
        version=1,
        scopes=scopes,
        now=naive_utc_now(),
        validated_resources=(),
    )
    assert edited.resources[0].display_name_snapshot == name
    session.delete(app)
    session.commit()
    assert repository.details(account.id, created.id).resources[0].display_name_snapshot == name


def test_removed_resource_keeps_live_workspace_name_in_scope_details(db_session_with_containers: Session) -> None:
    session = db_session_with_containers
    workspace = make_tenant(tenant_id=str(uuid4()))
    account = make_account(account_id=str(uuid4()), tenant=None)
    app = make_app(app_id=str(uuid4()), tenant_id=workspace.id, name="Deleted app")
    session.add_all(
        [
            workspace,
            account,
            app,
            TenantAccountJoin(
                tenant_id=workspace.id,
                account_id=account.id,
                role=TenantAccountRole.OWNER,
                current=True,
            ),
        ]
    )
    session.commit()
    repository = PersonalAccessTokenRepository(
        session_factory=sessionmaker(bind=session.get_bind(), expire_on_commit=False)
    )
    resource = PersonalAccessTokenResourceView(
        resource_type="app",
        resource_id=app.id,
        workspace_id=workspace.id,
        display_name=app.name,
        workspace_name=workspace.name,
        available=True,
        reason=None,
        display_name_snapshot=app.name,
        workspace_name_snapshot="",
    )
    created = repository.create(
        PersonalAccessTokenRecord(
            summary=PersonalAccessTokenSummary(
                id=str(uuid4()),
                name="Removed app scope",
                secret_last_four="test",
                created_at=naive_utc_now(),
                expires_at=None,
                resource_scope_mode="selected",
                workspace_scope_mode="none",
            ),
            account_id=account.id,
            secret_digest=uuid4().hex * 2,
            secret_ciphertext=b"test-ciphertext",
            scopes=PersonalAccessTokenScopes(
                resource_mode="selected",
                resources=(PersonalAccessTokenResourceRef("app", app.id),),
                workspace_mode="none",
            ),
            validated_resources=(resource,),
        )
    )

    membership = session.scalar(
        select(TenantAccountJoin).where(
            TenantAccountJoin.tenant_id == workspace.id,
            TenantAccountJoin.account_id == account.id,
        )
    )
    assert membership is not None
    session.delete(membership)
    session.delete(app)
    session.commit()

    detail = repository.details(account.id, created.id)
    assert detail.resources[0].available is False
    assert detail.resources[0].workspace_name == workspace.name
