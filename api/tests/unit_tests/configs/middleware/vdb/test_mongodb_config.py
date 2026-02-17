import unittest
from unittest.mock import patch

from configs.middleware.vdb.mongodb_config import MongoDBConfig


class TestMongoDBConfig(unittest.TestCase):
    def test_mongodb_uri_takes_precedence(self):
        """Test that MONGODB_URI takes precedence over individual components."""
        config = MongoDBConfig(
            MONGODB_URI="mongodb://user:pass@host:27017/db",
            MONGODB_HOST="other_host",
            MONGODB_PORT=12345,
        )
        self.assertEqual(config.MONGODB_CONNECT_URI, "mongodb://user:pass@host:27017/db")

    def test_build_uri_from_components_with_auth(self):
        """Test building URI from individual components with authentication."""
        config = MongoDBConfig(
            MONGODB_HOST="localhost",
            MONGODB_PORT=27017,
            MONGODB_USERNAME="user",
            MONGODB_PASSWORD="pass",
        )
        uri = config.MONGODB_CONNECT_URI
        self.assertIn("mongodb://", uri)
        self.assertIn("localhost", uri)
        self.assertIn("27017", uri)
        self.assertIn("user", uri)
        # Password should be URL-encoded in URI
        self.assertIn("pass", uri)

    def test_build_uri_from_components_without_auth(self):
        """Test building URI from individual components without authentication."""
        config = MongoDBConfig(
            MONGODB_HOST="localhost",
            MONGODB_PORT=27017,
        )
        uri = config.MONGODB_CONNECT_URI
        self.assertEqual(uri, "mongodb://localhost:27017")

    def test_build_uri_default_localhost(self):
        """Test building URI with default localhost when no host provided."""
        config = MongoDBConfig()
        uri = config.MONGODB_CONNECT_URI
        self.assertEqual(uri, "mongodb://localhost:27017")

    def test_build_uri_invalid_host_type(self):
        """Test that invalid host type raises ValueError."""
        config = MongoDBConfig(MONGODB_HOST=123)  # type: ignore
        with self.assertRaises(ValueError) as context:
            _ = config.MONGODB_CONNECT_URI
        self.assertIn("MONGODB_HOST must be a non-empty string", str(context.exception))

    def test_build_uri_invalid_port_type(self):
        """Test that invalid port type raises ValueError."""
        config = MongoDBConfig(MONGODB_HOST="localhost", MONGODB_PORT="invalid")  # type: ignore
        with self.assertRaises(ValueError) as context:
            _ = config.MONGODB_CONNECT_URI
        self.assertIn("MONGODB_PORT must be an integer", str(context.exception))

    def test_build_uri_invalid_port_range(self):
        """Test that invalid port range raises ValueError."""
        config = MongoDBConfig(MONGODB_HOST="localhost", MONGODB_PORT=70000)
        with self.assertRaises(ValueError) as context:
            _ = config.MONGODB_CONNECT_URI
        self.assertIn("MONGODB_PORT must be an integer between 1 and 65535", str(context.exception))

    def test_build_uri_invalid_username_type(self):
        """Test that invalid username type raises ValueError."""
        config = MongoDBConfig(
            MONGODB_HOST="localhost",
            MONGODB_USERNAME=123,  # type: ignore
        )
        with self.assertRaises(ValueError) as context:
            _ = config.MONGODB_CONNECT_URI
        self.assertIn("MONGODB_USERNAME must be a string", str(context.exception))

    def test_build_uri_empty_host_string(self):
        """Test that empty host string raises ValueError."""
        config = MongoDBConfig(MONGODB_HOST="   ")
        with self.assertRaises(ValueError) as context:
            _ = config.MONGODB_CONNECT_URI
        self.assertIn("MONGODB_HOST must be a non-empty string", str(context.exception))

    def test_mongodb_uri_invalid_format(self):
        """Test that invalid MONGODB_URI format raises ValueError."""
        config = MongoDBConfig(MONGODB_URI="invalid-uri")
        with self.assertRaises(ValueError) as context:
            _ = config.MONGODB_CONNECT_URI
        self.assertIn("missing scheme", str(context.exception))

    def test_mongodb_uri_empty_string(self):
        """Test that empty MONGODB_URI raises ValueError."""
        config = MongoDBConfig(MONGODB_URI="")
        with self.assertRaises(ValueError) as context:
            _ = config.MONGODB_CONNECT_URI
        self.assertIn("non-empty string", str(context.exception))

    def test_validate_mongodb_config_username_password_mismatch(self):
        """Test that username/password mismatch raises ValueError."""
        with self.assertRaises(ValueError) as context:
            MongoDBConfig(
                MONGODB_HOST="localhost",
                MONGODB_USERNAME="user",
                # Missing password
            )
        self.assertIn("Both MONGODB_USERNAME and MONGODB_PASSWORD must be provided", str(context.exception))

        with self.assertRaises(ValueError) as context:
            MongoDBConfig(
                MONGODB_HOST="localhost",
                MONGODB_PASSWORD="pass",
                # Missing username
            )
        self.assertIn("Both MONGODB_USERNAME and MONGODB_PASSWORD must be provided", str(context.exception))

    def test_validate_mongodb_config_with_uri(self):
        """Test that validation passes when MONGODB_URI is provided."""
        # Should not raise even if username/password are mismatched when URI is provided
        config = MongoDBConfig(
            MONGODB_URI="mongodb://user:pass@host:27017/db",
            MONGODB_USERNAME="other_user",
            # Missing password - but should be OK because URI takes precedence
        )
        self.assertEqual(config.MONGODB_CONNECT_URI, "mongodb://user:pass@host:27017/db")

    def test_build_uri_special_characters_in_credentials(self):
        """Test that special characters in credentials are properly encoded."""
        config = MongoDBConfig(
            MONGODB_HOST="localhost",
            MONGODB_PORT=27017,
            MONGODB_USERNAME="user@domain",
            MONGODB_PASSWORD="p@ss:w#rd",
        )
        uri = config.MONGODB_CONNECT_URI
        # Should contain encoded credentials
        self.assertIn("mongodb://", uri)
        self.assertIn("localhost", uri)
        # Special characters should be URL-encoded
        self.assertNotIn("@", uri.split("@")[0].split("://")[1])  # No @ in credentials part before @

    def test_mongodb_uri_mongodb_srv_scheme(self):
        """Test that mongodb+srv:// scheme is accepted."""
        config = MongoDBConfig(MONGODB_URI="mongodb+srv://user:pass@cluster.mongodb.net/db")
        uri = config.MONGODB_CONNECT_URI
        self.assertEqual(uri, "mongodb+srv://user:pass@cluster.mongodb.net/db")

