import logging
from functools import wraps

import anthropic

from core.llm.error import LLMAPIConnectionError, LLMAPIUnavailableError, LLMRateLimitError, LLMAuthorizationError, \
    LLMBadRequestError


def handle_anthropic_exceptions(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        except anthropic.APIConnectionError as e:
            logging.exception("Failed to connect to Anthropic API.")
            raise LLMAPIConnectionError(f"Anthropic: The server could not be reached, cause: {e.__cause__}")
        except anthropic.RateLimitError:
            raise LLMRateLimitError("Anthropic: A 429 status code was received; we should back off a bit.")
        except anthropic.AuthenticationError as e:
            raise LLMAuthorizationError(f"Anthropic: {e.message}")
        except anthropic.BadRequestError as e:
            raise LLMBadRequestError(f"Anthropic: {e.message}")
        except anthropic.APIStatusError as e:
            raise LLMAPIUnavailableError(f"Anthropic: code: {e.status_code}, cause: {e.message}")

    return wrapper
