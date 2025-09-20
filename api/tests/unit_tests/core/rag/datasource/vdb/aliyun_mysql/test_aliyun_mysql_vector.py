import unittest
from unittest.mock import MagicMock, patch

from core.rag.datasource.vdb.aliyun_mysql.aliyun_mysql_vector import AliyunMySQLVector, AliyunMySQLVectorConfig


class TestAliyunMySQLVector(unittest.TestCase):
    def setUp(self):
        self.config = AliyunMySQLVectorConfig(
            host="localhost",
            port=3306,
            user="test_user",
            password="test_password",
            database="test_db",
            min_connection=1,
            max_connection=5,
            charset="utf8mb4",
        )
        self.collection_name = "test_collection"

    @patch("core.rag.datasource.vdb.aliyun_mysql.aliyun_mysql_vector.pymysql.connect")
    def test_init(self, mock_connect):
        """Test AliyunMySQLVector initialization."""
        aliyun_mysql_vector = AliyunMySQLVector(self.collection_name, self.config)

        self.assertEqual(aliyun_mysql_vector.collection_name, self.collection_name)
        self.assertEqual(aliyun_mysql_vector.table_name, f"{self.collection_name}")
        self.assertEqual(aliyun_mysql_vector.get_type(), "aliyun_mysql")
        # PyMySQL connections are created on demand, not pooled
        self.assertIsNone(aliyun_mysql_vector.pool)

    @patch("core.rag.datasource.vdb.aliyun_mysql.aliyun_mysql_vector.pymysql.connect")
    @patch("core.rag.datasource.vdb.aliyun_mysql.aliyun_mysql_vector.redis_client")
    def test_create_collection(self, mock_redis, mock_connect):
        """Test collection creation."""
        # Mock Redis operations
        mock_redis.lock.return_value.__enter__ = MagicMock()
        mock_redis.lock.return_value.__exit__ = MagicMock()
        mock_redis.get.return_value = None
        mock_redis.set.return_value = None

        # Mock database connection and cursor
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_connect.return_value = mock_conn

        aliyun_mysql_vector = AliyunMySQLVector(self.collection_name, self.config)
        aliyun_mysql_vector._create_collection(768)

        # Verify SQL execution calls
        self.assertTrue(mock_cursor.execute.called)
        mock_redis.set.assert_called_once()

    def test_config_validation(self):
        """Test configuration validation."""
        # Test missing required fields
        with self.assertRaises(ValueError):
            AliyunMySQLVectorConfig(
                host="",  # Empty host should raise error
                port=3306,
                user="test",
                password="test",
                database="test",
                min_connection=1,
                max_connection=5,
            )

        # Test min_connection > max_connection
        with self.assertRaises(ValueError):
            AliyunMySQLVectorConfig(
                host="localhost",
                port=3306,
                user="test",
                password="test",
                database="test",
                min_connection=10,
                max_connection=5,  # Should be greater than min_connection
            )


if __name__ == "__main__":
    unittest.main()
