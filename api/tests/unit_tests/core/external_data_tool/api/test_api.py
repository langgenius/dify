from unittest.mock import patch

import pytest
from sqlalchemy.orm import Session

from core.extension.api_based_extension_requestor import APIBasedExtensionPoint
from core.external_data_tool.api.api import ApiExternalDataTool
from extensions.ext_database import db
from models.api_based_extension import APIBasedExtension

pytestmark = [
    pytest.mark.usefixtures("sqlite_session"),
    pytest.mark.parametrize("sqlite_session", [(APIBasedExtension,)], indirect=True),
]


def test_api_external_data_tool_name():
    assert ApiExternalDataTool.name == "api"


@patch("core.external_data_tool.api.api.ApiExternalDataTool._get_api_based_extension")
def test_validate_config_success(mock_get_extension):
    mock_get_extension.return_value = APIBasedExtension(
        tenant_id="tenant_id", name="Test extension", api_endpoint="http://api", api_key="encrypted_key"
    )
    # Should not raise exception
    ApiExternalDataTool.validate_config("tenant_id", {"api_based_extension_id": "ext_id"})
    mock_get_extension.assert_called_once_with("tenant_id", "ext_id", db.session)


def test_validate_config_missing_id():
    with pytest.raises(ValueError, match="api_based_extension_id is required"):
        ApiExternalDataTool.validate_config("tenant_id", {})


@patch("core.external_data_tool.api.api.ApiExternalDataTool._get_api_based_extension")
def test_validate_config_invalid_id(mock_get_extension):
    mock_get_extension.return_value = None
    with pytest.raises(ValueError, match="api_based_extension_id is invalid"):
        ApiExternalDataTool.validate_config("tenant_id", {"api_based_extension_id": "ext_id"})


@pytest.fixture
def api_tool():
    # Use standard kwargs as it inherits from ExternalDataTool which is typically a Pydantic BaseModel
    return ApiExternalDataTool(
        tenant_id="tenant_id", app_id="app_id", variable="var1", config={"api_based_extension_id": "ext_id"}
    )


@patch("core.external_data_tool.api.api.encrypter")
@patch("core.external_data_tool.api.api.APIBasedExtensionRequestor")
@patch("core.external_data_tool.api.api.ApiExternalDataTool._get_api_based_extension")
def test_query_success(mock_get_ext, mock_requestor_class, mock_encrypter, api_tool):
    mock_get_ext.return_value = APIBasedExtension(
        tenant_id="tenant_id", name="Test extension", api_endpoint="http://api", api_key="encrypted_key"
    )
    mock_encrypter.decrypt_token.return_value = "decrypted_key"

    mock_requestor = mock_requestor_class.return_value
    mock_requestor.request.return_value = {"result": "success_result"}

    res = api_tool.query({"input1": "value1"}, "query_str")

    assert res == "success_result"

    mock_get_ext.assert_called_once_with("tenant_id", "ext_id", db.session)
    mock_requestor_class.assert_called_once_with(api_endpoint="http://api", api_key="decrypted_key")
    mock_requestor.request.assert_called_once_with(
        point=APIBasedExtensionPoint.APP_EXTERNAL_DATA_TOOL_QUERY,
        params={"app_id": "app_id", "tool_variable": "var1", "inputs": {"input1": "value1"}, "query": "query_str"},
    )


def test_query_missing_config():
    api_tool = ApiExternalDataTool(tenant_id="tenant_id", app_id="app_id", variable="var1")
    api_tool.config = None  # Force None
    with pytest.raises(ValueError, match="config is required"):
        api_tool.query({}, "")


def test_query_missing_extension_id():
    api_tool = ApiExternalDataTool(tenant_id="tenant_id", app_id="app_id", variable="var1", config={"dummy": "value"})
    with pytest.raises(AssertionError, match="api_based_extension_id is required"):
        api_tool.query({}, "")


@patch("core.external_data_tool.api.api.ApiExternalDataTool._get_api_based_extension")
def test_query_invalid_extension(mock_get_ext, api_tool):
    mock_get_ext.return_value = None
    with pytest.raises(ValueError, match=".*error: api_based_extension_id is invalid"):
        api_tool.query({}, "")


@patch("core.external_data_tool.api.api.encrypter")
@patch("core.external_data_tool.api.api.APIBasedExtensionRequestor")
@patch("core.external_data_tool.api.api.ApiExternalDataTool._get_api_based_extension")
def test_query_requestor_init_error(mock_get_ext, mock_requestor_class, mock_encrypter, api_tool):
    mock_get_ext.return_value = APIBasedExtension(
        tenant_id="tenant_id", name="Test extension", api_endpoint="http://api", api_key="encrypted_key"
    )
    mock_encrypter.decrypt_token.return_value = "decrypted_key"

    mock_requestor_class.side_effect = Exception("init error")

    with pytest.raises(ValueError, match=".*error: init error"):
        api_tool.query({}, "")


@patch("core.external_data_tool.api.api.encrypter")
@patch("core.external_data_tool.api.api.APIBasedExtensionRequestor")
@patch("core.external_data_tool.api.api.ApiExternalDataTool._get_api_based_extension")
def test_query_no_result_in_response(mock_get_ext, mock_requestor_class, mock_encrypter, api_tool):
    mock_get_ext.return_value = APIBasedExtension(
        tenant_id="tenant_id", name="Test extension", api_endpoint="http://api", api_key="encrypted_key"
    )
    mock_encrypter.decrypt_token.return_value = "decrypted_key"

    mock_requestor = mock_requestor_class.return_value
    mock_requestor.request.return_value = {"other": "value"}

    with pytest.raises(ValueError, match=".*error: result not found in response"):
        api_tool.query({}, "")


@patch("core.external_data_tool.api.api.encrypter")
@patch("core.external_data_tool.api.api.APIBasedExtensionRequestor")
@patch("core.external_data_tool.api.api.ApiExternalDataTool._get_api_based_extension")
def test_query_result_not_string(mock_get_ext, mock_requestor_class, mock_encrypter, api_tool):
    mock_get_ext.return_value = APIBasedExtension(
        tenant_id="tenant_id", name="Test extension", api_endpoint="http://api", api_key="encrypted_key"
    )
    mock_encrypter.decrypt_token.return_value = "decrypted_key"

    mock_requestor = mock_requestor_class.return_value
    mock_requestor.request.return_value = {"result": 123}  # Not a string

    with pytest.raises(ValueError, match=".*error: result is not string"):
        api_tool.query({}, "")


def test_get_api_based_extension(sqlite_session: Session) -> None:
    target = APIBasedExtension(
        tenant_id="tenant-1",
        name="Target extension",
        api_endpoint="https://example.com/fetch",
        api_key="encrypted-key",
    )
    target.id = "ext-1"
    other_tenant = APIBasedExtension(
        tenant_id="tenant-2",
        name="Other extension",
        api_endpoint="https://example.com/other",
        api_key="other-key",
    )
    other_tenant.id = "ext-2"
    sqlite_session.add_all((target, other_tenant))
    sqlite_session.commit()

    result = ApiExternalDataTool._get_api_based_extension("tenant-1", "ext-1", sqlite_session)

    assert result is target
    assert ApiExternalDataTool._get_api_based_extension("tenant-1", "ext-2", sqlite_session) is None
