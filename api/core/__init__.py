import os
from typing import Optional

import langchain
from flask import Flask
from pydantic import BaseModel

from core.callback_handler.std_out_callback_handler import DifyStdOutCallbackHandler
from core.prompt.prompt_template import OneLineFormatter


class HostedOpenAICredential(BaseModel):
    api_key: str


class HostedAnthropicCredential(BaseModel):
    api_key: str


class HostedLLMCredentials(BaseModel):
    openai: Optional[HostedOpenAICredential] = None
    anthropic: Optional[HostedAnthropicCredential] = None


hosted_llm_credentials = HostedLLMCredentials()


def init_app(app: Flask):
    if os.environ.get("DEBUG") and os.environ.get("DEBUG").lower() == 'true':
        langchain.verbose = True

    if app.config.get("OPENAI_API_KEY"):
        hosted_llm_credentials.openai = HostedOpenAICredential(api_key=app.config.get("OPENAI_API_KEY"))

    if app.config.get("ANTHROPIC_API_KEY"):
        hosted_llm_credentials.anthropic = HostedAnthropicCredential(api_key=app.config.get("ANTHROPIC_API_KEY"))
