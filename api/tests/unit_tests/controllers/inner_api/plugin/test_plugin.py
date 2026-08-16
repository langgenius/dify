"""
Unit tests for inner_api plugin endpoints

Tests endpoint structure (method existence) for all plugin APIs, plus
handler-level logic tests for representative non-streaming endpoints.
Auth/setup decorators are tested separately in test_auth_wraps.py;
handler tests use inspect.unwrap() to bypass them.
"""

import inspect
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from sqlalchemy.orm import Session

from controllers.inner_api.plugin import plugin as plugin_module
from controllers.inner_api.plugin.plugin import (
    PluginDownloadFileRequestApi,
    PluginFetchAppInfoApi,
    PluginInvokeAppApi,
    PluginInvokeEncryptApi,
    PluginInvokeLLMApi,
    PluginInvokeLLMWithStructuredOutputApi,
    PluginInvokeModerationApi,
    PluginInvokeParameterExtractorNodeApi,
    PluginInvokeQuestionClassifierNodeApi,
    PluginInvokeRerankApi,
    PluginInvokeSpeech2TextApi,
    PluginInvokeSummaryApi,
    PluginInvokeTextEmbeddingApi,
    PluginInvokeToolApi,
    PluginInvokeTTSApi,
    PluginUploadFileRequestApi,
)
from core.workflow.file_reference import build_file_reference
from models import Account, Tenant


def _tenant() -> Tenant:
    tenant = Tenant(name="Test Tenant")
    tenant.id = "tenant-id"
    return tenant


def _user() -> Account:
    user = Account(name="Test User", email="user@example.com")
    user.id = "user-id"
    return user


def _extract_raw_post(cls):
    """Extract the raw post() method from a plugin endpoint class.

    Plugin endpoint methods are wrapped by several decorators (get_user_tenant,
    setup_required, plugin_inner_api_only, plugin_data). These decorators
    use @wraps where possible. This helper ensures we retrieve the original
    post(self, user_model, tenant_model, payload) function by unwrapping
    and, if necessary, walking the closure of the innermost wrapper.
    """
    bottom = inspect.unwrap(cls.post)

    # If unwrap() didn't get us to the raw function (e.g. if a decorator
    # missed @wraps), try to extract it from the closure if it looks like
    # a plugin_data or similar wrapper that closes over 'view_func'.
    if hasattr(bottom, "__code__") and "view_func" in bottom.__code__.co_freevars:
        try:
            idx = bottom.__code__.co_freevars.index("view_func")
            return bottom.__closure__[idx].cell_contents
        except (AttributeError, TypeError, IndexError):
            pass

    return bottom


class TestPluginInvokeLLMApi:
    """Test PluginInvokeLLMApi endpoint structure"""

    @pytest.fixture
    def api_instance(self):
        return PluginInvokeLLMApi()

    def test_has_post_method(self, api_instance):
        """Test that endpoint has post method"""
        assert hasattr(api_instance, "post")
        assert callable(api_instance.post)


class TestPluginInvokeLLMWithStructuredOutputApi:
    """Test PluginInvokeLLMWithStructuredOutputApi endpoint"""

    @pytest.fixture
    def api_instance(self):
        return PluginInvokeLLMWithStructuredOutputApi()

    def test_has_post_method(self, api_instance):
        assert hasattr(api_instance, "post")
        assert callable(api_instance.post)


class TestPluginInvokeTextEmbeddingApi:
    """Test PluginInvokeTextEmbeddingApi endpoint"""

    @pytest.fixture
    def api_instance(self):
        return PluginInvokeTextEmbeddingApi()

    def test_has_post_method(self, api_instance):
        assert hasattr(api_instance, "post")
        assert callable(api_instance.post)


class TestPluginInvokeRerankApi:
    """Test PluginInvokeRerankApi endpoint"""

    @pytest.fixture
    def api_instance(self):
        return PluginInvokeRerankApi()

    def test_has_post_method(self, api_instance):
        assert hasattr(api_instance, "post")
        assert callable(api_instance.post)


class TestPluginInvokeTTSApi:
    """Test PluginInvokeTTSApi endpoint"""

    @pytest.fixture
    def api_instance(self):
        return PluginInvokeTTSApi()

    def test_has_post_method(self, api_instance):
        assert hasattr(api_instance, "post")
        assert callable(api_instance.post)


class TestPluginInvokeSpeech2TextApi:
    """Test PluginInvokeSpeech2TextApi endpoint"""

    @pytest.fixture
    def api_instance(self):
        return PluginInvokeSpeech2TextApi()

    def test_has_post_method(self, api_instance):
        assert hasattr(api_instance, "post")
        assert callable(api_instance.post)


