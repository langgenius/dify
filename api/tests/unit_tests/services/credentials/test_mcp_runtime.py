"""Reactive MCP refresh contract, including concurrent stale callers."""

from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace

import pytest

from services.credentials.mcp_runtime import (
    MCPCredentialRecord,
    MCPCredentialService,
    MCPCredentialUnavailableError,
    mcp_credential_digest,
)
from tests.helpers.unit.credential_refresh import ThreadCredentialRefreshLock


class Store:
    def __init__(self) -> None:
        self.record = MCPCredentialRecord("id", "workspace", "provider", "old", {}, True)

    def get_mcp_credential(self, **_kwargs: object) -> MCPCredentialRecord:
        return self.record

    def update_mcp_credential_if_unchanged(
        self, *, record: MCPCredentialRecord, encrypted_credentials: str | None, authed: bool
    ) -> bool:
        if self.record != record:
            return False
        self.record = replace(record, encrypted_credentials=encrypted_credentials, authed=authed)
        return True


class Runtime:
    def __init__(self) -> None:
        self.refreshes = 0
        self.revoked = False

    def resolve(self, record: MCPCredentialRecord, **_kwargs: object) -> dict[str, object]:
        return {"server_url": "https://mcp.example/秘密", "headers": {"Authorization": record.encrypted_credentials}}

    def refresh(self, _record: MCPCredentialRecord, **_kwargs: object) -> str:
        self.refreshes += 1
        if self.revoked:
            raise MCPCredentialUnavailableError("Authorize again")
        return "new"


def test_twenty_stale_callers_share_one_rotation() -> None:
    store, runtime = Store(), Runtime()
    service = MCPCredentialService(credentials=store, runtime=runtime, refresh_lock=ThreadCredentialRefreshLock())
    failed = mcp_credential_digest(runtime.resolve(store.record))
    with ThreadPoolExecutor(max_workers=20) as pool:
        results = list(
            pool.map(
                lambda index: service.resolve(
                    workspace_id="workspace",
                    provider="provider",
                    credential_id="id",
                    failed_credential_digest=failed,
                    deployed=index % 2 == 0,
                ),
                range(20),
            )
        )
    assert results == [runtime.resolve(store.record)] * 20
    assert results[0]["headers"] == {"Authorization": "new"}
    assert runtime.refreshes == 1


def test_revoked_refresh_disables_later_resolution_until_reauthorized() -> None:
    store, runtime = Store(), Runtime()
    runtime.revoked = True
    service = MCPCredentialService(credentials=store, runtime=runtime, refresh_lock=ThreadCredentialRefreshLock())
    with pytest.raises(MCPCredentialUnavailableError):
        service.resolve(
            workspace_id="workspace",
            provider="provider",
            credential_id="id",
            failed_credential_digest=mcp_credential_digest(runtime.resolve(store.record)),
        )
    with pytest.raises(MCPCredentialUnavailableError):
        service.resolve(workspace_id="workspace", provider="provider", credential_id="id")
    assert not store.record.authed


def test_temporary_failure_preserves_authorization_and_allows_retry(monkeypatch: pytest.MonkeyPatch) -> None:
    from services.credentials.refresh import CredentialRefreshUnavailableError

    store, runtime = Store(), Runtime()
    service = MCPCredentialService(credentials=store, runtime=runtime, refresh_lock=ThreadCredentialRefreshLock())
    original = store.record

    def unavailable(*_args: object, **_kwargs: object) -> str:
        raise CredentialRefreshUnavailableError()

    monkeypatch.setattr(runtime, "refresh", unavailable)
    with pytest.raises(CredentialRefreshUnavailableError):
        service.resolve(
            workspace_id="workspace",
            provider="provider",
            credential_id="id",
            failed_credential_digest=mcp_credential_digest(runtime.resolve(original)),
        )
    assert store.record == original
    assert service.resolve(workspace_id="workspace", provider="provider", credential_id="id") == runtime.resolve(
        original
    )


def test_concurrent_configuration_change_is_not_overwritten(monkeypatch: pytest.MonkeyPatch) -> None:
    from services.credentials.refresh import CredentialRefreshUnavailableError

    store, runtime = Store(), Runtime()
    service = MCPCredentialService(credentials=store, runtime=runtime, refresh_lock=ThreadCredentialRefreshLock())

    def change_during_network(*_args: object, **_kwargs: object) -> str:
        store.record = replace(store.record, encrypted_credentials="admin-replacement")
        return "stale-network-result"

    monkeypatch.setattr(runtime, "refresh", change_during_network)
    with pytest.raises(CredentialRefreshUnavailableError):
        service.resolve(
            workspace_id="workspace",
            provider="provider",
            credential_id="id",
            failed_credential_digest=mcp_credential_digest(runtime.resolve(store.record)),
        )
    assert store.record.encrypted_credentials == "admin-replacement"
    assert store.record.authed


def test_initial_debug_auth_is_allowed_without_authorizing_deployed_reads() -> None:
    store, runtime = Store(), Runtime()
    store.record = replace(store.record, authed=False)
    service = MCPCredentialService(credentials=store, runtime=runtime, refresh_lock=ThreadCredentialRefreshLock())
    with pytest.raises(MCPCredentialUnavailableError):
        service.resolve(workspace_id="workspace", provider="provider", credential_id="id")
    values = service.resolve(
        workspace_id="workspace",
        provider="provider",
        credential_id="id",
        deployed=False,
        authorization_code="code",
        failed_credential_digest=mcp_credential_digest(runtime.resolve(store.record)),
    )
    assert values["headers"] == {"Authorization": "new"}
    assert store.record.authed


def test_temporary_failures_are_serialized_but_not_deduplicated(monkeypatch: pytest.MonkeyPatch) -> None:
    from services.credentials.refresh import CredentialRefreshUnavailableError

    store, runtime = Store(), Runtime()
    original = store.record
    service = MCPCredentialService(credentials=store, runtime=runtime, refresh_lock=ThreadCredentialRefreshLock())

    def unavailable(*_args: object, **_kwargs: object) -> str:
        runtime.refreshes += 1
        raise CredentialRefreshUnavailableError()

    monkeypatch.setattr(runtime, "refresh", unavailable)

    def resolve(_index: int) -> None:
        with pytest.raises(CredentialRefreshUnavailableError):
            service.resolve(
                workspace_id="workspace",
                provider="provider",
                credential_id="id",
                failed_credential_digest=mcp_credential_digest(runtime.resolve(original)),
            )

    with ThreadPoolExecutor(max_workers=20) as pool:
        list(pool.map(resolve, range(20)))
    assert runtime.refreshes == 20
    assert store.record == original
