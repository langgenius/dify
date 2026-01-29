"""App assets storage key generation.

Provides AssetPaths facade for generating storage keys for app assets.
Storage instances are obtained via AppAssetService.get_storage().
"""

from __future__ import annotations

from uuid import UUID

_BASE = "app_assets"


def _check_uuid(value: str, name: str) -> None:
    try:
        UUID(value)
    except (ValueError, TypeError) as e:
        raise ValueError(f"{name} must be a valid UUID") from e


class AssetPaths:
    """Facade for generating app asset storage keys."""

    @staticmethod
    def draft(tenant_id: str, app_id: str, node_id: str) -> str:
        """app_assets/{tenant}/{app}/draft/{node_id}"""
        _check_uuid(tenant_id, "tenant_id")
        _check_uuid(app_id, "app_id")
        _check_uuid(node_id, "node_id")
        return f"{_BASE}/{tenant_id}/{app_id}/draft/{node_id}"

    @staticmethod
    def build_zip(tenant_id: str, app_id: str, assets_id: str) -> str:
        """app_assets/{tenant}/{app}/artifacts/{assets_id}.zip"""
        _check_uuid(tenant_id, "tenant_id")
        _check_uuid(app_id, "app_id")
        _check_uuid(assets_id, "assets_id")
        return f"{_BASE}/{tenant_id}/{app_id}/artifacts/{assets_id}.zip"

    @staticmethod
    def resolved(tenant_id: str, app_id: str, assets_id: str, node_id: str) -> str:
        """app_assets/{tenant}/{app}/artifacts/{assets_id}/resolved/{node_id}"""
        _check_uuid(tenant_id, "tenant_id")
        _check_uuid(app_id, "app_id")
        _check_uuid(assets_id, "assets_id")
        _check_uuid(node_id, "node_id")
        return f"{_BASE}/{tenant_id}/{app_id}/artifacts/{assets_id}/resolved/{node_id}"

    @staticmethod
    def skill_bundle(tenant_id: str, app_id: str, assets_id: str) -> str:
        """app_assets/{tenant}/{app}/artifacts/{assets_id}/skill_artifact_set.json"""
        _check_uuid(tenant_id, "tenant_id")
        _check_uuid(app_id, "app_id")
        _check_uuid(assets_id, "assets_id")
        return f"{_BASE}/{tenant_id}/{app_id}/artifacts/{assets_id}/skill_artifact_set.json"

    @staticmethod
    def source_zip(tenant_id: str, app_id: str, workflow_id: str) -> str:
        """app_assets/{tenant}/{app}/sources/{workflow_id}.zip"""
        _check_uuid(tenant_id, "tenant_id")
        _check_uuid(app_id, "app_id")
        _check_uuid(workflow_id, "workflow_id")
        return f"{_BASE}/{tenant_id}/{app_id}/sources/{workflow_id}.zip"

    @staticmethod
    def bundle_export(tenant_id: str, app_id: str, export_id: str) -> str:
        """app_assets/{tenant}/{app}/bundle_exports/{export_id}.zip"""
        _check_uuid(tenant_id, "tenant_id")
        _check_uuid(app_id, "app_id")
        _check_uuid(export_id, "export_id")
        return f"{_BASE}/{tenant_id}/{app_id}/bundle_exports/{export_id}.zip"

    @staticmethod
    def bundle_import(tenant_id: str, import_id: str) -> str:
        """app_assets/{tenant}/imports/{import_id}.zip"""
        _check_uuid(tenant_id, "tenant_id")
        return f"{_BASE}/{tenant_id}/imports/{import_id}.zip"
