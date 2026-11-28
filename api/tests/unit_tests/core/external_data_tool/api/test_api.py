from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy.orm import Session

import core.external_data_tool.api.api as api_module
from core.external_data_tool.api.api import ApiExternalDataTool
from models.api_based_extension import APIBasedExtension, APIBasedExtensionPoint


@pytest.fixture
def api_extension(sqlite_session: Session) -> APIBasedExtension:
    extension = APIBasedExtension(
        tenant_id="tenant_id",
        name="Test extension",
        api_endpoint="http://api",
        api_key="encrypted_key",
    )
    extension.id = "ext_id"
    sqlite_session.add(extension)
    sqlite_session.commit()
    return extension


def test_api_external_data_tool_name() -> None:
    assert ApiExternalDataTool.name == "api"


def test_validate_config_success(api_extension: APIBasedExtension) -> None:
    # Should not raise exception
    ApiExternalDataTool.validate_config("tenant_id", {"api_based_extension_id": "ext_id"})


def test_validate_config_missing_id() -> None:
    with pytest.raises(ValueError, match="api_based_extension_id is required"):
        ApiExternalDataTool.validate_config("tenant_id", {})


def test_validate_config_invalid_id() -> None:
    with pytest.raises(ValueError, match="api_based_extension_id is invalid"):
        ApiExternalDataTool.validate_config("tenant_id", {"api_based_extension_id": "ext_id"})


def test_validate_config_rejects_other_tenant_extension(api_extension: APIBasedExtension) -> None:
    with pytest.raises(ValueError, match="api_based_extension_id is invalid"):
        ApiExternalDataTool.validate_config("other_tenant", {"api_based_extension_id": "ext_id"})


@pytest.fixture
def api_tool() -> ApiExternalDataTool:
    # Use standard kwargs as it inherits from ExternalDataTool which is typically a Pydantic BaseModel
    return ApiExternalDataTool(
        tenant_id="tenant_id", app_id="app_id", variable="var1", config={"api_based_extension_id": "ext_id"}
    )


@patch("core.external_data_tool.api.api.encrypter")
@patch("core.external_data_tool.api.api.APIBasedExtensionRequestor")
def test_query_success(
    mock_requestor_class: MagicMock,
    mock_encrypter: MagicMock,
    api_tool: ApiExternalDataTool,
    api_extension: APIBasedExtension,
) -> None:
    mock_encrypter.decrypt_token.return_value = "decrypted_key"

    mock_requestor = mock_requestor_class.return_value
    mock_requestor.request.return_value = {"result": "success_result"}

    res = api_tool.query({"input1": "value1"}, "query_str")

    assert res == "success_result"

    mock_requestor_class.assert_called_once_with(api_endpoint="http://api", api_key="decrypted_key")
    mock_requestor.request.assert_called_once_with(
        point=APIBasedExtensionPoint.APP_EXTERNAL_DATA_TOOL_QUERY,
        params={"app_id": "app_id", "tool_variable": "var1", "inputs": {"input1": "value1"}, "query": "query_str"},
    )


def test_query_missing_config() -> None:
    api_tool = ApiExternalDataTool(tenant_id="tenant_id", app_id="app_id", variable="var1")
    api_tool.config = None  # Force None
    with pytest.raises(ValueError, match="config is required"):
        api_tool.query({}, "")


def test_query_missing_extension_id() -> None:
    api_tool = ApiExternalDataTool(tenant_id="tenant_id", app_id="app_id", variable="var1", config={"dummy": "value"})
    with pytest.raises(AssertionError, match="api_based_extension_id is required"):
        api_tool.query({}, "")


def test_query_invalid_extension(api_tool: ApiExternalDataTool) -> None:
    with pytest.raises(ValueError, match=".*error: api_based_extension_id is invalid"):
        api_tool.query({}, "")


def test_query_rejects_other_tenant_extension(api_extension: APIBasedExtension) -> None:
    other_tenant_tool = ApiExternalDataTool(
        tenant_id="other_tenant",
        app_id="app_id",
        variable="var1",
        config={"api_based_extension_id": "ext_id"},
    )
    with pytest.raises(ValueError, match=".*error: api_based_extension_id is invalid"):
        other_tenant_tool.query({}, "")


@patch("core.external_data_tool.api.api.encrypter")
@patch("core.external_data_tool.api.api.APIBasedExtensionRequestor")
def test_query_closes_session_before_outbound_request(
    mock_requestor_class: MagicMock,
    mock_encrypter: MagicMock,
    api_tool: ApiExternalDataTool,
    api_extension: APIBasedExtension,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    mock_encrypter.decrypt_token.return_value = "decrypted_key"

    opened_sessions = 0
    closed_sessions = 0
    original_create_session = api_module.session_factory.create_session

    class _TrackedSession:
        def __init__(self, session: Session) -> None:
            self._session = session

        def __enter__(self) -> Session:
            nonlocal opened_sessions
            opened_sessions += 1
            return self._session.__enter__()

        def __exit__(self, exc_type: object, exc_val: object, exc_tb: object) -> None:
            nonlocal closed_sessions
            try:
                self._session.__exit__(exc_type, exc_val, exc_tb)
            finally:
                closed_sessions += 1

    monkeypatch.setattr(
        api_module.session_factory,
        "create_session",
        lambda: _TrackedSession(original_create_session()),
    )

    session_states_at_request: list[tuple[int, int]] = []

    def _record_request(**_kwargs: object) -> dict[str, str]:
        session_states_at_request.append((opened_sessions, closed_sessions))
        return {"result": "ok"}

    mock_requestor_class.return_value.request.side_effect = _record_request

    assert api_tool.query({}, None) == "ok"
    assert session_states_at_request == [(1, 1)]


@patch("core.external_data_tool.api.api.encrypter")
@patch("core.external_data_tool.api.api.APIBasedExtensionRequestor")
def test_query_requestor_init_error(
    mock_requestor_class: MagicMock,
    mock_encrypter: MagicMock,
    api_tool: ApiExternalDataTool,
    api_extension: APIBasedExtension,
) -> None:
    mock_encrypter.decrypt_token.return_value = "decrypted_key"

    mock_requestor_class.side_effect = Exception("init error")

    with pytest.raises(ValueError, match=".*error: init error"):
        api_tool.query({}, "")


@patch("core.external_data_tool.api.api.encrypter")
@patch("core.external_data_tool.api.api.APIBasedExtensionRequestor")
def test_query_no_result_in_response(
    mock_requestor_class: MagicMock,
    mock_encrypter: MagicMock,
    api_tool: ApiExternalDataTool,
    api_extension: APIBasedExtension,
) -> None:
    mock_encrypter.decrypt_token.return_value = "decrypted_key"

    mock_requestor = mock_requestor_class.return_value
    mock_requestor.request.return_value = {"other": "value"}

    with pytest.raises(ValueError, match=".*error: result not found in response"):
        api_tool.query({}, "")


@patch("core.external_data_tool.api.api.encrypter")
@patch("core.external_data_tool.api.api.APIBasedExtensionRequestor")
def test_query_result_not_string(
    mock_requestor_class: MagicMock,
    mock_encrypter: MagicMock,
    api_tool: ApiExternalDataTool,
    api_extension: APIBasedExtension,
) -> None:
    mock_encrypter.decrypt_token.return_value = "decrypted_key"

    mock_requestor = mock_requestor_class.return_value
    mock_requestor.request.return_value = {"result": 123}  # Not a string

    with pytest.raises(ValueError, match=".*error: result is not string"):
        api_tool.query({}, "")
