import inspect
import json
import logging
from collections.abc import Callable, Generator, Mapping
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any, cast, get_args, get_origin
from urllib.parse import unquote

import httpx
from pydantic import BaseModel
from yarl import URL

from configs import dify_config
from core.helper.http_client_pooling import get_pooled_http_client
from core.plugin.endpoint.exc import EndpointSetupFailedError
from core.plugin.entities.plugin_daemon import (
    PluginDaemonBasicResponse,
    PluginDaemonError,
    PluginDaemonInnerError,
    PluginListResponse,
)
from core.plugin.impl.exc import (
    PluginDaemonBadRequestError,
    PluginDaemonClientSideError,
    PluginDaemonInternalServerError,
    PluginDaemonNotFoundError,
    PluginDaemonUnauthorizedError,
    PluginInvokeError,
    PluginLLMPollingUnsupportedError,
    PluginNotFoundError,
    PluginPermissionDeniedError,
    PluginRuntimeError,
    PluginUniqueIdentifierError,
)
from core.trigger.errors import (
    EventIgnoreError,
    TriggerInvokeError,
    TriggerPluginInvokeError,
    TriggerProviderCredentialValidationError,
)
from graphon.model_runtime.errors.invoke import (
    InvokeAuthorizationError,
    InvokeBadRequestError,
    InvokeConnectionError,
    InvokeRateLimitError,
    InvokeServerUnavailableError,
)
from graphon.model_runtime.errors.validate import CredentialsValidateFailedError

plugin_daemon_inner_api_baseurl = URL(str(dify_config.PLUGIN_DAEMON_URL))
_plugin_daemon_timeout_config = cast(
    float | httpx.Timeout | None,
    getattr(dify_config, "PLUGIN_DAEMON_TIMEOUT", 600.0),
)
plugin_daemon_request_timeout: httpx.Timeout | None
match _plugin_daemon_timeout_config:
    case None:
        plugin_daemon_request_timeout = None
    case httpx.Timeout():
        plugin_daemon_request_timeout = _plugin_daemon_timeout_config
    case _:
        plugin_daemon_request_timeout = httpx.Timeout(_plugin_daemon_timeout_config)

_plugin_daemon_request_timeout_override: ContextVar[httpx.Timeout | None] = ContextVar(
    "plugin_daemon_request_timeout_override",
    default=None,
)

logger = logging.getLogger(__name__)

PLUGIN_DAEMON_MAX_PATH_LENGTH = 4096
PLUGIN_DAEMON_MAX_PATH_DECODE_DEPTH = 8

_httpx_client: httpx.Client = get_pooled_http_client(
    "plugin_daemon",
    lambda: httpx.Client(limits=httpx.Limits(max_keepalive_connections=50, max_connections=100), trust_env=False),
)


@contextmanager
def use_plugin_daemon_request_timeout(timeout_seconds: float) -> Generator[None, None, None]:
    """Temporarily shorten plugin-daemon requests made in the current context."""
    if timeout_seconds <= 0:
        raise ValueError("timeout_seconds must be greater than zero")

    token = _plugin_daemon_request_timeout_override.set(httpx.Timeout(timeout_seconds))
    try:
        yield
    finally:
        _plugin_daemon_request_timeout_override.reset(token)


def _get_plugin_daemon_request_timeout() -> httpx.Timeout | None:
    return _plugin_daemon_request_timeout_override.get() or plugin_daemon_request_timeout


def _normalize_plugin_daemon_response_for_type(json_response: Any, type_: type[object]) -> Any:
    if type_ is not PluginListResponse:
        return json_response

    if isinstance(json_response, list):
        return {
            "code": 0,
            "message": "",
            "data": {"list": json_response, "total": len(json_response)},
        }

    if isinstance(json_response, dict):
        data = json_response.get("data")
        if isinstance(data, list):
            return {
                **json_response,
                "data": {"list": data, "total": len(data)},
            }

    return json_response


