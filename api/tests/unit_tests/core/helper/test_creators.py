"""Tests for the Creators Platform helper module."""

from collections.abc import Callable


class TestGetRedirectUrl:
    def test_without_oauth_code(self, config_overrides: Callable[..., None]) -> None:
        config_overrides(
            CREATORS_PLATFORM_API_URL="https://creators.example.com",
        )

        from core.helper.creators import get_redirect_url

        url = get_redirect_url("claim-abc")

        assert "dsl_claim_code=claim-abc" in url
        assert "oauth_code" not in url
        assert url.startswith("https://creators.example.com")

    def test_with_oauth_code(self, config_overrides: Callable[..., None]) -> None:
        config_overrides(
            CREATORS_PLATFORM_API_URL="https://creators.example.com",
        )

        from core.helper.creators import get_redirect_url

        url = get_redirect_url("claim-abc", oauth_code="oauth-code-123")

        assert "dsl_claim_code=claim-abc" in url
        assert "oauth_code=oauth-code-123" in url

    def test_strips_trailing_slash(self, config_overrides: Callable[..., None]) -> None:
        config_overrides(
            CREATORS_PLATFORM_API_URL="https://creators.example.com/",
        )

        from core.helper.creators import get_redirect_url

        url = get_redirect_url("claim-abc")

        assert url.startswith("https://creators.example.com?")
        assert "creators.example.com/?" not in url
