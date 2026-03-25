from pydantic import Field, NonNegativeInt
from pydantic_settings import BaseSettings


class HostedCreditConfig(BaseSettings):
    HOSTED_MODEL_CREDIT_CONFIG: str = Field(
        description="Model credit configuration in format 'model:credits,model:credits', e.g., 'gpt-4:20,gpt-4o:10'",
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
            credit_map = dict(
                item.strip().split(":", 1) for item in self.HOSTED_MODEL_CREDIT_CONFIG.split(",") if ":" in item
            )

            # Search for matching model pattern
            for pattern, credit in credit_map.items():
                if pattern.strip() == model_name:
                    return int(credit)
            return 1  # Default quota if no match found
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
        default="gpt-4,"
        "gpt-4-turbo-preview,"
        "gpt-4-turbo-2024-04-09,"
        "gpt-4-1106-preview,"
        "gpt-4-0125-preview,"
        "gpt-4-turbo,"
        "gpt-4.1,"
        "gpt-4.1-2025-04-14,"
        "gpt-4.1-mini,"
        "gpt-4.1-mini-2025-04-14,"
        "gpt-4.1-nano,"
        "gpt-4.1-nano-2025-04-14,"
        "gpt-3.5-turbo,"
        "gpt-3.5-turbo-16k,"
        "gpt-3.5-turbo-16k-0613,"
        "gpt-3.5-turbo-1106,"
        "gpt-3.5-turbo-0613,"
        "gpt-3.5-turbo-0125,"
        "gpt-3.5-turbo-instruct,"
        "text-davinci-003,"
        "chatgpt-4o-latest,"
        "gpt-4o,"
        "gpt-4o-2024-05-13,"
        "gpt-4o-2024-08-06,"
        "gpt-4o-2024-11-20,"
        "gpt-4o-audio-preview,"
        "gpt-4o-audio-preview-2025-06-03,"
        "gpt-4o-mini,"
        "gpt-4o-mini-2024-07-18,"
        "o3-mini,"
        "o3-mini-2025-01-31,"
        "gpt-5-mini-2025-08-07,"
        "gpt-5-mini,"
        "o4-mini,"
        "o4-mini-2025-04-16,"
        "gpt-5-chat-latest,"
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
        default="gpt-4,"
        "gpt-4-turbo-preview,"
        "gpt-4-turbo-2024-04-09,"
        "gpt-4-1106-preview,"
        "gpt-4-0125-preview,"
        "gpt-4-turbo,"
        "gpt-4.1,"
        "gpt-4.1-2025-04-14,"
        "gpt-4.1-mini,"
        "gpt-4.1-mini-2025-04-14,"
        "gpt-4.1-nano,"
        "gpt-4.1-nano-2025-04-14,"
        "gpt-3.5-turbo,"
        "gpt-3.5-turbo-16k,"
        "gpt-3.5-turbo-16k-0613,"
        "gpt-3.5-turbo-1106,"
        "gpt-3.5-turbo-0613,"
        "gpt-3.5-turbo-0125,"
        "gpt-3.5-turbo-instruct,"
        "text-davinci-003,"
        "chatgpt-4o-latest,"
        "gpt-4o,"
        "gpt-4o-2024-05-13,"
        "gpt-4o-2024-08-06,"
        "gpt-4o-2024-11-20,"
        "gpt-4o-audio-preview,"
        "gpt-4o-audio-preview-2025-06-03,"
        "gpt-4o-mini,"
        "gpt-4o-mini-2024-07-18,"
        "o3-mini,"
        "o3-mini-2025-01-31,"
        "gpt-5-mini-2025-08-07,"
        "gpt-5-mini,"
        "o4-mini,"
        "o4-mini-2025-04-16,"
        "gpt-5-chat-latest,"
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
        default="claude-opus-4-20250514,"
        "claude-sonnet-4-20250514,"
        "claude-3-5-haiku-20241022,"
        "claude-3-opus-20240229,"
        "claude-3-7-sonnet-20250219,"
        "claude-3-haiku-20240307",
    )
    HOSTED_ANTHROPIC_PAID_MODELS: str = Field(
        description="Comma-separated list of available models for paid access",
        default="claude-opus-4-20250514,"
        "claude-sonnet-4-20250514,"
        "claude-3-5-haiku-20241022,"
        "claude-3-opus-20240229,"
        "claude-3-7-sonnet-20250219,"
        "claude-3-haiku-20240307",
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
    """
    Configuration for hosted Moderation service
    """

    HOSTED_MODERATION_ENABLED: bool = Field(
        description="Enable hosted Moderation service",
        default=False,
    )

    HOSTED_MODERATION_PROVIDERS: str = Field(
        description="Comma-separated list of moderation providers",
        default="",
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
