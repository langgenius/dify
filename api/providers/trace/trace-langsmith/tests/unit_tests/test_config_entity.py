import pytest
from dify_trace_langsmith.config import LangSmithConfig
from pydantic import ValidationError


class TestLangSmithConfig:
    """Test cases for LangSmithConfig"""

    def test_valid_config(self):
        """Test valid LangSmith configuration"""
        config = LangSmithConfig(api_key="test_key", project="test_project", endpoint="https://custom.smith.com")
        assert config.api_key == "test_key"
        assert config.project == "test_project"
        assert config.endpoint == "https://custom.smith.com"

    def test_default_values(self):
        """Test default values are set correctly"""
        config = LangSmithConfig(api_key="key", project="project")
        assert config.endpoint == "https://api.smith.langchain.com"

    def test_missing_required_fields(self):
        """Test that required fields are enforced"""
        with pytest.raises(ValidationError):
            LangSmithConfig.model_validate({})

        with pytest.raises(ValidationError):
            LangSmithConfig.model_validate({"api_key": "key"})

        with pytest.raises(ValidationError):
            LangSmithConfig.model_validate({"project": "project"})

    def test_endpoint_validation_https_only(self):
        """Test endpoint validation only allows HTTPS"""
        with pytest.raises(ValidationError, match="URL scheme must be one of"):
            LangSmithConfig(api_key="key", project="project", endpoint="http://insecure.com")
