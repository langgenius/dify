"""Refresh coordination with concrete ports and concurrent callers."""

import json
import time
from collections.abc import Callable, Mapping
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field, replace
from threading import Barrier

import pytest

from services.credentials.refresh import CredentialRefreshUnavailableError
from services.credentials.tool_runtime import (
    RefreshedToolCredential,
    ToolCredentialNotFoundError,
    ToolCredentialRefreshError,
    ToolCredentialService,
    ToolRuntimeCredential,
)
from tests.helpers.unit.credential_refresh import ThreadCredentialRefreshLock


def _record(*, expires_at: int = 1) -> ToolRuntimeCredential:
    return ToolRuntimeCredential(
        "credential", "workspace", "owner", "provider", "oauth2", '{"token":"old"}', expires_at
    )


@dataclass
class CredentialStore:
    record: ToolRuntimeCredential | None
    barrier: Barrier | None = None
    writes: int = 0

    def get_tool_credential(
        self, *, workspace_id: str, providers: tuple[str, ...], credential_id: str | None
    ) -> ToolRuntimeCredential | None:
        record = self.record
        if record is not None:
            assert record.workspace_id == workspace_id
            assert record.provider in providers
            assert credential_id in (None, record.id)
        if self.barrier is not None and credential_id is None:
            self.barrier.wait(timeout=2)
        return record

    def update_tool_credential_if_unchanged(
        self, *, record: ToolRuntimeCredential, encrypted_credentials: str, expires_at: int
    ) -> bool:
        if self.record != record:
            return False
        self.writes += 1
        self.record = replace(record, encrypted_credentials=encrypted_credentials, expires_at=expires_at)
        return True


@dataclass
class CredentialRuntime:
    during_refresh: Callable[[], None] = lambda: None
    refreshes: int = 0
    invalidations: list[str] = field(default_factory=list)

    def check_policy(self, record: ToolRuntimeCredential) -> None:
        assert record.workspace_id == "workspace"

    def decrypt(self, record: ToolRuntimeCredential) -> dict[str, object]:
        return json.loads(record.encrypted_credentials or "{}")

    def encrypt(self, record: ToolRuntimeCredential, credentials: Mapping[str, object]) -> str:
        assert record.workspace_id == "workspace"
        return json.dumps(credentials)

    def refresh(self, record: ToolRuntimeCredential, credentials: Mapping[str, object]) -> RefreshedToolCredential:
        assert record.workspace_id == "workspace"
        assert credentials == {"token": "old"}
        self.refreshes += 1
        self.during_refresh()
        return RefreshedToolCredential({"token": "new"}, int(time.time()) + 3600)

    def invalidate(self, record: ToolRuntimeCredential) -> None:
        self.invalidations.append(record.id)


def _service(
    store: CredentialStore, runtime: CredentialRuntime, lock: ThreadCredentialRefreshLock
) -> ToolCredentialService:
    return ToolCredentialService(credentials=store, runtime=runtime, refresh_lock=lock, providers=("provider",))


def test_concurrent_and_sequential_calls_refresh_once() -> None:
    store = CredentialStore(_record(), barrier=Barrier(4))
    lock = ThreadCredentialRefreshLock()
    runtime = CredentialRuntime(during_refresh=lambda: lock.wait_for_callers(4))
    service = _service(store, runtime, lock)
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = [pool.submit(service.resolve, workspace_id="workspace", credential_id=None) for _ in range(4)]
        assert [future.result(timeout=3).credentials for future in futures] == [{"token": "new"}] * 4
    assert service.resolve(workspace_id="workspace", credential_id="credential").credentials == {"token": "new"}
    assert runtime.refreshes == store.writes == 1
    assert runtime.invalidations == ["credential"]
    assert lock.keys == [("tool", "workspace", "credential")] * 4


@pytest.mark.parametrize("expires_at", [-1, int(time.time()) + 3600])
def test_valid_credentials_do_not_acquire_a_lock(expires_at: int) -> None:
    store, runtime, lock = (
        CredentialStore(_record(expires_at=expires_at)),
        CredentialRuntime(),
        ThreadCredentialRefreshLock(),
    )
    assert _service(store, runtime, lock).resolve(workspace_id="workspace", credential_id=None).credentials == {
        "token": "old"
    }
    assert lock.keys == []
    assert runtime.refreshes == store.writes == 0


@pytest.mark.parametrize("failure", ["unavailable", "lost-before", "lost-after", "provider"])
def test_refresh_failure_does_not_write_or_return_expired_credentials(failure: str) -> None:
    store, runtime, lock = CredentialStore(_record()), CredentialRuntime(), ThreadCredentialRefreshLock()
    lock.unavailable = failure == "unavailable"
    lock.lost = failure == "lost-before"

    def fail_refresh() -> None:
        if failure == "lost-after":
            lock.lost = True
        if failure == "provider":
            raise ToolCredentialRefreshError("provider failed")

    runtime.during_refresh = fail_refresh
    with pytest.raises((ToolCredentialRefreshError, CredentialRefreshUnavailableError)):
        _service(store, runtime, lock).resolve(workspace_id="workspace", credential_id=None)
    assert store.writes == 0
    assert runtime.invalidations == []
    assert runtime.refreshes == (1 if failure in {"lost-after", "provider"} else 0)


@pytest.mark.parametrize("change", ["reauthorized", "expired", "deleted"])
def test_refresh_cannot_overwrite_concurrent_changes(change: str) -> None:
    record = _record()
    store, runtime, lock = CredentialStore(record), CredentialRuntime(), ThreadCredentialRefreshLock()

    def change_credential() -> None:
        store.record = (
            None
            if change == "deleted"
            else replace(
                record,
                encrypted_credentials='{"token":"replacement"}',
                expires_at=-1 if change == "reauthorized" else 1,
            )
        )

    runtime.during_refresh = change_credential
    service = _service(store, runtime, lock)
    if change == "reauthorized":
        assert service.resolve(workspace_id="workspace", credential_id=None).credentials == {"token": "replacement"}
    else:
        with pytest.raises(ToolCredentialNotFoundError if change == "deleted" else ToolCredentialRefreshError):
            service.resolve(workspace_id="workspace", credential_id=None)
    assert store.writes == 0
    assert runtime.invalidations == []
