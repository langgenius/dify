from __future__ import annotations

import re

from pydantic import BaseModel, Field

# Constants
BUNDLE_DSL_FILENAME_PATTERN = re.compile(r"^[^/]+\.ya?ml$")
BUNDLE_MAX_SIZE = 50 * 1024 * 1024  # 50MB


# Exceptions
class BundleFormatError(Exception):
    """Raised when bundle format is invalid."""

    pass


class ZipSecurityError(Exception):
    """Raised when zip file contains security violations."""

    pass


# Entities
class BundleExportResult(BaseModel):
    zip_bytes: bytes = Field(description="ZIP file content as bytes")
    filename: str = Field(description="Suggested filename for the ZIP")


class SourceFileEntry(BaseModel):
    path: str = Field(description="File path within the ZIP")
    node_id: str = Field(description="Node ID in the asset tree")


class ExtractedFile(BaseModel):
    path: str = Field(description="Relative path of the extracted file")
    content: bytes = Field(description="File content as bytes")


class ExtractedFolder(BaseModel):
    path: str = Field(description="Relative path of the extracted folder")
