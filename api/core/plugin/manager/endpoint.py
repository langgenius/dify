from core.plugin.entities.endpoint import EndpointEntity
from core.plugin.manager.base import BasePluginManager


class PluginEndpointManager(BasePluginManager):
    def create_endpoint(self, tenant_id: str, user_id: str, plugin_unique_identifier: str, name: str, settings: dict):
        """
        Create an endpoint for the given plugin.

        Errors will be raised if any error occurs.
        """
        self._request_with_plugin_daemon_response(
            "POST",
            f"plugin/{tenant_id}/endpoint/setup",
            dict,
            headers={
                "Content-Type": "application/json",
            },
            data={
                "user_id": user_id,
                "plugin_unique_identifier": plugin_unique_identifier,
                "settings": settings,
                "name": name,
            },
        )

    def list_endpoints(self, tenant_id: str, user_id: str):
        """
        List all endpoints for the given tenant and user.
        """
        return self._request_with_plugin_daemon_response(
            "GET",
            f"plugin/{tenant_id}/endpoint/list",
            list[EndpointEntity],
            params={"page": 1, "page_size": 256},
        )

    def list_plugin_endpoints(self, tenant_id: str, user_id: str, plugin_unique_identifier: str):
        """
        List all endpoints for the given tenant, user and plugin.
        """
        return self._request_with_plugin_daemon_response(
            "GET",
            f"plugin/{tenant_id}/endpoint/list/plugin",
            list[EndpointEntity],
            headers={
                "Content-Type": "application/json",
            },
            data={
                "plugin_unique_identifier": plugin_unique_identifier,
            },
        )

    def update_endpoint(self, tenant_id: str, user_id: str, endpoint_id: str, name: str, settings: dict):
        """
        Update the settings of the given endpoint.
        """
        self._request_with_plugin_daemon_response(
            "POST",
            f"plugin/{tenant_id}/endpoint/update",
            dict,
            data={
                "user_id": user_id,
                "endpoint_id": endpoint_id,
                "name": name,
                "settings": settings,
            },
        )

    def delete_endpoint(self, tenant_id: str, user_id: str, endpoint_id: str):
        """
        Delete the given endpoint.
        """
        self._request_with_plugin_daemon_response(
            "DELETE",
            f"plugin/{tenant_id}/endpoint/remove",
            dict,
            data={
                "endpoint_id": endpoint_id,
            },
        )

    def enable_endpoint(self, tenant_id: str, user_id: str, endpoint_id: str):
        """
        Enable the given endpoint.
        """
        self._request_with_plugin_daemon_response(
            "POST",
            f"plugin/{tenant_id}/endpoint/enable",
            dict,
            data={
                "endpoint_id": endpoint_id,
            },
        )

    def disable_endpoint(self, tenant_id: str, user_id: str, endpoint_id: str):
        """
        Disable the given endpoint.
        """
        self._request_with_plugin_daemon_response(
            "POST",
            f"plugin/{tenant_id}/endpoint/disable",
            dict,
            data={
                "endpoint_id": endpoint_id,
            },
        )
