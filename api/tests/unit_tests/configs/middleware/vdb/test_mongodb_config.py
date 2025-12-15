import unittest

from pydantic import ValidationError

from configs.middleware.vdb.mongodb_config import MongoDBConfig


class TestMongoDBConfig(unittest.TestCase):
    def test_valid_uri(self):
        """Test configuration with valid MongoDB URI."""
        config = MongoDBConfig(MONGODB_URI="mongodb://localhost:27017/test")
        self.assertEqual(config.MONGODB_CONNECT_URI, "mongodb://localhost:27017/test")

    def test_valid_srv_uri(self):
        """Test configuration with valid MongoDB SRV URI."""
        uri = "mongodb+srv://user:pass@cluster.mongodb.net/db?retryWrites=true"
        config = MongoDBConfig(MONGODB_URI=uri)
        self.assertEqual(config.MONGODB_CONNECT_URI, uri)

    def test_invalid_uri_scheme(self):
        """Test configuration with invalid URI scheme."""
        with self.assertRaises(ValidationError) as context:
            MongoDBConfig(MONGODB_URI="http://localhost:27017")
        
        error_msg = str(context.exception)
        self.assertIn("Invalid MongoDB URI scheme", error_msg)

    def test_invalid_uri_missing_hostname(self):
        """Test configuration with URI missing hostname."""
        with self.assertRaises(ValidationError) as context:
            MongoDBConfig(MONGODB_URI="mongodb://")
        
        error_msg = str(context.exception)
        self.assertIn("hostname", error_msg)

    def test_invalid_srv_uri_missing_hostname(self):
        """Test configuration with SRV URI missing hostname."""
        with self.assertRaises(ValidationError) as context:
            MongoDBConfig(MONGODB_URI="mongodb+srv://")
        
        error_msg = str(context.exception)
        self.assertIn("hostname", error_msg)

    def test_valid_host_config(self):
        """Test configuration with host, port, and credentials."""
        config = MongoDBConfig(
            MONGODB_HOST="localhost",
            MONGODB_PORT=27017,
            MONGODB_USERNAME="user",
            MONGODB_PASSWORD="pass",
        )
        self.assertIn("mongodb://", config.MONGODB_CONNECT_URI)
        self.assertIn("localhost", config.MONGODB_CONNECT_URI)
        self.assertIn("27017", config.MONGODB_CONNECT_URI)

    def test_valid_host_config_no_auth(self):
        """Test configuration with host and port but no credentials."""
        config = MongoDBConfig(MONGODB_HOST="localhost", MONGODB_PORT=27017)
        self.assertEqual(config.MONGODB_CONNECT_URI, "mongodb://localhost:27017")

    def test_invalid_host_config_username_only(self):
        """Test configuration with username but no password."""
        with self.assertRaises(ValidationError) as context:
            MongoDBConfig(
                MONGODB_HOST="localhost",
                MONGODB_USERNAME="user",
            )
        
        error_msg = str(context.exception)
        self.assertIn("MONGODB_USERNAME and MONGODB_PASSWORD", error_msg)

    def test_invalid_host_config_password_only(self):
        """Test configuration with password but no username."""
        with self.assertRaises(ValidationError) as context:
            MongoDBConfig(
                MONGODB_HOST="localhost",
                MONGODB_PASSWORD="pass",
            )
        
        error_msg = str(context.exception)
        self.assertIn("MONGODB_USERNAME and MONGODB_PASSWORD", error_msg)

    def test_invalid_hostname_format(self):
        """Test configuration with invalid hostname format."""
        with self.assertRaises(ValidationError) as context:
            MongoDBConfig(MONGODB_HOST="invalid..hostname")
        
        error_msg = str(context.exception)
        self.assertIn("Invalid MONGODB_HOST format", error_msg)

    def test_valid_ip_address(self):
        """Test configuration with valid IP address."""
        config = MongoDBConfig(MONGODB_HOST="192.168.1.1", MONGODB_PORT=27017)
        self.assertIn("192.168.1.1", config.MONGODB_CONNECT_URI)

    def test_invalid_port_range_low(self):
        """Test configuration with port below valid range."""
        with self.assertRaises(ValidationError):
            MongoDBConfig(MONGODB_HOST="localhost", MONGODB_PORT=0)

    def test_invalid_port_range_high(self):
        """Test configuration with port above valid range."""
        with self.assertRaises(ValidationError):
            MongoDBConfig(MONGODB_HOST="localhost", MONGODB_PORT=70000)

    def test_invalid_database_name(self):
        """Test configuration with invalid database name."""
        with self.assertRaises(ValidationError) as context:
            MongoDBConfig(MONGODB_DATABASE="invalid.db.name")
        
        error_msg = str(context.exception)
        self.assertIn("Invalid MONGODB_DATABASE format", error_msg)

    def test_empty_database_name(self):
        """Test configuration with empty database name."""
        with self.assertRaises(ValidationError) as context:
            MongoDBConfig(MONGODB_DATABASE="")
        
        error_msg = str(context.exception)
        self.assertIn("non-empty string", error_msg)

    def test_invalid_index_name(self):
        """Test configuration with invalid index name."""
        with self.assertRaises(ValidationError) as context:
            MongoDBConfig(MONGODB_VECTOR_INDEX_NAME="invalid.index.name")
        
        error_msg = str(context.exception)
        self.assertIn("Invalid MONGODB_VECTOR_INDEX_NAME format", error_msg)

    def test_empty_index_name(self):
        """Test configuration with empty index name."""
        with self.assertRaises(ValidationError) as context:
            MongoDBConfig(MONGODB_VECTOR_INDEX_NAME="")
        
        error_msg = str(context.exception)
        self.assertIn("non-empty string", error_msg)

    def test_default_values(self):
        """Test configuration with default values."""
        config = MongoDBConfig()
        self.assertEqual(config.MONGODB_CONNECT_URI, "mongodb://localhost:27017")
        self.assertEqual(config.MONGODB_DATABASE, "dify")
        self.assertEqual(config.MONGODB_VECTOR_INDEX_NAME, "vector_index")
        self.assertEqual(config.MONGODB_PORT, 27017)

    def test_uri_takes_precedence(self):
        """Test that URI takes precedence over host/port configuration."""
        config = MongoDBConfig(
            MONGODB_URI="mongodb://custom:27018/customdb",
            MONGODB_HOST="localhost",
            MONGODB_PORT=27017,
        )
        self.assertEqual(config.MONGODB_CONNECT_URI, "mongodb://custom:27018/customdb")

    def test_uri_with_invalid_database_name(self):
        """Test URI with invalid database name in path."""
        with self.assertRaises(ValidationError) as context:
            MongoDBConfig(MONGODB_URI="mongodb://localhost:27017/invalid.db.name")
        
        error_msg = str(context.exception)
        self.assertIn("Invalid database name in URI", error_msg)

