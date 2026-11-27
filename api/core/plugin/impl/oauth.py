import binascii
from collections.abc import Mapping
from typing import Any

from werkzeug import Request

from core.plugin.entities.plugin_daemon import PluginOAuthAuthorizationUrlResponse, PluginOAuthCredentialsResponse
from core.plugin.impl.base import BasePluginClient
from services.plugin.dispatch_identity import plugin_dispatch_headers


class OAuthHandler(BasePluginClient):
    def get_authorization_url(
        self,
        tenant_id: str,
        user_id: str,
        plugin_id: str,
        provider: str,
        redirect_uri: str,
        system_credentials: Mapping[str, Any],
        *,
        plugin_unique_identifier: str | None = None,
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
                headers=plugin_dispatch_headers(plugin_id, plugin_unique_identifier),
            )
            for resp in response:
                return resp
            raise ValueError("No response received from plugin daemon for authorization URL request.")
        except Exception as e:
            raise ValueError(f"Error getting authorization URL: {e}") from e

    def get_credentials(
        self,
        tenant_id: str,
        user_id: str,
        plugin_id: str,
        provider: str,
        redirect_uri: str,
        system_credentials: Mapping[str, Any],
        request: Request,
        *,
        plugin_unique_identifier: str | None = None,
    ) -> PluginOAuthCredentialsResponse:
        """
        Get credentials from the given request.
        """

        try:
            raw_request = self._convert_request_to_raw_data(request)
        except Exception as error:
            raise ValueError(f"Error getting credentials: {error}") from error

        return self.get_credentials_from_raw_request(
            tenant_id=tenant_id,
            user_id=user_id,
            plugin_id=plugin_id,
            provider=provider,
            redirect_uri=redirect_uri,
            system_credentials=system_credentials,
            raw_request=raw_request,
            plugin_unique_identifier=plugin_unique_identifier,
        )

    def get_credentials_from_raw_request(
        self,
        *,
        tenant_id: str,
        user_id: str,
        plugin_id: str,
        provider: str,
        redirect_uri: str,
        system_credentials: Mapping[str, Any],
        raw_request: bytes,
        plugin_unique_identifier: str | None,
    ) -> PluginOAuthCredentialsResponse:
        """Exchange a detached callback without depending on Flask's request lifetime."""
        try:
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
                        "raw_http_request": binascii.hexlify(raw_request).decode(),
                    },
                },
                headers=plugin_dispatch_headers(plugin_id, plugin_unique_identifier),
            )
            for resp in response:
                return resp
            raise ValueError("No response received from plugin daemon for authorization URL request.")
        except Exception as e:
            raise ValueError(f"Error getting credentials: {e}") from e

    def refresh_credentials(
        self,
        tenant_id: str,
        user_id: str,
        plugin_id: str,
        provider: str,
        redirect_uri: str,
        system_credentials: Mapping[str, Any],
        credentials: Mapping[str, Any],
        *,
        plugin_unique_identifier: str | None = None,
    ) -> PluginOAuthCredentialsResponse:
        try:
            response = self._request_with_plugin_daemon_response_stream(
                "POST",
                f"plugin/{tenant_id}/dispatch/oauth/refresh_credentials",
                PluginOAuthCredentialsResponse,
                data={
                    "user_id": user_id,
                    "data": {
                        "provider": provider,
                        "redirect_uri": redirect_uri,
                        "system_credentials": system_credentials,
                        "credentials": credentials,
                    },
                },
                headers=plugin_dispatch_headers(plugin_id, plugin_unique_identifier),
            )
            for resp in response:
                return resp
            raise ValueError("No response received from plugin daemon for refresh credentials request.")
        except Exception as e:
            raise ValueError(f"Error refreshing credentials: {e}") from e

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
