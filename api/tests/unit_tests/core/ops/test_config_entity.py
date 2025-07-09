import pytest
from pydantic import ValidationError

from core.ops.entities.config_entity import (
    AliyunConfig,
    ArizeConfig,
    LangfuseConfig,
    LangSmithConfig,
    OpikConfig,
    PhoenixConfig,
    TracingProviderEnum,
    WeaveConfig,
)


class TestTracingProviderEnum:
    """Test cases for TracingProviderEnum"""

    def test_enum_values(self):
        """Test that all expected enum values are present"""
        assert TracingProviderEnum.ARIZE == "arize"
        assert TracingProviderEnum.PHOENIX == "phoenix"
        assert TracingProviderEnum.LANGFUSE == "langfuse"
        assert TracingProviderEnum.LANGSMITH == "langsmith"
        assert TracingProviderEnum.OPIK == "opik"
        assert TracingProviderEnum.WEAVE == "weave"
        assert TracingProviderEnum.ALIYUN == "aliyun"


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
        """Test endpoint validation normalizes URL by removing path"""
        config = PhoenixConfig(endpoint="https://custom.phoenix.com/api/v1")
        assert config.endpoint == "https://custom.phoenix.com"


class TestLangfuseConfig:
    """Test cases for LangfuseConfig"""

    def test_valid_config(self):
        """Test valid Langfuse configuration"""
        config = LangfuseConfig(public_key="public_key", secret_key="secret_key", host="https://custom.langfuse.com")
        assert config.public_key == "public_key"
        assert config.secret_key == "secret_key"
        assert config.host == "https://custom.langfuse.com"

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
            LangSmithConfig()

        with pytest.raises(ValidationError):
            LangSmithConfig(api_key="key")

        with pytest.raises(ValidationError):
            LangSmithConfig(project="project")

    def test_endpoint_validation_https_only(self):
        """Test endpoint validation only allows HTTPS"""
        with pytest.raises(ValidationError, match="URL scheme must be one of"):
            LangSmithConfig(api_key="key", project="project", endpoint="http://insecure.com")


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
            WeaveConfig()

        with pytest.raises(ValidationError):
            WeaveConfig(api_key="key")

        with pytest.raises(ValidationError):
            WeaveConfig(project="project")

    def test_endpoint_validation_https_only(self):
        """Test endpoint validation only allows HTTPS"""
        with pytest.raises(ValidationError, match="URL scheme must be one of"):
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
        with pytest.raises(ValidationError, match="URL scheme must be one of"):
            WeaveConfig(api_key="key", project="project", host="ftp://invalid.host.com")


class TestAliyunConfig:
    """Test cases for AliyunConfig"""

    def test_valid_config(self):
        """Test valid Aliyun configuration"""
        config = AliyunConfig(
            app_name="test_app",
            license_key="test_license_key",
            endpoint="https://custom.tracing-analysis-dc-hz.aliyuncs.com",
        )
        assert config.app_name == "test_app"
        assert config.license_key == "test_license_key"
        assert config.endpoint == "https://custom.tracing-analysis-dc-hz.aliyuncs.com"

    def test_default_values(self):
        """Test default values are set correctly"""
        config = AliyunConfig(license_key="test_license", endpoint="https://tracing-analysis-dc-hz.aliyuncs.com")
        assert config.app_name == "dify_app"

    def test_missing_required_fields(self):
        """Test that required fields are enforced"""
        with pytest.raises(ValidationError):
            AliyunConfig()

        with pytest.raises(ValidationError):
            AliyunConfig(license_key="test_license")

        with pytest.raises(ValidationError):
            AliyunConfig(endpoint="https://tracing-analysis-dc-hz.aliyuncs.com")

    def test_app_name_validation_empty(self):
        """Test app_name validation with empty value"""
        config = AliyunConfig(
            license_key="test_license", endpoint="https://tracing-analysis-dc-hz.aliyuncs.com", app_name=""
        )
        assert config.app_name == "dify_app"

    def test_endpoint_validation_empty(self):
        """Test endpoint validation with empty value"""
        config = AliyunConfig(license_key="test_license", endpoint="")
        assert config.endpoint == "https://tracing-analysis-dc-hz.aliyuncs.com"

    def test_endpoint_validation_with_path(self):
        """Test endpoint validation normalizes URL by removing path"""
        config = AliyunConfig(
            license_key="test_license", endpoint="https://tracing-analysis-dc-hz.aliyuncs.com/api/v1/traces"
        )
        assert config.endpoint == "https://tracing-analysis-dc-hz.aliyuncs.com"

    def test_endpoint_validation_invalid_scheme(self):
        """Test endpoint validation rejects invalid schemes"""
        with pytest.raises(ValidationError, match="URL scheme must be one of"):
            AliyunConfig(license_key="test_license", endpoint="ftp://invalid.tracing-analysis-dc-hz.aliyuncs.com")

    def test_endpoint_validation_no_scheme(self):
        """Test endpoint validation rejects URLs without scheme"""
        with pytest.raises(ValidationError, match="URL scheme must be one of"):
            AliyunConfig(license_key="test_license", endpoint="invalid.tracing-analysis-dc-hz.aliyuncs.com")

    def test_license_key_required(self):
        """Test that license_key is required and cannot be empty"""
        with pytest.raises(ValidationError):
            AliyunConfig(license_key="", endpoint="https://tracing-analysis-dc-hz.aliyuncs.com")


class TestConfigIntegration:
    """Integration tests for configuration classes"""

    def test_all_configs_can_be_instantiated(self):
        """Test that all config classes can be instantiated with valid data"""
        configs = [
            ArizeConfig(api_key="key"),
            PhoenixConfig(api_key="key"),
            LangfuseConfig(public_key="public", secret_key="secret"),
            LangSmithConfig(api_key="key", project="project"),
            OpikConfig(api_key="key"),
            WeaveConfig(api_key="key", project="project"),
            AliyunConfig(license_key="test_license", endpoint="https://tracing-analysis-dc-hz.aliyuncs.com"),
        ]

        for config in configs:
            assert config is not None

    def test_url_normalization_consistency(self):
        """Test that URL normalization works consistently across configs"""
        # Test that paths are removed from endpoints
        arize_config = ArizeConfig(endpoint="https://arize.com/api/v1/test")
        phoenix_config = PhoenixConfig(endpoint="https://phoenix.com/api/v2/")
        aliyun_config = AliyunConfig(
            license_key="test_license", endpoint="https://tracing-analysis-dc-hz.aliyuncs.com/api/v1/traces"
        )

        assert arize_config.endpoint == "https://arize.com"
        assert phoenix_config.endpoint == "https://phoenix.com"
        assert aliyun_config.endpoint == "https://tracing-analysis-dc-hz.aliyuncs.com"

    def test_project_default_values(self):
        """Test that project default values are set correctly"""
        arize_config = ArizeConfig(project="")
        phoenix_config = PhoenixConfig(project="")
        opik_config = OpikConfig(project="")
        aliyun_config = AliyunConfig(
            license_key="test_license", endpoint="https://tracing-analysis-dc-hz.aliyuncs.com", app_name=""
        )

        assert arize_config.project == "default"
        assert phoenix_config.project == "default"
        assert opik_config.project == "Default Project"
        assert aliyun_config.app_name == "dify_app"
