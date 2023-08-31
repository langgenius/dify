from typing import Dict

from httpx import Limits
from langchain.chat_models import ChatAnthropic
from langchain.utils import get_from_dict_or_env, check_package_version
from pydantic import root_validator


class AnthropicLLM(ChatAnthropic):
    @root_validator()
    def validate_environment(cls, values: Dict) -> Dict:
        """Validate that api key and python package exists in environment."""
        values["anthropic_api_key"] = get_from_dict_or_env(
            values, "anthropic_api_key", "ANTHROPIC_API_KEY"
        )
        # Get custom api url from environment.
        values["anthropic_api_url"] = get_from_dict_or_env(
            values,
            "anthropic_api_url",
            "ANTHROPIC_API_URL",
            default="https://api.anthropic.com",
        )

        try:
            import anthropic

            check_package_version("anthropic", gte_version="0.3")
            values["client"] = anthropic.Anthropic(
                base_url=values["anthropic_api_url"],
                api_key=values["anthropic_api_key"],
                timeout=values["default_request_timeout"],
                max_retries=0,
                connection_pool_limits=Limits(max_connections=200, max_keepalive_connections=100),
            )
            values["async_client"] = anthropic.AsyncAnthropic(
                base_url=values["anthropic_api_url"],
                api_key=values["anthropic_api_key"],
                timeout=values["default_request_timeout"],
            )
            values["HUMAN_PROMPT"] = anthropic.HUMAN_PROMPT
            values["AI_PROMPT"] = anthropic.AI_PROMPT
            values["count_tokens"] = values["client"].count_tokens
        except ImportError:
            raise ImportError(
                "Could not import anthropic python package. "
                "Please it install it with `pip install anthropic`."
            )
        return values
