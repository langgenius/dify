from typing import Optional

from pydantic import Field, NonNegativeInt, computed_field
from pydantic_settings import BaseSettings


class HostedCreditConfig(BaseSettings):
    HOSTED_MODEL_CREDIT_CONFIG: str = Field(
        description="Model credit configuration in format 'model:credits,model:credits', e.g., 'gpt-4:20,gpt-4o:10'",
        default="",
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

    HOSTED_OPENAI_API_KEY: Optional[str] = Field(
        description="API key for hosted OpenAI service",
        default=None,
    )

    HOSTED_OPENAI_API_BASE: Optional[str] = Field(
        description="Base URL for hosted OpenAI API",
        default=None,
    )

    HOSTED_OPENAI_API_ORGANIZATION: Optional[str] = Field(
        description="Organization ID for hosted OpenAI service",
        default=None,
    )

    HOSTED_OPENAI_TRIAL_ENABLED: bool = Field(
        description="Enable trial access to hosted OpenAI service",
        default=False,
    )

    HOSTED_OPENAI_TRIAL_MODELS: str = Field(
        description="Comma-separated list of available models for trial access",
        default="gpt-3.5-turbo,"
        "gpt-3.5-turbo-1106,"
        "gpt-3.5-turbo-instruct,"
        "gpt-3.5-turbo-16k,"
        "gpt-3.5-turbo-16k-0613,"
        "gpt-3.5-turbo-0613,"
        "gpt-3.5-turbo-0125,"
        "text-davinci-003",
    )

    HOSTED_OPENAI_QUOTA_LIMIT: NonNegativeInt = Field(
        description="Quota limit for hosted OpenAI service usage",
        default=200,
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
        "gpt-3.5-turbo,"
        "gpt-3.5-turbo-16k,"
        "gpt-3.5-turbo-16k-0613,"
        "gpt-3.5-turbo-1106,"
        "gpt-3.5-turbo-0613,"
        "gpt-3.5-turbo-0125,"
        "gpt-3.5-turbo-instruct,"
        "text-davinci-003",
    )


class HostedAzureOpenAiConfig(BaseSettings):
    """
    Configuration for hosted Azure OpenAI service
    """

    HOSTED_AZURE_OPENAI_ENABLED: bool = Field(
        description="Enable hosted Azure OpenAI service",
        default=False,
    )

    HOSTED_AZURE_OPENAI_API_KEY: Optional[str] = Field(
        description="API key for hosted Azure OpenAI service",
        default=None,
    )

    HOSTED_AZURE_OPENAI_API_BASE: Optional[str] = Field(
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

    HOSTED_ANTHROPIC_API_BASE: Optional[str] = Field(
        description="Base URL for hosted Anthropic API",
        default=None,
    )

    HOSTED_ANTHROPIC_API_KEY: Optional[str] = Field(
        description="API key for hosted Anthropic service",
        default=None,
    )

    HOSTED_ANTHROPIC_TRIAL_ENABLED: bool = Field(
        description="Enable trial access to hosted Anthropic service",
        default=False,
    )

    HOSTED_ANTHROPIC_QUOTA_LIMIT: NonNegativeInt = Field(
        description="Quota limit for hosted Anthropic service usage",
        default=600000,
    )

    HOSTED_ANTHROPIC_PAID_ENABLED: bool = Field(
        description="Enable paid access to hosted Anthropic service",
        default=False,
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


class HostedServiceConfig(
    # place the configs in alphabet order
    HostedAnthropicConfig,
    HostedAzureOpenAiConfig,
    HostedFetchAppTemplateConfig,
    HostedMinmaxConfig,
    HostedOpenAiConfig,
    HostedSparkConfig,
    HostedZhipuAIConfig,
    # moderation
    HostedModerationConfig,
    # credit config
    HostedCreditConfig,
):
    pass
