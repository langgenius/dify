from collections.abc import Callable, Generator
from contextlib import contextmanager
from unittest.mock import MagicMock, patch

from extensions.ext_redis import RedisClientWrapper
from services.workspace_membership_lock import (
    account_membership_mutation_lock,
    account_workspace_membership_mutation_lock,
    account_workspace_membership_mutation_locks,
)


def test_account_lock_canonicalizes_uuid_and_uses_wrapper_prefix(config_overrides: Callable[..., None]) -> None:
    raw_client = MagicMock()
    raw_client.lock.return_value.acquire.return_value = True
    wrapper = RedisClientWrapper()
    wrapper.initialize(raw_client)
    config_overrides(
        REDIS_KEY_PREFIX="enterprise-a",
        ENTERPRISE_RBAC_REQUEST_TIMEOUT=5,
        ENTERPRISE_REQUEST_TIMEOUT=7,
    )

    with patch("services.workspace_membership_lock.redis_client", wrapper):
        with account_membership_mutation_lock("AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA"):
            pass

    raw_client.lock.assert_called_once()
    args, kwargs = raw_client.lock.call_args
    assert args == ("enterprise-a:rbac:account-membership:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",)
    assert kwargs["timeout"] == 6 * 5 + 7 + 60


def test_combined_lock_orders_account_before_sorted_unique_workspaces() -> None:
    events: list[str] = []

    @contextmanager
    def tracked_account(account_id: str) -> Generator[None]:
        events.append(f"enter account {account_id}")
        try:
            yield
        finally:
            events.append(f"exit account {account_id}")

    @contextmanager
    def tracked_workspace(tenant_id: str) -> Generator[None]:
        events.append(f"enter workspace {tenant_id}")
        try:
            yield
        finally:
            events.append(f"exit workspace {tenant_id}")

    account_id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    first_workspace = "11111111-1111-1111-1111-111111111111"
    second_workspace = "22222222-2222-2222-2222-222222222222"
    with (
        patch("services.workspace_membership_lock.account_membership_mutation_lock", tracked_account),
        patch("services.workspace_membership_lock.workspace_membership_mutation_lock", tracked_workspace),
        account_workspace_membership_mutation_lock(
            account_id,
            second_workspace,
            first_workspace,
            second_workspace,
        ),
    ):
        events.append("body")

    assert events == [
        f"enter account {account_id}",
        f"enter workspace {first_workspace}",
        f"enter workspace {second_workspace}",
        "body",
        f"exit workspace {second_workspace}",
        f"exit workspace {first_workspace}",
        f"exit account {account_id}",
    ]


def test_plural_combined_lock_sorts_unique_accounts_before_workspaces() -> None:
    events: list[str] = []

    @contextmanager
    def tracked_account(account_id: str) -> Generator[None]:
        events.append(f"account {account_id}")
        yield

    @contextmanager
    def tracked_workspace(tenant_id: str) -> Generator[None]:
        events.append(f"workspace {tenant_id}")
        yield

    first = "11111111-1111-1111-1111-111111111111"
    second = "22222222-2222-2222-2222-222222222222"
    workspace = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    with (
        patch("services.workspace_membership_lock.account_membership_mutation_lock", tracked_account),
        patch("services.workspace_membership_lock.workspace_membership_mutation_lock", tracked_workspace),
        account_workspace_membership_mutation_locks([second, first, second], [workspace]),
    ):
        pass

    assert events == [f"account {first}", f"account {second}", f"workspace {workspace}"]
