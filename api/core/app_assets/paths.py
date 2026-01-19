class AssetPaths:
    _BASE = "app_assets"

    @staticmethod
    def draft_file(tenant_id: str, app_id: str, node_id: str) -> str:
        return f"{AssetPaths._BASE}/{tenant_id}/{app_id}/draft/{node_id}"

    @staticmethod
    def published_zip(tenant_id: str, app_id: str, publish_id: str) -> str:
        return f"{AssetPaths._BASE}/{tenant_id}/{app_id}/published/{publish_id}.zip"

    @staticmethod
    def published_resolved_file(tenant_id: str, app_id: str, publish_id: str, node_id: str) -> str:
        return f"{AssetPaths._BASE}/{tenant_id}/{app_id}/published/{publish_id}/resolved/{node_id}"

    @staticmethod
    def published_tool_manifest(tenant_id: str, app_id: str, publish_id: str) -> str:
        return f"{AssetPaths._BASE}/{tenant_id}/{app_id}/published/{publish_id}/tools.json"
