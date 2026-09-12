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
