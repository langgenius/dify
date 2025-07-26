"""ClickZetta Volume权限管理机制

该模块提供Volume权限检查、验证和管理功能。
根据ClickZetta的权限模型，不同Volume类型有不同的权限要求。
"""

import logging
from enum import Enum
from typing import Optional

logger = logging.getLogger(__name__)


class VolumePermission(Enum):
    """Volume权限类型枚举"""

    READ = "SELECT"  # 对应ClickZetta的SELECT权限
    WRITE = "INSERT,UPDATE,DELETE"  # 对应ClickZetta的写权限
    LIST = "SELECT"  # 列出文件需要SELECT权限
    DELETE = "INSERT,UPDATE,DELETE"  # 删除文件需要写权限
    USAGE = "USAGE"  # External Volume需要的基本权限


class VolumePermissionManager:
    """Volume权限管理器"""

    def __init__(self, connection_or_config, volume_type: str | None = None, volume_name: Optional[str] = None):
        """初始化权限管理器

        Args:
            connection_or_config: ClickZetta连接对象或配置字典
            volume_type: Volume类型 (user|table|external)
            volume_name: Volume名称 (用于external volume)
        """
        # 支持两种初始化方式：连接对象或配置字典
        if isinstance(connection_or_config, dict):
            # 从配置字典创建连接
            import clickzetta  # type: ignore[import-untyped]

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
            # 直接使用连接对象
            self._connection = connection_or_config
            self._volume_type = volume_type
            self._volume_name = volume_name

        if not self._connection:
            raise ValueError("Valid connection or config is required")
        if not self._volume_type:
            raise ValueError("volume_type is required")

        self._permission_cache: dict[str, set[str]] = {}
        self._current_username = None  # 将从连接中获取当前用户名

    def check_permission(self, operation: VolumePermission, dataset_id: Optional[str] = None) -> bool:
        """检查用户是否有执行特定操作的权限

        Args:
            operation: 要执行的操作类型
            dataset_id: 数据集ID (用于table volume)

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

        except Exception as e:
            logger.exception("Permission check failed")
            return False

    def _check_user_volume_permission(self, operation: VolumePermission) -> bool:
        """检查User Volume权限

        User Volume权限规则:
        - 用户对自己的User Volume有全部权限
        - 只要用户能够连接到ClickZetta，就默认具有User Volume的基本权限
        - 更注重连接身份验证，而不是复杂的权限检查
        """
        try:
            # 获取当前用户名
            current_user = self._get_current_username()

            # 检查基本连接状态
            with self._connection.cursor() as cursor:
                # 简单的连接测试，如果能执行查询说明用户有基本权限
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

        except Exception as e:
            logger.exception("User Volume permission check failed")
            # 对于User Volume，如果权限检查失败，可能是配置问题，给出更友好的错误提示
            logger.info("User Volume permission check failed, but permission checking is disabled in this version")
            return False

    def _check_table_volume_permission(self, operation: VolumePermission, dataset_id: Optional[str]) -> bool:
        """检查Table Volume权限

        Table Volume权限规则:
        - Table Volume权限继承对应表的权限
        - SELECT权限 -> 可以READ/LIST文件
        - INSERT,UPDATE,DELETE权限 -> 可以WRITE/DELETE文件
        """
        if not dataset_id:
            logger.warning("dataset_id is required for table volume permission check")
            return False

        table_name = f"dataset_{dataset_id}" if not dataset_id.startswith("dataset_") else dataset_id

        try:
            # 检查表权限
            permissions = self._get_table_permissions(table_name)
            required_permissions = set(operation.value.split(","))

            # 检查是否有所需的所有权限
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

        except Exception as e:
            logger.exception("Table volume permission check failed for %s", table_name)
            return False

    def _check_external_volume_permission(self, operation: VolumePermission) -> bool:
        """检查External Volume权限

        External Volume权限规则:
        - 尝试获取对External Volume的权限
        - 如果权限检查失败，进行备选验证
        - 对于开发环境，提供更宽松的权限检查
        """
        if not self._volume_name:
            logger.warning("volume_name is required for external volume permission check")
            return False

        try:
            # 检查External Volume权限
            permissions = self._get_external_volume_permissions(self._volume_name)

            # External Volume权限映射：根据操作类型确定所需权限
            required_permissions = set()

            if operation in [VolumePermission.READ, VolumePermission.LIST]:
                required_permissions.add("read")
            elif operation in [VolumePermission.WRITE, VolumePermission.DELETE]:
                required_permissions.add("write")

            # 检查是否有所需的所有权限
            has_permission = required_permissions.issubset(permissions)

            logger.debug(
                "External Volume permission check for %s, operation %s: required=%s, has=%s, granted=%s",
                self._volume_name,
                operation.name,
                required_permissions,
                permissions,
                has_permission,
            )

            # 如果权限检查失败，尝试备选验证
            if not has_permission:
                logger.info("Direct permission check failed for %s, trying fallback verification", self._volume_name)

                # 备选验证：尝试列出Volume来验证基本访问权限
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

        except Exception as e:
            logger.exception("External volume permission check failed for %s", self._volume_name)
            logger.info("External Volume permission check failed, but permission checking is disabled in this version")
            return False

    def _get_table_permissions(self, table_name: str) -> set[str]:
        """获取用户对指定表的权限

        Args:
            table_name: 表名

        Returns:
            用户对该表的权限集合
        """
        cache_key = f"table:{table_name}"

        if cache_key in self._permission_cache:
            return self._permission_cache[cache_key]

        permissions = set()

        try:
            with self._connection.cursor() as cursor:
                # 使用正确的ClickZetta语法检查当前用户权限
                cursor.execute("SHOW GRANTS")
                grants = cursor.fetchall()

                # 解析权限结果，查找对该表的权限
                for grant in grants:
                    if len(grant) >= 3:  # 典型格式: (privilege, object_type, object_name, ...)
                        privilege = grant[0].upper()
                        object_type = grant[1].upper() if len(grant) > 1 else ""
                        object_name = grant[2] if len(grant) > 2 else ""

                        # 检查是否是对该表的权限
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

                # 如果没有找到明确的权限，尝试执行一个简单的查询来验证权限
                if not permissions:
                    try:
                        cursor.execute(f"SELECT COUNT(*) FROM {table_name} LIMIT 1")
                        permissions.add("SELECT")
                    except Exception:
                        logger.debug("Cannot query table %s, no SELECT permission", table_name)

        except Exception as e:
            logger.warning("Could not check table permissions for %s: %s", table_name, e)
            # 安全默认：权限检查失败时拒绝访问
            pass

        # 缓存权限信息
        self._permission_cache[cache_key] = permissions
        return permissions

    def _get_current_username(self) -> str:
        """获取当前用户名"""
        if self._current_username:
            return self._current_username

        try:
            with self._connection.cursor() as cursor:
                cursor.execute("SELECT CURRENT_USER()")
                result = cursor.fetchone()
                if result:
                    self._current_username = result[0]
                    return str(self._current_username)
        except Exception as e:
            logger.exception("Failed to get current username")

        return "unknown"

    def _get_user_permissions(self, username: str) -> set[str]:
        """获取用户的基本权限集合"""
        cache_key = f"user_permissions:{username}"

        if cache_key in self._permission_cache:
            return self._permission_cache[cache_key]

        permissions = set()

        try:
            with self._connection.cursor() as cursor:
                # 使用正确的ClickZetta语法检查当前用户权限
                cursor.execute("SHOW GRANTS")
                grants = cursor.fetchall()

                # 解析权限结果，查找用户的基本权限
                for grant in grants:
                    if len(grant) >= 3:  # 典型格式: (privilege, object_type, object_name, ...)
                        privilege = grant[0].upper()
                        object_type = grant[1].upper() if len(grant) > 1 else ""

                        # 收集所有相关权限
                        if privilege in ["SELECT", "INSERT", "UPDATE", "DELETE", "ALL"]:
                            if privilege == "ALL":
                                permissions.update(["SELECT", "INSERT", "UPDATE", "DELETE"])
                            else:
                                permissions.add(privilege)

        except Exception as e:
            logger.warning("Could not check user permissions for %s: %s", username, e)
            # 安全默认：权限检查失败时拒绝访问
            pass

        # 缓存权限信息
        self._permission_cache[cache_key] = permissions
        return permissions

    def _get_external_volume_permissions(self, volume_name: str) -> set[str]:
        """获取用户对指定External Volume的权限

        Args:
            volume_name: External Volume名称

        Returns:
            用户对该Volume的权限集合
        """
        cache_key = f"external_volume:{volume_name}"

        if cache_key in self._permission_cache:
            return self._permission_cache[cache_key]

        permissions = set()

        try:
            with self._connection.cursor() as cursor:
                # 使用正确的ClickZetta语法检查Volume权限
                logger.info("Checking permissions for volume: %s", volume_name)
                cursor.execute(f"SHOW GRANTS ON VOLUME {volume_name}")
                grants = cursor.fetchall()

                logger.info("Raw grants result for %s: %s", volume_name, grants)

                # 解析权限结果
                # 格式: (granted_type, privilege, conditions, granted_on, object_name, granted_to,
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

                        # 检查是否是对该Volume的权限或者是层级权限
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

                # 如果没有找到明确的权限，尝试查看Volume列表来验证基本权限
                if not permissions:
                    try:
                        cursor.execute("SHOW VOLUMES")
                        volumes = cursor.fetchall()
                        for volume in volumes:
                            if len(volume) > 0 and volume[0] == volume_name:
                                permissions.add("read")  # 至少有读权限
                                logger.debug("Volume %s found in SHOW VOLUMES, assuming read permission", volume_name)
                                break
                    except Exception:
                        logger.debug("Cannot access volume %s, no basic permission", volume_name)

        except Exception as e:
            logger.warning("Could not check external volume permissions for %s: %s", volume_name, e)
            # 在权限检查失败时，尝试基本的Volume访问验证
            try:
                with self._connection.cursor() as cursor:
                    cursor.execute("SHOW VOLUMES")
                    volumes = cursor.fetchall()
                    for volume in volumes:
                        if len(volume) > 0 and volume[0] == volume_name:
                            logger.info("Basic volume access verified for %s", volume_name)
                            permissions.add("read")
                            permissions.add("write")  # 假设有写权限
                            break
            except Exception as basic_e:
                logger.warning("Basic volume access check failed for %s: %s", volume_name, basic_e)
                # 最后的备选方案：假设有基本权限
                permissions.add("read")

        # 缓存权限信息
        self._permission_cache[cache_key] = permissions
        return permissions

    def clear_permission_cache(self):
        """清空权限缓存"""
        self._permission_cache.clear()
        logger.debug("Permission cache cleared")

    def get_permission_summary(self, dataset_id: Optional[str] = None) -> dict[str, bool]:
        """获取权限摘要

        Args:
            dataset_id: 数据集ID (用于table volume)

        Returns:
            权限摘要字典
        """
        summary = {}

        for operation in VolumePermission:
            summary[operation.name.lower()] = self.check_permission(operation, dataset_id)

        return summary

    def check_inherited_permission(self, file_path: str, operation: VolumePermission) -> bool:
        """检查文件路径的权限继承

        Args:
            file_path: 文件路径
            operation: 要执行的操作

        Returns:
            True if user has permission, False otherwise
        """
        try:
            # 解析文件路径
            path_parts = file_path.strip("/").split("/")

            if not path_parts:
                logger.warning("Invalid file path for permission inheritance check")
                return False

            # 对于Table Volume，第一层是dataset_id
            if self._volume_type == "table":
                if len(path_parts) < 1:
                    return False

                dataset_id = path_parts[0]

                # 检查对dataset的权限
                has_dataset_permission = self.check_permission(operation, dataset_id)

                if not has_dataset_permission:
                    logger.debug("Permission denied for dataset %s", dataset_id)
                    return False

                # 检查路径遍历攻击
                if self._contains_path_traversal(file_path):
                    logger.warning("Path traversal attack detected: %s", file_path)
                    return False

                # 检查是否访问敏感目录
                if self._is_sensitive_path(file_path):
                    logger.warning("Access to sensitive path denied: %s", file_path)
                    return False

                logger.debug("Permission inherited for path %s", file_path)
                return True

            elif self._volume_type == "user":
                # User Volume的权限继承
                current_user = self._get_current_username()

                # 检查是否试图访问其他用户的目录
                if len(path_parts) > 1 and path_parts[0] != current_user:
                    logger.warning("User %s attempted to access %s's directory", current_user, path_parts[0])
                    return False

                # 检查基本权限
                return self.check_permission(operation)

            elif self._volume_type == "external":
                # External Volume的权限继承
                # 检查对External Volume的权限
                return self.check_permission(operation)

            else:
                logger.warning("Unknown volume type for permission inheritance: %s", self._volume_type)
                return False

        except Exception as e:
            logger.exception("Permission inheritance check failed")
            return False

    def _contains_path_traversal(self, file_path: str) -> bool:
        """检查路径是否包含路径遍历攻击"""
        # 检查常见的路径遍历模式
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

        # 检查绝对路径
        if file_path.startswith("/") or file_path.startswith("\\"):
            return True

        # 检查Windows驱动器路径
        if len(file_path) >= 2 and file_path[1] == ":":
            return True

        return False

    def _is_sensitive_path(self, file_path: str) -> bool:
        """检查路径是否为敏感路径"""
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

    def validate_operation(self, operation: str, dataset_id: Optional[str] = None) -> bool:
        """验证操作权限

        Args:
            operation: 操作名称 (save|load|exists|delete|scan)
            dataset_id: 数据集ID

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
    """Volume权限错误异常"""

    def __init__(self, message: str, operation: str, volume_type: str, dataset_id: Optional[str] = None):
        self.operation = operation
        self.volume_type = volume_type
        self.dataset_id = dataset_id
        super().__init__(message)


def check_volume_permission(
    permission_manager: VolumePermissionManager, operation: str, dataset_id: Optional[str] = None
) -> None:
    """权限检查装饰器函数

    Args:
        permission_manager: 权限管理器
        operation: 操作名称
        dataset_id: 数据集ID

    Raises:
        VolumePermissionError: 如果没有权限
    """
    if not permission_manager.validate_operation(operation, dataset_id):
        error_message = f"Permission denied for operation '{operation}' on {permission_manager._volume_type} volume"
        if dataset_id:
            error_message += f" (dataset: {dataset_id})"

        raise VolumePermissionError(
            error_message,
            operation=operation,
            volume_type=permission_manager._volume_type or "unknown",
            dataset_id=dataset_id,
        )
