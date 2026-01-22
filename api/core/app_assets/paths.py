class AssetPaths:
    _BASE = "app_assets"

    @staticmethod
    def draft_file(tenant_id: str, app_id: str, node_id: str) -> str:
        return f"{AssetPaths._BASE}/{tenant_id}/{app_id}/draft/{node_id}"

    @staticmethod
    def build_zip(tenant_id: str, app_id: str, assets_id: str) -> str:
        return f"{AssetPaths._BASE}/{tenant_id}/{app_id}/artifacts/{assets_id}.zip"

    @staticmethod
    def build_resolved_file(tenant_id: str, app_id: str, assets_id: str, node_id: str) -> str:
        return f"{AssetPaths._BASE}/{tenant_id}/{app_id}/artifacts/{assets_id}/resolved/{node_id}"

    @staticmethod
    def build_skill_bundle(tenant_id: str, app_id: str, assets_id: str) -> str:
        return f"{AssetPaths._BASE}/{tenant_id}/{app_id}/artifacts/{assets_id}/skill_artifact_set.json"

    @staticmethod
    def build_source_zip(tenant_id: str, app_id: str, workflow_id: str) -> str:
        """Storage key for source assets zip (editable files snapshot at publish time)."""
        return f"{AssetPaths._BASE}/{tenant_id}/{app_id}/sources/{workflow_id}.zip"
