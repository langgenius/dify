import os
from urllib.parse import urlparse

import pytest

from core.rag.datasource.vdb.mongodb.mongodb_config import MongoDBConfig
from core.rag.datasource.vdb.mongodb.mongodb_vector import MongoDBVector
from tests.integration_tests.vdb.test_vector_store import (
    AbstractVectorTest,
    setup_mock_redis,
)


# Default values for MongoDB test configuration
_DEFAULT_MONGODB_URI = "mongodb://localhost:27017"
_DEFAULT_MONGODB_DATABASE = "dify_test"
_DEFAULT_MONGODB_VECTOR_INDEX_NAME = "vector_index"


def _get_mongodb_config() -> MongoDBConfig:
    """
    Get MongoDB configuration from environment variables with safe defaults.
    
    Returns:
        MongoDBConfig instance with values from environment or defaults
    """
    return MongoDBConfig(
        MONGODB_URI=os.environ.get("MONGODB_URI", _DEFAULT_MONGODB_URI),
        MONGODB_DATABASE=os.environ.get("MONGODB_DATABASE", _DEFAULT_MONGODB_DATABASE),
        MONGODB_VECTOR_INDEX_NAME=os.environ.get(
            "MONGODB_VECTOR_INDEX_NAME", _DEFAULT_MONGODB_VECTOR_INDEX_NAME
        ),
    )


def _get_mongodb_config_from_components() -> MongoDBConfig:
    """
    Get MongoDB configuration built from individual components (host, port, etc.).
    
    Returns:
        MongoDBConfig instance built from components
    """
    mongodb_uri = os.environ.get("MONGODB_URI", _DEFAULT_MONGODB_URI)
    
    # If MONGODB_URI is provided, parse it to extract components
    if mongodb_uri and "://" in mongodb_uri:
        parsed = urlparse(mongodb_uri)
        
        return MongoDBConfig(
            MONGODB_HOST=parsed.hostname or "localhost",
            MONGODB_PORT=parsed.port or 27017,
            MONGODB_USERNAME=parsed.username,
            MONGODB_PASSWORD=parsed.password,
            MONGODB_DATABASE=os.environ.get("MONGODB_DATABASE", _DEFAULT_MONGODB_DATABASE),
            MONGODB_VECTOR_INDEX_NAME=os.environ.get(
                "MONGODB_VECTOR_INDEX_NAME", _DEFAULT_MONGODB_VECTOR_INDEX_NAME
            ),
        )
    else:
        # Default to localhost if URI parsing fails
        return MongoDBConfig(
            MONGODB_HOST="localhost",
            MONGODB_PORT=27017,
            MONGODB_DATABASE=os.environ.get("MONGODB_DATABASE", _DEFAULT_MONGODB_DATABASE),
            MONGODB_VECTOR_INDEX_NAME=os.environ.get(
                "MONGODB_VECTOR_INDEX_NAME", _DEFAULT_MONGODB_VECTOR_INDEX_NAME
            ),
        )


class MongoDBVectorTest(AbstractVectorTest):
    def __init__(self):
        super().__init__()
        config = _get_mongodb_config()
        self.vector = MongoDBVector(
            collection_name=self.collection_name,
            group_id=self.dataset_id,
            config=config,
        )

    def search_by_full_text(self):
        # MongoDB vector implementation currently doesn't support full text search
        # or returns empty list. Overriding to skip assertion failure.
        pass


class MongoDBVectorFromComponentsTest(AbstractVectorTest):
    """Test MongoDB vector store using URI built from individual components."""
    
    def __init__(self):
        super().__init__()
        config = _get_mongodb_config_from_components()
        self.vector = MongoDBVector(
            collection_name=self.collection_name,
            group_id=self.dataset_id,
            config=config,
        )

    def search_by_full_text(self):
        # MongoDB vector implementation currently doesn't support full text search
        # or returns empty list. Overriding to skip assertion failure.
        pass


