from functools import lru_cache

from pydantic import Field, NonNegativeInt, PositiveInt
from pydantic_settings import BaseSettings


@lru_cache(maxsize=1)
def _hosted_credit_rates(config: str) -> dict[str, str]:
    """Parse the deployment-wide price table once per configuration, not once per catalog entry."""
    entries = dict(item.strip().split(":", 1) for item in config.split(",") if ":" in item)
    rates: dict[str, str] = {}
    for name, rate in entries.items():
        # Preserve the first normalized match after resolving exact duplicate keys.
        rates.setdefault(name.strip(), rate)
    return rates


class HostedCreditConfig(BaseSettings):
    HOSTED_MODEL_CREDIT_CONFIG: str = Field(
        description=(
            "Deployment-wide prices by exact model ID, e.g. 'gpt-4o-mini:1,gpt-4o:0'. "
            "A zero price skips charging; it does not add the model to any provider's trial or paid list."
        ),
        default="",
    )

    HOSTED_POOL_CREDITS: int = Field(
        description="Pool credits for hosted service",
        default=200,
    )

    def get_model_credits(self, model_name: str) -> int:
        """
        Get credit value for a specific model name.
        Returns 1 if model is not found in configuration (default credit).

        :param model_name: The name of the model to search for
        :return: The credit value for the model
        """
        if not self.HOSTED_MODEL_CREDIT_CONFIG:
            return 1

        try:
            return int(_hosted_credit_rates(self.HOSTED_MODEL_CREDIT_CONFIG).get(model_name, "1"))
        except (ValueError, AttributeError):
            return 1  # Return default quota if parsing fails


class HostedOpenAiConfig(BaseSettings):
    """
    Configuration for hosted OpenAI service
    """

    HOSTED_OPENAI_API_KEY: str | None = Field(
        description="API key for hosted OpenAI service",
        default=None,
    )

    HOSTED_OPENAI_API_BASE: str | None = Field(
        description="Base URL for hosted OpenAI API",
        default=None,
    )

    HOSTED_OPENAI_API_ORGANIZATION: str | None = Field(
        description="Organization ID for hosted OpenAI service",
        default=None,
    )

    HOSTED_OPENAI_TRIAL_ENABLED: bool = Field(
        description="Enable trial access to hosted OpenAI service",
        default=False,
    )

    HOSTED_OPENAI_TRIAL_MODELS: str = Field(
        description="Comma-separated list of available models for trial access",
        default="gpt-4.1,"
        "gpt-4.1-2025-04-14,"
        "gpt-4.1-mini,"
        "gpt-4.1-mini-2025-04-14,"
        "gpt-3.5-turbo-16k,"
        "gpt-4o,"
        "gpt-4o-2024-08-06,"
        "gpt-4o-2024-11-20,"
        "gpt-4o-audio-preview-2025-06-03,"
        "gpt-4o-mini,"
        "gpt-4o-mini-2024-07-18,"
        "gpt-5-mini-2025-08-07,"
        "gpt-5-mini,"
        "gpt-5,"
        "gpt-5-2025-08-07,"
        "gpt-5-nano,"
        "gpt-5-nano-2025-08-07",
    )

    HOSTED_OPENAI_PAID_ENABLED: bool = Field(
        description="Enable paid access to hosted OpenAI service",
        default=False,
    )

    HOSTED_OPENAI_PAID_MODELS: str = Field(
        description="Comma-separated list of available models for paid access",
        default="gpt-4.1,"
        "gpt-4.1-2025-04-14,"
        "gpt-4.1-mini,"
        "gpt-4.1-mini-2025-04-14,"
        "gpt-3.5-turbo-16k,"
        "gpt-4o,"
        "gpt-4o-2024-08-06,"
        "gpt-4o-2024-11-20,"
        "gpt-4o-audio-preview-2025-06-03,"
        "gpt-4o-mini,"
        "gpt-4o-mini-2024-07-18,"
        "gpt-5-mini-2025-08-07,"
        "gpt-5-mini,"
        "gpt-5,"
        "gpt-5-2025-08-07,"
        "gpt-5-nano,"
        "gpt-5-nano-2025-08-07",
    )


