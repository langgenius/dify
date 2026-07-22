"""Tests for Azure Managed Identity Redis helpers."""

from unittest.mock import MagicMock, patch

import pytest

from configs import DifyConfig
from configs.middleware.cache.redis_config import RedisConfig
from extensions.azure import (
    AzureEntraIdCredentialProvider,
    apply_azure_celery_broker_auth,
    apply_azure_redis_auth,
    get_azure_credential_provider,
)


class TestAzureConfigValidation:
    """Test pydantic config validation for Azure Managed Redis constraints."""

    def test_redis_db_0_passes(self):
        config = RedisConfig(REDIS_USE_AZURE_MANAGED_IDENTITY=True, REDIS_DB=0)
        assert config.REDIS_DB == 0

    def test_redis_db_nonzero_raises(self):
        with pytest.raises(ValueError, match="only supports db 0"):
            RedisConfig(REDIS_USE_AZURE_MANAGED_IDENTITY=True, REDIS_DB=1)

    def test_redis_db_nonzero_without_azure_mi_passes(self):
        config = RedisConfig(REDIS_USE_AZURE_MANAGED_IDENTITY=False, REDIS_DB=5)
        assert config.REDIS_DB == 5

    def test_redis_db_default_with_azure_mi_passes(self):
        config = RedisConfig(REDIS_USE_AZURE_MANAGED_IDENTITY=True)
        assert config.REDIS_DB == 0

    def test_celery_broker_url_db_0_with_azure_mi_passes(self):
        config = DifyConfig(
            REDIS_USE_AZURE_MANAGED_IDENTITY=True,
            REDIS_DB=0,
            CELERY_BROKER_URL="rediss://:@host:10000/0",
        )
        assert config.CELERY_BROKER_URL == "rediss://:@host:10000/0"

    def test_celery_broker_url_nonzero_db_with_azure_mi_raises(self):
        with pytest.raises(ValueError, match="only supports db 0"):
            DifyConfig(
                REDIS_USE_AZURE_MANAGED_IDENTITY=True,
                REDIS_DB=0,
                CELERY_BROKER_URL="rediss://:@host:10000/1",
            )

    def test_celery_broker_url_nonzero_db_without_azure_mi_passes(self):
        config = DifyConfig(
            REDIS_USE_AZURE_MANAGED_IDENTITY=False,
            CELERY_BROKER_URL="redis://localhost:6379/5",
        )
        assert config.CELERY_BROKER_URL == "redis://localhost:6379/5"


class TestApplyAzureCeleryBrokerAuth:
    """Test apply_azure_celery_broker_auth Celery configuration."""

    def test_sets_broker_read_and_write_urls(self):
        mock_app = MagicMock()
        apply_azure_celery_broker_auth(mock_app, "rediss://:@host:10000/0")

        mock_app.conf.update.assert_called_once()
        call_kwargs = mock_app.conf.update.call_args[1]

        assert "broker_read_url" in call_kwargs
        assert "broker_write_url" in call_kwargs

    def test_appends_credential_provider_query_param(self):
        mock_app = MagicMock()
        apply_azure_celery_broker_auth(mock_app, "rediss://:@host:10000/0")

        call_kwargs = mock_app.conf.update.call_args[1]
        expected_param = "credential_provider=extensions.azure.AzureEntraIdCredentialProvider"
        assert expected_param in call_kwargs["broker_read_url"]
        assert expected_param in call_kwargs["broker_write_url"]

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

    def test_get_credentials_delegates_to_inner(self):
        provider = AzureEntraIdCredentialProvider.__new__(AzureEntraIdCredentialProvider)
        mock_inner = MagicMock()
        mock_inner.get_credentials.return_value = ("user-oid", "jwt-token")
        provider._inner = mock_inner

        result = provider.get_credentials()
        assert result == ("user-oid", "jwt-token")


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


class TestApplyAzureRedisAuth:
    """Test apply_azure_redis_auth params mutation."""

    @patch("extensions.azure.get_azure_credential_provider")
    def test_removes_username_and_password(self, mock_get_provider):
        mock_get_provider.return_value = MagicMock()
        params: dict = {"host": "localhost", "username": "user", "password": "secret"}

        apply_azure_redis_auth(params)

        assert "username" not in params
        assert "password" not in params

    @patch("extensions.azure.get_azure_credential_provider")
    def test_injects_credential_provider(self, mock_get_provider):
        sentinel = MagicMock()
        mock_get_provider.return_value = sentinel
        params: dict = {"host": "localhost", "username": "u", "password": "p"}

        apply_azure_redis_auth(params)

        assert params["credential_provider"] is sentinel

    @patch("extensions.azure.get_azure_credential_provider")
    def test_handles_missing_username_password(self, mock_get_provider):
        mock_get_provider.return_value = MagicMock()
        params: dict = {"host": "localhost"}

        apply_azure_redis_auth(params)

        assert "username" not in params
        assert "password" not in params
        assert "credential_provider" in params
