from machinery.errors import ActiveWorkspaceRequiredError, AdmissionConfigurationError, ErrorDetail, MachineryError


def test_admission_configuration_error_has_transport_neutral_contract() -> None:
    detail = ErrorDetail(
        type="incomplete_requirement",
        location=("rbac", "permission"),
        message="RBAC resource scope and permission must be configured together",
    )

    error = AdmissionConfigurationError("Invalid RBAC admission declaration", details=[detail])

    assert isinstance(error, MachineryError)
    assert not isinstance(error, ValueError)
    assert error.error_code == "invalid_admission_configuration"
    assert error.message == "Invalid RBAC admission declaration"
    assert str(error) == error.message
    assert error.details == (detail,)
    assert not hasattr(error, "code")


def test_admission_configuration_error_uses_stable_default_message() -> None:
    error = AdmissionConfigurationError()

    assert error.message == "Admission configuration is invalid."
    assert error.details == ()


def test_active_workspace_required_error_has_stable_contract() -> None:
    error = ActiveWorkspaceRequiredError()

    assert isinstance(error, MachineryError)
    assert not isinstance(error, ValueError)
    assert error.error_code == "active_workspace_required"
    assert error.message == "Admission did not resolve an active workspace."
    assert str(error) == error.message
    assert error.details == ()
    assert not hasattr(error, "code")
