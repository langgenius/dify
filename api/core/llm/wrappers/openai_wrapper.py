import logging
from functools import wraps

import openai

from core.llm.error import LLMAPIConnectionError, LLMAPIUnavailableError, LLMRateLimitError, LLMAuthorizationError, \
    LLMBadRequestError


def handle_openai_exceptions(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        except openai.error.InvalidRequestError as e:
            logging.exception("Invalid request to OpenAI API.")
            raise LLMBadRequestError(str(e))
        except openai.error.APIConnectionError as e:
            logging.exception("Failed to connect to OpenAI API.")
            raise LLMAPIConnectionError(e.__class__.__name__ + ":" + str(e))
        except (openai.error.APIError, openai.error.ServiceUnavailableError, openai.error.Timeout) as e:
            logging.exception("OpenAI service unavailable.")
            raise LLMAPIUnavailableError(e.__class__.__name__ + ":" + str(e))
        except openai.error.RateLimitError as e:
            raise LLMRateLimitError(str(e))
        except openai.error.AuthenticationError as e:
            raise LLMAuthorizationError(str(e))
        except openai.error.OpenAIError as e:
            raise LLMBadRequestError(e.__class__.__name__ + ":" + str(e))

    return wrapper
