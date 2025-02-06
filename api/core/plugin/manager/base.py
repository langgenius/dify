import inspect
import json
import logging
from collections.abc import Callable, Generator
from typing import TypeVar

import requests
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
from core.plugin.entities.plugin_daemon import PluginDaemonBasicResponse, PluginDaemonError, PluginDaemonInnerError
from core.plugin.manager.exc import (
    PluginDaemonBadRequestError,
    PluginDaemonInternalServerError,
    PluginDaemonNotFoundError,
    PluginDaemonUnauthorizedError,
    PluginInvokeError,
    PluginNotFoundError,
    PluginPermissionDeniedError,
    PluginUniqueIdentifierError,
)

plugin_daemon_inner_api_baseurl = dify_config.PLUGIN_DAEMON_URL
plugin_daemon_inner_api_key = dify_config.PLUGIN_DAEMON_KEY

T = TypeVar("T", bound=(BaseModel | dict | list | bool | str))

logger = logging.getLogger(__name__)


class BasePluginManager:
    def _request(
        self,
        method: str,
        path: str,
        headers: dict | None = None,
        data: bytes | dict | str | None = None,
        params: dict | None = None,
        files: dict | None = None,
        stream: bool = False,
    ) -> requests.Response:
        """
        Make a request to the plugin daemon inner API.
        """
        url = URL(str(plugin_daemon_inner_api_baseurl)) / path
        headers = headers or {}
        headers["X-Api-Key"] = plugin_daemon_inner_api_key
        headers["Accept-Encoding"] = "gzip, deflate, br"

        if headers.get("Content-Type") == "application/json" and isinstance(data, dict):
            data = json.dumps(data)

        try:
            response = requests.request(
                method=method, url=str(url), headers=headers, data=data, params=params, stream=stream, files=files
            )
        except requests.exceptions.ConnectionError:
            logger.exception("Request to Plugin Daemon Service failed")
            raise PluginDaemonInnerError(code=-500, message="Request to Plugin Daemon Service failed")

        return response

    def _stream_request(
        self,
        method: str,
        path: str,
        params: dict | None = None,
        headers: dict | None = None,
        data: bytes | dict | None = None,
        files: dict | None = None,
    ) -> Generator[bytes, None, None]:
        """
        Make a stream request to the plugin daemon inner API
        """
        response = self._request(method, path, headers, data, params, files, stream=True)
        for line in response.iter_lines():
            line = line.decode("utf-8").strip()
            if line.startswith("data:"):
                line = line[5:].strip()
            if line:
                yield line

    def _stream_request_with_model(
        self,
        method: str,
        path: str,
        type: type[T],
        headers: dict | None = None,
        data: bytes | dict | None = None,
        params: dict | None = None,
        files: dict | None = None,
    ) -> Generator[T, None, None]:
        """
        Make a stream request to the plugin daemon inner API and yield the response as a model.
        """
        for line in self._stream_request(method, path, params, headers, data, files):
            yield type(**json.loads(line))  # type: ignore

    def _request_with_model(
        self,
        method: str,
        path: str,
        type: type[T],
        headers: dict | None = None,
        data: bytes | None = None,
        params: dict | None = None,
        files: dict | None = None,
    ) -> T:
        """
        Make a request to the plugin daemon inner API and return the response as a model.
        """
        response = self._request(method, path, headers, data, params, files)
        return type(**response.json())  # type: ignore

    def _request_with_plugin_daemon_response(
        self,
        method: str,
        path: str,
        type: type[T],
        headers: dict | None = None,
        data: bytes | dict | None = None,
        params: dict | None = None,
        files: dict | None = None,
        transformer: Callable[[dict], dict] | None = None,
    ) -> T:
        """
        Make a request to the plugin daemon inner API and return the response as a model.
        """
        response = self._request(method, path, headers, data, params, files)
        json_response = response.json()
        if transformer:
            json_response = transformer(json_response)

        rep = PluginDaemonBasicResponse[type](**json_response)  # type: ignore
        if rep.code != 0:
            try:
                error = PluginDaemonError(**json.loads(rep.message))
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
        type: type[T],
        headers: dict | None = None,
        data: bytes | dict | None = None,
        params: dict | None = None,
        files: dict | None = None,
    ) -> Generator[T, None, None]:
        """
        Make a stream request to the plugin daemon inner API and yield the response as a model.
        """
        for line in self._stream_request(method, path, params, headers, data, files):
            line_data = None
            try:
                line_data = json.loads(line)
                rep = PluginDaemonBasicResponse[type](**line_data)  # type: ignore
            except Exception:
                # TODO modify this when line_data has code and message
                if line_data and "error" in line_data:
                    raise ValueError(line_data["error"])
                else:
                    raise ValueError(line)

            if rep.code != 0:
                if rep.code == -500:
                    try:
                        error = PluginDaemonError(**json.loads(rep.message))
                    except Exception:
                        raise PluginDaemonInnerError(code=rep.code, message=rep.message)

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
