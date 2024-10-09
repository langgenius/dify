from core.plugin.entities.endpoint import EndpointEntityWithInstance
from core.plugin.manager.base import BasePluginManager


class PluginEndpointManager(BasePluginManager):
    def create_endpoint(
        self, tenant_id: str, user_id: str, plugin_unique_identifier: str, name: str, settings: dict
    ) -> bool:
        """
        Create an endpoint for the given plugin.

        Errors will be raised if any error occurs.
        """
        return self._request_with_plugin_daemon_response(
            "POST",
            f"plugin/{tenant_id}/endpoint/setup",
            bool,
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

    def list_endpoints(self, tenant_id: str, user_id: str, page: int, page_size: int):
        """
        List all endpoints for the given tenant and user.
        """
        return self._request_with_plugin_daemon_response(
            "GET",
            f"plugin/{tenant_id}/endpoint/list",
            list[EndpointEntityWithInstance],
            params={"page": page, "page_size": page_size},
        )

    def list_endpoints_for_single_plugin(self, tenant_id: str, user_id: str, plugin_id: str, page: int, page_size: int):
        """
        List all endpoints for the given tenant, user and plugin.
        """
        return self._request_with_plugin_daemon_response(
            "GET",
            f"plugin/{tenant_id}/endpoint/list/plugin",
            list[EndpointEntityWithInstance],
            params={"plugin_id": plugin_id, "page": page, "page_size": page_size},
        )

    def update_endpoint(self, tenant_id: str, user_id: str, endpoint_id: str, name: str, settings: dict):
        """
        Update the settings of the given endpoint.
        """
        return self._request_with_plugin_daemon_response(
            "POST",
            f"plugin/{tenant_id}/endpoint/update",
            bool,
            data={
                "user_id": user_id,
                "endpoint_id": endpoint_id,
                "name": name,
                "settings": settings,
            },
            headers={
                "Content-Type": "application/json",
            },
        )

    def delete_endpoint(self, tenant_id: str, user_id: str, endpoint_id: str):
        """
        Delete the given endpoint.
        """
        return self._request_with_plugin_daemon_response(
            "POST",
            f"plugin/{tenant_id}/endpoint/remove",
            bool,
            data={
                "endpoint_id": endpoint_id,
            },
            headers={
                "Content-Type": "application/json",
            },
        )

    def enable_endpoint(self, tenant_id: str, user_id: str, endpoint_id: str):
        """
        Enable the given endpoint.
        """
        return self._request_with_plugin_daemon_response(
            "POST",
            f"plugin/{tenant_id}/endpoint/enable",
            bool,
            data={
                "endpoint_id": endpoint_id,
            },
            headers={
                "Content-Type": "application/json",
            },
        )

    def disable_endpoint(self, tenant_id: str, user_id: str, endpoint_id: str):
        """
        Disable the given endpoint.
        """
        return self._request_with_plugin_daemon_response(
            "POST",
            f"plugin/{tenant_id}/endpoint/disable",
            bool,
            data={
                "endpoint_id": endpoint_id,
            },
            headers={
                "Content-Type": "application/json",
            },
        )
