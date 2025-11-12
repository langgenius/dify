"""ClickZetta Volume Storage Implementation

This module provides storage backend using ClickZetta Volume functionality.
Supports Table Volume, User Volume, and External Volume types.
"""

import logging
import os
import tempfile
from collections.abc import Generator
from io import BytesIO
from pathlib import Path

import clickzetta
from pydantic import BaseModel, model_validator

from extensions.storage.base_storage import BaseStorage

from .volume_permissions import VolumePermissionManager, check_volume_permission

logger = logging.getLogger(__name__)


class ClickZettaVolumeConfig(BaseModel):
    """Configuration for ClickZetta Volume storage."""

    username: str = ""
    password: str = ""
    instance: str = ""
    service: str = "api.clickzetta.com"
    workspace: str = "quick_start"
    vcluster: str = "default_ap"
    schema_name: str = "dify"
    volume_type: str = "table"  # table|user|external
    volume_name: str | None = None  # For external volumes
    table_prefix: str = "dataset_"  # Prefix for table volume names
    dify_prefix: str = "dify_km"  # Directory prefix for User Volume
    permission_check: bool = True  # Enable/disable permission checking

    @model_validator(mode="before")
    @classmethod
    def validate_config(cls, values: dict):
        """Validate the configuration values.

        This method will first try to use CLICKZETTA_VOLUME_* environment variables,
        then fall back to CLICKZETTA_* environment variables (for vector DB config).
        """
        import os

        # Helper function to get environment variable with fallback
        def get_env_with_fallback(volume_key: str, fallback_key: str, default: str | None = None) -> str:
            # First try CLICKZETTA_VOLUME_* specific config
            volume_value = values.get(volume_key.lower().replace("clickzetta_volume_", ""))
            if volume_value:
                return str(volume_value)

            # Then try environment variables
            volume_env = os.getenv(volume_key)
            if volume_env:
                return volume_env

            # Fall back to existing CLICKZETTA_* config
            fallback_env = os.getenv(fallback_key)
            if fallback_env:
                return fallback_env

            return default or ""

        # Apply environment variables with fallback to existing CLICKZETTA_* config
        values.setdefault("username", get_env_with_fallback("CLICKZETTA_VOLUME_USERNAME", "CLICKZETTA_USERNAME"))
        values.setdefault("password", get_env_with_fallback("CLICKZETTA_VOLUME_PASSWORD", "CLICKZETTA_PASSWORD"))
        values.setdefault("instance", get_env_with_fallback("CLICKZETTA_VOLUME_INSTANCE", "CLICKZETTA_INSTANCE"))
        values.setdefault(
            "service", get_env_with_fallback("CLICKZETTA_VOLUME_SERVICE", "CLICKZETTA_SERVICE", "api.clickzetta.com")
        )
        values.setdefault(
            "workspace", get_env_with_fallback("CLICKZETTA_VOLUME_WORKSPACE", "CLICKZETTA_WORKSPACE", "quick_start")
        )
        values.setdefault(
            "vcluster", get_env_with_fallback("CLICKZETTA_VOLUME_VCLUSTER", "CLICKZETTA_VCLUSTER", "default_ap")
        )
        values.setdefault("schema_name", get_env_with_fallback("CLICKZETTA_VOLUME_SCHEMA", "CLICKZETTA_SCHEMA", "dify"))

        # Volume-specific configurations (no fallback to vector DB config)
        values.setdefault("volume_type", os.getenv("CLICKZETTA_VOLUME_TYPE", "table"))
        values.setdefault("volume_name", os.getenv("CLICKZETTA_VOLUME_NAME"))
        values.setdefault("table_prefix", os.getenv("CLICKZETTA_VOLUME_TABLE_PREFIX", "dataset_"))
        values.setdefault("dify_prefix", os.getenv("CLICKZETTA_VOLUME_DIFY_PREFIX", "dify_km"))
        # Temporarily disable permission check feature, set directly to false
        values.setdefault("permission_check", False)

        # Validate required fields
        if not values.get("username"):
            raise ValueError("CLICKZETTA_VOLUME_USERNAME or CLICKZETTA_USERNAME is required")
        if not values.get("password"):
            raise ValueError("CLICKZETTA_VOLUME_PASSWORD or CLICKZETTA_PASSWORD is required")
        if not values.get("instance"):
            raise ValueError("CLICKZETTA_VOLUME_INSTANCE or CLICKZETTA_INSTANCE is required")

        # Validate volume type
        volume_type = values["volume_type"]
        if volume_type not in ["table", "user", "external"]:
            raise ValueError("CLICKZETTA_VOLUME_TYPE must be one of: table, user, external")

        if volume_type == "external" and not values.get("volume_name"):
            raise ValueError("CLICKZETTA_VOLUME_NAME is required for external volume type")

        return values


