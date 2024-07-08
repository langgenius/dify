from typing import Optional

from pydantic import Field, NonNegativeInt
from pydantic_settings import BaseSettings


class HostedOpenAiConfig(BaseSettings):
    """
    Hosted OpenAI service config
    """

    HOSTED_OPENAI_API_KEY: Optional[str] = Field(
        description='',
        default=None,
    )

    HOSTED_OPENAI_API_BASE: Optional[str] = Field(
        description='',
        default=None,
    )

    HOSTED_OPENAI_API_ORGANIZATION: Optional[str] = Field(
        description='',
        default=None,
    )

    HOSTED_OPENAI_TRIAL_ENABLED: bool = Field(
        description='',
        default=False,
    )

    HOSTED_OPENAI_TRIAL_MODELS: str = Field(
        description='',
        default='gpt-3.5-turbo,'
                'gpt-3.5-turbo-1106,'
                'gpt-3.5-turbo-instruct,'
                'gpt-3.5-turbo-16k,'
                'gpt-3.5-turbo-16k-0613,'
                'gpt-3.5-turbo-0613,'
                'gpt-3.5-turbo-0125,'
                'text-davinci-003',
    )

    HOSTED_OPENAI_QUOTA_LIMIT: NonNegativeInt = Field(
        description='',
        default=200,
    )

    HOSTED_OPENAI_PAID_ENABLED: bool = Field(
        description='',
        default=False,
    )

    HOSTED_OPENAI_PAID_MODELS: str = Field(
        description='',
        default='gpt-4,'
                'gpt-4-turbo-preview,'
                'gpt-4-turbo-2024-04-09,'
                'gpt-4-1106-preview,'
                'gpt-4-0125-preview,'
                'gpt-3.5-turbo,'
                'gpt-3.5-turbo-16k,'
                'gpt-3.5-turbo-16k-0613,'
                'gpt-3.5-turbo-1106,'
                'gpt-3.5-turbo-0613,'
                'gpt-3.5-turbo-0125,'
                'gpt-3.5-turbo-instruct,'
                'text-davinci-003',
    )


class HostedAzureOpenAiConfig(BaseSettings):
    """
    Hosted OpenAI service config
    """

    HOSTED_AZURE_OPENAI_ENABLED: bool = Field(
        description='',
        default=False,
    )

    HOSTED_OPENAI_API_KEY: Optional[str] = Field(
        description='',
        default=None,
    )

    HOSTED_AZURE_OPENAI_API_BASE: Optional[str] = Field(
        description='',
        default=None,
    )

    HOSTED_AZURE_OPENAI_QUOTA_LIMIT: NonNegativeInt = Field(
        description='',
        default=200,
    )


class HostedAnthropicConfig(BaseSettings):
    """
    Hosted Azure OpenAI service config
    """

    HOSTED_ANTHROPIC_API_BASE: Optional[str] = Field(
        description='',
        default=None,
    )

    HOSTED_ANTHROPIC_API_KEY: Optional[str] = Field(
        description='',
        default=None,
    )

    HOSTED_ANTHROPIC_TRIAL_ENABLED: bool = Field(
        description='',
        default=False,
    )

    HOSTED_ANTHROPIC_QUOTA_LIMIT: NonNegativeInt = Field(
        description='',
        default=600000,
    )

    HOSTED_ANTHROPIC_PAID_ENABLED: bool = Field(
        description='',
        default=False,
    )


class HostedMinmaxConfig(BaseSettings):
    """
    Hosted Minmax service config
    """

    HOSTED_MINIMAX_ENABLED: bool = Field(
        description='',
        default=False,
    )


class HostedSparkConfig(BaseSettings):
    """
    Hosted Spark service config
    """

    HOSTED_SPARK_ENABLED: bool = Field(
        description='',
        default=False,
    )


class HostedZhipuAIConfig(BaseSettings):
    """
    Hosted Minmax service config
    """

    HOSTED_ZHIPUAI_ENABLED: bool = Field(
        description='',
        default=False,
    )


class HostedModerationConfig(BaseSettings):
    """
    Hosted Moderation service config
    """

    HOSTED_MODERATION_ENABLED: bool = Field(
        description='',
        default=False,
    )

    HOSTED_MODERATION_PROVIDERS: str = Field(
        description='',
        default='',
    )


class HostedFetchAppTemplateConfig(BaseSettings):
    """
    Hosted Moderation service config
    """

    HOSTED_FETCH_APP_TEMPLATES_MODE: str = Field(
        description='the mode for fetching app templates,'
                    ' default to remote,'
                    ' available values: remote, db, builtin',
        default='remote',
    )

    HOSTED_FETCH_APP_TEMPLATES_REMOTE_DOMAIN: str = Field(
        description='the domain for fetching remote app templates',
        default='https://tmpl.dify.ai',
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
):
    pass
