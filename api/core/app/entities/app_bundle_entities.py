from __future__ import annotations

import re
from datetime import UTC, datetime

from pydantic import BaseModel, ConfigDict, Field

from core.app.entities.app_asset_entities import AppAssetFileTree

# Constants
BUNDLE_DSL_FILENAME_PATTERN = re.compile(r"^[^/]+\.ya?ml$")
BUNDLE_MAX_SIZE = 50 * 1024 * 1024  # 50MB
MANIFEST_FILENAME = "manifest.json"
MANIFEST_SCHEMA_VERSION = "1.0"


# Exceptions
class BundleFormatError(Exception):
    """Raised when bundle format is invalid."""

    pass


class ZipSecurityError(Exception):
    """Raised when zip file contains security violations."""

    pass


# Manifest DTOs
class ManifestFileEntry(BaseModel):
    """Maps node_id to file path in the bundle."""

    model_config = ConfigDict(extra="forbid")

    node_id: str
    path: str


class ManifestIntegrity(BaseModel):
    """Basic integrity check fields."""

    model_config = ConfigDict(extra="forbid")

    file_count: int


class ManifestAppAssets(BaseModel):
    """App assets section containing the full tree."""

    model_config = ConfigDict(extra="forbid")

    tree: AppAssetFileTree


class BundleManifest(BaseModel):
    """
    Bundle manifest for app asset import/export.

    Schema version 1.0:
    - dsl_filename: DSL file name in bundle root (e.g. "my_app.yml")
    - tree: Full AppAssetFileTree (files + folders) for 100% restoration including node IDs
    - files: Explicit node_id -> path mapping for file nodes only
    - integrity: Basic file_count validation
    """

    model_config = ConfigDict(extra="forbid")

    schema_version: str = Field(default=MANIFEST_SCHEMA_VERSION)
    generated_at: datetime = Field(default_factory=lambda: datetime.now(tz=UTC))
    dsl_filename: str = Field(description="DSL file name in bundle root")
    app_assets: ManifestAppAssets
    files: list[ManifestFileEntry]
    integrity: ManifestIntegrity

    @property
    def assets_prefix(self) -> str:
        """Assets directory name (DSL filename without extension)."""
        return self.dsl_filename.rsplit(".", 1)[0]

    @classmethod
    def from_tree(cls, tree: AppAssetFileTree, dsl_filename: str) -> BundleManifest:
        """Build manifest from an AppAssetFileTree."""
        files = [ManifestFileEntry(node_id=n.id, path=tree.get_path(n.id)) for n in tree.walk_files()]
        return cls(
            dsl_filename=dsl_filename,
            app_assets=ManifestAppAssets(tree=tree),
            files=files,
            integrity=ManifestIntegrity(file_count=len(files)),
        )


# Export result
class BundleExportResult(BaseModel):
    download_url: str = Field(description="Temporary download URL for the ZIP")
    filename: str = Field(description="Suggested filename for the ZIP")
