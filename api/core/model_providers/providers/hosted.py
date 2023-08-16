import os
from typing import Optional

import langchain
from flask import Flask
from pydantic import BaseModel


class HostedOpenAI(BaseModel):
    api_base: str = None
    api_organization: str = None
    api_key: str
    quota_limit: int = 0
    """Quota limit for the openai hosted model. 0 means unlimited."""
    paid_enabled: bool = False
    paid_stripe_price_id: str = None
    paid_increase_quota: int = 1


class HostedAzureOpenAI(BaseModel):
    api_base: str
    api_key: str
    quota_limit: int = 0
    """Quota limit for the azure openai hosted model. 0 means unlimited."""


class HostedAnthropic(BaseModel):
    api_base: str = None
    api_key: str
    quota_limit: int = 0
    """Quota limit for the anthropic hosted model. 0 means unlimited."""
    paid_enabled: bool = False
    paid_stripe_price_id: str = None
    paid_increase_quota: int = 1000000
    paid_min_quantity: int = 20
    paid_max_quantity: int = 100


class HostedModelProviders(BaseModel):
    openai: Optional[HostedOpenAI] = None
    azure_openai: Optional[HostedAzureOpenAI] = None
    anthropic: Optional[HostedAnthropic] = None


hosted_model_providers = HostedModelProviders()


def init_app(app: Flask):
    if os.environ.get("DEBUG") and os.environ.get("DEBUG").lower() == 'true':
        langchain.verbose = True

    if app.config.get("HOSTED_OPENAI_ENABLED"):
        hosted_model_providers.openai = HostedOpenAI(
            api_base=app.config.get("HOSTED_OPENAI_API_BASE"),
            api_organization=app.config.get("HOSTED_OPENAI_API_ORGANIZATION"),
            api_key=app.config.get("HOSTED_OPENAI_API_KEY"),
            quota_limit=app.config.get("HOSTED_OPENAI_QUOTA_LIMIT"),
            paid_enabled=app.config.get("HOSTED_OPENAI_PAID_ENABLED"),
            paid_stripe_price_id=app.config.get("HOSTED_OPENAI_PAID_STRIPE_PRICE_ID"),
            paid_increase_quota=app.config.get("HOSTED_OPENAI_PAID_INCREASE_QUOTA"),
        )

    if app.config.get("HOSTED_AZURE_OPENAI_ENABLED"):
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
            paid_enabled=app.config.get("HOSTED_ANTHROPIC_PAID_ENABLED"),
            paid_stripe_price_id=app.config.get("HOSTED_ANTHROPIC_PAID_STRIPE_PRICE_ID"),
            paid_increase_quota=app.config.get("HOSTED_ANTHROPIC_PAID_INCREASE_QUOTA"),
            paid_min_quantity=app.config.get("HOSTED_ANTHROPIC_PAID_MIN_QUANTITY"),
            paid_max_quantity=app.config.get("HOSTED_ANTHROPIC_PAID_MAX_QUANTITY"),
        )
