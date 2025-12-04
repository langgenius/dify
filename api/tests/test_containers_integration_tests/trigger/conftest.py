"""
Fixtures for trigger integration tests.

This module provides fixtures for creating test data (tenant, account, app)
and mock objects used across trigger-related tests.
"""

from __future__ import annotations

from collections.abc import Generator
from typing import Any

import pytest
from sqlalchemy.orm import Session

from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.model import App


@pytest.fixture
def tenant_and_account(db_session_with_containers: Session) -> Generator[tuple[Tenant, Account], None, None]:
    """
    Create a tenant and account for testing.

    This fixture creates a tenant, account, and their association,
    then cleans up after the test completes.

    Yields:
        tuple[Tenant, Account]: The created tenant and account
    """
    tenant = Tenant(name="trigger-e2e")
    account = Account(name="tester", email="tester@example.com", interface_language="en-US")
    db_session_with_containers.add_all([tenant, account])
    db_session_with_containers.commit()

    join = TenantAccountJoin(tenant_id=tenant.id, account_id=account.id, role=TenantAccountRole.OWNER.value)
    db_session_with_containers.add(join)
    db_session_with_containers.commit()

    yield tenant, account

    # Cleanup
    db_session_with_containers.query(TenantAccountJoin).filter_by(tenant_id=tenant.id).delete()
    db_session_with_containers.query(Account).filter_by(id=account.id).delete()
    db_session_with_containers.query(Tenant).filter_by(id=tenant.id).delete()
    db_session_with_containers.commit()


@pytest.fixture
def app_model(
    db_session_with_containers: Session, tenant_and_account: tuple[Tenant, Account]
) -> Generator[App, None, None]:
    """
    Create an app for testing.

    This fixture creates a workflow app associated with the tenant and account,
    then cleans up after the test completes.

    Yields:
        App: The created app
    """
    tenant, account = tenant_and_account
    app = App(
        tenant_id=tenant.id,
        name="trigger-app",
        description="trigger e2e",
        mode="workflow",
        icon_type="emoji",
        icon="robot",
        icon_background="#FFEAD5",
        enable_site=True,
        enable_api=True,
        api_rpm=100,
        api_rph=1000,
        is_demo=False,
        is_public=False,
        is_universal=False,
        created_by=account.id,
    )
    db_session_with_containers.add(app)
    db_session_with_containers.commit()

    yield app

    # Cleanup - delete related records first
    from models.trigger import (
        AppTrigger,
        TriggerSubscription,
        WorkflowPluginTrigger,
        WorkflowSchedulePlan,
        WorkflowTriggerLog,
        WorkflowWebhookTrigger,
    )
    from models.workflow import Workflow

    db_session_with_containers.query(WorkflowTriggerLog).filter_by(app_id=app.id).delete()
    db_session_with_containers.query(WorkflowSchedulePlan).filter_by(app_id=app.id).delete()
    db_session_with_containers.query(WorkflowWebhookTrigger).filter_by(app_id=app.id).delete()
    db_session_with_containers.query(WorkflowPluginTrigger).filter_by(app_id=app.id).delete()
    db_session_with_containers.query(AppTrigger).filter_by(app_id=app.id).delete()
    db_session_with_containers.query(TriggerSubscription).filter_by(tenant_id=tenant.id).delete()
    db_session_with_containers.query(Workflow).filter_by(app_id=app.id).delete()
    db_session_with_containers.query(App).filter_by(id=app.id).delete()
    db_session_with_containers.commit()


class MockCeleryGroup:
    """Mock for celery group() function that collects dispatched tasks."""

    def __init__(self) -> None:
        self.collected: list[dict[str, Any]] = []
        self._applied = False

    def __call__(self, items: Any) -> MockCeleryGroup:
        self.collected = list(items)
        return self

    def apply_async(self) -> None:
        self._applied = True

    @property
    def applied(self) -> bool:
        return self._applied


class MockCelerySignature:
    """Mock for celery task signature that returns task info dict."""

    def s(self, schedule_id: str) -> dict[str, str]:
        return {"schedule_id": schedule_id}


@pytest.fixture
def mock_celery_group() -> MockCeleryGroup:
    """
    Provide a mock celery group for testing task dispatch.

    Returns:
        MockCeleryGroup: Mock group that collects dispatched tasks
    """
    return MockCeleryGroup()


@pytest.fixture
def mock_celery_signature() -> MockCelerySignature:
    """
    Provide a mock celery signature for testing task dispatch.

    Returns:
        MockCelerySignature: Mock signature generator
    """
    return MockCelerySignature()


class MockPluginSubscription:
    """Mock plugin subscription for testing plugin triggers."""

    def __init__(
        self,
        subscription_id: str = "sub-1",
        tenant_id: str = "tenant-1",
        provider_id: str = "provider-1",
    ) -> None:
        self.id = subscription_id
        self.tenant_id = tenant_id
        self.provider_id = provider_id
        self.credentials: dict[str, str] = {"token": "secret"}
        self.credential_type = "api-key"

    def to_entity(self) -> MockPluginSubscription:
        return self


@pytest.fixture
def mock_plugin_subscription() -> MockPluginSubscription:
    """
    Provide a mock plugin subscription for testing.

    Returns:
        MockPluginSubscription: Mock subscription instance
    """
    return MockPluginSubscription()