class TestPluginInvokeModerationApi:
    """Test PluginInvokeModerationApi endpoint"""

    @pytest.fixture
    def api_instance(self):
        return PluginInvokeModerationApi()

    def test_has_post_method(self, api_instance):
        assert hasattr(api_instance, "post")
        assert callable(api_instance.post)


class TestPluginInvokeToolApi:
    """Test PluginInvokeToolApi endpoint"""

    @pytest.fixture
    def api_instance(self):
        return PluginInvokeToolApi()

    def test_has_post_method(self, api_instance):
        assert hasattr(api_instance, "post")
        assert callable(api_instance.post)


class TestPluginInvokeParameterExtractorNodeApi:
    """Test PluginInvokeParameterExtractorNodeApi endpoint"""

    @pytest.fixture
    def api_instance(self):
        return PluginInvokeParameterExtractorNodeApi()

    def test_has_post_method(self, api_instance):
        assert hasattr(api_instance, "post")
        assert callable(api_instance.post)


class TestPluginInvokeQuestionClassifierNodeApi:
    """Test PluginInvokeQuestionClassifierNodeApi endpoint"""

    @pytest.fixture
    def api_instance(self):
        return PluginInvokeQuestionClassifierNodeApi()

    def test_has_post_method(self, api_instance):
        assert hasattr(api_instance, "post")
        assert callable(api_instance.post)


class TestPluginInvokeAppApi:
    """Test PluginInvokeAppApi endpoint"""

    @pytest.fixture
    def api_instance(self):
        return PluginInvokeAppApi()

    def test_has_post_method(self, api_instance):
        assert hasattr(api_instance, "post")
        assert callable(api_instance.post)


class TestPluginInvokeEncryptApi:
    """Test PluginInvokeEncryptApi endpoint structure and handler logic"""

    @pytest.fixture
    def api_instance(self):
        return PluginInvokeEncryptApi()

    def test_has_post_method(self, api_instance):
        assert hasattr(api_instance, "post")
        assert callable(api_instance.post)

    @patch("controllers.inner_api.plugin.plugin.PluginEncrypter")
    def test_post_returns_encrypted_data(self, mock_encrypter, api_instance, app: Flask):
        """Test that post() delegates to PluginEncrypter and returns model_dump output"""
        # Arrange
        mock_encrypter.invoke_encrypt.return_value = {"encrypted": "data"}
        tenant = _tenant()
        user = _user()
        mock_payload = MagicMock()

        # Act — extract raw post() bypassing all decorators including plugin_data
        raw_post = _extract_raw_post(PluginInvokeEncryptApi)
        result = raw_post(api_instance, user_model=user, tenant_model=tenant, payload=mock_payload)

        # Assert
        mock_encrypter.invoke_encrypt.assert_called_once_with(tenant, mock_payload)
        assert result["data"] == {"encrypted": "data"}
        assert result.get("error") == ""

    @patch("controllers.inner_api.plugin.plugin.PluginEncrypter")
    def test_post_returns_error_on_exception(self, mock_encrypter, api_instance, app: Flask):
        """Test that post() catches exceptions and returns error response"""
        # Arrange
        mock_encrypter.invoke_encrypt.side_effect = RuntimeError("encrypt failed")
        tenant = _tenant()
        user = _user()
        mock_payload = MagicMock()

        # Act
        raw_post = _extract_raw_post(PluginInvokeEncryptApi)
        result = raw_post(api_instance, user_model=user, tenant_model=tenant, payload=mock_payload)

        # Assert
        assert "encrypt failed" in result["error"]


class TestPluginInvokeSummaryApi:
    """Test PluginInvokeSummaryApi endpoint"""

    @pytest.fixture
    def api_instance(self):
        return PluginInvokeSummaryApi()

    def test_has_post_method(self, api_instance):
        assert hasattr(api_instance, "post")
        assert callable(api_instance.post)


class TestPluginUploadFileRequestApi:
    """Test PluginUploadFileRequestApi endpoint structure and handler logic"""

    @pytest.fixture
    def api_instance(self):
        return PluginUploadFileRequestApi()

    def test_has_post_method(self, api_instance):
        assert hasattr(api_instance, "post")
        assert callable(api_instance.post)

    @patch("controllers.inner_api.plugin.plugin.get_signed_file_uri_for_plugin")
    def test_post_returns_signed_url(self, mock_get_uri, api_instance, app: Flask, monkeypatch: pytest.MonkeyPatch):
        """Test that post() generates a signed URL and returns it"""
        # Arrange
        mock_get_uri.return_value = "/files/upload/for-plugin?sign=1"
        monkeypatch.setattr(plugin_module.dify_config, "INTERNAL_FILES_URL", "http://api:5001")
        tenant = _tenant()
        user = _user()
        mock_payload = MagicMock()
        mock_payload.filename = "test.pdf"
        mock_payload.mimetype = "application/pdf"
        mock_payload.conversation_id = "conversation-id"

        # Act
        raw_post = _extract_raw_post(PluginUploadFileRequestApi)
        result = raw_post(api_instance, user_model=user, tenant_model=tenant, payload=mock_payload)

        # Assert
        mock_get_uri.assert_called_once_with(
            filename="test.pdf",
            mimetype="application/pdf",
            tenant_id="tenant-id",
            user_id="user-id",
            conversation_id="conversation-id",
        )
        assert result["data"]["url"] == "http://api:5001/files/upload/for-plugin?sign=1"