class ClickZettaVolumeStorage(BaseStorage):
    """ClickZetta Volume storage implementation."""

    def __init__(self, config: ClickZettaVolumeConfig):
        """Initialize ClickZetta Volume storage.

        Args:
            config: ClickZetta Volume configuration
        """
        self._config = config
        self._connection = None
        self._permission_manager: VolumePermissionManager | None = None
        self._init_connection()
        self._init_permission_manager()

        logger.info("ClickZetta Volume storage initialized with type: %s", config.volume_type)

    def _init_connection(self):
        """Initialize ClickZetta connection."""
        try:
            self._connection = clickzetta.connect(
                username=self._config.username,
                password=self._config.password,
                instance=self._config.instance,
                service=self._config.service,
                workspace=self._config.workspace,
                vcluster=self._config.vcluster,
                schema=self._config.schema_name,
            )
            logger.debug("ClickZetta connection established")
        except Exception:
            logger.exception("Failed to connect to ClickZetta")
            raise

    def _init_permission_manager(self):
        """Initialize permission manager."""
        try:
            self._permission_manager = VolumePermissionManager(
                self._connection, self._config.volume_type, self._config.volume_name
            )
            logger.debug("Permission manager initialized")
        except Exception:
            logger.exception("Failed to initialize permission manager")
            raise

    def _get_volume_path(self, filename: str, dataset_id: str | None = None) -> str:
        """Get the appropriate volume path based on volume type."""
        if self._config.volume_type == "user":
            # Add dify prefix for User Volume to organize files
            return f"{self._config.dify_prefix}/{filename}"
        elif self._config.volume_type == "table":
            # Check if this should use User Volume (special directories)
            if dataset_id in ["upload_files", "temp", "cache", "tools", "website_files", "privkeys"]:
                # Use User Volume with dify prefix for special directories
                return f"{self._config.dify_prefix}/{filename}"

            if dataset_id:
                return f"{self._config.table_prefix}{dataset_id}/{filename}"
            else:
                # Extract dataset_id from filename if not provided
                # Format: dataset_id/filename
                if "/" in filename:
                    return filename
                else:
                    raise ValueError("dataset_id is required for table volume or filename must include dataset_id/")
        elif self._config.volume_type == "external":
            return filename
        else:
            raise ValueError(f"Unsupported volume type: {self._config.volume_type}")

    def _get_volume_sql_prefix(self, dataset_id: str | None = None) -> str:
        """Get SQL prefix for volume operations."""
        if self._config.volume_type == "user":
            return "USER VOLUME"
        elif self._config.volume_type == "table":
            # For Dify's current file storage pattern, most files are stored in
            # paths like "upload_files/tenant_id/uuid.ext", "tools/tenant_id/uuid.ext"
            # These should use USER VOLUME for better compatibility
            if dataset_id in ["upload_files", "temp", "cache", "tools", "website_files", "privkeys"]:
                return "USER VOLUME"

            # Only use TABLE VOLUME for actual dataset-specific paths
            # like "dataset_12345/file.pdf" or paths with dataset_ prefix
            if dataset_id:
                table_name = f"{self._config.table_prefix}{dataset_id}"
            else:
                # Default table name for generic operations
                table_name = "default_dataset"
            return f"TABLE VOLUME {table_name}"
        elif self._config.volume_type == "external":
            return f"VOLUME {self._config.volume_name}"
        else:
            raise ValueError(f"Unsupported volume type: {self._config.volume_type}")

    def _execute_sql(self, sql: str, fetch: bool = False):
        """Execute SQL command."""
        try:
            if self._connection is None:
                raise RuntimeError("Connection not initialized")
            with self._connection.cursor() as cursor:
                cursor.execute(sql)
                if fetch:
                    return cursor.fetchall()
                return None
        except Exception:
            logger.exception("SQL execution failed: %s", sql)
            raise

    def _ensure_table_volume_exists(self, dataset_id: str):
        """Ensure table volume exists for the given dataset_id."""
        if self._config.volume_type != "table" or not dataset_id:
            return

        # Skip for upload_files and other special directories that use USER VOLUME
        if dataset_id in ["upload_files", "temp", "cache", "tools", "website_files", "privkeys"]:
            return

        table_name = f"{self._config.table_prefix}{dataset_id}"

        try:
            # Check if table exists
            check_sql = f"SHOW TABLES LIKE '{table_name}'"
            result = self._execute_sql(check_sql, fetch=True)

            if not result:
                # Create table with volume
                create_sql = f"""
                CREATE TABLE {table_name} (
                    id INT PRIMARY KEY AUTO_INCREMENT,
                    filename VARCHAR(255) NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    INDEX idx_filename (filename)
                ) WITH VOLUME
                """
                self._execute_sql(create_sql)
                logger.info("Created table volume: %s", table_name)

        except Exception as e:
            logger.warning("Failed to create table volume %s: %s", table_name, e)
            # Don't raise exception, let the operation continue
            # The table might exist but not be visible due to permissions

    def save(self, filename: str, data: bytes):
        """Save data to ClickZetta Volume.

        Args:
            filename: File path in volume
            data: File content as bytes
        """
        # Extract dataset_id from filename if present
        dataset_id = None
        if "/" in filename and self._config.volume_type == "table":
            parts = filename.split("/", 1)
            if parts[0].startswith(self._config.table_prefix):
                dataset_id = parts[0][len(self._config.table_prefix) :]
                filename = parts[1]
            else:
                dataset_id = parts[0]
                filename = parts[1]

        # Ensure table volume exists (for table volumes)
        if dataset_id:
            self._ensure_table_volume_exists(dataset_id)

        # Check permissions (if enabled)
        if self._config.permission_check:
            # Skip permission check for special directories that use USER VOLUME
            if dataset_id not in ["upload_files", "temp", "cache", "tools", "website_files", "privkeys"]:
                if self._permission_manager is not None:
                    check_volume_permission(self._permission_manager, "save", dataset_id)

        # Write data to temporary file
        with tempfile.NamedTemporaryFile(delete=False) as temp_file:
            temp_file.write(data)
            temp_file_path = temp_file.name

        try:
            # Upload to volume
            volume_prefix = self._get_volume_sql_prefix(dataset_id)

            # Get the actual volume path (may include dify_km prefix)
            volume_path = self._get_volume_path(filename, dataset_id)

            # For User Volume, use the full path with dify_km prefix
            if volume_prefix == "USER VOLUME":
                sql = f"PUT '{temp_file_path}' TO {volume_prefix} FILE '{volume_path}'"
            else:
                sql = f"PUT '{temp_file_path}' TO {volume_prefix} FILE '{filename}'"

            self._execute_sql(sql)
            logger.debug("File %s saved to ClickZetta Volume at path %s", filename, volume_path)
        finally:
            # Clean up temporary file
            Path(temp_file_path).unlink(missing_ok=True)

    def load_once(self, filename: str) -> bytes:
        """Load file content from ClickZetta Volume.

        Args:
            filename: File path in volume

        Returns:
            File content as bytes
        """
        # Extract dataset_id from filename if present
        dataset_id = None
        if "/" in filename and self._config.volume_type == "table":
            parts = filename.split("/", 1)
            if parts[0].startswith(self._config.table_prefix):
                dataset_id = parts[0][len(self._config.table_prefix) :]
                filename = parts[1]
            else:
                dataset_id = parts[0]
                filename = parts[1]

        # Check permissions (if enabled)
        if self._config.permission_check:
            # Skip permission check for special directories that use USER VOLUME
            if dataset_id not in ["upload_files", "temp", "cache", "tools", "website_files", "privkeys"]:
                if self._permission_manager is not None:
                    check_volume_permission(self._permission_manager, "load_once", dataset_id)

        # Download to temporary directory
        with tempfile.TemporaryDirectory() as temp_dir:
            volume_prefix = self._get_volume_sql_prefix(dataset_id)

            # Get the actual volume path (may include dify_km prefix)
            volume_path = self._get_volume_path(filename, dataset_id)

            # For User Volume, use the full path with dify_km prefix
            if volume_prefix == "USER VOLUME":
                sql = f"GET {volume_prefix} FILE '{volume_path}' TO '{temp_dir}'"
            else:
                sql = f"GET {volume_prefix} FILE '{filename}' TO '{temp_dir}'"

            self._execute_sql(sql)

            # Find the downloaded file (may be in subdirectories)
            downloaded_file = None
            for root, _, files in os.walk(temp_dir):
                for file in files:
                    if file == filename or file == os.path.basename(filename):
                        downloaded_file = Path(root) / file
                        break
                if downloaded_file:
                    break

            if not downloaded_file or not downloaded_file.exists():
                raise FileNotFoundError(f"Downloaded file not found: {filename}")

            content = downloaded_file.read_bytes()

            logger.debug("File %s loaded from ClickZetta Volume", filename)
            return content

    def load_stream(self, filename: str) -> Generator:
        """Load file as stream from ClickZetta Volume.

        Args:
            filename: File path in volume

        Yields:
            File content chunks
        """
        content = self.load_once(filename)
        batch_size = 4096
        stream = BytesIO(content)

        while chunk := stream.read(batch_size):
            yield chunk

        logger.debug("File %s loaded as stream from ClickZetta Volume", filename)

    def download(self, filename: str, target_filepath: str):
        """Download file from ClickZetta Volume to local path.

        Args:
            filename: File path in volume
            target_filepath: Local target file path
        """
        content = self.load_once(filename)

        with Path(target_filepath).open("wb") as f:
            f.write(content)

        logger.debug("File %s downloaded from ClickZetta Volume to %s", filename, target_filepath)

    def exists(self, filename: str) -> bool:
        """Check if file exists in ClickZetta Volume.

        Args:
            filename: File path in volume

        Returns:
            True if file exists, False otherwise
        """
        try:
            # Extract dataset_id from filename if present
            dataset_id = None
            if "/" in filename and self._config.volume_type == "table":
                parts = filename.split("/", 1)
                if parts[0].startswith(self._config.table_prefix):
                    dataset_id = parts[0][len(self._config.table_prefix) :]
                    filename = parts[1]
                else:
                    dataset_id = parts[0]
                    filename = parts[1]

            volume_prefix = self._get_volume_sql_prefix(dataset_id)

            # Get the actual volume path (may include dify_km prefix)
            volume_path = self._get_volume_path(filename, dataset_id)

            # For User Volume, use the full path with dify_km prefix
            if volume_prefix == "USER VOLUME":
                sql = f"LIST {volume_prefix} REGEXP = '^{volume_path}$'"
            else:
                sql = f"LIST {volume_prefix} REGEXP = '^{filename}$'"

            rows = self._execute_sql(sql, fetch=True)

            exists = len(rows) > 0 if rows else False
            logger.debug("File %s exists check: %s", filename, exists)
            return exists
        except Exception as e:
            logger.warning("Error checking file existence for %s: %s", filename, e)
            return False

    def delete(self, filename: str):
        """Delete file from ClickZetta Volume.

        Args:
            filename: File path in volume
        """
        if not self.exists(filename):
            logger.debug("File %s not found, skip delete", filename)
            return

        # Extract dataset_id from filename if present
        dataset_id = None
        if "/" in filename and self._config.volume_type == "table":
            parts = filename.split("/", 1)
            if parts[0].startswith(self._config.table_prefix):
                dataset_id = parts[0][len(self._config.table_prefix) :]
                filename = parts[1]
            else:
                dataset_id = parts[0]
                filename = parts[1]

        volume_prefix = self._get_volume_sql_prefix(dataset_id)

        # Get the actual volume path (may include dify_km prefix)
        volume_path = self._get_volume_path(filename, dataset_id)

        # For User Volume, use the full path with dify_km prefix
        if volume_prefix == "USER VOLUME":
            sql = f"REMOVE {volume_prefix} FILE '{volume_path}'"
        else:
            sql = f"REMOVE {volume_prefix} FILE '{filename}'"

        self._execute_sql(sql)

        logger.debug("File %s deleted from ClickZetta Volume", filename)

    def scan(self, path: str, files: bool = True, directories: bool = False) -> list[str]:
        """Scan files and directories in ClickZetta Volume.

        Args:
            path: Path to scan (dataset_id for table volumes)
            files: Include files in results
            directories: Include directories in results

        Returns:
            List of file/directory paths
        """
        try:
            # For table volumes, path is treated as dataset_id
            dataset_id = None
            if self._config.volume_type == "table":
                dataset_id = path
                path = ""  # Root of the table volume

            volume_prefix = self._get_volume_sql_prefix(dataset_id)

            # For User Volume, add dify prefix to path
            if volume_prefix == "USER VOLUME":
                if path:
                    scan_path = f"{self._config.dify_prefix}/{path}"
                    sql = f"LIST {volume_prefix} SUBDIRECTORY '{scan_path}'"
                else:
                    sql = f"LIST {volume_prefix} SUBDIRECTORY '{self._config.dify_prefix}'"
            else:
                if path:
                    sql = f"LIST {volume_prefix} SUBDIRECTORY '{path}'"
                else:
                    sql = f"LIST {volume_prefix}"

            rows = self._execute_sql(sql, fetch=True)

            result = []
            if rows:
                for row in rows:
                    file_path = row[0]  # relative_path column

                    # For User Volume, remove dify prefix from results
                    dify_prefix_with_slash = f"{self._config.dify_prefix}/"
                    if volume_prefix == "USER VOLUME" and file_path.startswith(dify_prefix_with_slash):
                        file_path = file_path[len(dify_prefix_with_slash) :]  # Remove prefix

                    if files and not file_path.endswith("/") or directories and file_path.endswith("/"):
                        result.append(file_path)

            logger.debug("Scanned %d items in path %s", len(result), path)
            return result

        except Exception:
            logger.exception("Error scanning path %s", path)
            return []