class HostedGeminiConfig(BaseSettings):
    """
    Configuration for fetching Gemini service
    """

    HOSTED_GEMINI_API_KEY: str | None = Field(
        description="API key for hosted Gemini service",
        default=None,
    )

    HOSTED_GEMINI_API_BASE: str | None = Field(
        description="Base URL for hosted Gemini API",
        default=None,
    )

    HOSTED_GEMINI_API_ORGANIZATION: str | None = Field(
        description="Organization ID for hosted Gemini service",
        default=None,
    )

    HOSTED_GEMINI_TRIAL_ENABLED: bool = Field(
        description="Enable trial access to hosted Gemini service",
        default=False,
    )

    HOSTED_GEMINI_TRIAL_MODELS: str = Field(
        description="Comma-separated list of available models for trial access",
        default="gemini-2.5-flash,gemini-2.0-flash,gemini-2.0-flash-lite,",
    )

    HOSTED_GEMINI_PAID_ENABLED: bool = Field(
        description="Enable paid access to hosted gemini service",
        default=False,
    )

    HOSTED_GEMINI_PAID_MODELS: str = Field(
        description="Comma-separated list of available models for paid access",
        default="gemini-2.5-flash,gemini-2.0-flash,gemini-2.0-flash-lite,",
    )


class HostedXAIConfig(BaseSettings):
    """
    Configuration for fetching XAI service
    """

    HOSTED_XAI_API_KEY: str | None = Field(
        description="API key for hosted XAI service",
        default=None,
    )

    HOSTED_XAI_API_BASE: str | None = Field(
        description="Base URL for hosted XAI API",
        default=None,
    )

    HOSTED_XAI_API_ORGANIZATION: str | None = Field(
        description="Organization ID for hosted XAI service",
        default=None,
    )

    HOSTED_XAI_TRIAL_ENABLED: bool = Field(
        description="Enable trial access to hosted XAI service",
        default=False,
    )

    HOSTED_XAI_TRIAL_MODELS: str = Field(
        description="Comma-separated list of available models for trial access",
        default="grok-3,grok-3-mini,grok-3-mini-fast",
    )

    HOSTED_XAI_PAID_ENABLED: bool = Field(
        description="Enable paid access to hosted XAI service",
        default=False,
    )

    HOSTED_XAI_PAID_MODELS: str = Field(
        description="Comma-separated list of available models for paid access",
        default="grok-3,grok-3-mini,grok-3-mini-fast",
    )


class HostedDeepseekConfig(BaseSettings):
    """
    Configuration for fetching Deepseek service
    """

    HOSTED_DEEPSEEK_API_KEY: str | None = Field(
        description="API key for hosted Deepseek service",
        default=None,
    )

    HOSTED_DEEPSEEK_API_BASE: str | None = Field(
        description="Base URL for hosted Deepseek API",
        default=None,
    )

    HOSTED_DEEPSEEK_API_ORGANIZATION: str | None = Field(
        description="Organization ID for hosted Deepseek service",
        default=None,
    )

    HOSTED_DEEPSEEK_TRIAL_ENABLED: bool = Field(
        description="Enable trial access to hosted Deepseek service",
        default=False,
    )

    HOSTED_DEEPSEEK_TRIAL_MODELS: str = Field(
        description="Comma-separated list of available models for trial access",
        default="deepseek-chat,deepseek-reasoner",
    )

    HOSTED_DEEPSEEK_PAID_ENABLED: bool = Field(
        description="Enable paid access to hosted Deepseek service",
        default=False,
    )

    HOSTED_DEEPSEEK_PAID_MODELS: str = Field(
        description="Comma-separated list of available models for paid access",
        default="deepseek-chat,deepseek-reasoner",
    )


class HostedAzureOpenAiConfig(BaseSettings):
    """
    Configuration for hosted Azure OpenAI service
    """

    HOSTED_AZURE_OPENAI_ENABLED: bool = Field(
        description="Enable hosted Azure OpenAI service",
        default=False,
    )

    HOSTED_AZURE_OPENAI_API_KEY: str | None = Field(
        description="API key for hosted Azure OpenAI service",
        default=None,
    )

    HOSTED_AZURE_OPENAI_API_BASE: str | None = Field(
        description="Base URL for hosted Azure OpenAI API",
        default=None,
    )

    HOSTED_AZURE_OPENAI_QUOTA_LIMIT: NonNegativeInt = Field(
        description="Quota limit for hosted Azure OpenAI service usage",
        default=200,
    )


class HostedAnthropicConfig(BaseSettings):
    """
    Configuration for hosted Anthropic service
    """

    HOSTED_ANTHROPIC_API_BASE: str | None = Field(
        description="Base URL for hosted Anthropic API",
        default=None,
    )

    HOSTED_ANTHROPIC_API_KEY: str | None = Field(
        description="API key for hosted Anthropic service",
        default=None,
    )

    HOSTED_ANTHROPIC_TRIAL_ENABLED: bool = Field(
        description="Enable trial access to hosted Anthropic service",
        default=False,
    )

    HOSTED_ANTHROPIC_PAID_ENABLED: bool = Field(
        description="Enable paid access to hosted Anthropic service",
        default=False,
    )

    HOSTED_ANTHROPIC_TRIAL_MODELS: str = Field(
        description="Comma-separated list of available models for paid access",
        default="claude-opus-4-8,claude-sonnet-5-5,claude-haiku-4-5-20251001",
    )
    HOSTED_ANTHROPIC_PAID_MODELS: str = Field(
        description="Comma-separated list of available models for paid access",
        default="claude-opus-4-8,claude-sonnet-5-5,claude-haiku-4-5-20251001",
    )


