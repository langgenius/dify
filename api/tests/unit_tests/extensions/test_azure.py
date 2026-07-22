"""Tests for Azure Managed Identity Redis helpers."""

from unittest.mock import MagicMock, patch

from extensions.azure import (
    AzureEntraIdCredentialProvider,
    _force_redis_db_zero,
    apply_azure_celery_broker_auth,
    get_azure_credential_provider,
)


class TestForceRedisDbZero:
    """Test _force_redis_db_zero URL rewriting."""

    def test_replaces_db_1_with_0(self):
        url = "rediss://:@host.redis.azure.net:10000/1"
        assert _force_redis_db_zero(url) == "rediss://:@host.redis.azure.net:10000/0"

    def test_replaces_db_15_with_0(self):
        url = "redis://localhost:6379/15"
        assert _force_redis_db_zero(url) == "redis://localhost:6379/0"

    def test_keeps_db_0_unchanged(self):
        url = "rediss://:@host.redis.azure.net:10000/0"
        assert _force_redis_db_zero(url) == url

    def test_preserves_query_params(self):
        url = "rediss://:@host.redis.azure.net:10000/3?timeout=5"
        result = _force_redis_db_zero(url)
        assert "/0?" in result
        assert "timeout=5" in result

    def test_handles_no_db_in_path(self):
        url = "redis://localhost:6379"
        result = _force_redis_db_zero(url)
        assert result == "redis://localhost:6379/0"

    def test_preserves_credentials_in_url(self):
        url = "rediss://user:pass@host.redis.azure.net:10000/2"
        result = _force_redis_db_zero(url)
        assert result == "rediss://user:pass@host.redis.azure.net:10000/0"


class TestApplyAzureCeleryBrokerAuth:
    """Test apply_azure_celery_broker_auth Celery configuration."""

    def test_sets_broker_read_and_write_urls(self):
        mock_app = MagicMock()
        apply_azure_celery_broker_auth(mock_app, "rediss://:@host:10000/1")

        mock_app.conf.update.assert_called_once()
        call_kwargs = mock_app.conf.update.call_args[1]

        assert "broker_url" in call_kwargs
        assert "broker_read_url" in call_kwargs
        assert "broker_write_url" in call_kwargs

    def test_forces_db_zero_in_all_urls(self):
        mock_app = MagicMock()
        apply_azure_celery_broker_auth(mock_app, "rediss://:@host:10000/5")

        call_kwargs = mock_app.conf.update.call_args[1]
        assert "/0" in call_kwargs["broker_url"]
        assert "/5" not in call_kwargs["broker_url"]
        assert "/0?" in call_kwargs["broker_read_url"]
        assert "/0?" in call_kwargs["broker_write_url"]

    def test_appends_credential_provider_query_param(self):
        mock_app = MagicMock()
        apply_azure_celery_broker_auth(mock_app, "rediss://:@host:10000/0")

        call_kwargs = mock_app.conf.update.call_args[1]
        expected_param = "credential_provider=extensions.azure.AzureEntraIdCredentialProvider"
        assert expected_param in call_kwargs["broker_read_url"]
        assert expected_param in call_kwargs["broker_write_url"]
        assert expected_param not in call_kwargs["broker_url"]

    def test_uses_ampersand_when_url_already_has_query(self):
        mock_app = MagicMock()
        apply_azure_celery_broker_auth(mock_app, "rediss://:@host:10000/0?timeout=5")

        call_kwargs = mock_app.conf.update.call_args[1]
        assert "&credential_provider=" in call_kwargs["broker_read_url"]

    def test_uses_question_mark_when_url_has_no_query(self):
        mock_app = MagicMock()
        apply_azure_celery_broker_auth(mock_app, "rediss://:@host:10000/0")

        call_kwargs = mock_app.conf.update.call_args[1]
        assert "?credential_provider=" in call_kwargs["broker_read_url"]


class TestAzureEntraIdCredentialProvider:
    """Test AzureEntraIdCredentialProvider wrapper."""

    @patch("extensions.azure.AzureEntraIdCredentialProvider.__init__", return_value=None)
    def test_get_credentials_returns_two_tuple(self, _mock_init):
        provider = AzureEntraIdCredentialProvider.__new__(AzureEntraIdCredentialProvider)
        mock_inner = MagicMock()
        mock_inner.get_credentials.return_value = ("user-oid", "jwt-token")
        provider._inner = mock_inner

        result = provider.get_credentials()
        assert result == ("user-oid", "jwt-token")

    @patch("extensions.azure.AzureEntraIdCredentialProvider.__init__", return_value=None)
    def test_get_credentials_handles_single_value(self, _mock_init):
        provider = AzureEntraIdCredentialProvider.__new__(AzureEntraIdCredentialProvider)
        mock_inner = MagicMock()
        mock_inner.get_credentials.return_value = ("token-only",)
        provider._inner = mock_inner

        result = provider.get_credentials()
        assert result == ("", "token-only")


class TestGetAzureCredentialProvider:
    """Test get_azure_credential_provider factory."""

    @patch("redis_entraid.cred_provider.create_from_default_azure_credential")
    def test_calls_create_with_correct_scope(self, mock_create):
        mock_create.return_value = MagicMock()
        get_azure_credential_provider()

        mock_create.assert_called_once_with(
            scopes=("https://redis.azure.com/.default",),
        )

    @patch("redis_entraid.cred_provider.create_from_default_azure_credential")
    def test_returns_provider_instance(self, mock_create):
        sentinel = MagicMock()
        mock_create.return_value = sentinel

        result = get_azure_credential_provider()
        assert result is sentinel
