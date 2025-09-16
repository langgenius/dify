"""Integration tests for ClickZetta Volume Storage."""

import os
import tempfile
import unittest
from pathlib import Path

import pytest

from extensions.storage.clickzetta_volume.clickzetta_volume_storage import (
    ClickZettaVolumeConfig,
    ClickZettaVolumeStorage,
)


class TestClickZettaVolumeStorage(unittest.TestCase):
    """Test cases for ClickZetta Volume Storage."""

    def setUp(self):
        """Set up test environment."""
        self.config = ClickZettaVolumeConfig(
            username=os.getenv("CLICKZETTA_USERNAME", "test_user"),
            password=os.getenv("CLICKZETTA_PASSWORD", "test_pass"),
            instance=os.getenv("CLICKZETTA_INSTANCE", "test_instance"),
            service=os.getenv("CLICKZETTA_SERVICE", "uat-api.clickzetta.com"),
            workspace=os.getenv("CLICKZETTA_WORKSPACE", "quick_start"),
            vcluster=os.getenv("CLICKZETTA_VCLUSTER", "default_ap"),
            schema_name=os.getenv("CLICKZETTA_SCHEMA", "dify"),
            volume_type="table",
            table_prefix="test_dataset_",
        )

    @pytest.mark.skipif(not os.getenv("CLICKZETTA_USERNAME"), reason="ClickZetta credentials not provided")
    def test_user_volume_operations(self):
        """Test basic operations with User Volume."""
        config = self.config
        config.volume_type = "user"

        storage = ClickZettaVolumeStorage(config)

        # Test file operations
        test_filename = "test_file.txt"
        test_content = b"Hello, ClickZetta Volume!"

        # Save file
        storage.save(test_filename, test_content)

        # Check if file exists
        assert storage.exists(test_filename)

        # Load file
        loaded_content = storage.load_once(test_filename)
        assert loaded_content == test_content

        # Test streaming
        stream_content = b""
        for chunk in storage.load_stream(test_filename):
            stream_content += chunk
        assert stream_content == test_content

        # Test download
        with tempfile.NamedTemporaryFile() as temp_file:
            storage.download(test_filename, temp_file.name)
            downloaded_content = Path(temp_file.name).read_bytes()
            assert downloaded_content == test_content

        # Test scan
        files = storage.scan("", files=True, directories=False)
        assert test_filename in files

        # Delete file
        storage.delete(test_filename)
        assert not storage.exists(test_filename)

    @pytest.mark.skipif(not os.getenv("CLICKZETTA_USERNAME"), reason="ClickZetta credentials not provided")
    def test_table_volume_operations(self):
        """Test basic operations with Table Volume."""
        config = self.config
        config.volume_type = "table"

        storage = ClickZettaVolumeStorage(config)

        # Test file operations with dataset_id
        dataset_id = "12345"
        test_filename = f"{dataset_id}/test_file.txt"
        test_content = b"Hello, Table Volume!"

        # Save file
        storage.save(test_filename, test_content)

        # Check if file exists
        assert storage.exists(test_filename)

        # Load file
        loaded_content = storage.load_once(test_filename)
        assert loaded_content == test_content

        # Test scan for dataset
        files = storage.scan(dataset_id, files=True, directories=False)
        assert "test_file.txt" in files

        # Delete file
        storage.delete(test_filename)
        assert not storage.exists(test_filename)

    def test_config_validation(self):
        """Test configuration validation."""
        # Test missing required fields
        with pytest.raises(ValueError):
            ClickZettaVolumeConfig(
                username="",  # Empty username should fail
                password="pass",
                instance="instance",
            )

        # Test invalid volume type
        with pytest.raises(ValueError):
            ClickZettaVolumeConfig(username="user", password="pass", instance="instance", volume_type="invalid_type")

        # Test external volume without volume_name
        with pytest.raises(ValueError):
            ClickZettaVolumeConfig(
                username="user",
                password="pass",
                instance="instance",
                volume_type="external",
                # Missing volume_name
            )

    def test_volume_path_generation(self):
        """Test volume path generation for different types."""
        storage = ClickZettaVolumeStorage(self.config)

        # Test table volume path
        path = storage._get_volume_path("test.txt", "12345")
        assert path == "test_dataset_12345/test.txt"

        # Test path with existing dataset_id prefix
        path = storage._get_volume_path("12345/test.txt")
        assert path == "12345/test.txt"

        # Test user volume
        storage._config.volume_type = "user"
        path = storage._get_volume_path("test.txt")
        assert path == "test.txt"

    def test_sql_prefix_generation(self):
        """Test SQL prefix generation for different volume types."""
        storage = ClickZettaVolumeStorage(self.config)

        # Test table volume SQL prefix
        prefix = storage._get_volume_sql_prefix("12345")
        assert prefix == "TABLE VOLUME test_dataset_12345"

        # Test user volume SQL prefix
        storage._config.volume_type = "user"
        prefix = storage._get_volume_sql_prefix()
        assert prefix == "USER VOLUME"

        # Test external volume SQL prefix
        storage._config.volume_type = "external"
        storage._config.volume_name = "my_external_volume"
        prefix = storage._get_volume_sql_prefix()
        assert prefix == "VOLUME my_external_volume"


if __name__ == "__main__":
    unittest.main()
