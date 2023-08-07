from typing import Optional

from flask import Flask
from pydantic import BaseModel


class HostedOpenAI(BaseModel):
    api_base: str = None
    api_organization: str = None
    api_key: str
    quota_limit: int = 0
    """Quota limit for the openai hosted model. 0 means unlimited."""


class HostedAzureOpenAI(BaseModel):
    api_base: str
    api_key: str
    quota_limit: int = 0
    """Quota limit for the azure openai hosted model. 0 means unlimited."""


class HostedAnthropic(BaseModel):
    api_base: str
    api_key: str
    quota_limit: int = 0
    """Quota limit for the anthropic hosted model. 0 means unlimited."""


class HostedModelProviders(BaseModel):
    openai: Optional[HostedOpenAI] = None
    azure_openai: Optional[HostedAzureOpenAI] = None
    anthropic: Optional[HostedAnthropic] = None


hosted_model_providers = HostedModelProviders()


def init_app(app: Flask):
    if app.config.get("HOSTED_OPENAI_ENABLED"):
        hosted_model_providers.openai = HostedOpenAI(
            api_base=app.config.get("HOSTED_OPENAI_API_KEY"),
            api_organization=app.config.get("HOSTED_OPENAI_API_KEY"),
            api_key=app.config.get("HOSTED_OPENAI_API_KEY"),
            quota_limit=app.config.get("HOSTED_OPENAI_QUOTA_LIMIT"),
        )

    if app.config.get("HOSTED_AZURE_ENABLED"):
        hosted_model_providers.azure_openai = HostedAzureOpenAI(
            api_base=app.config.get("HOSTED_AZURE_OPENAI_API_BASE"),
            api_key=app.config.get("HOSTED_AZURE_OPENAI_API_KEY"),
            quota_limit=app.config.get("HOSTED_AZURE_OPENAI_QUOTA_LIMIT"),
        )

    if app.config.get("HOSTED_ANTHROPIC_ENABLED"):
        hosted_model_providers.anthropic = HostedAnthropic(
            api_base=app.config.get("HOSTED_ANTHROPIC_API_BASE"),
            api_key=app.config.get("HOSTED_ANTHROPIC_API_KEY"),
            quota_limit=app.config.get("HOSTED_ANTHROPIC_QUOTA_LIMIT"),
        )
