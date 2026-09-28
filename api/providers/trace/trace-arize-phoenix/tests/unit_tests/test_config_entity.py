import pytest
from dify_trace_arize_phoenix.config import ArizeConfig, PhoenixConfig
from pydantic import ValidationError


class TestArizeConfig:
    """Test cases for ArizeConfig"""

    def test_valid_config(self):
        """Test valid Arize configuration"""
        config = ArizeConfig(
            api_key="test_key", space_id="test_space", project="test_project", endpoint="https://custom.arize.com"
        )
        assert config.api_key == "test_key"
        assert config.space_id == "test_space"
        assert config.project == "test_project"
        assert config.endpoint == "https://custom.arize.com"

    def test_default_values(self):
        """Test default values are set correctly"""
        config = ArizeConfig()
        assert config.api_key is None
        assert config.space_id is None
        assert config.project is None
        assert config.endpoint == "https://otlp.arize.com"

    def test_project_validation_empty(self):
        """Test project validation with empty value"""
        config = ArizeConfig(project="")
        assert config.project == "default"

    def test_project_validation_none(self):
        """Test project validation with None value"""
        config = ArizeConfig(project=None)
        assert config.project == "default"

    def test_endpoint_validation_empty(self):
        """Test endpoint validation with empty value"""
        config = ArizeConfig(endpoint="")
        assert config.endpoint == "https://otlp.arize.com"

    def test_endpoint_validation_with_path(self):
        """Test endpoint validation normalizes URL by removing path"""
        config = ArizeConfig(endpoint="https://custom.arize.com/api/v1")
        assert config.endpoint == "https://custom.arize.com"

    def test_endpoint_validation_invalid_scheme(self):
        """Test endpoint validation rejects invalid schemes"""
        with pytest.raises(ValidationError, match="URL scheme must be one of"):
            ArizeConfig(endpoint="ftp://invalid.com")

    def test_endpoint_validation_no_scheme(self):
        """Test endpoint validation rejects URLs without scheme"""
        with pytest.raises(ValidationError, match="URL scheme must be one of"):
            ArizeConfig(endpoint="invalid.com")


class TestPhoenixConfig:
    """Test cases for PhoenixConfig"""

    def test_valid_config(self):
        """Test valid Phoenix configuration"""
        config = PhoenixConfig(api_key="test_key", project="test_project", endpoint="https://custom.phoenix.com")
        assert config.api_key == "test_key"
        assert config.project == "test_project"
        assert config.endpoint == "https://custom.phoenix.com"

    def test_default_values(self):
        """Test default values are set correctly"""
        config = PhoenixConfig()
        assert config.api_key is None
        assert config.project is None
        assert config.endpoint == "https://app.phoenix.arize.com"

    def test_project_validation_empty(self):
        """Test project validation with empty value"""
        config = PhoenixConfig(project="")
        assert config.project == "default"

    def test_endpoint_validation_with_path(self):
        """Test endpoint validation with path"""
        config = PhoenixConfig(endpoint="https://app.phoenix.arize.com/s/dify-integration")
        assert config.endpoint == "https://app.phoenix.arize.com/s/dify-integration"

    def test_endpoint_validation_without_path(self):
        """Test endpoint validation without path"""
        config = PhoenixConfig(endpoint="https://app.phoenix.arize.com")
        assert config.endpoint == "https://app.phoenix.arize.com"
