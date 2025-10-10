"""
Elasticsearch extension for Dify.

This module provides Elasticsearch client configuration and initialization
for storing workflow logs and execution data.
"""

import logging
from typing import Optional

from elasticsearch import Elasticsearch
from flask import Flask

from configs import dify_config

logger = logging.getLogger(__name__)


class ElasticsearchExtension:
    """
    Elasticsearch extension for Flask application.
    
    Provides centralized Elasticsearch client management with proper
    configuration and connection handling.
    """

    def __init__(self):
        self._client: Optional[Elasticsearch] = None

    def init_app(self, app: Flask) -> None:
        """
        Initialize Elasticsearch extension with Flask app.
        
        Args:
            app: Flask application instance
        """
        # Only initialize if Elasticsearch is enabled
        if not dify_config.ELASTICSEARCH_ENABLED:
            logger.info("Elasticsearch is disabled, skipping initialization")
            return

        try:
            # Create Elasticsearch client with configuration
            client_config = {
                "hosts": dify_config.ELASTICSEARCH_HOSTS,
                "timeout": dify_config.ELASTICSEARCH_TIMEOUT,
                "max_retries": dify_config.ELASTICSEARCH_MAX_RETRIES,
                "retry_on_timeout": True,
            }

            # Add authentication if configured
            if dify_config.ELASTICSEARCH_USERNAME and dify_config.ELASTICSEARCH_PASSWORD:
                client_config["http_auth"] = (
                    dify_config.ELASTICSEARCH_USERNAME,
                    dify_config.ELASTICSEARCH_PASSWORD,
                )

            # Add SSL configuration if enabled
            if dify_config.ELASTICSEARCH_USE_SSL:
                client_config["verify_certs"] = dify_config.ELASTICSEARCH_VERIFY_CERTS
                
                if dify_config.ELASTICSEARCH_CA_CERTS:
                    client_config["ca_certs"] = dify_config.ELASTICSEARCH_CA_CERTS

            self._client = Elasticsearch(**client_config)

            # Test connection
            if self._client.ping():
                logger.info("Elasticsearch connection established successfully")
            else:
                logger.error("Failed to connect to Elasticsearch")
                self._client = None

        except Exception as e:
            logger.error("Failed to initialize Elasticsearch client: %s", e)
            self._client = None

        # Store client in app context
        app.elasticsearch = self._client

    @property
    def client(self) -> Optional[Elasticsearch]:
        """
        Get the Elasticsearch client instance.
        
        Returns:
            Elasticsearch client if available, None otherwise
        """
        return self._client

    def is_available(self) -> bool:
        """
        Check if Elasticsearch is available and connected.
        
        Returns:
            True if Elasticsearch is available, False otherwise
        """
        if not self._client:
            return False
        
        try:
            return self._client.ping()
        except Exception:
            return False


# Global Elasticsearch extension instance
elasticsearch = ElasticsearchExtension()


def init_app(app):
    """Initialize Elasticsearch extension with Flask app."""
    elasticsearch.init_app(app)


def is_enabled():
    """Check if Elasticsearch extension is enabled."""
    from configs import dify_config
    return dify_config.ELASTICSEARCH_ENABLED
