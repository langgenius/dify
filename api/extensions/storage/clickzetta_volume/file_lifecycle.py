"""ClickZetta Volume file lifecycle management

This module provides file lifecycle management features including version control,
automatic cleanup, backup and restore.
Supports complete lifecycle management for knowledge base files.
"""

from __future__ import annotations

import json
import logging
import operator
from dataclasses import asdict, dataclass
from datetime import datetime
from enum import StrEnum, auto
from typing import Any

logger = logging.getLogger(__name__)


class FileStatus(StrEnum):
    """File status enumeration"""

    ACTIVE = auto()  # Active status
    ARCHIVED = auto()  # Archived
    DELETED = auto()  # Deleted (soft delete)
    BACKUP = auto()  # Backup file


@dataclass
class FileMetadata:
    """File metadata"""

    filename: str
    size: int | None
    created_at: datetime
    modified_at: datetime
    version: int | None
    status: FileStatus
    checksum: str | None = None
    tags: dict[str, str] | None = None
    parent_version: int | None = None

    def to_dict(self):
        """Convert to dictionary format"""
        data = asdict(self)
        data["created_at"] = self.created_at.isoformat()
        data["modified_at"] = self.modified_at.isoformat()
        data["status"] = self.status.value
        return data

    @classmethod
    def from_dict(cls, data: dict) -> FileMetadata:
        """Create instance from dictionary"""
        data = data.copy()
        data["created_at"] = datetime.fromisoformat(data["created_at"])
        data["modified_at"] = datetime.fromisoformat(data["modified_at"])
        data["status"] = FileStatus(data["status"])
        return cls(**data)