def plugin_daemon_item_identity_hint(item: Any) -> str:
    """Build a log-friendly identity from a plugin-daemon list element."""
    if not isinstance(item, dict):
        return f"non-object {type(item).__name__}"

    parts: list[str] = []
    for key in ("plugin_id", "provider", "plugin_unique_identifier"):
        value = item.get(key)
        if value is not None and value != "":
            parts.append(f"{key}={value}")

    declaration = item.get("declaration")
    if isinstance(declaration, dict):
        identity = declaration.get("identity")
        if isinstance(identity, dict):
            name = identity.get("name")
            if name:
                parts.append(f"identity.name={name}")

    return ", ".join(parts) if parts else "unknown identity"


def keep_declaration_items_with_identity(
    items: Any,
    provider_name: Any,
    *,
    item_kind: str,
    provider_hint: str,
    mutate_item: Callable[[dict[str, Any]], None] | None = None,
) -> list[Any]:
    """Keep inner declaration items that have a dict identity and set identity.provider.

    A missing identity on one tool/datasource/event/strategy is skipped so it cannot
    KeyError the whole management list.
    """
    if not isinstance(items, list):
        return []

    kept_items: list[Any] = []
    for item in items:
        if not isinstance(item, dict) or not isinstance(item.get("identity"), dict):
            logger.warning(
                "Skipping %s without a usable identity in plugin provider (%s)",
                item_kind,
                provider_hint,
            )
            continue
        item["identity"]["provider"] = provider_name
        try:
            if mutate_item is not None:
                mutate_item(item)
        except Exception as exc:
            logger.warning(
                "Skipping %s that failed transformation in plugin provider (%s): %s",
                item_kind,
                provider_hint,
                exc,
            )
            continue
        kept_items.append(item)
    return kept_items


def _plugin_daemon_structured_list_item_type(type_: Any) -> type[BaseModel] | None:
    if get_origin(type_) is not list:
        return None
    args = get_args(type_)
    if not args:
        return None
    item_type = args[0]
    try:
        if inspect.isclass(item_type) and issubclass(item_type, BaseModel):
            return item_type
    except TypeError:
        return None
    return None


def _filter_valid_plugin_daemon_list_items[T: BaseModel](
    items: list[Any],
    item_type: type[T],
    path: str,
) -> list[T]:
    valid_items: list[T] = []
    for index, item in enumerate(items):
        identity = plugin_daemon_item_identity_hint(item)
        if not isinstance(item, dict):
            logger.warning(
                "Skipping invalid plugin daemon list item at index %s for %s (%s): expected an object",
                index,
                path,
                identity,
            )
            continue
        try:
            valid_items.append(item_type.model_validate(item))
        except Exception as exc:
            logger.warning(
                "Skipping invalid plugin daemon list item at index %s for %s (%s): %s",
                index,
                path,
                identity,
                exc,
            )
    return valid_items


