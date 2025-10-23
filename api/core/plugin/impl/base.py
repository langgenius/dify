import inspect
import json
import logging
from collections.abc import Callable, Generator
from typing import Any, TypeVar, cast

import httpx
from pydantic import BaseModel
from yarl import URL

from configs import dify_config
from core.model_runtime.errors.invoke import (
    InvokeAuthorizationError,
    InvokeBadRequestError,
    InvokeConnectionError,
    InvokeRateLimitError,
    InvokeServerUnavailableError,
)
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.plugin.endpoint.exc import EndpointSetupFailedError
from core.plugin.entities.plugin_daemon import PluginDaemonBasicResponse, PluginDaemonError, PluginDaemonInnerError
from core.plugin.impl.exc import (
    PluginDaemonBadRequestError,
    PluginDaemonInternalServerError,
    PluginDaemonNotFoundError,
    PluginDaemonUnauthorizedError,
    PluginInvokeError,
    PluginNotFoundError,
    PluginPermissionDeniedError,
    PluginUniqueIdentifierError,
)

plugin_daemon_inner_api_baseurl = URL(str(dify_config.PLUGIN_DAEMON_URL))
_plugin_daemon_timeout_config = cast(
    float | httpx.Timeout | None,
    getattr(dify_config, "PLUGIN_DAEMON_TIMEOUT", 300.0),
)
plugin_daemon_request_timeout: httpx.Timeout | None
if _plugin_daemon_timeout_config is None:
    plugin_daemon_request_timeout = None
elif isinstance(_plugin_daemon_timeout_config, httpx.Timeout):
    plugin_daemon_request_timeout = _plugin_daemon_timeout_config
else:
    plugin_daemon_request_timeout = httpx.Timeout(_plugin_daemon_timeout_config)

T = TypeVar("T", bound=(BaseModel | dict | list | bool | str))

logger = logging.getLogger(__name__)


