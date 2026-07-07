import pytest
from dify_trace_opik.config import OpikConfig
from pydantic import ValidationError


class TestOpikConfig:
    """Test cases for OpikConfig"""

    def test_valid_config(self):
        """Test valid Opik configuration"""
        config = OpikConfig(
            api_key="test_key",
            project="test_project",
            workspace="test_workspace",
            url="https://custom.comet.com/opik/api/",
        )
        assert config.api_key == "test_key"
        assert config.project == "test_project"
        assert config.workspace == "test_workspace"
        assert config.url == "https://custom.comet.com/opik/api/"

    def test_default_values(self):
        """Test default values are set correctly"""
        config = OpikConfig()
        assert config.api_key is None
        assert config.project is None
        assert config.workspace is None
        assert config.url == "https://www.comet.com/opik/api/"

    def test_project_validation_empty(self):
        """Test project validation with empty value"""
        config = OpikConfig(project="")
        assert config.project == "Default Project"

    def test_url_validation_empty(self):
        """Test URL validation with empty value"""
        config = OpikConfig(url="")
        assert config.url == "https://www.comet.com/opik/api/"

    def test_url_validation_missing_suffix(self):
        """Test URL validation requires /api/ suffix"""
        with pytest.raises(ValidationError, match="URL should end with /api/"):
            OpikConfig(url="https://custom.comet.com/opik/")

    def test_url_validation_invalid_scheme(self):
        """Test URL validation rejects invalid schemes"""
        with pytest.raises(ValidationError, match="URL must start with https:// or http://"):
            OpikConfig(url="ftp://custom.comet.com/opik/api/")
