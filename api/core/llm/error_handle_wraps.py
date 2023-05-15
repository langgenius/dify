import logging
from functools import wraps

import openai

from core.llm.error import LLMAPIConnectionError, LLMAPIUnavailableError, LLMRateLimitError, LLMAuthorizationError, \
    LLMBadRequestError


def handle_llm_exceptions(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        except openai.error.InvalidRequestError as e:
            logging.exception("Invalid request to OpenAI API.")
            raise LLMBadRequestError(str(e))
        except openai.error.APIConnectionError as e:
            logging.exception("Failed to connect to OpenAI API.")
            raise LLMAPIConnectionError(str(e))
        except (openai.error.APIError, openai.error.ServiceUnavailableError, openai.error.Timeout) as e:
            logging.exception("OpenAI service unavailable.")
            raise LLMAPIUnavailableError(str(e))
        except openai.error.RateLimitError as e:
            raise LLMRateLimitError(str(e))
        except openai.error.AuthenticationError as e:
            raise LLMAuthorizationError(str(e))

    return wrapper


def handle_llm_exceptions_async(func):
    @wraps(func)
    async def wrapper(*args, **kwargs):
        try:
            return await func(*args, **kwargs)
        except openai.error.InvalidRequestError as e:
            logging.exception("Invalid request to OpenAI API.")
            raise LLMBadRequestError(str(e))
        except openai.error.APIConnectionError as e:
            logging.exception("Failed to connect to OpenAI API.")
            raise LLMAPIConnectionError(str(e))
        except (openai.error.APIError, openai.error.ServiceUnavailableError, openai.error.Timeout) as e:
            logging.exception("OpenAI service unavailable.")
            raise LLMAPIUnavailableError(str(e))
        except openai.error.RateLimitError as e:
            raise LLMRateLimitError(str(e))
        except openai.error.AuthenticationError as e:
            raise LLMAuthorizationError(str(e))

    return wrapper
