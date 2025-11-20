"""Base client with common functionality for both sync and async clients."""

import json
import time
import logging
from typing import Dict, Callable, Optional

try:
    # Python 3.10+
    from typing import ParamSpec
except ImportError:
    # Python < 3.10
    from typing_extensions import ParamSpec

from urllib.parse import urljoin

import httpx

P = ParamSpec("P")

from .exceptions import (
    DifyClientError,
    APIError,
    AuthenticationError,
    RateLimitError,
    ValidationError,
    NetworkError,
    TimeoutError,
)


class BaseClientMixin:
    """Mixin class providing common functionality for Dify clients."""

    def __init__(
        self,
        api_key: str,
        base_url: str = "https://api.dify.ai/v1",
        timeout: float = 60.0,
        max_retries: int = 3,
        retry_delay: float = 1.0,
        enable_logging: bool = False,
    ):
        """Initialize the base client.

        Args:
            api_key: Your Dify API key
            base_url: Base URL for the Dify API
            timeout: Request timeout in seconds
            max_retries: Maximum number of retry attempts
            retry_delay: Delay between retries in seconds
            enable_logging: Enable detailed logging
        """
        if not api_key:
            raise ValidationError("API key is required")

        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.max_retries = max_retries
        self.retry_delay = retry_delay
        self.enable_logging = enable_logging

        # Setup logging
        self.logger = logging.getLogger(f"dify_client.{self.__class__.__name__.lower()}")
        if enable_logging and not self.logger.handlers:
            # Create console handler with formatter
            handler = logging.StreamHandler()
            formatter = logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")
            handler.setFormatter(formatter)
            self.logger.addHandler(handler)
            self.logger.setLevel(logging.INFO)
            self.enable_logging = True
        else:
            self.enable_logging = enable_logging

    def _get_headers(self, content_type: str = "application/json") -> Dict[str, str]:
        """Get common request headers."""
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": content_type,
            "User-Agent": "dify-client-python/0.1.12",
        }

    def _build_url(self, endpoint: str) -> str:
        """Build full URL from endpoint."""
        return urljoin(self.base_url + "/", endpoint.lstrip("/"))

    def _handle_response(self, response: httpx.Response) -> httpx.Response:
        """Handle HTTP response and raise appropriate exceptions."""
        try:
            if response.status_code == 401:
                raise AuthenticationError(
                    "Authentication failed. Check your API key.",
                    status_code=response.status_code,
                    response=response.json() if response.content else None,
                )
            elif response.status_code == 429:
                retry_after = response.headers.get("Retry-After")
                raise RateLimitError(
                    "Rate limit exceeded. Please try again later.",
                    retry_after=int(retry_after) if retry_after else None,
                )
            elif response.status_code >= 400:
                try:
                    error_data = response.json()
                    message = error_data.get("message", f"HTTP {response.status_code}")
                except:
                    message = f"HTTP {response.status_code}: {response.text}"

                raise APIError(
                    message,
                    status_code=response.status_code,
                    response=response.json() if response.content else None,
                )

            return response

        except json.JSONDecodeError:
            raise APIError(
                f"Invalid JSON response: {response.text}",
                status_code=response.status_code,
            )

    def _retry_request(
        self,
        request_func: Callable[P, httpx.Response],
        request_context: str | None = None,
        *args: P.args,
        **kwargs: P.kwargs,
    ) -> httpx.Response:
        """Retry a request with exponential backoff.

        Args:
            request_func: Function that performs the HTTP request
            request_context: Context description for logging (e.g., "GET /v1/messages")
            *args: Positional arguments to pass to request_func
            **kwargs: Keyword arguments to pass to request_func

        Returns:
            httpx.Response: Successful response

        Raises:
            NetworkError: On network failures after retries
            TimeoutError: On timeout failures after retries
            APIError: On API errors (4xx/5xx responses)
            DifyClientError: On unexpected failures
        """
        last_exception = None

        for attempt in range(self.max_retries + 1):
            try:
                response = request_func(*args, **kwargs)
                return response  # Let caller handle response processing

            except (httpx.NetworkError, httpx.TimeoutException) as e:
                last_exception = e
                context_msg = f" {request_context}" if request_context else ""

                if attempt < self.max_retries:
                    delay = self.retry_delay * (2**attempt)  # Exponential backoff
                    self.logger.warning(
                        f"Request failed{context_msg} (attempt {attempt + 1}/{self.max_retries + 1}): {e}. "
                        f"Retrying in {delay:.2f} seconds..."
                    )
                    time.sleep(delay)
                else:
                    self.logger.error(f"Request failed{context_msg} after {self.max_retries + 1} attempts: {e}")
                    # Convert to custom exceptions
                    if isinstance(e, httpx.TimeoutException):
                        from .exceptions import TimeoutError

                        raise TimeoutError(f"Request timed out after {self.max_retries} retries{context_msg}") from e
                    else:
                        from .exceptions import NetworkError

                        raise NetworkError(
                            f"Network error after {self.max_retries} retries{context_msg}: {str(e)}"
                        ) from e

        if last_exception:
            raise last_exception
        raise DifyClientError("Request failed after retries")

    def _validate_params(self, **params) -> None:
        """Validate request parameters."""
        for key, value in params.items():
            if value is None:
                continue

            # String validations
            if isinstance(value, str):
                if not value.strip():
                    raise ValidationError(f"Parameter '{key}' cannot be empty or whitespace only")
                if len(value) > 10000:
                    raise ValidationError(f"Parameter '{key}' exceeds maximum length of 10000 characters")

            # List validations
            elif isinstance(value, list):
                if len(value) > 1000:
                    raise ValidationError(f"Parameter '{key}' exceeds maximum size of 1000 items")

            # Dictionary validations
            elif isinstance(value, dict):
                if len(value) > 100:
                    raise ValidationError(f"Parameter '{key}' exceeds maximum size of 100 items")

            # Type-specific validations
            if key == "user" and not isinstance(value, str):
                raise ValidationError(f"Parameter '{key}' must be a string")
            elif key in ["page", "limit", "page_size"] and not isinstance(value, int):
                raise ValidationError(f"Parameter '{key}' must be an integer")
            elif key == "files" and not isinstance(value, (list, dict)):
                raise ValidationError(f"Parameter '{key}' must be a list or dict")
            elif key == "rating" and value not in ["like", "dislike"]:
                raise ValidationError(f"Parameter '{key}' must be 'like' or 'dislike'")

    def _log_request(self, method: str, url: str, **kwargs) -> None:
        """Log request details."""
        self.logger.info(f"Making {method} request to {url}")
        if kwargs.get("json"):
            self.logger.debug(f"Request body: {kwargs['json']}")
        if kwargs.get("params"):
            self.logger.debug(f"Query params: {kwargs['params']}")

    def _log_response(self, response: httpx.Response) -> None:
        """Log response details."""
        self.logger.info(f"Received response: {response.status_code} ({len(response.content)} bytes)")
