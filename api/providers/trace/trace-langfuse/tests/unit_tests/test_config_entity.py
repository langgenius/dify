import pytest
from dify_trace_langfuse.config import LangfuseConfig
from pydantic import ValidationError


class TestLangfuseConfig:
    """Test cases for LangfuseConfig"""

    def test_valid_config(self):
        """Test valid Langfuse configuration"""
        config = LangfuseConfig(public_key="public_key", secret_key="secret_key", host="https://custom.langfuse.com")
        assert config.public_key == "public_key"
        assert config.secret_key == "secret_key"
        assert config.host == "https://custom.langfuse.com"

    def test_valid_config_with_path(self):
        host = "https://custom.langfuse.com/api/v1"
        config = LangfuseConfig(public_key="public_key", secret_key="secret_key", host=host)
        assert config.public_key == "public_key"
        assert config.secret_key == "secret_key"
        assert config.host == host

    def test_default_values(self):
        """Test default values are set correctly"""
        config = LangfuseConfig(public_key="public", secret_key="secret")
        assert config.host == "https://api.langfuse.com"

    def test_missing_required_fields(self):
        """Test that required fields are enforced"""
        with pytest.raises(ValidationError):
            LangfuseConfig()

        with pytest.raises(ValidationError):
            LangfuseConfig(public_key="public")

        with pytest.raises(ValidationError):
            LangfuseConfig(secret_key="secret")

    def test_host_validation_empty(self):
        """Test host validation with empty value"""
        config = LangfuseConfig(public_key="public", secret_key="secret", host="")
        assert config.host == "https://api.langfuse.com"