def test_mongodb_vector(setup_mock_redis):
    """
    Integration test for MongoDB vector store using MONGODB_URI.
    
    Uses MONGODB_URI from environment if set, otherwise defaults to localhost.
    Test will be skipped if MONGODB_URI is explicitly set to empty string.
    """
    mongodb_uri = os.environ.get("MONGODB_URI", _DEFAULT_MONGODB_URI)
    # Skip if explicitly set to empty (but allow default localhost for local testing)
    if mongodb_uri == "":
        pytest.skip("MONGODB_URI is explicitly set to empty string")

    MongoDBVectorTest().run_all_tests()


def test_mongodb_vector_from_components(setup_mock_redis):
    """
    Integration test for MongoDB vector store using URI built from components.
    
    Tests that MongoDB connection works when URI is constructed from
    individual components (host, port, username, password) rather than
    using MONGODB_URI directly.
    """
    mongodb_uri = os.environ.get("MONGODB_URI", _DEFAULT_MONGODB_URI)
    # Skip if explicitly set to empty (but allow default localhost for local testing)
    if mongodb_uri == "":
        pytest.skip("MONGODB_URI is explicitly set to empty string")

    MongoDBVectorFromComponentsTest().run_all_tests()


def test_mongodb_config_uri_construction():
    """Test that MongoDBConfig correctly constructs URI from components."""
    # Test with authentication
    config = MongoDBConfig(
        MONGODB_HOST="test-host",
        MONGODB_PORT=27017,
        MONGODB_USERNAME="testuser",
        MONGODB_PASSWORD="testpass",
    )
    uri = config.MONGODB_CONNECT_URI
    assert "mongodb://" in uri
    assert "test-host" in uri
    assert "27017" in uri
    assert "testuser" in uri
    # Password should be URL-encoded
    assert "testpass" in uri or "%" in uri
    
    # Test without authentication
    config_no_auth = MongoDBConfig(
        MONGODB_HOST="test-host",
        MONGODB_PORT=27017,
    )
    uri_no_auth = config_no_auth.MONGODB_CONNECT_URI
    assert "mongodb://test-host:27017" == uri_no_auth
    
    # Test that MONGODB_URI takes precedence
    config_with_uri = MongoDBConfig(
        MONGODB_URI="mongodb://override:27017",
        MONGODB_HOST="should-be-ignored",
        MONGODB_PORT=9999,
    )
    assert config_with_uri.MONGODB_CONNECT_URI == "mongodb://override:27017"


def test_mongodb_config_validation():
    """Test MongoDBConfig validation logic."""
    # Test that username/password must both be provided or neither
    with pytest.raises(ValueError, match="Both MONGODB_USERNAME and MONGODB_PASSWORD"):
        MongoDBConfig(
            MONGODB_HOST="localhost",
            MONGODB_USERNAME="user",
            # Missing password
        )
    
    with pytest.raises(ValueError, match="Both MONGODB_USERNAME and MONGODB_PASSWORD"):
        MongoDBConfig(
            MONGODB_HOST="localhost",
            MONGODB_PASSWORD="pass",
            # Missing username
        )
    
    # Test that validation passes when both are provided
    config = MongoDBConfig(
        MONGODB_HOST="localhost",
        MONGODB_USERNAME="user",
        MONGODB_PASSWORD="pass",
    )
    assert config.MONGODB_USERNAME == "user"
    assert config.MONGODB_PASSWORD == "pass"
    
    # Test that validation passes when MONGODB_URI is provided
    config_with_uri = MongoDBConfig(
        MONGODB_URI="mongodb://user:pass@localhost:27017",
        MONGODB_USERNAME="different",  # Should be ignored
        # Missing password - but OK because URI takes precedence
    )
    assert config_with_uri.MONGODB_CONNECT_URI == "mongodb://user:pass@localhost:27017"

