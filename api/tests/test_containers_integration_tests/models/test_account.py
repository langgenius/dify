# import secrets

# import pytest
# from sqlalchemy import select
# from sqlalchemy.orm import Session
# from sqlalchemy.orm.exc import DetachedInstanceError

# from libs.datetime_utils import naive_utc_now
# from models.account import Account, Tenant, TenantAccountJoin


# @pytest.fixture
# def session(db_session_with_containers):
#     with Session(db_session_with_containers.get_bind()) as session:
#         yield session


# @pytest.fixture
# def account(session):
#     account = Account(
#         name="test account",
#         email=f"test_{secrets.token_hex(8)}@example.com",
#     )
#     session.add(account)
#     session.commit()
#     return account


# @pytest.fixture
# def tenant(session):
#     tenant = Tenant(name="test tenant")
#     session.add(tenant)
#     session.commit()
#     return tenant


# @pytest.fixture
# def tenant_account_join(session, account, tenant):
#     tenant_join = TenantAccountJoin(account_id=account.id, tenant_id=tenant.id)
#     session.add(tenant_join)
#     session.commit()
#     yield tenant_join
#     session.delete(tenant_join)
#     session.commit()


# class TestAccountTenant:
#     def test_set_current_tenant_should_reload_tenant(
#         self,
#         db_session_with_containers,
#         account,
#         tenant,
#         tenant_account_join,
#     ):
#         with Session(db_session_with_containers.get_bind(), expire_on_commit=True) as session:
#             scoped_tenant = session.scalars(select(Tenant).where(Tenant.id == tenant.id)).one()
#             account.current_tenant = scoped_tenant
#             scoped_tenant.created_at = naive_utc_now()
#             # session.commit()

#         # Ensure the tenant used in assignment is detached.
#         with pytest.raises(DetachedInstanceError):
#             _ = scoped_tenant.name

#         assert account._current_tenant.id == tenant.id
#         assert account._current_tenant.id == tenant.id

#     def test_set_tenant_id_should_load_tenant_as_not_expire(
#         self,
#         flask_app_with_containers,
#         account,
#         tenant,
#         tenant_account_join,
#     ):
#         with flask_app_with_containers.test_request_context():
#             account.set_tenant_id(tenant.id)

#         assert account._current_tenant.id == tenant.id
#         assert account._current_tenant.id == tenant.id
