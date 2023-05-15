import pytest
from app import create_app, db
from flask_login import current_user
from models.model import Account, TenantAccountJoin, Tenant


@pytest.fixture
def client(test_client, db_session):
    app = create_app()
    app.config["TESTING"] = True
    with app.app_context():
        db.create_all()
        yield test_client
        db.drop_all()


def test_login_api_post(client, db_session):
    # create a tenant, account, and tenant account join
    tenant = Tenant(name="Test Tenant", status="normal")
    account = Account(email="test@test.com", name="Test User")
    account.password_salt = "uQ7K0/0wUJ7VPhf3qBzwNQ=="
    account.password = "A9YpfzjK7c/tOwzamrvpJg=="
    db.session.add_all([tenant, account])
    db.session.flush()
    tenant_account_join = TenantAccountJoin(tenant_id=tenant.id, account_id=account.id, is_tenant_owner=True)
    db.session.add(tenant_account_join)
    db.session.commit()

    # login with correct credentials
    response = client.post("/login", json={
        "email": "test@test.com",
        "password": "Abc123456",
        "remember_me": True
    })
    assert response.status_code == 200
    assert response.json == {"result": "success"}
    assert current_user == account
    assert 'tenant_id' in client.session
    assert client.session['tenant_id'] == tenant.id

    # login with incorrect password
    response = client.post("/login", json={
        "email": "test@test.com",
        "password": "wrong_password",
        "remember_me": True
    })
    assert response.status_code == 401

    # login with non-existent account
    response = client.post("/login", json={
        "email": "non_existent_account@test.com",
        "password": "Abc123456",
        "remember_me": True
    })
    assert response.status_code == 401


def test_logout_api_get(client, db_session):
    # create a tenant, account, and tenant account join
    tenant = Tenant(name="Test Tenant", status="normal")
    account = Account(email="test@test.com", name="Test User")
    db.session.add_all([tenant, account])
    db.session.flush()
    tenant_account_join = TenantAccountJoin(tenant_id=tenant.id, account_id=account.id, is_tenant_owner=True)
    db.session.add(tenant_account_join)
    db.session.commit()

    # login and check if session variable and current_user are set
    with client.session_transaction() as session:
        session['tenant_id'] = tenant.id
    client.post("/login", json={
        "email": "test@test.com",
        "password": "Abc123456",
        "remember_me": True
    })
    assert current_user == account
    assert 'tenant_id' in client.session
    assert client.session['tenant_id'] == tenant.id

    # logout and check if session variable and current_user are unset
    response = client.get("/logout")
    assert response.status_code == 200
    assert current_user.is_authenticated is False
    assert 'tenant_id' not in client.session


def test_reset_password_api_get(client, db_session):
    # create a tenant, account, and tenant account join
    tenant = Tenant(name="Test Tenant", status="normal")
    account = Account(email="test@test.com", name="Test User")
    db.session.add_all([tenant, account])
    db.session.flush()
    tenant_account_join = TenantAccountJoin(tenant_id=tenant.id, account_id=account.id, is_tenant_owner=True)
    db.session.add(tenant_account_join)
    db.session.commit()

    # reset password in cloud edition
    app = client.application
    app.config["CLOUD_EDITION"] = True
    response = client.get("/reset_password")
    assert response.status_code == 200
    assert response.json == {"result": "success"}

    # reset password in non-cloud edition
    app.config["CLOUD_EDITION"] = False
    response = client.get("/reset_password")
    assert response.status_code == 200
    assert response.json == {"result": "success"}
