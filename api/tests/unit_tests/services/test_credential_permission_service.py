"""Unit tests for CredentialPermissionService.

Tests the visibility filtering logic, partial-member read path,
and admin bypass behavior.
"""

from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.plugin.entities.plugin_daemon import CredentialType as TriggerCredentialType
from models.account import Account, TenantAccountRole
from models.credential_permission import CredentialPermission, CredentialType
from models.enums import PermissionEnum
from models.trigger import TriggerSubscription
from services.credential_permission_service import CredentialPermissionService


@pytest.fixture
def tenant_id() -> str:
    return str(uuid4())


@pytest.fixture
def user_id() -> str:
    return str(uuid4())


@pytest.fixture
def other_user_id() -> str:
    return str(uuid4())


@pytest.fixture
def credential_id() -> str:
    return str(uuid4())


def _subscription(
    *,
    tenant_id: str,
    owner_id: str,
    name: str,
    visibility: PermissionEnum,
) -> TriggerSubscription:
    return TriggerSubscription(
        name=name,
        tenant_id=tenant_id,
        user_id=owner_id,
        provider_id="test/provider",
        endpoint_id=f"{name}-endpoint",
        parameters={},
        properties={},
        credentials={},
        credential_type=TriggerCredentialType.API_KEY,
        visibility=visibility,
    )


def _user(user_id: str, *, is_admin: bool) -> Account:
    user = Account(name="Credential User", email=f"{user_id}@example.com")
    user.id = user_id
    user.role = TenantAccountRole.ADMIN if is_admin else TenantAccountRole.NORMAL
    return user


class TestGetPartialMemberList:
    def test_returns_empty_when_no_permissions(
        self, sqlite_session: Session, credential_id: str, tenant_id: str, user_id: str
    ) -> None:
        unrelated_permission = CredentialPermission(
            credential_id=str(uuid4()),
            credential_type=CredentialType.TRIGGER_SUBSCRIPTION,
            account_id=user_id,
            tenant_id=tenant_id,
        )
        sqlite_session.add(unrelated_permission)
        sqlite_session.commit()

        result = CredentialPermissionService.get_partial_member_list(
            credential_id, CredentialType.TRIGGER_SUBSCRIPTION, session=sqlite_session
        )

        assert result == []

    def test_returns_account_ids(
        self,
        sqlite_session: Session,
        credential_id: str,
        user_id: str,
        other_user_id: str,
        tenant_id: str,
    ) -> None:
        sqlite_session.add_all(
            [
                CredentialPermission(
                    credential_id=credential_id,
                    credential_type=CredentialType.TRIGGER_SUBSCRIPTION,
                    account_id=account_id,
                    tenant_id=tenant_id,
                )
                for account_id in (user_id, other_user_id)
            ]
        )
        sqlite_session.commit()

        result = CredentialPermissionService.get_partial_member_list(
            credential_id, CredentialType.TRIGGER_SUBSCRIPTION, session=sqlite_session
        )

        assert set(result) == {user_id, other_user_id}


class TestApplyVisibilityFilter:
    def test_admin_does_not_bypass_personal_visibility(
        self,
        sqlite_session: Session,
        tenant_id: str,
        user_id: str,
        other_user_id: str,
    ) -> None:
        private_subscription = _subscription(
            tenant_id=tenant_id,
            owner_id=other_user_id,
            name="private",
            visibility=PermissionEnum.ONLY_ME,
        )
        sqlite_session.add(private_subscription)
        sqlite_session.commit()

        query = CredentialPermissionService.apply_visibility_filter(
            select(TriggerSubscription).where(TriggerSubscription.tenant_id == tenant_id),
            model_id_column=TriggerSubscription.id,
            model_user_id_column=TriggerSubscription.user_id,
            model_visibility_column=TriggerSubscription.visibility,
            credential_type=CredentialType.TRIGGER_SUBSCRIPTION,
            user=_user(user_id, is_admin=True),
        )

        assert sqlite_session.scalars(query).all() == []

    def test_non_admin_sees_team_owned_and_partial_member_subscriptions(
        self,
        sqlite_session: Session,
        tenant_id: str,
        user_id: str,
        other_user_id: str,
    ) -> None:
        team_subscription = _subscription(
            tenant_id=tenant_id,
            owner_id=other_user_id,
            name="team",
            visibility=PermissionEnum.ALL_TEAM,
        )
        owned_subscription = _subscription(
            tenant_id=tenant_id,
            owner_id=user_id,
            name="owned",
            visibility=PermissionEnum.ONLY_ME,
        )
        shared_subscription = _subscription(
            tenant_id=tenant_id,
            owner_id=other_user_id,
            name="shared",
            visibility=PermissionEnum.PARTIAL_TEAM,
        )
        private_subscription = _subscription(
            tenant_id=tenant_id,
            owner_id=other_user_id,
            name="private",
            visibility=PermissionEnum.ONLY_ME,
        )
        sqlite_session.add_all(
            [
                team_subscription,
                owned_subscription,
                shared_subscription,
                private_subscription,
                CredentialPermission(
                    credential_id=shared_subscription.id,
                    credential_type=CredentialType.TRIGGER_SUBSCRIPTION,
                    account_id=user_id,
                    tenant_id=tenant_id,
                ),
            ]
        )
        sqlite_session.commit()

        query = CredentialPermissionService.apply_visibility_filter(
            select(TriggerSubscription).where(TriggerSubscription.tenant_id == tenant_id),
            model_id_column=TriggerSubscription.id,
            model_user_id_column=TriggerSubscription.user_id,
            model_visibility_column=TriggerSubscription.visibility,
            credential_type=CredentialType.TRIGGER_SUBSCRIPTION,
            user=_user(user_id, is_admin=False),
        )

        visible_ids = {subscription.id for subscription in sqlite_session.scalars(query)}
        assert visible_ids == {team_subscription.id, owned_subscription.id, shared_subscription.id}