class HostedTongyiConfig(BaseSettings):
    """
    Configuration for hosted Tongyi service
    """

    HOSTED_TONGYI_API_KEY: str | None = Field(
        description="API key for hosted Tongyi service",
        default=None,
    )

    HOSTED_TONGYI_USE_INTERNATIONAL_ENDPOINT: bool = Field(
        description="Use international endpoint for hosted Tongyi service",
        default=False,
    )

    HOSTED_TONGYI_TRIAL_ENABLED: bool = Field(
        description="Enable trial access to hosted Tongyi service",
        default=False,
    )

    HOSTED_TONGYI_PAID_ENABLED: bool = Field(
        description="Enable paid access to hosted Anthropic service",
        default=False,
    )

    HOSTED_TONGYI_TRIAL_MODELS: str = Field(
        description="Comma-separated list of available models for trial access",
        default="",
    )

    HOSTED_TONGYI_PAID_MODELS: str = Field(
        description="Comma-separated list of available models for paid access",
        default="",
    )


class HostedMinmaxConfig(BaseSettings):
    """
    Configuration for hosted Minmax service
    """

    HOSTED_MINIMAX_ENABLED: bool = Field(
        description="Enable hosted Minmax service",
        default=False,
    )


class HostedSparkConfig(BaseSettings):
    """
    Configuration for hosted Spark service
    """

    HOSTED_SPARK_ENABLED: bool = Field(
        description="Enable hosted Spark service",
        default=False,
    )


class HostedZhipuAIConfig(BaseSettings):
    """
    Configuration for hosted ZhipuAI service
    """

    HOSTED_ZHIPUAI_ENABLED: bool = Field(
        description="Enable hosted ZhipuAI service",
        default=False,
    )


class HostedModerationConfig(BaseSettings):
    """Automatic OpenAI moderation and verdict retention for Cloud model calls."""

    HOSTED_MODERATION_ENABLED: bool = Field(
        description="Enable automatic platform moderation for Cloud AI-credit LLMs; ignored in other editions",
        default=False,
    )

    HOSTED_MODERATION_BATCH_MAX_ITEMS: PositiveInt = Field(
        description="Maximum number of text segments per platform moderation request",
        default=32,
    )

    HOSTED_MODERATION_BATCH_MAX_TEXT_BYTES: PositiveInt = Field(
        description="UTF-8 text budget per platform moderation batch; oversized segments are sent alone",
        default=128 * 1024,
    )

    HOSTED_MODERATION_CACHE_TTL: NonNegativeInt = Field(
        description="TTL in seconds for batch moderation verdicts; 0 disables caching",
        default=600,
    )


class HostedFetchAppTemplateConfig(BaseSettings):
    """
    Configuration for fetching app templates
    """

    HOSTED_FETCH_APP_TEMPLATES_MODE: str = Field(
        description="Mode for fetching app templates: remote, db, or builtin default to remote,",
        default="remote",
    )

    HOSTED_FETCH_APP_TEMPLATES_REMOTE_DOMAIN: str = Field(
        description="Domain for fetching remote app templates",
        default="https://tmpl.dify.ai",
    )

    HOSTED_FETCH_APP_TEMPLATES_CACHE_TTL: int = Field(
        description="TTL in seconds for caching remote app template HTTP responses. 0 disables caching.",
        default=600,
        ge=0,
    )


class HostedFetchPipelineTemplateConfig(BaseSettings):
    """
    Configuration for fetching pipeline templates
    """

    HOSTED_FETCH_PIPELINE_TEMPLATES_MODE: str = Field(
        description="Mode for fetching pipeline templates: remote, db, or builtin default to remote,",
        default="remote",
    )

    HOSTED_FETCH_PIPELINE_TEMPLATES_REMOTE_DOMAIN: str = Field(
        description="Domain for fetching remote pipeline templates",
        default="https://tmpl.dify.ai",
    )


class HostedServiceConfig(
    # place the configs in alphabet order
    HostedAnthropicConfig,
    HostedAzureOpenAiConfig,
    HostedFetchAppTemplateConfig,
    HostedFetchPipelineTemplateConfig,
    HostedMinmaxConfig,
    HostedOpenAiConfig,
    HostedSparkConfig,
    HostedZhipuAIConfig,
    HostedTongyiConfig,
    # moderation
    HostedModerationConfig,
    # credit config
    HostedCreditConfig,
    HostedGeminiConfig,
    HostedXAIConfig,
    HostedDeepseekConfig,
):
    pass
