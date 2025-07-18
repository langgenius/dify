import binascii
from collections.abc import Mapping
from typing import Any

from werkzeug import Request

from core.plugin.entities.plugin_daemon import PluginOAuthAuthorizationUrlResponse, PluginOAuthCredentialsResponse
from core.plugin.impl.base import BasePluginClient


class OAuthHandler(BasePluginClient):
    def get_authorization_url(
        self,
        tenant_id: str,
        user_id: str,
        plugin_id: str,
        provider: str,
        redirect_uri: str,
        system_credentials: Mapping[str, Any],
    ) -> PluginOAuthAuthorizationUrlResponse:
        try:
            response = self._request_with_plugin_daemon_response_stream(
                "POST",
                f"plugin/{tenant_id}/dispatch/oauth/get_authorization_url",
                PluginOAuthAuthorizationUrlResponse,
                data={
                    "user_id": user_id,
                    "data": {
                        "provider": provider,
                        "redirect_uri": redirect_uri,
                        "system_credentials": system_credentials,
                    },
                },
                headers={
                    "X-Plugin-ID": plugin_id,
                    "Content-Type": "application/json",
                },
            )
            for resp in response:
                return resp
            raise ValueError("No response received from plugin daemon for authorization URL request.")
        except Exception as e:
            raise ValueError(f"Error getting authorization URL: {e}")

    def get_credentials(
        self,
        tenant_id: str,
        user_id: str,
        plugin_id: str,
        provider: str,
        redirect_uri: str,
        system_credentials: Mapping[str, Any],
        request: Request,
    ) -> PluginOAuthCredentialsResponse:
        """
        Get credentials from the given request.
        """

        try:
            # encode request to raw http request
            raw_request_bytes = self._convert_request_to_raw_data(request)
            response = self._request_with_plugin_daemon_response_stream(
                "POST",
                f"plugin/{tenant_id}/dispatch/oauth/get_credentials",
                PluginOAuthCredentialsResponse,
                data={
                    "user_id": user_id,
                    "data": {
                        "provider": provider,
                        "redirect_uri": redirect_uri,
                        "system_credentials": system_credentials,
                        # for json serialization
                        "raw_http_request": binascii.hexlify(raw_request_bytes).decode(),
                    },
                },
                headers={
                    "X-Plugin-ID": plugin_id,
                    "Content-Type": "application/json",
                },
            )
            for resp in response:
                return resp
            raise ValueError("No response received from plugin daemon for authorization URL request.")
        except Exception as e:
            raise ValueError(f"Error getting credentials: {e}")

    def _convert_request_to_raw_data(self, request: Request) -> bytes:
        """
        Convert a Request object to raw HTTP data.

        Args:
            request: The Request object to convert.

        Returns:
            The raw HTTP data as bytes.
        """
        # Start with the request line
        method = request.method
        path = request.full_path
        protocol = request.headers.get("HTTP_VERSION", "HTTP/1.1")
        raw_data = f"{method} {path} {protocol}\r\n".encode()

        # Add headers
        for header_name, header_value in request.headers.items():
            raw_data += f"{header_name}: {header_value}\r\n".encode()

        # Add empty line to separate headers from body
        raw_data += b"\r\n"

        # Add body if exists
        body = request.get_data(as_text=False)
        if body:
            raw_data += body

        return raw_data
