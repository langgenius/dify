from enum import StrEnum


class HostedTrialProvider(StrEnum):
    """
    Enum representing hosted model provider names for trial access.
    """

    OPENAI = "langgenius/openai"
    ANTHROPIC = "langgenius/anthropic"
    GEMINI = "langgenius/gemini"
    X = "langgenius/x"
    DEEPSEEK = "langgenius/deepseek"
    TONGYI = "langgenius/tongyi"

    @property
    def config_key(self) -> str:
        """Return the config key used in dify_config (e.g., HOSTED_{config_key}_PAID_ENABLED)."""
        if self == HostedTrialProvider.X:
            return "XAI"
        return self.name
