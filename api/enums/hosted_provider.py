from enum import StrEnum


class HostedTrialProvider(StrEnum):
    """
    Enum representing hosted model provider names for trial access.
    """

    OPENAI = "openai"
    DEEPSEEK = "deepseek"
    ANTHROPIC = "anthropic"
    GEMINI = "gemini"
    XAI = "xai"
    TONGYI = "tongyi"