class BasePluginClient:
    def _request(
        self,
        method: str,
        path: str,
        headers: dict[str, str] | None = None,
        data: bytes | dict[str, Any] | str | None = None,
        params: dict[str, Any] | None = None,
        files: dict[str, Any] | None = None,
    ) -> httpx.Response:
        """
        Make a request to the plugin daemon inner API.
        """
        url, headers, prepared_data, params, files = self._prepare_request(path, headers, data, params, files)

        request_kwargs: dict[str, Any] = {
            "method": method,
            "url": url,
            "headers": headers,
            "params": params,
            "files": files,
            "timeout": _get_plugin_daemon_request_timeout(),
        }
        if isinstance(prepared_data, dict):
            request_kwargs["data"] = prepared_data
        elif prepared_data is not None:
            request_kwargs["content"] = prepared_data

        try:
            response = _httpx_client.request(**request_kwargs)
        except httpx.RequestError:
            logger.exception("Request to Plugin Daemon Service failed")
            raise PluginDaemonInnerError(code=-500, message="Request to Plugin Daemon Service failed")

        return response

    def _prepare_request(
        self,
        path: str,
        headers: dict[str, str] | None,
        data: bytes | dict[str, Any] | str | None,
        params: dict[str, Any] | None,
        files: dict[str, Any] | None,
    ) -> tuple[str, dict[str, str], bytes | dict[str, Any] | str | None, dict[str, Any] | None, dict[str, Any] | None]:
        if len(path) > PLUGIN_DAEMON_MAX_PATH_LENGTH:
            raise ValueError(f"Invalid plugin daemon path: path length exceeds {PLUGIN_DAEMON_MAX_PATH_LENGTH}")

        decoded_path = path
        for _ in range(PLUGIN_DAEMON_MAX_PATH_DECODE_DEPTH):
            next_decoded_path = unquote(decoded_path)
            if next_decoded_path == decoded_path:
                break
            decoded_path = next_decoded_path
        else:
            raise ValueError("Invalid plugin daemon path: path is too deeply encoded")

        if any(seg == ".." for seg in decoded_path.split("/")):
            raise ValueError(f"Invalid plugin daemon path: traversal sequence detected in {path!r}")
        url = plugin_daemon_inner_api_baseurl / path
        prepared_headers = dict(headers or {})
        prepared_headers["X-Api-Key"] = dify_config.PLUGIN_DAEMON_KEY
        prepared_headers.setdefault("Accept-Encoding", "gzip, deflate, br")

        # Inject traceparent header for distributed tracing
        self._inject_trace_headers(prepared_headers)

        prepared_data: bytes | dict[str, Any] | str | None = (
            data if isinstance(data, (bytes, str, dict)) or data is None else None
        )
        if isinstance(data, dict):
            if prepared_headers.get("Content-Type") == "application/json":
                prepared_data = json.dumps(data)
            else:
                prepared_data = data

        return str(url), prepared_headers, prepared_data, params, files

    def _inject_trace_headers(self, headers: dict[str, str]) -> None:
        """
        Inject W3C traceparent header for distributed tracing.

        This ensures trace context is propagated to plugin daemon even if
        HTTPXClientInstrumentor doesn't cover module-level httpx functions.
        """
        if not dify_config.ENABLE_OTEL:
            return

        import contextlib

        # Skip if already present (case-insensitive check)
        for key in headers:
            if key.lower() == "traceparent":
                return

        # Inject traceparent - works as fallback when OTEL instrumentation doesn't cover this call
        with contextlib.suppress(Exception):
            from core.helper.trace_id_helper import generate_traceparent_header

            traceparent = generate_traceparent_header()
            if traceparent:
                headers["traceparent"] = traceparent

    def _stream_request(
        self,
        method: str,
        path: str,
        params: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
        data: bytes | dict[str, Any] | None = None,
        files: dict[str, Any] | None = None,
    ) -> Generator[str, None, None]:
        """
        Make a stream request to the plugin daemon inner API
        """
        url, headers, prepared_data, params, files = self._prepare_request(path, headers, data, params, files)

        stream_kwargs: dict[str, Any] = {
            "method": method,
            "url": url,
            "headers": headers,
            "params": params,
            "files": files,
            "timeout": _get_plugin_daemon_request_timeout(),
        }
        if isinstance(prepared_data, dict):
            stream_kwargs["data"] = prepared_data
        elif prepared_data is not None:
            stream_kwargs["content"] = prepared_data

        try:
            with _httpx_client.stream(**stream_kwargs) as response:
                for raw_line in response.iter_lines():
                    if not raw_line:
                        continue
                    line = raw_line.decode("utf-8") if isinstance(raw_line, bytes) else raw_line
                    line = line.strip()
                    if line.startswith("data:"):
                        line = line[5:].strip()
                    if line:
                        yield line
        except httpx.RequestError:
            logger.exception("Stream request to Plugin Daemon Service failed")
            raise PluginDaemonInnerError(code=-500, message="Request to Plugin Daemon Service failed")

    def _stream_request_with_model[T: BaseModel | dict[str, Any] | list[Any] | bool | str](
        self,
        method: str,
        path: str,
        type_: type[T],
        headers: dict[str, str] | None = None,
        data: bytes | dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
        files: dict[str, Any] | None = None,
    ) -> Generator[T, None, None]:
        """
        Make a stream request to the plugin daemon inner API and yield the response as a model.
        """
        for line in self._stream_request(method, path, params, headers, data, files):
            yield type_(**json.loads(line))  # type: ignore

    def _request_with_model[T: BaseModel | dict[str, Any] | list[Any] | bool | str](
        self,
        method: str,
        path: str,
        type_: type[T],
        headers: dict[str, str] | None = None,
        data: bytes | None = None,
        params: dict[str, Any] | None = None,
        files: dict[str, Any] | None = None,
    ) -> T:
        """
        Make a request to the plugin daemon inner API and return the response as a model.
        """
        response = self._request(method, path, headers, data, params, files)
        return type_(**response.json())  # type: ignore[return-value]

    def _request_with_plugin_daemon_response[T: BaseModel | dict[str, Any] | list[Any] | bool | str](
        self,
        method: str,
        path: str,
        type_: type[T],
        headers: dict[str, str] | None = None,
        data: bytes | dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
        files: dict[str, Any] | None = None,
        transformer: Callable[[dict[str, Any]], dict[str, Any]] | None = None,
    ) -> T:
        """
        Make a request to the plugin daemon inner API and return the response as a model.

        List payloads of Pydantic models are validated per item: malformed elements are
        skipped and logged so one invalid plugin declaration cannot fail the whole page.
        Single-object payloads stay strict. HTTP errors and daemon ``code != 0`` are
        unchanged.
        """
        try:
            response = self._request(method, path, headers, data, params, files)
            response.raise_for_status()
        except httpx.HTTPStatusError as e:
            logger.exception("Failed to request plugin daemon, status: %s, url: %s", e.response.status_code, path)
            if e.response.status_code < 500:
                raise PluginDaemonClientSideError(description=str(e))
            else:
                raise PluginDaemonInternalServerError(description=str(e))
        except Exception as e:
            msg = f"Failed to request plugin daemon, url: {path}"
            logger.exception("Failed to request plugin daemon, url: %s", path)
            raise ValueError(msg) from e

        list_item_type: type[BaseModel] | None = None
        try:
            json_response = response.json()
            if transformer:
                json_response = transformer(json_response)
            json_response = _normalize_plugin_daemon_response_for_type(json_response, type_)
            list_item_type = _plugin_daemon_structured_list_item_type(type_)
            # https://stackoverflow.com/questions/59634937/variable-foo-class-is-not-valid-as-type-but-why
            if list_item_type is not None:
                # Validate the envelope only; individual list elements are checked below.
                rep = PluginDaemonBasicResponse[list[Any]].model_validate(json_response)
            else:
                rep = PluginDaemonBasicResponse[type_].model_validate(json_response)  # type: ignore
        except Exception as e:
            msg = (
                f"Failed to parse response from plugin daemon to PluginDaemonBasicResponse [{str(type_.__name__)}],"
                f" url: {path}"
            )
            logger.exception(msg)
            raise ValueError(msg) from e

        if rep.code != 0:
            try:
                error = PluginDaemonError.model_validate(json.loads(rep.message))
            except Exception as e:
                raise ValueError(f"{rep.message}, code: {rep.code}") from e

            self._handle_plugin_daemon_error(error.error_type, error.message)
        if rep.data is None:
            frame = inspect.currentframe()
            raise ValueError(f"got empty data from plugin daemon: {frame.f_lineno if frame else 'unknown'}")

        if list_item_type is not None:
            items = rep.data if isinstance(rep.data, list) else []
            return cast(T, _filter_valid_plugin_daemon_list_items(items, list_item_type, path))
        return cast(T, rep.data)

    def _request_with_plugin_daemon_response_stream[T: BaseModel | dict[str, Any] | list[Any] | bool | str](
        self,
        method: str,
        path: str,
        type_: type[T],
        headers: dict[str, str] | None = None,
        data: bytes | dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
        files: dict[str, Any] | None = None,
    ) -> Generator[T, None, None]:
        """
        Make a stream request to the plugin daemon inner API and yield the response as a model.
        """
        for line in self._stream_request(method, path, params, headers, data, files):
            try:
                rep = PluginDaemonBasicResponse[type_].model_validate_json(line)  # type: ignore
            except (ValueError, TypeError):
                # TODO modify this when line_data has code and message
                try:
                    line_data = json.loads(line)
                except (ValueError, TypeError):
                    raise ValueError(line)
                # If the dictionary contains the `error` key, use its value as the argument
                # for `ValueError`.
                # Otherwise, use the `line` to provide better contextual information about the error.
                raise ValueError(line_data.get("error", line))

            if rep.code != 0:
                if rep.code == -500:
                    try:
                        error = PluginDaemonError.model_validate(json.loads(rep.message))
                    except Exception:
                        raise PluginDaemonInnerError(code=rep.code, message=rep.message)

                    logger.error("Error in stream response for plugin %s", rep.__dict__)
                    self._handle_plugin_daemon_error(error.error_type, error.message)
                raise ValueError(f"plugin daemon: {rep.message}, code: {rep.code}")
            if rep.data is None:
                frame = inspect.currentframe()
                raise ValueError(f"got empty data from plugin daemon: {frame.f_lineno if frame else 'unknown'}")
            yield rep.data

    def _handle_plugin_daemon_error(self, error_type: str, message: str):
        """
        handle the error from plugin daemon
        """
        match error_type:
            case PluginDaemonInnerError.__name__:
                raise PluginDaemonInnerError(code=-500, message=message)
            case PluginInvokeError.__name__:
                error_object = json.loads(message)
                invoke_error_type = error_object.get("error_type")
                match invoke_error_type:
                    case InvokeRateLimitError.__name__:
                        raise InvokeRateLimitError(description=error_object.get("message"))
                    case InvokeAuthorizationError.__name__:
                        raise InvokeAuthorizationError(description=error_object.get("message"))
                    case InvokeBadRequestError.__name__:
                        raise InvokeBadRequestError(description=error_object.get("message"))
                    case InvokeConnectionError.__name__:
                        raise InvokeConnectionError(description=error_object.get("message"))
                    case InvokeServerUnavailableError.__name__:
                        raise InvokeServerUnavailableError(description=error_object.get("message"))
                    case CredentialsValidateFailedError.__name__:
                        raise CredentialsValidateFailedError(error_object.get("message"))
                    case EndpointSetupFailedError.__name__:
                        raise EndpointSetupFailedError(error_object.get("message"))
                    case TriggerProviderCredentialValidationError.__name__:
                        raise TriggerProviderCredentialValidationError(error_object.get("message"))
                    case TriggerPluginInvokeError.__name__:
                        raise TriggerPluginInvokeError(description=error_object.get("message"))
                    case TriggerInvokeError.__name__:
                        raise TriggerInvokeError(error_object.get("message"))
                    case EventIgnoreError.__name__:
                        raise EventIgnoreError(description=error_object.get("message"))
                    # NOTE: current plugin sdk / plugin daemon does not raise exception with
                    # type `PluginLLMPollingUnsupportedError`.
                    case PluginLLMPollingUnsupportedError.__name__:
                        raise PluginLLMPollingUnsupportedError(description=error_object.get("message"))
                    case PluginRuntimeError.__name__:
                        args = error_object.get("args")
                        lambda_request_id = args.get("request_id") if isinstance(args, Mapping) else None
                        if not isinstance(lambda_request_id, str):
                            lambda_request_id = None
                        runtime_message = error_object.get("message")
                        if not isinstance(runtime_message, str):
                            runtime_message = "Plugin runtime request failed"
                        raise PluginRuntimeError(
                            description=runtime_message,
                            lambda_request_id=lambda_request_id,
                        )
                    case _:
                        raise PluginInvokeError(description=message)
            case PluginDaemonInternalServerError.__name__:
                raise PluginDaemonInternalServerError(description=message)
            case PluginDaemonBadRequestError.__name__:
                raise PluginDaemonBadRequestError(description=message)
            case PluginDaemonNotFoundError.__name__:
                raise PluginDaemonNotFoundError(description=message)
            case PluginUniqueIdentifierError.__name__:
                raise PluginUniqueIdentifierError(description=message)
            case PluginNotFoundError.__name__:
                raise PluginNotFoundError(description=message)
            case PluginDaemonUnauthorizedError.__name__:
                raise PluginDaemonUnauthorizedError(description=message)
            case PluginPermissionDeniedError.__name__:
                raise PluginPermissionDeniedError(description=message)
            case _:
                raise Exception(f"got unknown error from plugin daemon: {error_type}, message: {message}")
