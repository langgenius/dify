from dify_trace_aliyun.config import AliyunConfig
from dify_trace_arize_phoenix.config import ArizeConfig, PhoenixConfig
from dify_trace_langfuse.config import LangfuseConfig
from dify_trace_langsmith.config import LangSmithConfig
from dify_trace_opik.config import OpikConfig
from dify_trace_weave.config import WeaveConfig

from core.ops.entities.config_entity import TracingProviderEnum


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


class TestConfigIntegration:
    """Cross-provider configuration sanity checks"""

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
        arize_config = ArizeConfig(endpoint="https://arize.com/api/v1/test")
        phoenix_with_path_config = PhoenixConfig(endpoint="https://app.phoenix.arize.com/s/dify-integration")
        phoenix_without_path_config = PhoenixConfig(endpoint="https://app.phoenix.arize.com")
        aliyun_config = AliyunConfig(
            license_key="test_license", endpoint="https://tracing-analysis-dc-hz.aliyuncs.com/api/v1/traces"
        )

        assert arize_config.endpoint == "https://arize.com"
        assert phoenix_with_path_config.endpoint == "https://app.phoenix.arize.com/s/dify-integration"
        assert phoenix_without_path_config.endpoint == "https://app.phoenix.arize.com"
        assert aliyun_config.endpoint == "https://tracing-analysis-dc-hz.aliyuncs.com/api/v1/traces"

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
