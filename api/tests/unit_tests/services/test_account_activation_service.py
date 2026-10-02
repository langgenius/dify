from unittest.mock import MagicMock, call

import pytest
from pytest_mock import MockerFixture
from sqlalchemy import delete, select
from sqlalchemy.orm import Session, sessionmaker

from extensions.ext_redis import RedisClientWrapper
from models.account import Account, AccountStatus, TenantAccountJoin, TenantAccountRole
from repositories.account_activation_repository import SQLAlchemyAccountActivationRepository
from services.account.adapters import (
    BillingAccountActivationEligibility,
    BillingWorkspaceMembershipCache,
    DeploymentWorkspaceInvitePolicy,
    RBACWorkspaceMemberAccessSync,
    RedisInvitationTokenStore,
)
from services.account_activation_service import AccountActivationService
from services.account_errors import AccountEmailDomainSuspendedError as EmailDomainSuspendedError
from services.account_errors import FrozenAccountError, InvalidInvitationError, InvitationAccountMismatchError
from services.entities.account_activation_entities import (
    AccountInvitation,
    AccountSetup,
    ActivationCommand,
    InvitationLookup,
    InvitationToken,
)
from tests.unit_tests.model_factories import make_account, make_tenant


def _lookup(email: str | None = "invitee@example.com") -> InvitationLookup:
    return InvitationLookup(workspace_id="workspace-1", email=email, token="token-1")


def _invitation(
    *, account_status: str = "pending", role: str | None = None, requires_setup: bool | None = None
) -> AccountInvitation:
    return AccountInvitation(
        account_id="account-1",
        account_email="invitee@example.com",
        account_status=account_status,
        workspace_id="workspace-1",
        workspace_name="Workspace",
        role=role,
        requires_setup=requires_setup,
    )


@pytest.fixture
def service(
    sqlite_session_factory: sessionmaker[Session], redis_transport: tuple[RedisClientWrapper, MagicMock]
) -> AccountActivationService:
    redis, commands = redis_transport
    commands.return_value = b"account-1"
    with sqlite_session_factory.begin() as session:
        session.add(make_account(email="invitee@example.com", status=AccountStatus.PENDING))
        session.add(make_tenant(tenant_id="workspace-1", name="Workspace"))
    return AccountActivationService(
        tokens=RedisInvitationTokenStore(redis=redis),
        accounts=SQLAlchemyAccountActivationRepository(sqlite_session_factory),
        workspace_policy=DeploymentWorkspaceInvitePolicy(),
        eligibility=BillingAccountActivationEligibility(enabled=True),
        membership_cache=BillingWorkspaceMembershipCache(enabled=True),
        member_access_sync=RBACWorkspaceMemberAccessSync(enabled=True),
    )


@pytest.fixture
def boundaries(service: AccountActivationService, mocker: MockerFixture) -> dict[str, MagicMock]:
    return {
        "find": mocker.spy(service._tokens, "find"),
        "revoke": mocker.spy(service._tokens, "revoke"),
        "resolve": mocker.spy(service._accounts, "resolve"),
        "activate": mocker.spy(service._accounts, "activate"),
        "policy": mocker.patch("services.account.adapters.check_workspace_member_invite_permission"),
        "freeze": mocker.patch("services.account.adapters.BillingService.get_email_freeze_type", return_value=None),
        "cache": mocker.patch("services.account.adapters.BillingService.clean_billing_info_cache"),
        "sync": mocker.patch(
            "tasks.initialize_created_app_rbac_access_task.sync_joined_workspace_member_rbac_access_task.delay"
        ),
    }


