import pytest
from dify_trace_aliyun.config import AliyunConfig
from pydantic import ValidationError


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
        """Test endpoint validation preserves path for Aliyun endpoints"""
        config = AliyunConfig(
            license_key="test_license", endpoint="https://tracing-analysis-dc-hz.aliyuncs.com/api/v1/traces"
        )
        assert config.endpoint == "https://tracing-analysis-dc-hz.aliyuncs.com/api/v1/traces"

    def test_endpoint_validation_invalid_scheme(self):
        """Test endpoint validation rejects invalid schemes"""
        with pytest.raises(ValidationError, match="URL must start with https:// or http://"):
            AliyunConfig(license_key="test_license", endpoint="ftp://invalid.tracing-analysis-dc-hz.aliyuncs.com")

    def test_endpoint_validation_no_scheme(self):
        """Test endpoint validation rejects URLs without scheme"""
        with pytest.raises(ValidationError, match="URL must start with https:// or http://"):
            AliyunConfig(license_key="test_license", endpoint="invalid.tracing-analysis-dc-hz.aliyuncs.com")

    def test_license_key_required(self):
        """Test that license_key is required and cannot be empty"""
        with pytest.raises(ValidationError):
            AliyunConfig(license_key="", endpoint="https://tracing-analysis-dc-hz.aliyuncs.com")

    def test_valid_endpoint_format_examples(self):
        """Test valid endpoint format examples from comments"""
        valid_endpoints = [
            # cms2.0 public endpoint
            "https://proj-xtrace-123456-cn-heyuan.cn-heyuan.log.aliyuncs.com/apm/trace/opentelemetry",
            # cms2.0 intranet endpoint
            "https://proj-xtrace-123456-cn-heyuan.cn-heyuan-intranet.log.aliyuncs.com/apm/trace/opentelemetry",
            # xtrace public endpoint
            "http://tracing-cn-heyuan.arms.aliyuncs.com",
            # xtrace intranet endpoint
            "http://tracing-cn-heyuan-internal.arms.aliyuncs.com",
        ]

        for endpoint in valid_endpoints:
            config = AliyunConfig(license_key="test_license", endpoint=endpoint)
            assert config.endpoint == endpoint
