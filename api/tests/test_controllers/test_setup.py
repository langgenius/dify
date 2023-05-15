import os
import pytest
from models.model import Account, Tenant, TenantAccountJoin


def test_setup_api_get(test_client,db_session):
    response = test_client.get("/setup")
    assert response.status_code == 200
    assert response.json == {"step": "not_start"}

    # create a tenant and check again
    tenant = Tenant(name="Test Tenant", status="normal")
    db_session.add(tenant)
    db_session.commit()
    response = test_client.get("/setup")
    assert response.status_code == 200
    assert response.json == {"step": "step2"}

    # create setup file and check again
    response = test_client.get("/setup")
    assert response.status_code == 200
    assert response.json == {"step": "finished"}


def test_setup_api_post(test_client):
    response = test_client.post("/setup", json={
        "email": "test@test.com",
        "name": "Test User",
        "password": "Abc123456"
    })
    assert response.status_code == 200
    assert response.json == {"result": "success", "next_step": "step2"}

    # check if the tenant, account, and tenant account join records were created
    tenant = Tenant.query.first()
    assert tenant.name == "Test User's LLM Factory"
    assert tenant.status == "normal"
    assert tenant.encrypt_public_key

    account = Account.query.first()
    assert account.email == "test@test.com"
    assert account.name == "Test User"
    assert account.password_salt
    assert account.password
    assert TenantAccountJoin.query.filter_by(account_id=account.id, is_tenant_owner=True).count() == 1

    # check if password is encrypted correctly
    salt = account.password_salt.encode()
    password_hashed = account.password.encode()
    assert account.password == base64.b64encode(hash_password("Abc123456", salt)).decode()


def test_setup_step2_api_post(test_client,db_session):
    # create a tenant, account, and setup file
    tenant = Tenant(name="Test Tenant", status="normal")
    account = Account(email="test@test.com", name="Test User")
    db_session.add_all([tenant, account])
    db_session.commit()

    # try to set up with incorrect language
    response = test_client.post("/setup/step2", json={
        "interface_language": "invalid_language",
        "timezone": "Asia/Shanghai"
    })
    assert response.status_code == 400

    # set up successfully
    response = test_client.post("/setup/step2", json={
        "interface_language": "en",
        "timezone": "Asia/Shanghai"
    })
    assert response.status_code == 200
    assert response.json == {"result": "success", "next_step": "finished"}

    # check if account was updated correctly
    account = Account.query.first()
    assert account.interface_language == "en"
    assert account.timezone == "Asia/Shanghai"
    assert account.interface_theme == "light"
    assert account.last_login_ip == "127.0.0.1"
