from collections.abc import Generator
from unittest.mock import Mock, patch

import pytest

from extensions.storage.supabase_storage import SupabaseStorage


class TestSupabaseStorage:
    """Test suite for SupabaseStorage class."""

    def test_init_success_with_all_config(self):
        """Test successful initialization when all required config is provided."""
        with patch("extensions.storage.supabase_storage.dify_config", autospec=True) as mock_config:
            mock_config.SUPABASE_URL = "https://test.supabase.co"
            mock_config.SUPABASE_API_KEY = "test-api-key"
            mock_config.SUPABASE_BUCKET_NAME = "test-bucket"

            with patch("extensions.storage.supabase_storage.Client", autospec=True) as mock_client_class:
                mock_client = Mock()
                mock_client_class.return_value = mock_client

                # Mock bucket_exists to return True so create_bucket is not called
                with patch.object(SupabaseStorage, "bucket_exists", return_value=True):
                    storage = SupabaseStorage()

                    assert storage.bucket_name == "test-bucket"
                    mock_client_class.assert_called_once_with(
                        supabase_url="https://test.supabase.co", supabase_key="test-api-key"
                    )

    def test_init_raises_error_when_url_missing(self):
        """Test initialization raises ValueError when SUPABASE_URL is None."""
        with patch("extensions.storage.supabase_storage.dify_config", autospec=True) as mock_config:
            mock_config.SUPABASE_URL = None
            mock_config.SUPABASE_API_KEY = "test-api-key"
            mock_config.SUPABASE_BUCKET_NAME = "test-bucket"

            with pytest.raises(ValueError, match="SUPABASE_URL is not set"):
                SupabaseStorage()

    def test_init_raises_error_when_api_key_missing(self):
        """Test initialization raises ValueError when SUPABASE_API_KEY is None."""
        with patch("extensions.storage.supabase_storage.dify_config", autospec=True) as mock_config:
            mock_config.SUPABASE_URL = "https://test.supabase.co"
            mock_config.SUPABASE_API_KEY = None
            mock_config.SUPABASE_BUCKET_NAME = "test-bucket"

            with pytest.raises(ValueError, match="SUPABASE_API_KEY is not set"):
                SupabaseStorage()

    def test_init_raises_error_when_bucket_name_missing(self):
        """Test initialization raises ValueError when SUPABASE_BUCKET_NAME is None."""
        with patch("extensions.storage.supabase_storage.dify_config", autospec=True) as mock_config:
            mock_config.SUPABASE_URL = "https://test.supabase.co"
            mock_config.SUPABASE_API_KEY = "test-api-key"
            mock_config.SUPABASE_BUCKET_NAME = None

            with pytest.raises(ValueError, match="SUPABASE_BUCKET_NAME is not set"):
                SupabaseStorage()

    def test_create_bucket_when_not_exists(self):
        """Test create_bucket creates bucket when it doesn't exist."""
        with patch("extensions.storage.supabase_storage.dify_config", autospec=True) as mock_config:
            mock_config.SUPABASE_URL = "https://test.supabase.co"
            mock_config.SUPABASE_API_KEY = "test-api-key"
            mock_config.SUPABASE_BUCKET_NAME = "test-bucket"

            with patch("extensions.storage.supabase_storage.Client", autospec=True) as mock_client_class:
                mock_client = Mock()
                mock_client_class.return_value = mock_client

                with patch.object(SupabaseStorage, "bucket_exists", return_value=False):
                    storage = SupabaseStorage()

                    mock_client.storage.create_bucket.assert_called_once_with(id="test-bucket", name="test-bucket")

    def test_create_bucket_when_exists(self):
        """Test create_bucket does not create bucket when it already exists."""
        with patch("extensions.storage.supabase_storage.dify_config", autospec=True) as mock_config:
            mock_config.SUPABASE_URL = "https://test.supabase.co"
            mock_config.SUPABASE_API_KEY = "test-api-key"
            mock_config.SUPABASE_BUCKET_NAME = "test-bucket"

            with patch("extensions.storage.supabase_storage.Client", autospec=True) as mock_client_class:
                mock_client = Mock()
                mock_client_class.return_value = mock_client

                with patch.object(SupabaseStorage, "bucket_exists", return_value=True):
                    storage = SupabaseStorage()

                    mock_client.storage.create_bucket.assert_not_called()

    @pytest.fixture
    def storage_with_mock_client(self):
        """Fixture providing SupabaseStorage with mocked client."""
        with patch("extensions.storage.supabase_storage.dify_config", autospec=True) as mock_config:
            mock_config.SUPABASE_URL = "https://test.supabase.co"
            mock_config.SUPABASE_API_KEY = "test-api-key"
            mock_config.SUPABASE_BUCKET_NAME = "test-bucket"

            with patch("extensions.storage.supabase_storage.Client", autospec=True) as mock_client_class:
                mock_client = Mock()
                mock_client_class.return_value = mock_client

                with patch.object(SupabaseStorage, "bucket_exists", return_value=True):
                    storage = SupabaseStorage()
                    # Create fresh mock for each test
                    mock_client.reset_mock()
                    yield storage, mock_client

    def test_save(self, storage_with_mock_client):
        """Test save calls client.storage.from_(bucket).upload(path, data)."""
        storage, mock_client = storage_with_mock_client

        filename = "test.txt"
        data = b"test data"

        storage.save(filename, data)

        mock_client.storage.from_.assert_called_once_with("test-bucket")
        mock_client.storage.from_().upload.assert_called_once_with(filename, data)

    def test_load_once_returns_bytes(self, storage_with_mock_client):
        """Test load_once returns bytes."""
        storage, mock_client = storage_with_mock_client

        expected_data = b"test content"
        mock_client.storage.from_().download.return_value = expected_data

        result = storage.load_once("test.txt")

        assert result == expected_data
        # Verify the correct calls were made
        assert "test-bucket" in [call[0][0] for call in mock_client.storage.from_.call_args_list if call[0]]
        mock_client.storage.from_().download.assert_called_with("test.txt")

    def test_load_stream_yields_chunks(self, storage_with_mock_client):
        """Test load_stream yields chunks."""
        storage, mock_client = storage_with_mock_client

        test_data = b"test content for streaming"
        mock_client.storage.from_().download.return_value = test_data

        result = storage.load_stream("test.txt")

        assert isinstance(result, Generator)

        # Collect all chunks
        chunks = list(result)

        # Verify chunks contain the expected data
        assert b"".join(chunks) == test_data
        # Verify the correct calls were made
        assert "test-bucket" in [call[0][0] for call in mock_client.storage.from_.call_args_list if call[0]]
        mock_client.storage.from_().download.assert_called_with("test.txt")

    def test_download_writes_bytes_to_disk(self, storage_with_mock_client, tmp_path):
        """Test download writes expected bytes to disk."""
        storage, mock_client = storage_with_mock_client

        test_data = b"test file content"
        mock_client.storage.from_().download.return_value = test_data

        target_file = tmp_path / "downloaded_file.txt"

        storage.download("test.txt", str(target_file))

        # Verify file was written with correct content
        assert target_file.read_bytes() == test_data
        # Verify the correct calls were made
        assert "test-bucket" in [call[0][0] for call in mock_client.storage.from_.call_args_list if call[0]]
        mock_client.storage.from_().download.assert_called_with("test.txt")

    def test_exists_returns_true_when_file_found(self, storage_with_mock_client):
        """Test exists returns True when list() returns items."""
        storage, mock_client = storage_with_mock_client

        mock_client.storage.from_().list.return_value = [{"name": "test.txt"}]

        result = storage.exists("test.txt")

        assert result is True
        assert "test-bucket" in [call[0][0] for call in mock_client.storage.from_.call_args_list if call[0]]
        mock_client.storage.from_().list.assert_called_with(path="test.txt")

    def test_exists_returns_false_when_file_not_found(self, storage_with_mock_client):
        """Test exists returns False when list() returns an empty list."""
        storage, mock_client = storage_with_mock_client

        mock_client.storage.from_().list.return_value = []

        result = storage.exists("test.txt")

        assert result is False
        assert "test-bucket" in [call[0][0] for call in mock_client.storage.from_.call_args_list if call[0]]
        mock_client.storage.from_().list.assert_called_with(path="test.txt")

    def test_delete_calls_remove_with_filename_in_list(self, storage_with_mock_client):
        """Test delete calls remove([...]) (some client versions require a list)."""
        storage, mock_client = storage_with_mock_client

        filename = "test.txt"

        storage.delete(filename)

        mock_client.storage.from_.assert_called_once_with("test-bucket")
        mock_client.storage.from_().remove.assert_called_once_with([filename])

    def test_bucket_exists_returns_true_when_bucket_found(self):
        """Test bucket_exists returns True when bucket is found in list."""
        with patch("extensions.storage.supabase_storage.dify_config", autospec=True) as mock_config:
            mock_config.SUPABASE_URL = "https://test.supabase.co"
            mock_config.SUPABASE_API_KEY = "test-api-key"
            mock_config.SUPABASE_BUCKET_NAME = "test-bucket"

            with patch("extensions.storage.supabase_storage.Client", autospec=True) as mock_client_class:
                mock_client = Mock()
                mock_client_class.return_value = mock_client

                mock_bucket = Mock()
                mock_bucket.name = "test-bucket"
                mock_client.storage.list_buckets.return_value = [mock_bucket]
                storage = SupabaseStorage()
                result = storage.bucket_exists()

                assert result is True
                assert mock_client.storage.list_buckets.call_count >= 1

    def test_bucket_exists_returns_false_when_bucket_not_found(self):
        """Test bucket_exists returns False when bucket is not found in list."""
        with patch("extensions.storage.supabase_storage.dify_config", autospec=True) as mock_config:
            mock_config.SUPABASE_URL = "https://test.supabase.co"
            mock_config.SUPABASE_API_KEY = "test-api-key"
            mock_config.SUPABASE_BUCKET_NAME = "test-bucket"

            with patch("extensions.storage.supabase_storage.Client", autospec=True) as mock_client_class:
                mock_client = Mock()
                mock_client_class.return_value = mock_client

                # Mock different bucket
                mock_bucket = Mock()
                mock_bucket.name = "different-bucket"
                mock_client.storage.list_buckets.return_value = [mock_bucket]
                mock_client.storage.create_bucket = Mock()

                storage = SupabaseStorage()
                result = storage.bucket_exists()

                assert result is False
                assert mock_client.storage.list_buckets.call_count >= 1

    def test_bucket_exists_returns_false_when_no_buckets(self):
        """Test bucket_exists returns False when no buckets exist."""
        with patch("extensions.storage.supabase_storage.dify_config", autospec=True) as mock_config:
            mock_config.SUPABASE_URL = "https://test.supabase.co"
            mock_config.SUPABASE_API_KEY = "test-api-key"
            mock_config.SUPABASE_BUCKET_NAME = "test-bucket"

            with patch("extensions.storage.supabase_storage.Client", autospec=True) as mock_client_class:
                mock_client = Mock()
                mock_client_class.return_value = mock_client

                mock_client.storage.list_buckets.return_value = []
                mock_client.storage.create_bucket = Mock()

                storage = SupabaseStorage()
                result = storage.bucket_exists()

                assert result is False
                assert mock_client.storage.list_buckets.call_count >= 1
