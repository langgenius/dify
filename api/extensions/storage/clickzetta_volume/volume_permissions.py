"""ClickZetta Volume permission management mechanism

This module provides Volume permission checking, validation and management features.
According to ClickZetta's permission model, different Volume types have different permission requirements.
"""

import logging
from enum import StrEnum

logger = logging.getLogger(__name__)


class VolumePermission(StrEnum):
    """Volume permission type enumeration"""

    READ = "SELECT"  # Corresponds to ClickZetta's SELECT permission
    WRITE = "INSERT,UPDATE,DELETE"  # Corresponds to ClickZetta's write permissions
    LIST = "SELECT"  # Listing files requires SELECT permission
    DELETE = "INSERT,UPDATE,DELETE"  # Deleting files requires write permissions
    USAGE = "USAGE"  # Basic permission required for External Volume


class VolumePermissionManager:
    """Volume permission manager"""

    def __init__(self, connection_or_config, volume_type: str | None = None, volume_name: str | None = None):
        """Initialize permission manager

        Args:
            connection_or_config: ClickZetta connection object or configuration dictionary
            volume_type: Volume type (user|table|external)
            volume_name: Volume name (for external volume)
        """
        # Support two initialization methods: connection object or configuration dictionary
        if isinstance(connection_or_config, dict):
            # Create connection from configuration dictionary
            import clickzetta

            config = connection_or_config
            self._connection = clickzetta.connect(
                username=config.get("username"),
                password=config.get("password"),
                instance=config.get("instance"),
                service=config.get("service"),
                workspace=config.get("workspace"),
                vcluster=config.get("vcluster"),
                schema=config.get("schema") or config.get("database"),
            )
            self._volume_type = config.get("volume_type", volume_type)
            self._volume_name = config.get("volume_name", volume_name)
        else:
            # Use connection object directly
            self._connection = connection_or_config
            self._volume_type = volume_type
            self._volume_name = volume_name

        if not self._connection:
            raise ValueError("Valid connection or config is required")
        if not self._volume_type:
            raise ValueError("volume_type is required")

        self._permission_cache: dict[str, set[str]] = {}
        self._current_username = None  # Will get current username from connection

    def check_permission(self, operation: VolumePermission, dataset_id: str | None = None) -> bool:
        """Check if user has permission to perform specific operation

        Args:
            operation: Type of operation to perform
            dataset_id: Dataset ID (for table volume)

        Returns:
            True if user has permission, False otherwise
        """
        try:
            if self._volume_type == "user":
                return self._check_user_volume_permission(operation)
            elif self._volume_type == "table":
                return self._check_table_volume_permission(operation, dataset_id)
            elif self._volume_type == "external":
                return self._check_external_volume_permission(operation)
            else:
                logger.warning("Unknown volume type: %s", self._volume_type)
                return False

        except Exception:
            logger.exception("Permission check failed")
            return False

    def _check_user_volume_permission(self, operation: VolumePermission) -> bool:
        """Check User Volume permission

        User Volume permission rules:
        - User has full permissions on their own User Volume
        - As long as user can connect to ClickZetta, they have basic User Volume permissions by default
        - Focus more on connection authentication rather than complex permission checking
        """
        try:
            # Get current username
            current_user = self._get_current_username()

            # Check basic connection status
            with self._connection.cursor() as cursor:
                # Simple connection test, if query can be executed user has basic permissions
                cursor.execute("SELECT 1")
                result = cursor.fetchone()

                if result:
                    logger.debug(
                        "User Volume permission check for %s, operation %s: granted (basic connection verified)",
                        current_user,
                        operation.name,
                    )
                    return True
                else:
                    logger.warning(
                        "User Volume permission check failed: cannot verify basic connection for %s", current_user
                    )
                    return False

        except Exception:
            logger.exception("User Volume permission check failed")
            # For User Volume, if permission check fails, it might be a configuration issue,
            # provide friendlier error message
            logger.info("User Volume permission check failed, but permission checking is disabled in this version")
            return False

    def _check_table_volume_permission(self, operation: VolumePermission, dataset_id: str | None) -> bool:
        """Check Table Volume permission

        Table Volume permission rules:
        - Table Volume permissions inherit from corresponding table permissions
        - SELECT permission -> can READ/LIST files
        - INSERT,UPDATE,DELETE permissions -> can WRITE/DELETE files
        """
        if not dataset_id:
            logger.warning("dataset_id is required for table volume permission check")
            return False

        table_name = f"dataset_{dataset_id}" if not dataset_id.startswith("dataset_") else dataset_id

        try:
            # Check table permissions
            permissions = self._get_table_permissions(table_name)
            required_permissions = set(operation.value.split(","))

            # Check if has all required permissions
            has_permission = required_permissions.issubset(permissions)

            logger.debug(
                "Table Volume permission check for %s, operation %s: required=%s, has=%s, granted=%s",
                table_name,
                operation.name,
                required_permissions,
                permissions,
                has_permission,
            )

            return has_permission

        except Exception:
            logger.exception("Table volume permission check failed for %s", table_name)
            return False

    def _check_external_volume_permission(self, operation: VolumePermission) -> bool:
        """Check External Volume permission

        External Volume permission rules:
        - Try to get permissions for External Volume
        - If permission check fails, perform fallback verification
        - For development environment, provide more lenient permission checking
        """
        if not self._volume_name:
            logger.warning("volume_name is required for external volume permission check")
            return False

        try:
            # Check External Volume permissions
            permissions = self._get_external_volume_permissions(self._volume_name)

            # External Volume permission mapping: determine required permissions based on operation type
            required_permissions = set()

            if operation in [VolumePermission.READ, VolumePermission.LIST]:
                required_permissions.add("read")
            elif operation in [VolumePermission.WRITE, VolumePermission.DELETE]:
                required_permissions.add("write")

            # Check if has all required permissions
            has_permission = required_permissions.issubset(permissions)

            logger.debug(
                "External Volume permission check for %s, operation %s: required=%s, has=%s, granted=%s",
                self._volume_name,
                operation.name,
                required_permissions,
                permissions,
                has_permission,
            )

            # If permission check fails, try fallback verification
            if not has_permission:
                logger.info("Direct permission check failed for %s, trying fallback verification", self._volume_name)

                # Fallback verification: try listing Volume to verify basic access permissions
                try:
                    with self._connection.cursor() as cursor:
                        cursor.execute("SHOW VOLUMES")
                        volumes = cursor.fetchall()
                        for volume in volumes:
                            if len(volume) > 0 and volume[0] == self._volume_name:
                                logger.info("Fallback verification successful for %s", self._volume_name)
                                return True
                except Exception as fallback_e:
                    logger.warning("Fallback verification failed for %s: %s", self._volume_name, fallback_e)

            return has_permission

        except Exception:
            logger.exception("External volume permission check failed for %s", self._volume_name)
            logger.info("External Volume permission check failed, but permission checking is disabled in this version")
            return False

    def _get_table_permissions(self, table_name: str) -> set[str]:
        """Get user permissions for specified table

        Args:
            table_name: Table name

        Returns:
            Set of user permissions for this table
        """
        cache_key = f"table:{table_name}"

        if cache_key in self._permission_cache:
            return self._permission_cache[cache_key]

        permissions = set()

        try:
            with self._connection.cursor() as cursor:
                # Use correct ClickZetta syntax to check current user permissions
                cursor.execute("SHOW GRANTS")
                grants = cursor.fetchall()

                # Parse permission results, find permissions for this table
                for grant in grants:
                    if len(grant) >= 3:  # Typical format: (privilege, object_type, object_name, ...)
                        privilege = grant[0].upper()
                        object_type = grant[1].upper() if len(grant) > 1 else ""
                        object_name = grant[2] if len(grant) > 2 else ""

                        # Check if it's permission for this table
                        if (
                            object_type == "TABLE"
                            and object_name == table_name
                            or object_type == "SCHEMA"
                            and object_name in table_name
                        ):
                            if privilege in ["SELECT", "INSERT", "UPDATE", "DELETE", "ALL"]:
                                if privilege == "ALL":
                                    permissions.update(["SELECT", "INSERT", "UPDATE", "DELETE"])
                                else:
                                    permissions.add(privilege)

                # If no explicit permissions found, try executing a simple query to verify permissions
                if not permissions:
                    try:
                        cursor.execute(f"SELECT COUNT(*) FROM {table_name} LIMIT 1")
                        permissions.add("SELECT")
                    except Exception:
                        logger.debug("Cannot query table %s, no SELECT permission", table_name)

        except Exception as e:
            logger.warning("Could not check table permissions for %s: %s", table_name, e)
            # Safe default: deny access when permission check fails
            pass

        # Cache permission information
        self._permission_cache[cache_key] = permissions
        return permissions

    def _get_current_username(self) -> str:
        """Get current username"""
        if self._current_username:
            return self._current_username

        try:
            with self._connection.cursor() as cursor:
                cursor.execute("SELECT CURRENT_USER()")
                result = cursor.fetchone()
                if result:
                    self._current_username = result[0]
                    return str(self._current_username)
        except Exception:
            logger.exception("Failed to get current username")

        return "unknown"

    def _get_user_permissions(self, username: str) -> set[str]:
        """Get user's basic permission set"""
        cache_key = f"user_permissions:{username}"

        if cache_key in self._permission_cache:
            return self._permission_cache[cache_key]

        permissions = set()

        try:
            with self._connection.cursor() as cursor:
                # Use correct ClickZetta syntax to check current user permissions
                cursor.execute("SHOW GRANTS")
                grants = cursor.fetchall()

                # Parse permission results, find user's basic permissions
                for grant in grants:
                    if len(grant) >= 3:  # Typical format: (privilege, object_type, object_name, ...)
                        privilege = grant[0].upper()
                        _ = grant[1].upper() if len(grant) > 1 else ""

                        # Collect all relevant permissions
                        if privilege in ["SELECT", "INSERT", "UPDATE", "DELETE", "ALL"]:
                            if privilege == "ALL":
                                permissions.update(["SELECT", "INSERT", "UPDATE", "DELETE"])
                            else:
                                permissions.add(privilege)

        except Exception as e:
            logger.warning("Could not check user permissions for %s: %s", username, e)
            # Safe default: deny access when permission check fails
            pass

        # Cache permission information
        self._permission_cache[cache_key] = permissions
        return permissions

    def _get_external_volume_permissions(self, volume_name: str) -> set[str]:
        """Get user permissions for specified External Volume

        Args:
            volume_name: External Volume name

        Returns:
            Set of user permissions for this Volume
        """
        cache_key = f"external_volume:{volume_name}"

        if cache_key in self._permission_cache:
            return self._permission_cache[cache_key]

        permissions = set()

        try:
            with self._connection.cursor() as cursor:
                # Use correct ClickZetta syntax to check Volume permissions
                logger.info("Checking permissions for volume: %s", volume_name)
                cursor.execute(f"SHOW GRANTS ON VOLUME {volume_name}")
                grants = cursor.fetchall()

                logger.info("Raw grants result for %s: %s", volume_name, grants)

                # Parse permission results
                # Format: (granted_type, privilege, conditions, granted_on, object_name, granted_to,
                #       grantee_name, grantor_name, grant_option, granted_time)
                for grant in grants:
                    logger.info("Processing grant: %s", grant)
                    if len(grant) >= 5:
                        granted_type = grant[0]
                        privilege = grant[1].upper()
                        granted_on = grant[3]
                        object_name = grant[4]

                        logger.info(
                            "Grant details - type: %s, privilege: %s, granted_on: %s, object_name: %s",
                            granted_type,
                            privilege,
                            granted_on,
                            object_name,
                        )

                        # Check if it's permission for this Volume or hierarchical permission
                        if (
                            granted_type == "PRIVILEGE" and granted_on == "VOLUME" and object_name.endswith(volume_name)
                        ) or (granted_type == "OBJECT_HIERARCHY" and granted_on == "VOLUME"):
                            logger.info("Matching grant found for %s", volume_name)

                            if "READ" in privilege:
                                permissions.add("read")
                                logger.info("Added READ permission for %s", volume_name)
                            if "WRITE" in privilege:
                                permissions.add("write")
                                logger.info("Added WRITE permission for %s", volume_name)
                            if "ALTER" in privilege:
                                permissions.add("alter")
                                logger.info("Added ALTER permission for %s", volume_name)
                            if privilege == "ALL":
                                permissions.update(["read", "write", "alter"])
                                logger.info("Added ALL permissions for %s", volume_name)

                logger.info("Final permissions for %s: %s", volume_name, permissions)

                # If no explicit permissions found, try viewing Volume list to verify basic permissions
                if not permissions:
                    try:
                        cursor.execute("SHOW VOLUMES")
                        volumes = cursor.fetchall()
                        for volume in volumes:
                            if len(volume) > 0 and volume[0] == volume_name:
                                permissions.add("read")  # At least has read permission
                                logger.debug("Volume %s found in SHOW VOLUMES, assuming read permission", volume_name)
                                break
                    except Exception:
                        logger.debug("Cannot access volume %s, no basic permission", volume_name)

        except Exception as e:
            logger.warning("Could not check external volume permissions for %s: %s", volume_name, e)
            # When permission check fails, try basic Volume access verification
            try:
                with self._connection.cursor() as cursor:
                    cursor.execute("SHOW VOLUMES")
                    volumes = cursor.fetchall()
                    for volume in volumes:
                        if len(volume) > 0 and volume[0] == volume_name:
                            logger.info("Basic volume access verified for %s", volume_name)
                            permissions.add("read")
                            permissions.add("write")  # Assume has write permission
                            break
            except Exception as basic_e:
                logger.warning("Basic volume access check failed for %s: %s", volume_name, basic_e)
                # Last fallback: assume basic permissions
                permissions.add("read")

        # Cache permission information
        self._permission_cache[cache_key] = permissions
        return permissions

    def clear_permission_cache(self):
        """Clear permission cache"""
        self._permission_cache.clear()
        logger.debug("Permission cache cleared")

    @property
    def volume_type(self) -> str | None:
        """Get the volume type."""
        return self._volume_type

    def get_permission_summary(self, dataset_id: str | None = None) -> dict[str, bool]:
        """Get permission summary

        Args:
            dataset_id: Dataset ID (for table volume)

        Returns:
            Permission summary dictionary
        """
        summary = {}

        for operation in VolumePermission:
            summary[operation.name.lower()] = self.check_permission(operation, dataset_id)

        return summary

    def check_inherited_permission(self, file_path: str, operation: VolumePermission) -> bool:
        """Check permission inheritance for file path

        Args:
            file_path: File path
            operation: Operation to perform

        Returns:
            True if user has permission, False otherwise
        """
        try:
            # Parse file path
            path_parts = file_path.strip("/").split("/")

            if not path_parts:
                logger.warning("Invalid file path for permission inheritance check")
                return False

            # For Table Volume, first layer is dataset_id
            if self._volume_type == "table":
                if len(path_parts) < 1:
                    return False

                dataset_id = path_parts[0]

                # Check permissions for dataset
                has_dataset_permission = self.check_permission(operation, dataset_id)

                if not has_dataset_permission:
                    logger.debug("Permission denied for dataset %s", dataset_id)
                    return False

                # Check path traversal attack
                if self._contains_path_traversal(file_path):
                    logger.warning("Path traversal attack detected: %s", file_path)
                    return False

                # Check if accessing sensitive directory
                if self._is_sensitive_path(file_path):
                    logger.warning("Access to sensitive path denied: %s", file_path)
                    return False

                logger.debug("Permission inherited for path %s", file_path)
                return True

            elif self._volume_type == "user":
                # User Volume permission inheritance
                current_user = self._get_current_username()

                # Check if attempting to access other user's directory
                if len(path_parts) > 1 and path_parts[0] != current_user:
                    logger.warning("User %s attempted to access %s's directory", current_user, path_parts[0])
                    return False

                # Check basic permissions
                return self.check_permission(operation)

            elif self._volume_type == "external":
                # External Volume permission inheritance
                # Check permissions for External Volume
                return self.check_permission(operation)

            else:
                logger.warning("Unknown volume type for permission inheritance: %s", self._volume_type)
                return False

        except Exception:
            logger.exception("Permission inheritance check failed")
            return False

    def _contains_path_traversal(self, file_path: str) -> bool:
        """Check if path contains path traversal attack"""
        # Check common path traversal patterns
        traversal_patterns = [
            "../",
            "..\\",
            "..%2f",
            "..%2F",
            "..%5c",
            "..%5C",
            "%2e%2e%2f",
            "%2e%2e%5c",
            "....//",
            "....\\\\",
        ]

        file_path_lower = file_path.lower()

        for pattern in traversal_patterns:
            if pattern in file_path_lower:
                return True

        # Check absolute path
        if file_path.startswith("/") or file_path.startswith("\\"):
            return True

        # Check Windows drive path
        if len(file_path) >= 2 and file_path[1] == ":":
            return True

        return False

    def _is_sensitive_path(self, file_path: str) -> bool:
        """Check if path is sensitive path"""
        sensitive_patterns = [
            "passwd",
            "shadow",
            "hosts",
            "config",
            "secrets",
            "private",
            "key",
            "certificate",
            "cert",
            "ssl",
            "database",
            "backup",
            "dump",
            "log",
            "tmp",
        ]

        file_path_lower = file_path.lower()

        return any(pattern in file_path_lower for pattern in sensitive_patterns)

    def validate_operation(self, operation: str, dataset_id: str | None = None) -> bool:
        """Validate operation permission

        Args:
            operation: Operation name (save|load|exists|delete|scan)
            dataset_id: Dataset ID

        Returns:
            True if operation is allowed, False otherwise
        """
        operation_mapping = {
            "save": VolumePermission.WRITE,
            "load": VolumePermission.READ,
            "load_once": VolumePermission.READ,
            "load_stream": VolumePermission.READ,
            "download": VolumePermission.READ,
            "exists": VolumePermission.READ,
            "delete": VolumePermission.DELETE,
            "scan": VolumePermission.LIST,
        }

        if operation not in operation_mapping:
            logger.warning("Unknown operation: %s", operation)
            return False

        volume_permission = operation_mapping[operation]
        return self.check_permission(volume_permission, dataset_id)


class VolumePermissionError(Exception):
    """Volume permission error exception"""

    def __init__(self, message: str, operation: str, volume_type: str, dataset_id: str | None = None):
        self.operation = operation
        self.volume_type = volume_type
        self.dataset_id = dataset_id
        super().__init__(message)


def check_volume_permission(permission_manager: VolumePermissionManager, operation: str, dataset_id: str | None = None):
    """Permission check decorator function

    Args:
        permission_manager: Permission manager
        operation: Operation name
        dataset_id: Dataset ID

    Raises:
        VolumePermissionError: If no permission
    """
    if not permission_manager.validate_operation(operation, dataset_id):
        error_message = f"Permission denied for operation '{operation}' on {permission_manager.volume_type} volume"
        if dataset_id:
            error_message += f" (dataset: {dataset_id})"

        raise VolumePermissionError(
            error_message,
            operation=operation,
            volume_type=permission_manager.volume_type or "unknown",
            dataset_id=dataset_id,
        )
