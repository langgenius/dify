import pytest
from dify_trace_weave.config import WeaveConfig
from pydantic import ValidationError


class TestWeaveConfig:
    """Test cases for WeaveConfig"""

    def test_valid_config(self):
        """Test valid Weave configuration"""
        config = WeaveConfig(
            api_key="test_key",
            entity="test_entity",
            project="test_project",
            endpoint="https://custom.wandb.ai",
            host="https://custom.host.com",
        )
        assert config.api_key == "test_key"
        assert config.entity == "test_entity"
        assert config.project == "test_project"
        assert config.endpoint == "https://custom.wandb.ai"
        assert config.host == "https://custom.host.com"

    def test_default_values(self):
        """Test default values are set correctly"""
        config = WeaveConfig(api_key="key", project="project")
        assert config.entity is None
        assert config.endpoint == "https://trace.wandb.ai"
        assert config.host is None

    def test_missing_required_fields(self):
        """Test that required fields are enforced"""
        with pytest.raises(ValidationError):
            WeaveConfig.model_validate({})

        with pytest.raises(ValidationError):
            WeaveConfig.model_validate({"api_key": "key"})

        with pytest.raises(ValidationError):
            WeaveConfig.model_validate({"project": "project"})

    def test_endpoint_validation_https_only(self):
        """Test endpoint validation only allows HTTPS"""
        with pytest.raises(ValidationError, match="URL must start with https://"):
            WeaveConfig(api_key="key", project="project", endpoint="http://insecure.wandb.ai")

    def test_host_validation_optional(self):
        """Test host validation is optional but validates when provided"""
        config = WeaveConfig(api_key="key", project="project", host=None)
        assert config.host is None

        config = WeaveConfig(api_key="key", project="project", host="")
        assert config.host == ""

        config = WeaveConfig(api_key="key", project="project", host="https://valid.host.com")
        assert config.host == "https://valid.host.com"

    def test_host_validation_invalid_scheme(self):
        """Test host validation rejects invalid schemes when provided"""
        with pytest.raises(ValidationError, match="URL must start with https:// or http://"):
            WeaveConfig(api_key="key", project="project", host="ftp://invalid.host.com")

    def test_endpoint_preserves_path(self):
        """Self-hosted Weave endpoints keep their path prefix"""
        config = WeaveConfig(api_key="key", project="project", endpoint="https://wandb.internal/api")
        assert config.endpoint == "https://wandb.internal/api"

    def test_host_preserves_path(self):
        """Self-hosted W&B hosts keep their path prefix"""
        config = WeaveConfig(api_key="key", project="project", host="https://wandb.internal/wandb")
        assert config.host == "https://wandb.internal/wandb"

    def test_host_preserves_http_path(self):
        """Self-hosted W&B hosts may be plain http and keep their path"""
        config = WeaveConfig(api_key="key", project="project", host="http://wandb.internal/wandb")
        assert config.host == "http://wandb.internal/wandb"
