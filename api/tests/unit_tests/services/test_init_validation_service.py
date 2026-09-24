"""Tests for initialization validation policy without Flask or persistence."""

from unittest.mock import Mock, create_autospec

import pytest

from services.init_validation_service import (
    AlreadyInitializedError,
    InitValidationService,
    InitValidationState,
    InvalidInitializationPasswordError,
)


@pytest.fixture
def state() -> Mock:
    return create_autospec(InitValidationState, instance=True, spec_set=True)


def test_status_is_valid_when_validation_is_not_required(state: Mock) -> None:
    service = InitValidationService(state=state, validation_required=False, expected_password="")

    assert service.is_validated(session_validated=False) is True
    state.is_setup.assert_not_called()


def test_status_is_valid_when_browser_session_was_validated(state: Mock) -> None:
    service = InitValidationService(state=state, validation_required=True, expected_password="expected")

    assert service.is_validated(session_validated=True) is True
    state.is_setup.assert_not_called()


@pytest.mark.parametrize("setup_exists", [False, True])
def test_status_falls_back_to_persisted_setup_state(state: Mock, setup_exists: bool) -> None:
    state.is_setup.return_value = setup_exists
    service = InitValidationService(state=state, validation_required=True, expected_password="expected")

    assert service.is_validated(session_validated=False) is setup_exists
    state.is_setup.assert_called_once_with()


def test_password_validation_rejects_an_initialized_installation(state: Mock) -> None:
    state.has_tenants.return_value = True
    service = InitValidationService(state=state, validation_required=True, expected_password="expected")

    with pytest.raises(AlreadyInitializedError):
        service.validate_password("expected")


def test_initialized_installation_takes_precedence_over_a_password_mismatch(state: Mock) -> None:
    state.has_tenants.return_value = True
    service = InitValidationService(state=state, validation_required=True, expected_password="expected")

    with pytest.raises(AlreadyInitializedError):
        service.validate_password("wrong")


def test_password_validation_rejects_a_mismatch(state: Mock) -> None:
    state.has_tenants.return_value = False
    service = InitValidationService(state=state, validation_required=True, expected_password="expected")

    with pytest.raises(InvalidInitializationPasswordError):
        service.validate_password("wrong")


def test_password_validation_accepts_a_match(state: Mock) -> None:
    state.has_tenants.return_value = False
    service = InitValidationService(state=state, validation_required=True, expected_password="expected")

    service.validate_password("expected")

    state.has_tenants.assert_called_once_with()


@pytest.mark.parametrize("expected_password", ["", "expected"])
def test_password_validation_rejects_an_empty_password(state: Mock, expected_password: str) -> None:
    state.has_tenants.return_value = False
    service = InitValidationService(
        state=state,
        validation_required=bool(expected_password),
        expected_password=expected_password,
    )

    with pytest.raises(InvalidInitializationPasswordError):
        service.validate_password("")


def test_password_validation_rejects_a_password_when_no_password_is_configured(state: Mock) -> None:
    state.has_tenants.return_value = False
    service = InitValidationService(state=state, validation_required=False, expected_password="")

    with pytest.raises(InvalidInitializationPasswordError):
        service.validate_password("unexpected")


def test_password_validation_accepts_a_unicode_password(state: Mock) -> None:
    state.has_tenants.return_value = False
    service = InitValidationService(state=state, validation_required=True, expected_password="pässwörd-🔐")

    service.validate_password("pässwörd-🔐")
