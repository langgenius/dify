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
from services.errors.workspace import WorkspaceInvitationQuotaError
from services.workspace.quota import WorkspaceMemberQuotaSnapshot
from tests.unit_tests.model_factories import make_account, make_tenant

_UNLIMITED_MEMBER_QUOTA = WorkspaceMemberQuotaSnapshot(None, 0, None, 0)


class UnlimitedMemberQuotaGateway:
    def snapshot(self, workspace_id: str) -> WorkspaceMemberQuotaSnapshot:
        del workspace_id
        return _UNLIMITED_MEMBER_QUOTA


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
        member_quotas=UnlimitedMemberQuotaGateway(),
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

    def test_capacity_race_keeps_first_use_invitation_retryable(
        self,
        service: AccountActivationService,
        boundaries: dict[str, MagicMock],
        mocker: MockerFixture,
    ) -> None:
        mocker.patch.object(
            service._member_quotas, "snapshot", return_value=WorkspaceMemberQuotaSnapshot(0, 0, None, 0)
        )

        with pytest.raises(WorkspaceInvitationQuotaError):
            service.activate(
                ActivationCommand(
                    invitation=_lookup(),
                    name="John Doe",
                    interface_language="en-US",
                    timezone="UTC",
                ),
                authenticated_account_id=None,
            )

        boundaries["revoke"].assert_not_called()
        boundaries["cache"].assert_not_called()
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
            quota=_UNLIMITED_MEMBER_QUOTA,
            create_membership=True,
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
            _invitation(account_status="active", role="editor", requires_setup=False),
            role="editor",
            setup=None,
            quota=_UNLIMITED_MEMBER_QUOTA,
            create_membership=True,
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