class FileLifecycleManager:
    """File lifecycle manager"""

    def __init__(self, storage, dataset_id: str | None = None):
        """Initialize lifecycle manager

        Args:
            storage: ClickZetta Volume storage instance
            dataset_id: Dataset ID (for Table Volume)
        """
        self._storage = storage
        self._dataset_id = dataset_id
        self._metadata_file = ".dify_file_metadata.json"
        self._version_prefix = ".versions/"
        self._backup_prefix = ".backups/"
        self._deleted_prefix = ".deleted/"

        # Get permission manager (if exists)
        self._permission_manager: Any | None = getattr(storage, "_permission_manager", None)

    def save_with_lifecycle(self, filename: str, data: bytes, tags: dict[str, str] | None = None) -> FileMetadata:
        """Save file and manage lifecycle

        Args:
            filename: File name
            data: File content
            tags: File tags

        Returns:
            File metadata
        """
        # Permission check
        if not self._check_permission(filename, "save"):
            from .volume_permissions import VolumePermissionError

            raise VolumePermissionError(
                f"Permission denied for lifecycle save operation on file: {filename}",
                operation="save",
                volume_type=getattr(self._storage, "_config", {}).get("volume_type", "unknown"),
                dataset_id=self._dataset_id,
            )

        try:
            # 1. Check if old version exists
            metadata_dict = self._load_metadata()
            current_metadata = metadata_dict.get(filename)

            # 2. If old version exists, create version backup
            if current_metadata:
                self._create_version_backup(filename, current_metadata)

            # 3. Calculate file information
            now = datetime.now()
            checksum = self._calculate_checksum(data)
            new_version = (current_metadata["version"] + 1) if current_metadata else 1

            # 4. Save new file
            self._storage.save(filename, data)

            # 5. Create metadata
            created_at = now
            parent_version = None

            if current_metadata:
                # If created_at is string, convert to datetime
                if isinstance(current_metadata["created_at"], str):
                    created_at = datetime.fromisoformat(current_metadata["created_at"])
                else:
                    created_at = current_metadata["created_at"]
                parent_version = current_metadata["version"]

            file_metadata = FileMetadata(
                filename=filename,
                size=len(data),
                created_at=created_at,
                modified_at=now,
                version=new_version,
                status=FileStatus.ACTIVE,
                checksum=checksum,
                tags=tags or {},
                parent_version=parent_version,
            )

            # 6. Update metadata
            metadata_dict[filename] = file_metadata.to_dict()
            self._save_metadata(metadata_dict)

            logger.info("File %s saved with lifecycle management, version %s", filename, new_version)
            return file_metadata

        except Exception:
            logger.exception("Failed to save file with lifecycle")
            raise

    def get_file_metadata(self, filename: str) -> FileMetadata | None:
        """Get file metadata

        Args:
            filename: File name

        Returns:
            File metadata, returns None if not exists
        """
        try:
            metadata_dict = self._load_metadata()
            if filename in metadata_dict:
                return FileMetadata.from_dict(metadata_dict[filename])
            return None
        except Exception:
            logger.exception("Failed to get file metadata for %s", filename)
            return None

    def list_file_versions(self, filename: str) -> list[FileMetadata]:
        """List all versions of a file

        Args:
            filename: File name

        Returns:
            File version list, sorted by version number
        """
        try:
            versions = []

            # Get current version
            current_metadata = self.get_file_metadata(filename)
            if current_metadata:
                versions.append(current_metadata)

            # Get historical versions
            try:
                version_files = self._storage.scan(self._dataset_id or "", files=True)
                for file_path in version_files:
                    if file_path.startswith(f"{self._version_prefix}{filename}.v"):
                        # Parse version number
                        version_str = file_path.split(".v")[-1].split(".")[0]
                        try:
                            _ = int(version_str)
                            # Simplified processing here, should actually read metadata from version file
                            # Temporarily create basic metadata information
                        except ValueError:
                            continue
            except Exception:
                # If cannot scan version files, only return current version
                logger.exception("Failed to scan version files for %s", filename)

            return sorted(versions, key=lambda x: x.version or 0, reverse=True)

        except Exception:
            logger.exception("Failed to list file versions for %s", filename)
            return []

    def restore_version(self, filename: str, version: int) -> bool:
        """Restore file to specified version

        Args:
            filename: File name
            version: Version number to restore

        Returns:
            Whether restore succeeded
        """
        try:
            version_filename = f"{self._version_prefix}{filename}.v{version}"

            # Check if version file exists
            if not self._storage.exists(version_filename):
                logger.warning("Version %s of %s not found", version, filename)
                return False

            # Read version file content
            version_data = self._storage.load_once(version_filename)

            # Save current version as backup
            current_metadata = self.get_file_metadata(filename)
            if current_metadata:
                self._create_version_backup(filename, current_metadata.to_dict())

            # Restore file
            self.save_with_lifecycle(filename, version_data, {"restored_from": str(version)})
            return True

        except Exception:
            logger.exception("Failed to restore %s to version %s", filename, version)
            return False

    def archive_file(self, filename: str) -> bool:
        """Archive file

        Args:
            filename: File name

        Returns:
            Whether archive succeeded
        """
        # Permission check
        if not self._check_permission(filename, "archive"):
            logger.warning("Permission denied for archive operation on file: %s", filename)
            return False

        try:
            # Update file status to archived
            metadata_dict = self._load_metadata()
            if filename not in metadata_dict:
                logger.warning("File %s not found in metadata", filename)
                return False

            metadata_dict[filename]["status"] = FileStatus.ARCHIVED
            metadata_dict[filename]["modified_at"] = datetime.now().isoformat()

            self._save_metadata(metadata_dict)

            logger.info("File %s archived successfully", filename)
            return True

        except Exception:
            logger.exception("Failed to archive file %s", filename)
            return False

    def soft_delete_file(self, filename: str) -> bool:
        """Soft delete file (move to deleted directory)

        Args:
            filename: File name

        Returns:
            Whether delete succeeded
        """
        # Permission check
        if not self._check_permission(filename, "delete"):
            logger.warning("Permission denied for soft delete operation on file: %s", filename)
            return False

        try:
            # Check if file exists
            if not self._storage.exists(filename):
                logger.warning("File %s not found", filename)
                return False

            # Read file content
            file_data = self._storage.load_once(filename)

            # Move to deleted directory
            deleted_filename = f"{self._deleted_prefix}{filename}.{datetime.now().strftime('%Y%m%d_%H%M%S')}"
            self._storage.save(deleted_filename, file_data)

            # Delete original file
            self._storage.delete(filename)

            # Update metadata
            metadata_dict = self._load_metadata()
            if filename in metadata_dict:
                metadata_dict[filename]["status"] = FileStatus.DELETED
                metadata_dict[filename]["modified_at"] = datetime.now().isoformat()
                self._save_metadata(metadata_dict)

            logger.info("File %s soft deleted successfully", filename)
            return True

        except Exception:
            logger.exception("Failed to soft delete file %s", filename)
            return False

    def cleanup_old_versions(self, max_versions: int = 5, max_age_days: int = 30) -> int:
        """Cleanup old version files

        Args:
            max_versions: Maximum number of versions to keep
            max_age_days: Maximum retention days for version files

        Returns:
            Number of files cleaned
        """
        try:
            cleaned_count = 0

            # Get all version files
            try:
                all_files = self._storage.scan(self._dataset_id or "", files=True)
                version_files = [f for f in all_files if f.startswith(self._version_prefix)]

                # Group by file
                file_versions: dict[str, list[tuple[int, str]]] = {}
                for version_file in version_files:
                    # Parse filename and version
                    parts = version_file[len(self._version_prefix) :].split(".v")
                    if len(parts) >= 2:
                        base_filename = parts[0]
                        version_part = parts[1].split(".")[0]
                        try:
                            version_num = int(version_part)
                            if base_filename not in file_versions:
                                file_versions[base_filename] = []
                            file_versions[base_filename].append((version_num, version_file))
                        except ValueError:
                            continue

                # Cleanup old versions for each file
                for base_filename, versions in file_versions.items():
                    # Sort by version number
                    versions.sort(key=operator.itemgetter(0), reverse=True)

                    # Keep the newest max_versions versions, delete the rest
                    if len(versions) > max_versions:
                        to_delete = versions[max_versions:]
                        for version_num, version_file in to_delete:
                            self._storage.delete(version_file)
                            cleaned_count += 1
                            logger.debug("Cleaned old version: %s", version_file)

                logger.info("Cleaned %d old version files", cleaned_count)

            except Exception as e:
                logger.warning("Could not scan for version files: %s", e)

            return cleaned_count

        except Exception:
            logger.exception("Failed to cleanup old versions")
            return 0

    def get_storage_statistics(self) -> dict[str, Any]:
        """Get storage statistics

        Returns:
            Storage statistics dictionary
        """
        try:
            metadata_dict = self._load_metadata()

            stats: dict[str, Any] = {
                "total_files": len(metadata_dict),
                "active_files": 0,
                "archived_files": 0,
                "deleted_files": 0,
                "total_size": 0,
                "versions_count": 0,
                "oldest_file": None,
                "newest_file": None,
            }

            oldest_date = None
            newest_date = None

            for filename, metadata in metadata_dict.items():
                file_meta = FileMetadata.from_dict(metadata)

                # Count file status
                if file_meta.status == FileStatus.ACTIVE:
                    stats["active_files"] = (stats["active_files"] or 0) + 1
                elif file_meta.status == FileStatus.ARCHIVED:
                    stats["archived_files"] = (stats["archived_files"] or 0) + 1
                elif file_meta.status == FileStatus.DELETED:
                    stats["deleted_files"] = (stats["deleted_files"] or 0) + 1

                # Count size
                stats["total_size"] = (stats["total_size"] or 0) + (file_meta.size or 0)

                # Count versions
                stats["versions_count"] = (stats["versions_count"] or 0) + (file_meta.version or 0)

                # Find newest and oldest files
                if oldest_date is None or file_meta.created_at < oldest_date:
                    oldest_date = file_meta.created_at
                    stats["oldest_file"] = filename

                if newest_date is None or file_meta.modified_at > newest_date:
                    newest_date = file_meta.modified_at
                    stats["newest_file"] = filename

            return stats

        except Exception:
            logger.exception("Failed to get storage statistics")
            return {}

    def _create_version_backup(self, filename: str, metadata: dict):
        """Create version backup"""
        try:
            # Read current file content
            current_data = self._storage.load_once(filename)

            # Save as version file
            version_filename = f"{self._version_prefix}{filename}.v{metadata['version']}"
            self._storage.save(version_filename, current_data)

            logger.debug("Created version backup: %s", version_filename)

        except Exception as e:
            logger.warning("Failed to create version backup for %s: %s", filename, e)

    def _load_metadata(self) -> dict[str, Any]:
        """Load metadata file"""
        try:
            if self._storage.exists(self._metadata_file):
                metadata_content = self._storage.load_once(self._metadata_file)
                result = json.loads(metadata_content.decode("utf-8"))
                return dict(result) if result else {}
            else:
                return {}
        except Exception as e:
            logger.warning("Failed to load metadata: %s", e)
            return {}

    def _save_metadata(self, metadata_dict: dict):
        """Save metadata file"""
        try:
            metadata_content = json.dumps(metadata_dict, indent=2, ensure_ascii=False)
            self._storage.save(self._metadata_file, metadata_content.encode("utf-8"))
            logger.debug("Metadata saved successfully")
        except Exception:
            logger.exception("Failed to save metadata")
            raise

    def _calculate_checksum(self, data: bytes) -> str:
        """Calculate file checksum"""
        import hashlib

        return hashlib.md5(data).hexdigest()

    def _check_permission(self, filename: str, operation: str) -> bool:
        """Check file operation permission

        Args:
            filename: File name
            operation: Operation type

        Returns:
            True if permission granted, False otherwise
        """
        # If no permission manager, allow by default
        if not self._permission_manager:
            return True

        try:
            # Map operation type to permission
            operation_mapping = {
                "save": "save",
                "load": "load_once",
                "delete": "delete",
                "archive": "delete",  # Archive requires delete permission
                "restore": "save",  # Restore requires write permission
                "cleanup": "delete",  # Cleanup requires delete permission
                "read": "load_once",
                "write": "save",
            }

            mapped_operation = operation_mapping.get(operation, operation)

            # Check permission
            result = self._permission_manager.validate_operation(mapped_operation, self._dataset_id)
            return bool(result)

        except Exception:
            logger.exception("Permission check failed for %s operation %s", filename, operation)
            # Safe default: deny access when permission check fails
            return False