class TestPluginDownloadFileRequestApi:
    """Test PluginDownloadFileRequestApi endpoint structure and handler logic"""

    @pytest.fixture
    def api_instance(self):
        return PluginDownloadFileRequestApi()

    def test_has_post_method(self, api_instance):
        assert hasattr(api_instance, "post")
        assert callable(api_instance.post)

    @pytest.mark.parametrize("sqlite_session", [(Tenant,)], indirect=True)
    @pytest.mark.parametrize(
        ("for_external", "expected_url"),
        [
            (True, "https://files.example.com/files/tools/report.pdf?sign=1"),
            (False, "http://api:5001/files/tools/report.pdf?sign=1"),
        ],
    )
    @patch("controllers.inner_api.plugin.plugin.FileRequestService")
    def test_post_returns_signed_download_url(
        self,
        mock_service_cls,
        api_instance,
        app: Flask,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_session: Session,
        for_external: bool,
        expected_url: str,
    ):
        tenant = Tenant(
            name="Plugin Tenant",
            encrypt_public_key=None,
            plan="basic",
            custom_config=None,
        )
        tenant.id = "49a99e46-bc2c-4885-91fa-47615f6192b5"
        sqlite_session.add(tenant)
        sqlite_session.commit()
        monkeypatch.setattr(plugin_module.db, "session", sqlite_session)
        mock_service = mock_service_cls.return_value
        mock_service.request_download.return_value = MagicMock(
            filename="report.pdf",
            mime_type="application/pdf",
            size=123,
            download_uri="/files/tools/report.pdf?sign=1",
        )
        monkeypatch.setattr(plugin_module.dify_config, "FILES_URL", "https://files.example.com")
        monkeypatch.setattr(plugin_module.dify_config, "INTERNAL_FILES_URL", "http://api:5001")
        mock_payload = MagicMock()
        mock_payload.tenant_id = tenant.id
        mock_payload.user_id = "user-id"
        mock_payload.user_from = "account"
        mock_payload.invoke_from = "debugger"
        mock_payload.for_external = for_external
        reference = build_file_reference(record_id="tool-file-1")
        mock_payload.file.model_dump.return_value = {
            "transfer_method": "tool_file",
            "reference": reference,
        }

        raw_post = _extract_raw_post(PluginDownloadFileRequestApi)
        result = raw_post(api_instance, payload=mock_payload)

        mock_service.request_download.assert_called_once_with(
            tenant_id=tenant.id,
            user_id="user-id",
            user_from="account",
            invoke_from="debugger",
            file_mapping={"transfer_method": "tool_file", "reference": reference},
        )
        assert result["data"] == {
            "filename": "report.pdf",
            "mime_type": "application/pdf",
            "size": 123,
            "download_url": expected_url,
        }


class TestPluginFetchAppInfoApi:
    """Test PluginFetchAppInfoApi endpoint structure and handler logic"""

    @pytest.fixture
    def api_instance(self):
        return PluginFetchAppInfoApi()

    def test_has_post_method(self, api_instance):
        assert hasattr(api_instance, "post")
        assert callable(api_instance.post)

    @patch("controllers.inner_api.plugin.plugin.PluginAppBackwardsInvocation")
    def test_post_returns_app_info(self, mock_invocation, api_instance, app: Flask):
        """Test that post() fetches app info and returns it"""
        # Arrange
        mock_invocation.fetch_app_info.return_value = {"app_name": "My App", "mode": "chat"}
        tenant = _tenant()
        user = _user()
        mock_payload = MagicMock()
        mock_payload.app_id = "app-123"

        # Act
        raw_post = _extract_raw_post(PluginFetchAppInfoApi)
        result = raw_post(api_instance, user_model=user, tenant_model=tenant, payload=mock_payload)

        # Assert
        mock_invocation.fetch_app_info.assert_called_once_with("app-123", "tenant-id")
        assert result["data"] == {"app_name": "My App", "mode": "chat"}
