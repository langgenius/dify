class AssetPaths:
    _BASE = "app_assets"

    @staticmethod
    def draft_file(tenant_id: str, app_id: str, node_id: str) -> str:
        return f"{AssetPaths._BASE}/{tenant_id}/{app_id}/draft/{node_id}"

    @staticmethod
    def build_zip(tenant_id: str, app_id: str, assets_id: str) -> str:
        return f"{AssetPaths._BASE}/{tenant_id}/{app_id}/build/{assets_id}.zip"

    @staticmethod
    def build_resolved_file(tenant_id: str, app_id: str, assets_id: str, node_id: str) -> str:
        return f"{AssetPaths._BASE}/{tenant_id}/{app_id}/build/{assets_id}/resolved/{node_id}"

    @staticmethod
    def build_tool_manifest(tenant_id: str, app_id: str, assets_id: str) -> str:
        return f"{AssetPaths._BASE}/{tenant_id}/{app_id}/build/{assets_id}/tools.json"
