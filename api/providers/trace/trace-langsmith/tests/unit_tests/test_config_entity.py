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
        with pytest.raises(ValidationError, match="URL must start with https://"):
            LangSmithConfig(api_key="key", project="project", endpoint="http://insecure.com")

    def test_endpoint_preserves_path(self):
        """Self-hosted LangSmith endpoints keep their API path prefix"""
        config = LangSmithConfig(api_key="key", project="project", endpoint="https://langsmith.internal/api")
        assert config.endpoint == "https://langsmith.internal/api"

    def test_endpoint_preserves_versioned_path(self):
        """Self-hosted LangSmith endpoints keep multi-segment API paths"""
        config = LangSmithConfig(api_key="key", project="project", endpoint="https://langsmith.internal/api/v1")
        assert config.endpoint == "https://langsmith.internal/api/v1"
