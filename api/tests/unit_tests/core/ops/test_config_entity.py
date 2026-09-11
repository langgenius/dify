from dify_trace_aliyun.config import AliyunConfig
from dify_trace_arize_phoenix.config import ArizeConfig, PhoenixConfig
from dify_trace_langfuse.config import LangfuseConfig
from dify_trace_langsmith.config import LangSmithConfig
from dify_trace_opik.config import OpikConfig
from dify_trace_weave.config import WeaveConfig

from core.ops.provider_config import TracingProviderEnum


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