class TestEnsureMembership:
    def test_missing_token_returns_false_without_revoking(
        self,
        service: AccountActivationService,
        boundaries: dict[str, MagicMock],
        redis_transport: tuple[RedisClientWrapper, MagicMock],
    ) -> None:
        redis_transport[1].return_value = None

        assert service.ensure_membership(account_id="account-1", email="invitee@example.com", token="missing") is False

        boundaries["revoke"].assert_not_called()
        boundaries["activate"].assert_not_called()
        boundaries["cache"].assert_not_called()
        boundaries["sync"].assert_not_called()

    def test_quota_failure_releases_membership_claim_for_retry(
        self,
        service: AccountActivationService,
        sqlite_session_factory: sessionmaker[Session],
        redis_transport: tuple[RedisClientWrapper, MagicMock],
        mocker: MockerFixture,
    ) -> None:
        with sqlite_session_factory.begin() as session:
            account = session.get(Account, "account-1")
            assert account is not None
            account.status = AccountStatus.ACTIVE
        redis_transport[
            1
        ].return_value = b'{"account_id":"account-1","email":"invitee@example.com","workspace_id":"workspace-1"}'
        claimed = False

        def claim_membership(_lookup: InvitationLookup) -> str | None:
            nonlocal claimed
            if claimed:
                return None
            claimed = True
            return "claim-1"

        def release_membership(_lookup: InvitationLookup, claim_id: str) -> None:
            nonlocal claimed
            assert claim_id == "claim-1"
            claimed = False

        mocker.patch.object(service._tokens, "claim_membership", side_effect=claim_membership)
        release = mocker.patch.object(service._tokens, "release_membership", side_effect=release_membership)
        mocker.patch.object(
            service._member_quotas,
            "snapshot",
            side_effect=[WorkspaceInvitationQuotaError(), _UNLIMITED_MEMBER_QUOTA],
        )
        mocker.patch(
            "tasks.initialize_created_app_rbac_access_task.sync_joined_workspace_member_rbac_access_task.delay"
        )

        with pytest.raises(WorkspaceInvitationQuotaError):
            service.ensure_membership(account_id="account-1", email="invitee@example.com", token="token-1")

        release.assert_called_once()
        assert service.ensure_membership(account_id="account-1", email="invitee@example.com", token="token-1") is True
        with sqlite_session_factory() as session:
            assert session.scalar(select(TenantAccountJoin)) is not None

    @pytest.mark.parametrize(
        ("role", "stored_role"),
        [
            ("editor", TenantAccountRole.EDITOR),
            (None, TenantAccountRole.NORMAL),
            ("owner", TenantAccountRole.NORMAL),
        ],
    )
    def test_restores_membership_once_and_preserves_activation(
        self,
        service: AccountActivationService,
        boundaries: dict[str, MagicMock],
        sqlite_session_factory: sessionmaker[Session],
        redis_transport: tuple[RedisClientWrapper, MagicMock],
        role: str | None,
        stored_role: TenantAccountRole,
    ) -> None:
        with sqlite_session_factory.begin() as session:
            account = session.get(Account, "account-1")
            assert account is not None
            account.status = AccountStatus.ACTIVE
        role_json = f',"role":"{role}"' if role is not None else ""
        redis_transport[1].return_value = (
            '{"account_id":"account-1","email":"invitee@example.com","workspace_id":"workspace-1"'
            f'{role_json},"requires_setup":false}}'
        ).encode()

        used: set[object] = set()

        def execute(command: object, key: object, *args: object, **_kwargs: object) -> object:
            if command == "PTTL":
                return 3600
            if command == "SET":
                assert "NX" in args
                assert "PX" in args
                if key in used:
                    return None
                used.add(key)
                return b"OK"
            if command == "GET" and str(key).endswith(":membership_used"):
                return b"claim:used" if key in used else None
            return redis_transport[1].return_value

        redis_transport[1].side_effect = execute
        restored = service.ensure_membership(account_id="account-1", email="Invitee@Example.com", token="token-1")

        assert restored is True
        boundaries["revoke"].assert_not_called()
        boundaries["activate"].assert_called_once_with(
            _invitation(account_status="active", role=role, requires_setup=False),
            role=stored_role,
            setup=None,
            quota=_UNLIMITED_MEMBER_QUOTA,
        )
        boundaries["cache"].assert_called_once_with("workspace-1")
        boundaries["sync"].assert_called_once_with("workspace-1", "account-1", operator_account_id=None)
        with sqlite_session_factory() as session:
            account = session.get(Account, "account-1")
            membership = session.scalar(select(TenantAccountJoin))
            assert account is not None
            assert account.id == "account-1"
            assert account.status == AccountStatus.ACTIVE
            assert account.name == "Test User"
            assert membership is not None
            assert membership.role == stored_role
            assert membership.current is True
        check = service.check(InvitationLookup(workspace_id=None, email=None, token="token-1"))
        assert check.is_valid is True
        boundaries["revoke"].assert_not_called()

        with sqlite_session_factory.begin() as session:
            session.execute(delete(TenantAccountJoin))
        boundaries["activate"].reset_mock()
        assert service.ensure_membership(account_id="account-1", email="invitee@example.com", token="token-1") is False
        boundaries["activate"].assert_not_called()
        with sqlite_session_factory() as session:
            assert session.scalar(select(TenantAccountJoin)) is None

        with pytest.raises(InvalidInvitationError):
            service.activate(
                ActivationCommand(invitation=InvitationLookup(workspace_id=None, email=None, token="token-1")),
                authenticated_account_id="account-1",
            )
        boundaries["revoke"].assert_called_once()
        boundaries["activate"].assert_called_once_with(
            _invitation(account_status="active", role=role, requires_setup=False),
            role=stored_role,
            setup=None,
            quota=_UNLIMITED_MEMBER_QUOTA,
            create_membership=False,
        )
        with sqlite_session_factory() as session:
            assert session.scalar(select(TenantAccountJoin)) is None

    def test_activation_after_restore_keeps_existing_membership(
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
        redis_transport[1].return_value = (
            b'{"account_id":"account-1","email":"invitee@example.com","workspace_id":"workspace-1",'
            b'"role":"editor","requires_setup":false}'
        )
        used: set[object] = set()

        def execute(command: object, key: object, *_args: object, **_kwargs: object) -> object:
            if command == "PTTL":
                return 3600
            if command == "SET":
                used.add(key)
                return b"OK"
            if command == "GET" and str(key).endswith(":membership_used"):
                return b"claim:used" if key in used else None
            return redis_transport[1].return_value

        redis_transport[1].side_effect = execute
        assert service.ensure_membership(account_id="account-1", email="invitee@example.com", token="token-1") is True
        boundaries["cache"].reset_mock()
        boundaries["sync"].reset_mock()

        service.activate(
            ActivationCommand(invitation=InvitationLookup(workspace_id=None, email=None, token="token-1")),
            authenticated_account_id="account-1",
        )

        boundaries["revoke"].assert_called_once()
        boundaries["cache"].assert_not_called()
        boundaries["sync"].assert_called_once_with("workspace-1", "account-1", operator_account_id=None)
        with sqlite_session_factory() as session:
            memberships = session.scalars(select(TenantAccountJoin)).all()
            assert len(memberships) == 1
            assert memberships[0].role == TenantAccountRole.EDITOR
            assert memberships[0].current is True

    def test_existing_membership_is_not_rewritten_or_resynced(
        self,
        service: AccountActivationService,
        boundaries: dict[str, MagicMock],
        sqlite_session_factory: sessionmaker[Session],
        redis_transport: tuple[RedisClientWrapper, MagicMock],
    ) -> None:
        with sqlite_session_factory.begin() as session:
            session.add(
                TenantAccountJoin(tenant_id="workspace-1", account_id="account-1", role=TenantAccountRole.ADMIN)
            )
        redis_transport[1].side_effect = lambda command, *_args, **_kwargs: (
            3600
            if command == "PTTL"
            else b"OK"
            if command == "SET"
            else b'{"account_id":"account-1","email":"invitee@example.com","workspace_id":"workspace-1"}'
        )

        assert service.ensure_membership(account_id="account-1", email="invitee@example.com", token="token-1") is True

        boundaries["activate"].assert_called_once()
        boundaries["cache"].assert_not_called()
        boundaries["sync"].assert_not_called()
        with sqlite_session_factory() as session:
            memberships = session.scalars(select(TenantAccountJoin)).all()
            assert len(memberships) == 1
            assert memberships[0].role == TenantAccountRole.ADMIN

    def test_returns_false_when_activation_finds_no_workspace(
        self,
        service: AccountActivationService,
        boundaries: dict[str, MagicMock],
        mocker: MockerFixture,
        redis_transport: tuple[RedisClientWrapper, MagicMock],
    ) -> None:
        redis_transport[1].side_effect = lambda command, *_args, **_kwargs: (
            3600
            if command == "PTTL"
            else b"OK"
            if command == "SET"
            else b'{"account_id":"account-1","email":"invitee@example.com","workspace_id":"workspace-1"}'
        )
        mocker.patch.object(service._accounts, "activate", return_value=None)

        assert service.ensure_membership(account_id="account-1", email="invitee@example.com", token="token-1") is False

        boundaries["cache"].assert_not_called()
        boundaries["sync"].assert_not_called()

    def test_account_mismatch_does_not_write_membership_or_consume_token(
        self,
        service: AccountActivationService,
        boundaries: dict[str, MagicMock],
        redis_transport: tuple[RedisClientWrapper, MagicMock],
    ) -> None:
        redis_transport[
            1
        ].return_value = b'{"account_id":"account-1","email":"invitee@example.com","workspace_id":"workspace-1"}'
        assert (
            service.ensure_membership(account_id="different-account", email="invitee@example.com", token="token-1")
            is False
        )
        boundaries["activate"].assert_not_called()
        boundaries["revoke"].assert_not_called()
        boundaries["cache"].assert_not_called()
        boundaries["sync"].assert_not_called()
        assert all(args[0] == "GET" for args, _ in redis_transport[1].call_args_list)
