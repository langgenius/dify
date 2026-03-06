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

from controllers.inner_api.plugin.plugin import (
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


def _extract_raw_post(cls):
    """Extract the raw post() method from a plugin endpoint class.

    Plugin endpoint methods are wrapped by several decorators (get_user_tenant,
    setup_required, plugin_inner_api_only, plugin_data).  The plugin_data
    decorator does not use @wraps, so inspect.unwrap() stops there.  This
    helper walks the closure of the innermost plugin_data wrapper to retrieve
    the original post(self, user_model, tenant_model, payload) function.
    """
    bottom = inspect.unwrap(cls.post)
    # plugin_data's decorated_view closes over (payload_type, view_func)
    return bottom.__closure__[1].cell_contents


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
        mock_tenant = MagicMock()
        mock_user = MagicMock()
        mock_payload = MagicMock()

        # Act — extract raw post() bypassing all decorators including plugin_data
        raw_post = _extract_raw_post(PluginInvokeEncryptApi)
        result = raw_post(api_instance, user_model=mock_user, tenant_model=mock_tenant, payload=mock_payload)

        # Assert
        mock_encrypter.invoke_encrypt.assert_called_once_with(mock_tenant, mock_payload)
        assert result["data"] == {"encrypted": "data"}
        assert result.get("error") is None or result.get("error") == ""

    @patch("controllers.inner_api.plugin.plugin.PluginEncrypter")
    def test_post_returns_error_on_exception(self, mock_encrypter, api_instance, app: Flask):
        """Test that post() catches exceptions and returns error response"""
        # Arrange
        mock_encrypter.invoke_encrypt.side_effect = RuntimeError("encrypt failed")
        mock_tenant = MagicMock()
        mock_user = MagicMock()
        mock_payload = MagicMock()

        # Act
        raw_post = _extract_raw_post(PluginInvokeEncryptApi)
        result = raw_post(api_instance, user_model=mock_user, tenant_model=mock_tenant, payload=mock_payload)

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

    @patch("controllers.inner_api.plugin.plugin.get_signed_file_url_for_plugin")
    def test_post_returns_signed_url(self, mock_get_url, api_instance, app: Flask):
        """Test that post() generates a signed URL and returns it"""
        # Arrange
        mock_get_url.return_value = "https://storage.example.com/signed-upload-url"
        mock_tenant = MagicMock()
        mock_tenant.id = "tenant-id"
        mock_user = MagicMock()
        mock_user.id = "user-id"
        mock_payload = MagicMock()
        mock_payload.filename = "test.pdf"
        mock_payload.mimetype = "application/pdf"

        # Act
        raw_post = _extract_raw_post(PluginUploadFileRequestApi)
        result = raw_post(api_instance, user_model=mock_user, tenant_model=mock_tenant, payload=mock_payload)

        # Assert
        mock_get_url.assert_called_once_with(
            filename="test.pdf", mimetype="application/pdf", tenant_id="tenant-id", user_id="user-id"
        )
        assert result["data"]["url"] == "https://storage.example.com/signed-upload-url"


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
        mock_tenant = MagicMock()
        mock_tenant.id = "tenant-id"
        mock_user = MagicMock()
        mock_payload = MagicMock()
        mock_payload.app_id = "app-123"

        # Act
        raw_post = _extract_raw_post(PluginFetchAppInfoApi)
        result = raw_post(api_instance, user_model=mock_user, tenant_model=mock_tenant, payload=mock_payload)

        # Assert
        mock_invocation.fetch_app_info.assert_called_once_with("app-123", "tenant-id")
        assert result["data"] == {"app_name": "My App", "mode": "chat"}
