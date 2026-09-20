"""Invitation issuance and activation through real PostgreSQL and Redis adapters."""

import json
from hashlib import sha256
from unittest.mock import Mock
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from configs import dify_config
from enums import DeploymentEdition
from extensions.ext_application_services import application_services
from extensions.ext_redis import redis_client
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole, TenantStatus
from services.account.adapters import RedisInvitationTokenStore
from services.account_errors import InvalidInvitationError
from services.entities.account_activation_entities import ActivationCommand, InvitationLookup, InvitationToken
from services.workspace import gateways


@pytest.fixture
def workspace(db_session_with_containers: Session, monkeypatch: pytest.MonkeyPatch) -> tuple[Tenant, Account, Account]:
    monkeypatch.setattr(dify_config, "DEPLOYMENT_EDITION", DeploymentEdition.COMMUNITY)
    monkeypatch.setattr(dify_config, "RBAC_ENABLED", False)
    tenant = Tenant(name="Inviting workspace", status=TenantStatus.NORMAL)
    owner = Account(name="Owner", email=f"owner-{uuid4()}@example.com", status=AccountStatus.ACTIVE)
    invited = Account(name="Invited", email=f"invited-{uuid4()}@example.com", status=AccountStatus.PENDING)
    db_session_with_containers.add_all(
        [
            tenant,
            owner,
            invited,
            TenantAccountJoin(tenant_id=tenant.id, account_id=owner.id, role=TenantAccountRole.OWNER, current=True),
        ]
    )
    db_session_with_containers.commit()
    return tenant, owner, invited


@pytest.mark.parametrize("status", [AccountStatus.PENDING, AccountStatus.ACTIVE])
def test_invitation_token_round_trip_and_acceptance(
    workspace: tuple[Tenant, Account, Account],
    db_session_with_containers: Session,
    monkeypatch: pytest.MonkeyPatch,
    status: AccountStatus,
) -> None:
    tenant, owner, invited = workspace
    invited.status = status
    db_session_with_containers.commit()
    send = Mock(spec=gateways.send_invite_member_mail_task.delay)
    monkeypatch.setattr(gateways.send_invite_member_mail_task, "delay", send)
    services = application_services()

    token = services.workspaces.invitations.invite(tenant.id, invited.email, "en-US", "admin", inviter_id=owner.id)

    token_key = f"member_invite:token:{token}"
    payload = redis_client.get(token_key)
    assert payload is not None
    assert json.loads(payload) == {
        "account_id": invited.id,
        "email": invited.email,
        "workspace_id": tenant.id,
        "role": "admin",
        "requires_setup": status == AccountStatus.PENDING,
    }
    assert 0 < redis_client.ttl(token_key) <= dify_config.INVITE_EXPIRY_HOURS * 3600
    send.assert_called_once_with(
        language="en-US", to=invited.email, token=token, inviter_name=owner.name, workspace_name=tenant.name
    )
    assert services.workspaces.members.get_role(tenant.id, invited.id) == (
        TenantAccountRole.ADMIN if status == AccountStatus.PENDING else None
    )
    lookup = InvitationLookup(workspace_id=None, email=None, token=token)
    checked = services.accounts.activation.check(lookup)
    assert checked.is_valid
    assert checked.data is not None
    assert checked.data.email == invited.email
    assert checked.data.workspace_id == tenant.id
    assert checked.data.workspace_name == tenant.name
    assert checked.data.account_status == status
    assert checked.data.requires_setup is (status == AccountStatus.PENDING)

    services.accounts.activation.activate(
        ActivationCommand(invitation=lookup, name="Accepted", interface_language="en-US", timezone="UTC"),
        authenticated_account_id=invited.id,
    )

    db_session_with_containers.expire_all()
    assert invited.status == AccountStatus.ACTIVE
    assert services.workspaces.members.get_role(tenant.id, invited.id) == TenantAccountRole.ADMIN
    membership = db_session_with_containers.scalar(
        select(TenantAccountJoin).where(
            TenantAccountJoin.tenant_id == tenant.id, TenantAccountJoin.account_id == invited.id
        )
    )
    assert membership is not None
    assert membership.current
    assert redis_client.get(token_key) is None
    assert not services.accounts.activation.check(lookup).is_valid
    with pytest.raises(InvalidInvitationError):
        services.accounts.activation.activate(ActivationCommand(invitation=lookup), authenticated_account_id=invited.id)


@pytest.mark.parametrize("mixed_case", [False, True])
def test_previous_workspace_scoped_token_format_can_be_accepted_and_revoked(
    workspace: tuple[Tenant, Account, Account], mixed_case: bool
) -> None:
    tenant, _, invited = workspace
    token = str(uuid4())
    email_hash = sha256(invited.email.encode()).hexdigest()
    key = f"member_invite_token:{tenant.id}, {email_hash}:{token}"
    redis_client.setex(key, 3600, invited.id)
    lookup = InvitationLookup(
        workspace_id=tenant.id, email=invited.email.upper() if mixed_case else invited.email, token=token
    )
    services = application_services()

    checked = services.accounts.activation.check(lookup)
    assert checked.is_valid
    assert checked.data is not None
    assert checked.data.requires_setup
    assert checked.data.email == invited.email
    services.accounts.activation.activate(
        ActivationCommand(invitation=lookup, name="Accepted", interface_language="en-US", timezone="UTC"),
        authenticated_account_id=None,
    )

    assert redis_client.get(key) is None
    assert not services.accounts.activation.check(lookup).is_valid
    assert services.workspaces.members.get_role(tenant.id, invited.id) == TenantAccountRole.NORMAL


@pytest.mark.parametrize("reason", ["expired", "missing-account", "missing-workspace", "archived", "wrong-email"])
def test_invalid_invitation_state_is_rejected(
    workspace: tuple[Tenant, Account, Account], db_session_with_containers: Session, reason: str
) -> None:
    tenant, _, invited = workspace
    if reason == "archived":
        tenant.status = TenantStatus.ARCHIVE
        db_session_with_containers.commit()
    token = RedisInvitationTokenStore(redis=redis_client).create(
        InvitationToken(
            account_id=str(uuid4()) if reason == "missing-account" else invited.id,
            email="different@example.com" if reason == "wrong-email" else invited.email,
            workspace_id=str(uuid4()) if reason == "missing-workspace" else tenant.id,
        )
    )
    if reason == "expired":
        redis_client.pexpire(f"member_invite:token:{token}", 0)
    lookup = InvitationLookup(workspace_id=None, email=None, token=token)
    activation = application_services().accounts.activation

    assert not activation.check(lookup).is_valid
    with pytest.raises(InvalidInvitationError):
        activation.activate(ActivationCommand(invitation=lookup), authenticated_account_id=invited.id)
