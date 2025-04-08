from core.plugin.manager.endpoint import PluginEndpointManager


class EndpointService:
    @classmethod
    def create_endpoint(cls, tenant_id: str, user_id: str, plugin_unique_identifier: str, name: str, settings: dict):
        return PluginEndpointManager().create_endpoint(
            tenant_id=tenant_id,
            user_id=user_id,
            plugin_unique_identifier=plugin_unique_identifier,
            name=name,
            settings=settings,
        )

    @classmethod
    def list_endpoints(cls, tenant_id: str, user_id: str, page: int, page_size: int):
        return PluginEndpointManager().list_endpoints(
            tenant_id=tenant_id,
            user_id=user_id,
            page=page,
            page_size=page_size,
        )

    @classmethod
    def list_endpoints_for_single_plugin(cls, tenant_id: str, user_id: str, plugin_id: str, page: int, page_size: int):
        return PluginEndpointManager().list_endpoints_for_single_plugin(
            tenant_id=tenant_id,
            user_id=user_id,
            plugin_id=plugin_id,
            page=page,
            page_size=page_size,
        )

    @classmethod
    def update_endpoint(cls, tenant_id: str, user_id: str, endpoint_id: str, name: str, settings: dict):
        return PluginEndpointManager().update_endpoint(
            tenant_id=tenant_id,
            user_id=user_id,
            endpoint_id=endpoint_id,
            name=name,
            settings=settings,
        )

    @classmethod
    def delete_endpoint(cls, tenant_id: str, user_id: str, endpoint_id: str):
        return PluginEndpointManager().delete_endpoint(
            tenant_id=tenant_id,
            user_id=user_id,
            endpoint_id=endpoint_id,
        )

    @classmethod
    def enable_endpoint(cls, tenant_id: str, user_id: str, endpoint_id: str):
        return PluginEndpointManager().enable_endpoint(
            tenant_id=tenant_id,
            user_id=user_id,
            endpoint_id=endpoint_id,
        )

    @classmethod
    def disable_endpoint(cls, tenant_id: str, user_id: str, endpoint_id: str):
        return PluginEndpointManager().disable_endpoint(
            tenant_id=tenant_id,
            user_id=user_id,
            endpoint_id=endpoint_id,
        )
