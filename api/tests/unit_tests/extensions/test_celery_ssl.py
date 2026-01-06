"""Tests for Celery SSL configuration."""

import ssl
from unittest.mock import MagicMock, patch


class TestCelerySSLConfiguration:
    """Test suite for Celery SSL configuration."""

    def test_get_celery_ssl_options_when_ssl_disabled(self):
        """Test SSL options when BROKER_USE_SSL is False."""
        from configs import DifyConfig

        dify_config = DifyConfig(CELERY_BROKER_URL="redis://localhost:6379/0")

        with patch("extensions.ext_celery.dify_config", dify_config):
            from extensions.ext_celery import _get_celery_ssl_options

            result = _get_celery_ssl_options()
            assert result is None

    def test_get_celery_ssl_options_when_broker_not_redis(self):
        """Test SSL options when broker is not Redis."""
        mock_config = MagicMock()
        mock_config.CELERY_BROKER_URL = "amqp://localhost:5672"

        with patch("extensions.ext_celery.dify_config", mock_config):
            from extensions.ext_celery import _get_celery_ssl_options

            result = _get_celery_ssl_options()
            assert result is None

    def test_get_celery_ssl_options_with_cert_none(self):
        """Test SSL options with CERT_NONE requirement."""
        mock_config = MagicMock()
        mock_config.CELERY_BROKER_URL = "redis://localhost:6379/0"
        mock_config.REDIS_SSL_CERT_REQS = "CERT_NONE"
        mock_config.REDIS_SSL_CA_CERTS = None
        mock_config.REDIS_SSL_CERTFILE = None
        mock_config.REDIS_SSL_KEYFILE = None

        with patch("extensions.ext_celery.dify_config", mock_config):
            from extensions.ext_celery import _get_celery_ssl_options

            result = _get_celery_ssl_options()
            assert result is not None
            assert result["ssl_cert_reqs"] == ssl.CERT_NONE
            assert result["ssl_ca_certs"] is None
            assert result["ssl_certfile"] is None
            assert result["ssl_keyfile"] is None

    def test_get_celery_ssl_options_with_cert_required(self):
        """Test SSL options with CERT_REQUIRED and certificates."""
        mock_config = MagicMock()
        mock_config.CELERY_BROKER_URL = "rediss://localhost:6380/0"
        mock_config.REDIS_SSL_CERT_REQS = "CERT_REQUIRED"
        mock_config.REDIS_SSL_CA_CERTS = "/path/to/ca.crt"
        mock_config.REDIS_SSL_CERTFILE = "/path/to/client.crt"
        mock_config.REDIS_SSL_KEYFILE = "/path/to/client.key"

        with patch("extensions.ext_celery.dify_config", mock_config):
            from extensions.ext_celery import _get_celery_ssl_options

            result = _get_celery_ssl_options()
            assert result is not None
            assert result["ssl_cert_reqs"] == ssl.CERT_REQUIRED
            assert result["ssl_ca_certs"] == "/path/to/ca.crt"
            assert result["ssl_certfile"] == "/path/to/client.crt"
            assert result["ssl_keyfile"] == "/path/to/client.key"

    def test_get_celery_ssl_options_with_cert_optional(self):
        """Test SSL options with CERT_OPTIONAL requirement."""
        mock_config = MagicMock()
        mock_config.CELERY_BROKER_URL = "redis://localhost:6379/0"
        mock_config.REDIS_SSL_CERT_REQS = "CERT_OPTIONAL"
        mock_config.REDIS_SSL_CA_CERTS = "/path/to/ca.crt"
        mock_config.REDIS_SSL_CERTFILE = None
        mock_config.REDIS_SSL_KEYFILE = None

        with patch("extensions.ext_celery.dify_config", mock_config):
            from extensions.ext_celery import _get_celery_ssl_options

            result = _get_celery_ssl_options()
            assert result is not None
            assert result["ssl_cert_reqs"] == ssl.CERT_OPTIONAL
            assert result["ssl_ca_certs"] == "/path/to/ca.crt"

    def test_get_celery_ssl_options_with_invalid_cert_reqs(self):
        """Test SSL options with invalid cert requirement defaults to CERT_NONE."""
        mock_config = MagicMock()
        mock_config.CELERY_BROKER_URL = "redis://localhost:6379/0"
        mock_config.REDIS_SSL_CERT_REQS = "INVALID_VALUE"
        mock_config.REDIS_SSL_CA_CERTS = None
        mock_config.REDIS_SSL_CERTFILE = None
        mock_config.REDIS_SSL_KEYFILE = None

        with patch("extensions.ext_celery.dify_config", mock_config):
            from extensions.ext_celery import _get_celery_ssl_options

            result = _get_celery_ssl_options()
            assert result is not None
            assert result["ssl_cert_reqs"] == ssl.CERT_NONE  # Should default to CERT_NONE

    def test_celery_init_applies_ssl_to_broker_and_backend(self):
        """Test that SSL options are applied to both broker and backend when using Redis."""
        mock_config = MagicMock()
        mock_config.CELERY_BROKER_URL = "redis://localhost:6379/0"
        mock_config.CELERY_BACKEND = "redis"
        mock_config.CELERY_RESULT_BACKEND = "redis://localhost:6379/0"
        mock_config.REDIS_SSL_CERT_REQS = "CERT_NONE"
        mock_config.REDIS_SSL_CA_CERTS = None
        mock_config.REDIS_SSL_CERTFILE = None
        mock_config.REDIS_SSL_KEYFILE = None
        mock_config.CELERY_USE_SENTINEL = False
        mock_config.LOG_FORMAT = "%(message)s"
        mock_config.LOG_TZ = "UTC"
        mock_config.LOG_FILE = None

        # Mock all the scheduler configs
        mock_config.CELERY_BEAT_SCHEDULER_TIME = 1
        mock_config.ENABLE_CLEAN_EMBEDDING_CACHE_TASK = False
        mock_config.ENABLE_CLEAN_UNUSED_DATASETS_TASK = False
        mock_config.ENABLE_CREATE_TIDB_SERVERLESS_TASK = False
        mock_config.ENABLE_UPDATE_TIDB_SERVERLESS_STATUS_TASK = False
        mock_config.ENABLE_CLEAN_MESSAGES = False
        mock_config.ENABLE_MAIL_CLEAN_DOCUMENT_NOTIFY_TASK = False
        mock_config.ENABLE_DATASETS_QUEUE_MONITOR = False
        mock_config.ENABLE_CHECK_UPGRADABLE_PLUGIN_TASK = False
        mock_config.ENABLE_WORKFLOW_SCHEDULE_POLLER_TASK = False
        mock_config.WORKFLOW_SCHEDULE_POLLER_INTERVAL = 1
        mock_config.WORKFLOW_SCHEDULE_POLLER_BATCH_SIZE = 100
        mock_config.WORKFLOW_SCHEDULE_MAX_DISPATCH_PER_TICK = 0
        mock_config.ENABLE_TRIGGER_PROVIDER_REFRESH_TASK = False
        mock_config.TRIGGER_PROVIDER_REFRESH_INTERVAL = 15

        with patch("extensions.ext_celery.dify_config", mock_config):
            from dify_app import DifyApp
            from extensions.ext_celery import init_app

            app = DifyApp(__name__)
            celery_app = init_app(app)

            # Check that SSL options were applied
            assert "broker_use_ssl" in celery_app.conf
            assert celery_app.conf["broker_use_ssl"] is not None
            assert celery_app.conf["broker_use_ssl"]["ssl_cert_reqs"] == ssl.CERT_NONE

            # Check that SSL is also applied to Redis backend
            assert "redis_backend_use_ssl" in celery_app.conf
            assert celery_app.conf["redis_backend_use_ssl"] is not None