class TestCheckInvitation:
    def test_returns_invalid_without_touching_database_when_token_is_missing(
        self,
        service: AccountActivationService,
        boundaries: dict[str, MagicMock],
        redis_transport: tuple[RedisClientWrapper, MagicMock],
    ) -> None:
        redis_transport[1].return_value = None

        result = service.check(_lookup())

        assert result.is_valid is False
        assert result.data is None
        boundaries["resolve"].assert_not_called()
        boundaries["policy"].assert_not_called()

    def test_does_not_repeat_database_lookup_for_normalized_email(
        self,
        service: AccountActivationService,
        boundaries: dict[str, MagicMock],
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        with sqlite_session_factory.begin() as session:
            session.execute(delete(Account))

        result = service.check(_lookup())

        assert result.is_valid is False
        boundaries["resolve"].assert_called_once_with(
            InvitationToken(account_id="account-1", email="invitee@example.com", workspace_id="workspace-1")
        )
        boundaries["policy"].assert_not_called()

    def test_falls_back_to_normalized_email_and_applies_workspace_policy(
        self,
        service: AccountActivationService,
        boundaries: dict[str, MagicMock],
    ) -> None:
        result = service.check(_lookup("Invitee@Example.com"))

        assert result.is_valid is True
        assert result.data is not None
        assert result.data.requires_setup is True
        assert result.data.account_status == "pending"
        assert boundaries["find"].call_args_list == [
            call(_lookup("Invitee@Example.com")),
            call(_lookup("invitee@example.com")),
        ]
        assert boundaries["resolve"].call_args_list == [
            call(InvitationToken(account_id="account-1", email=email, workspace_id="workspace-1"))
            for email in ("Invitee@Example.com", "invitee@example.com")
        ]
        boundaries["policy"].assert_called_once_with("workspace-1")


class TestActivateInvitation:
    def test_rejects_authenticated_account_mismatch_before_side_effects(
        self,
        service: AccountActivationService,
        boundaries: dict[str, MagicMock],
    ) -> None:
        with pytest.raises(InvitationAccountMismatchError):
            service.activate(
                ActivationCommand(invitation=_lookup()),
                authenticated_account_id="different-account",
            )

        boundaries["freeze"].assert_not_called()
        boundaries["revoke"].assert_not_called()
        boundaries["activate"].assert_not_called()
        boundaries["sync"].assert_not_called()

    @pytest.mark.parametrize(
        ("freeze_type", "error"),
        [("freeze", FrozenAccountError), ("email_domain_suspended", EmailDomainSuspendedError)],
    )
    def test_rejects_ineligible_account_without_consuming_token(
        self,
        service: AccountActivationService,
        boundaries: dict[str, MagicMock],
        freeze_type: str,
        error: type[Exception],
    ) -> None:
        boundaries["freeze"].return_value = freeze_type

        with pytest.raises(error):
            service.activate(ActivationCommand(invitation=_lookup()), authenticated_account_id=None)

        boundaries["freeze"].assert_called_once_with("invitee@example.com")
        boundaries["revoke"].assert_not_called()
        boundaries["activate"].assert_not_called()
        boundaries["sync"].assert_not_called()

    def test_requires_all_setup_fields_before_consuming_token(
        self,
        service: AccountActivationService,
        boundaries: dict[str, MagicMock],
    ) -> None:
        with pytest.raises(InvalidInvitationError):
            service.activate(
                ActivationCommand(invitation=_lookup(), name="Name"),
                authenticated_account_id=None,
            )

        boundaries["revoke"].assert_not_called()
        boundaries["activate"].assert_not_called()
        boundaries["sync"].assert_not_called()

    @pytest.mark.parametrize("role", [None, "owner"])
    def test_activates_anonymous_invitation_and_invalidates_new_membership_cache(
        self,
        service: AccountActivationService,
        boundaries: dict[str, MagicMock],
        sqlite_session_factory: sessionmaker[Session],
        redis_transport: tuple[RedisClientWrapper, MagicMock],
        role: str | None,
    ) -> None:
        lookup = _lookup("Invitee@Example.com")
        if role == "owner":
            lookup = InvitationLookup(workspace_id=None, email=None, token="token-1")
            redis_transport[1].return_value = (
                b'{"account_id":"account-1","email":"invitee@example.com","workspace_id":"workspace-1",'
                b'"role":"owner","requires_setup":true}'
            )
        command = ActivationCommand(
            invitation=lookup,
            name="John Doe",
            interface_language="en-US",
            timezone="UTC",
        )

        service.activate(command, authenticated_account_id=None)

        boundaries["freeze"].assert_called_once_with("invitee@example.com")
        boundaries["revoke"].assert_called_once_with(_lookup("invitee@example.com") if role is None else lookup)
        boundaries["activate"].assert_called_once_with(
            _invitation(role=role, requires_setup=True if role == "owner" else None),
            role="normal",
            setup=AccountSetup(name="John Doe", interface_language="en-US", timezone="UTC"),
        )
        boundaries["cache"].assert_called_once_with("workspace-1")
        boundaries["sync"].assert_called_once_with("workspace-1", "account-1", operator_account_id=None)
        with sqlite_session_factory() as session:
            account = session.get(Account, "account-1")
            membership = session.scalar(select(TenantAccountJoin))
            assert account is not None
            assert membership is not None
            assert (account.name, account.interface_language, account.timezone) == ("John Doe", "en-US", "UTC")
            assert account.status == AccountStatus.ACTIVE
            assert account.initialized_at is not None
            assert membership.role == TenantAccountRole.NORMAL
            assert membership.current is True

    def test_preserves_existing_membership_cache_and_ignores_setup_fields(
        self,
        service: AccountActivationService,
        boundaries: dict[str, MagicMock],
        sqlite_session_factory: sessionmaker[Session],
        redis_transport: tuple[RedisClientWrapper, MagicMock],
    ) -> None:
        with sqlite_session_factory.begin() as session:
            account = session.get(Account, "account-1")
            assert account is not None
            account.status = AccountStatus.ACTIVE
            session.add(
                TenantAccountJoin(tenant_id="workspace-1", account_id="account-1", role=TenantAccountRole.EDITOR)
            )
        redis_transport[1].return_value = (
            b'{"account_id":"account-1","email":"invitee@example.com","workspace_id":"workspace-1",'
            b'"role":"editor","requires_setup":false}'
        )

        service.activate(
            ActivationCommand(
                invitation=InvitationLookup(workspace_id=None, email=None, token="token-1"),
                name="Ignored",
                interface_language="zh-Hans",
                timezone="Asia/Shanghai",
            ),
            authenticated_account_id="account-1",
        )

        boundaries["activate"].assert_called_once_with(
            _invitation(account_status="active", role="editor", requires_setup=False), role="editor", setup=None
        )
        boundaries["cache"].assert_not_called()
        boundaries["sync"].assert_called_once_with("workspace-1", "account-1", operator_account_id=None)
        with sqlite_session_factory() as session:
            account = session.get(Account, "account-1")
            memberships = session.scalars(select(TenantAccountJoin)).all()
            assert account is not None
            assert account.name == "Test User"
            assert len(memberships) == 1
            assert memberships[0].role == TenantAccountRole.EDITOR
            assert memberships[0].current is True
