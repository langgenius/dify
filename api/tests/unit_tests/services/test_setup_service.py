from collections.abc import Generator
from contextlib import contextmanager, nullcontext
from dataclasses import dataclass
from datetime import datetime
from unittest.mock import Mock, create_autospec

import pytest

from services.setup_service import (
    InitializationValidationRequiredError,
    SetupAccountProvisioner,
    SetupAlreadyCompletedError,
    SetupInput,
    SetupLock,
    SetupService,
    SetupState,
    SetupStatus,
)


@pytest.fixture
def state() -> Mock:
    state = create_autospec(SetupState, instance=True, spec_set=True)
    state.get_setup_at.return_value = None
    state.has_tenants.return_value = False
    return state


@pytest.fixture
def accounts() -> Mock:
    return create_autospec(SetupAccountProvisioner, instance=True, spec_set=True)


@pytest.fixture
def lock() -> Mock:
    lock = create_autospec(SetupLock, instance=True, spec_set=True)
    lock.acquire.return_value = nullcontext()
    return lock


@pytest.fixture
def setup_input() -> SetupInput:
    return SetupInput(
        email="Admin@Example.com",
        name="Admin",
        password="Passw0rd1",
        ip_address="203.0.113.7",
        language="en-US",
    )


@dataclass
class TrackingLock:
    inside: bool = False
    exited: bool = False

    @contextmanager
    def acquire(self) -> Generator[None]:
        self.inside = True
        try:
            yield
        finally:
            self.inside = False
            self.exited = True


class FailingLock:
    def __init__(self, error: Exception) -> None:
        self._error = error

    @contextmanager
    def acquire(self) -> Generator[None]:
        raise self._error
        yield


def test_cloud_status_is_finished_without_reading_persistence(state: Mock, accounts: Mock, lock: Mock) -> None:
    service = SetupService(state=state, accounts=accounts, lock=lock, setup_required=False)

    assert service.get_status() == SetupStatus(completed=True)
    state.get_setup_at.assert_not_called()


def test_self_hosted_status_is_not_started_without_setup(state: Mock, accounts: Mock, lock: Mock) -> None:
    service = SetupService(state=state, accounts=accounts, lock=lock, setup_required=True)

    assert service.get_status() == SetupStatus(completed=False)


def test_self_hosted_status_includes_setup_time(state: Mock, accounts: Mock, lock: Mock) -> None:
    setup_at = datetime(2026, 8, 6, 10, 30)
    state.get_setup_at.return_value = setup_at
    service = SetupService(state=state, accounts=accounts, lock=lock, setup_required=True)

    assert service.get_status() == SetupStatus(completed=True, setup_at=setup_at)


def test_initialize_rejects_existing_setup(
    state: Mock,
    accounts: Mock,
    lock: Mock,
    setup_input: SetupInput,
) -> None:
    state.get_setup_at.return_value = datetime(2026, 8, 6, 10, 30)
    service = SetupService(state=state, accounts=accounts, lock=lock, setup_required=True)

    with pytest.raises(SetupAlreadyCompletedError):
        service.initialize(setup_input, initialization_validated=True)

    state.has_tenants.assert_not_called()
    accounts.provision.assert_not_called()


def test_initialize_rejects_existing_tenant(
    state: Mock,
    accounts: Mock,
    lock: Mock,
    setup_input: SetupInput,
) -> None:
    state.has_tenants.return_value = True
    service = SetupService(state=state, accounts=accounts, lock=lock, setup_required=True)

    with pytest.raises(SetupAlreadyCompletedError):
        service.initialize(setup_input, initialization_validated=True)

    accounts.provision.assert_not_called()


@pytest.mark.parametrize("persistent_state", ["setup", "tenant"])
def test_initialize_prioritizes_existing_persistent_state_over_validation(
    state: Mock,
    accounts: Mock,
    lock: Mock,
    setup_input: SetupInput,
    persistent_state: str,
) -> None:
    if persistent_state == "setup":
        state.get_setup_at.return_value = datetime(2026, 8, 6, 10, 30)
    else:
        state.has_tenants.return_value = True
    service = SetupService(state=state, accounts=accounts, lock=lock, setup_required=True)

    with pytest.raises(SetupAlreadyCompletedError):
        service.initialize(setup_input, initialization_validated=False)

    accounts.provision.assert_not_called()


def test_initialize_requires_initialization_validation(
    state: Mock,
    accounts: Mock,
    lock: Mock,
    setup_input: SetupInput,
) -> None:
    service = SetupService(state=state, accounts=accounts, lock=lock, setup_required=True)

    with pytest.raises(InitializationValidationRequiredError):
        service.initialize(setup_input, initialization_validated=False)

    accounts.provision.assert_not_called()


def test_initialize_normalizes_email_and_provisions_account(
    state: Mock,
    accounts: Mock,
    lock: Mock,
    setup_input: SetupInput,
) -> None:
    service = SetupService(state=state, accounts=accounts, lock=lock, setup_required=True)

    service.initialize(setup_input, initialization_validated=True)

    accounts.provision.assert_called_once_with(
        SetupInput(
            email="admin@example.com",
            name="Admin",
            password="Passw0rd1",
            ip_address="203.0.113.7",
            language="en-US",
        )
    )
    lock.acquire.assert_called_once_with()


def test_initialize_reads_and_writes_only_while_holding_lock(
    state: Mock,
    accounts: Mock,
    setup_input: SetupInput,
) -> None:
    lock = TrackingLock()

    def get_setup_at() -> None:
        assert lock.inside

    def has_tenants() -> bool:
        assert lock.inside
        return False

    def provision(_setup: SetupInput) -> None:
        assert lock.inside

    state.get_setup_at.side_effect = get_setup_at
    state.has_tenants.side_effect = has_tenants
    accounts.provision.side_effect = provision
    service = SetupService(state=state, accounts=accounts, lock=lock, setup_required=True)

    service.initialize(setup_input, initialization_validated=True)

    assert lock.exited


def test_initialize_does_not_read_or_write_when_lock_acquisition_fails(
    state: Mock,
    accounts: Mock,
    setup_input: SetupInput,
) -> None:
    error = TimeoutError("lock acquisition timed out")
    service = SetupService(
        state=state,
        accounts=accounts,
        lock=FailingLock(error),
        setup_required=True,
    )

    with pytest.raises(TimeoutError, match="lock acquisition timed out") as raised:
        service.initialize(setup_input, initialization_validated=True)

    assert raised.value is error
    state.get_setup_at.assert_not_called()
    state.has_tenants.assert_not_called()
    accounts.provision.assert_not_called()


def test_initialize_releases_lock_and_propagates_provision_failure(
    state: Mock,
    accounts: Mock,
    setup_input: SetupInput,
) -> None:
    lock = TrackingLock()
    error = RuntimeError("provision failed")
    accounts.provision.side_effect = error
    service = SetupService(state=state, accounts=accounts, lock=lock, setup_required=True)

    with pytest.raises(RuntimeError, match="provision failed") as raised:
        service.initialize(setup_input, initialization_validated=True)

    assert raised.value is error
    assert lock.exited
    assert not lock.inside
