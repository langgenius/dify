# pyright: reportMissingImports=false

from collections.abc import Mapping

from dify_plugin import ModelProvider


class DifyAgentBenchmarkProvider(ModelProvider):
    def validate_provider_credentials(self, credentials: Mapping[str, object]) -> None:
        """Require the non-secret opt-in that activates this benchmark provider."""

        if credentials.get("benchmark_enabled") != "enabled":
            raise ValueError("benchmark provider must be explicitly enabled")