class BasePluginClient:
    def _request(
        self,
        method: str,
        path: str,
        headers: dict | None = None,
        data: bytes | dict | str | None = None,
        params: dict | None = None,
        files: dict | None = None,
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
            "timeout": plugin_daemon_request_timeout,
        }
        if isinstance(prepared_data, dict):
            request_kwargs["data"] = prepared_data
        elif prepared_data is not None:
            request_kwargs["content"] = prepared_data

        try:
            response = httpx.request(**request_kwargs)
        except httpx.RequestError:
            logger.exception("Request to Plugin Daemon Service failed")
            raise PluginDaemonInnerError(code=-500, message="Request to Plugin Daemon Service failed")

        return response

    def _prepare_request(
        self,
        path: str,
        headers: dict | None,
        data: bytes | dict | str | None,
        params: dict | None,
        files: dict | None,
    ) -> tuple[str, dict, bytes | dict | str | None, dict | None, dict | None]:
        url = plugin_daemon_inner_api_baseurl / path
        prepared_headers = dict(headers or {})
        prepared_headers["X-Api-Key"] = dify_config.PLUGIN_DAEMON_KEY
        prepared_headers.setdefault("Accept-Encoding", "gzip, deflate, br")

        prepared_data: bytes | dict | str | None = (
            data if isinstance(data, (bytes, str, dict)) or data is None else None
        )
        if isinstance(data, dict):
            if prepared_headers.get("Content-Type") == "application/json":
                prepared_data = json.dumps(data)
            else:
                prepared_data = data

        return str(url), prepared_headers, prepared_data, params, files

    def _stream_request(
        self,
        method: str,
        path: str,
        params: dict | None = None,
        headers: dict | None = None,
        data: bytes | dict | None = None,
        files: dict | None = None,
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
            "timeout": plugin_daemon_request_timeout,
        }
        if isinstance(prepared_data, dict):
            stream_kwargs["data"] = prepared_data
        elif prepared_data is not None:
            stream_kwargs["content"] = prepared_data

        try:
            with httpx.stream(**stream_kwargs) as response:
                for raw_line in response.iter_lines():
                    if raw_line is None:
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

    def _stream_request_with_model(
        self,
        method: str,
        path: str,
        type_: type[T],
        headers: dict | None = None,
        data: bytes | dict | None = None,
        params: dict | None = None,
        files: dict | None = None,
    ) -> Generator[T, None, None]:
        """
        Make a stream request to the plugin daemon inner API and yield the response as a model.
        """
        for line in self._stream_request(method, path, params, headers, data, files):
            yield type_(**json.loads(line))  # type: ignore

    def _request_with_model(
        self,
        method: str,
        path: str,
        type_: type[T],
        headers: dict | None = None,
        data: bytes | None = None,
        params: dict | None = None,
        files: dict | None = None,
    ) -> T:
        """
        Make a request to the plugin daemon inner API and return the response as a model.
        """
        response = self._request(method, path, headers, data, params, files)
        return type_(**response.json())  # type: ignore[return-value]

    def _request_with_plugin_daemon_response(
        self,
        method: str,
        path: str,
        type_: type[T],
        headers: dict | None = None,
        data: bytes | dict | None = None,
        params: dict | None = None,
        files: dict | None = None,
        transformer: Callable[[dict], dict] | None = None,
    ) -> T:
        """
        Make a request to the plugin daemon inner API and return the response as a model.
        """
        try:
            response = self._request(method, path, headers, data, params, files)
            response.raise_for_status()
        except httpx.HTTPStatusError as e:
            logger.exception("Failed to request plugin daemon, status: %s, url: %s", e.response.status_code, path)
            raise e
        except Exception as e:
            msg = f"Failed to request plugin daemon, url: {path}"
            logger.exception("Failed to request plugin daemon, url: %s", path)
            raise ValueError(msg) from e

        try:
            json_response = response.json()
            if transformer:
                json_response = transformer(json_response)
            # https://stackoverflow.com/questions/59634937/variable-foo-class-is-not-valid-as-type-but-why
            rep = PluginDaemonBasicResponse[type_].model_validate(json_response)  # type: ignore
        except Exception:
            msg = (
                f"Failed to parse response from plugin daemon to PluginDaemonBasicResponse [{str(type_.__name__)}],"
                f" url: {path}"
            )
            logger.exception(msg)
            raise ValueError(msg)

        if rep.code != 0:
            try:
                error = PluginDaemonError.model_validate(json.loads(rep.message))
            except Exception:
                raise ValueError(f"{rep.message}, code: {rep.code}")

            self._handle_plugin_daemon_error(error.error_type, error.message)
        if rep.data is None:
            frame = inspect.currentframe()
            raise ValueError(f"got empty data from plugin daemon: {frame.f_lineno if frame else 'unknown'}")

        return rep.data

    def _request_with_plugin_daemon_response_stream(
        self,
        method: str,
        path: str,
        type_: type[T],
        headers: dict | None = None,
        data: bytes | dict | None = None,
        params: dict | None = None,
        files: dict | None = None,
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
                args = error_object.get("args")
                match invoke_error_type:
                    case InvokeRateLimitError.__name__:
                        raise InvokeRateLimitError(description=args.get("description"))
                    case InvokeAuthorizationError.__name__:
                        raise InvokeAuthorizationError(description=args.get("description"))
                    case InvokeBadRequestError.__name__:
                        raise InvokeBadRequestError(description=args.get("description"))
                    case InvokeConnectionError.__name__:
                        raise InvokeConnectionError(description=args.get("description"))
                    case InvokeServerUnavailableError.__name__:
                        raise InvokeServerUnavailableError(description=args.get("description"))
                    case CredentialsValidateFailedError.__name__:
                        raise CredentialsValidateFailedError(error_object.get("message"))
                    case EndpointSetupFailedError.__name__:
                        raise EndpointSetupFailedError(error_object.get("message"))
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
