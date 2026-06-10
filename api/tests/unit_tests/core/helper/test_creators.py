"""Tests for the Creators Platform helper module."""

from unittest.mock import MagicMock, patch

import httpx
import pytest
from yarl import URL


@pytest.fixture(autouse=True)
def _patch_creators_url(monkeypatch: pytest.MonkeyPatch):
    """Patch the module-level creators_platform_api_url for all tests."""
    monkeypatch.setattr(
        "core.helper.creators.creators_platform_api_url",
        URL("https://creators.example.com"),
    )


class TestUploadDSL:
    @patch("core.helper.creators.httpx.post")
    def test_returns_claim_code(self, mock_post):
        mock_response = MagicMock(spec=httpx.Response)
        mock_response.json.return_value = {"data": {"claim_code": "abc123"}}
        mock_response.raise_for_status = MagicMock()
        mock_post.return_value = mock_response

        from core.helper.creators import upload_dsl

        result = upload_dsl(b"app: demo", "demo.yaml")

        assert result == "abc123"
        mock_post.assert_called_once()
        call_kwargs = mock_post.call_args
        assert "anonymous-upload" in call_kwargs.args[0]
        assert call_kwargs.kwargs["timeout"] == 30

    @patch("core.helper.creators.httpx.post")
    def test_raises_on_missing_claim_code(self, mock_post):
        mock_response = MagicMock(spec=httpx.Response)
        mock_response.json.return_value = {"data": {}}
        mock_response.raise_for_status = MagicMock()
        mock_post.return_value = mock_response

        from core.helper.creators import upload_dsl

        with pytest.raises(ValueError, match="claim_code"):
            upload_dsl(b"app: demo")

    @patch("core.helper.creators.httpx.post")
    def test_raises_on_http_error(self, mock_post):
        mock_response = MagicMock(spec=httpx.Response)
        mock_response.raise_for_status.side_effect = httpx.HTTPStatusError(
            "Server Error",
            request=MagicMock(),
            response=MagicMock(),
        )
        mock_post.return_value = mock_response

        from core.helper.creators import upload_dsl

        with pytest.raises(httpx.HTTPStatusError):
            upload_dsl(b"app: demo")


class TestGetRedirectUrl:
    @patch("core.helper.creators.dify_config")
    def test_without_oauth_client_id(self, mock_config):
        mock_config.CREATORS_PLATFORM_API_URL = "https://creators.example.com"
        mock_config.CREATORS_PLATFORM_OAUTH_CLIENT_ID = ""

        from core.helper.creators import get_redirect_url

        url = get_redirect_url("user-1", "claim-abc")

        assert "dsl_claim_code=claim-abc" in url
        assert "oauth_code" not in url
        assert url.startswith("https://creators.example.com")

    @patch("core.helper.creators.dify_config")
    def test_with_oauth_client_id(self, mock_config):
        mock_config.CREATORS_PLATFORM_API_URL = "https://creators.example.com"
        mock_config.CREATORS_PLATFORM_OAUTH_CLIENT_ID = "client-xyz"

        with patch(
            "services.oauth_server.OAuthServerService.sign_oauth_authorization_code",
            return_value="oauth-code-123",
        ) as mock_sign:
            from core.helper.creators import get_redirect_url

            url = get_redirect_url("user-1", "claim-abc")

            mock_sign.assert_called_once_with("client-xyz", "user-1")
            assert "dsl_claim_code=claim-abc" in url
            assert "oauth_code=oauth-code-123" in url

    @patch("core.helper.creators.dify_config")
    def test_strips_trailing_slash(self, mock_config):
        mock_config.CREATORS_PLATFORM_API_URL = "https://creators.example.com/"
        mock_config.CREATORS_PLATFORM_OAUTH_CLIENT_ID = ""

        from core.helper.creators import get_redirect_url

        url = get_redirect_url("user-1", "claim-abc")

        assert url.startswith("https://creators.example.com?")
        assert "creators.example.com/?" not in url
