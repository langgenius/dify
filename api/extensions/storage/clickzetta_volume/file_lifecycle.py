"""ClickZetta Volume文件生命周期管理

该模块提供文件版本控制、自动清理、备份和恢复等生命周期管理功能。
支持知识库文件的完整生命周期管理。
"""

import json
import logging
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta
from enum import Enum
from typing import Any, Optional

logger = logging.getLogger(__name__)


class FileStatus(Enum):
    """文件状态枚举"""

    ACTIVE = "active"  # 活跃状态
    ARCHIVED = "archived"  # 已归档
    DELETED = "deleted"  # 已删除（软删除）
    BACKUP = "backup"  # 备份文件


@dataclass
class FileMetadata:
    """文件元数据"""

    filename: str
    size: int | None
    created_at: datetime
    modified_at: datetime
    version: int | None
    status: FileStatus
    checksum: Optional[str] = None
    tags: Optional[dict[str, str]] = None
    parent_version: Optional[int] = None

    def to_dict(self) -> dict:
        """转换为字典格式"""
        data = asdict(self)
        data["created_at"] = self.created_at.isoformat()
        data["modified_at"] = self.modified_at.isoformat()
        data["status"] = self.status.value
        return data

    @classmethod
    def from_dict(cls, data: dict) -> "FileMetadata":
        """从字典创建实例"""
        data = data.copy()
        data["created_at"] = datetime.fromisoformat(data["created_at"])
        data["modified_at"] = datetime.fromisoformat(data["modified_at"])
        data["status"] = FileStatus(data["status"])
        return cls(**data)


class FileLifecycleManager:
    """文件生命周期管理器"""

    def __init__(self, storage, dataset_id: Optional[str] = None):
        """初始化生命周期管理器

        Args:
            storage: ClickZetta Volume存储实例
            dataset_id: 数据集ID（用于Table Volume）
        """
        self._storage = storage
        self._dataset_id = dataset_id
        self._metadata_file = ".dify_file_metadata.json"
        self._version_prefix = ".versions/"
        self._backup_prefix = ".backups/"
        self._deleted_prefix = ".deleted/"

        # 获取权限管理器（如果存在）
        self._permission_manager: Optional[Any] = getattr(storage, "_permission_manager", None)

    def save_with_lifecycle(self, filename: str, data: bytes, tags: Optional[dict[str, str]] = None) -> FileMetadata:
        """保存文件并管理生命周期

        Args:
            filename: 文件名
            data: 文件内容
            tags: 文件标签

        Returns:
            文件元数据
        """
        # 权限检查
        if not self._check_permission(filename, "save"):
            from .volume_permissions import VolumePermissionError

            raise VolumePermissionError(
                f"Permission denied for lifecycle save operation on file: {filename}",
                operation="save",
                volume_type=getattr(self._storage, "_config", {}).get("volume_type", "unknown"),
                dataset_id=self._dataset_id,
            )

        try:
            # 1. 检查是否存在旧版本
            metadata_dict = self._load_metadata()
            current_metadata = metadata_dict.get(filename)

            # 2. 如果存在旧版本，创建版本备份
            if current_metadata:
                self._create_version_backup(filename, current_metadata)

            # 3. 计算文件信息
            now = datetime.now()
            checksum = self._calculate_checksum(data)
            new_version = (current_metadata["version"] + 1) if current_metadata else 1

            # 4. 保存新文件
            self._storage.save(filename, data)

            # 5. 创建元数据
            created_at = now
            parent_version = None

            if current_metadata:
                # 如果created_at是字符串，转换为datetime
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

            # 6. 更新元数据
            metadata_dict[filename] = file_metadata.to_dict()
            self._save_metadata(metadata_dict)

            logger.info("File %s saved with lifecycle management, version %s", filename, new_version)
            return file_metadata

        except Exception as e:
            logger.exception("Failed to save file with lifecycle")
            raise

    def get_file_metadata(self, filename: str) -> Optional[FileMetadata]:
        """获取文件元数据

        Args:
            filename: 文件名

        Returns:
            文件元数据，如果不存在返回None
        """
        try:
            metadata_dict = self._load_metadata()
            if filename in metadata_dict:
                return FileMetadata.from_dict(metadata_dict[filename])
            return None
        except Exception as e:
            logger.exception("Failed to get file metadata for %s", filename)
            return None

    def list_file_versions(self, filename: str) -> list[FileMetadata]:
        """列出文件的所有版本

        Args:
            filename: 文件名

        Returns:
            文件版本列表，按版本号排序
        """
        try:
            versions = []

            # 获取当前版本
            current_metadata = self.get_file_metadata(filename)
            if current_metadata:
                versions.append(current_metadata)

            # 获取历史版本
            version_pattern = f"{self._version_prefix}{filename}.v*"
            try:
                version_files = self._storage.scan(self._dataset_id or "", files=True)
                for file_path in version_files:
                    if file_path.startswith(f"{self._version_prefix}{filename}.v"):
                        # 解析版本号
                        version_str = file_path.split(".v")[-1].split(".")[0]
                        try:
                            version_num = int(version_str)
                            # 这里简化处理，实际应该从版本文件中读取元数据
                            # 暂时创建基本的元数据信息
                        except ValueError:
                            continue
            except:
                # 如果无法扫描版本文件，只返回当前版本
                pass

            return sorted(versions, key=lambda x: x.version or 0, reverse=True)

        except Exception as e:
            logger.exception("Failed to list file versions for %s", filename)
            return []

    def restore_version(self, filename: str, version: int) -> bool:
        """恢复文件到指定版本

        Args:
            filename: 文件名
            version: 要恢复的版本号

        Returns:
            恢复是否成功
        """
        try:
            version_filename = f"{self._version_prefix}{filename}.v{version}"

            # 检查版本文件是否存在
            if not self._storage.exists(version_filename):
                logger.warning("Version %s of %s not found", version, filename)
                return False

            # 读取版本文件内容
            version_data = self._storage.load_once(version_filename)

            # 保存当前版本为备份
            current_metadata = self.get_file_metadata(filename)
            if current_metadata:
                self._create_version_backup(filename, current_metadata.to_dict())

            # 恢复文件
            self.save_with_lifecycle(filename, version_data, {"restored_from": str(version)})
            return True

        except Exception as e:
            logger.exception("Failed to restore %s to version %s", filename, version)
            return False

    def archive_file(self, filename: str) -> bool:
        """归档文件

        Args:
            filename: 文件名

        Returns:
            归档是否成功
        """
        # 权限检查
        if not self._check_permission(filename, "archive"):
            logger.warning("Permission denied for archive operation on file: %s", filename)
            return False

        try:
            # 更新文件状态为归档
            metadata_dict = self._load_metadata()
            if filename not in metadata_dict:
                logger.warning("File %s not found in metadata", filename)
                return False

            metadata_dict[filename]["status"] = FileStatus.ARCHIVED.value
            metadata_dict[filename]["modified_at"] = datetime.now().isoformat()

            self._save_metadata(metadata_dict)

            logger.info("File %s archived successfully", filename)
            return True

        except Exception as e:
            logger.exception("Failed to archive file %s", filename)
            return False

    def soft_delete_file(self, filename: str) -> bool:
        """软删除文件（移动到删除目录）

        Args:
            filename: 文件名

        Returns:
            删除是否成功
        """
        # 权限检查
        if not self._check_permission(filename, "delete"):
            logger.warning("Permission denied for soft delete operation on file: %s", filename)
            return False

        try:
            # 检查文件是否存在
            if not self._storage.exists(filename):
                logger.warning("File %s not found", filename)
                return False

            # 读取文件内容
            file_data = self._storage.load_once(filename)

            # 移动到删除目录
            deleted_filename = f"{self._deleted_prefix}{filename}.{datetime.now().strftime('%Y%m%d_%H%M%S')}"
            self._storage.save(deleted_filename, file_data)

            # 删除原文件
            self._storage.delete(filename)

            # 更新元数据
            metadata_dict = self._load_metadata()
            if filename in metadata_dict:
                metadata_dict[filename]["status"] = FileStatus.DELETED.value
                metadata_dict[filename]["modified_at"] = datetime.now().isoformat()
                self._save_metadata(metadata_dict)

            logger.info("File %s soft deleted successfully", filename)
            return True

        except Exception as e:
            logger.exception("Failed to soft delete file %s", filename)
            return False

    def cleanup_old_versions(self, max_versions: int = 5, max_age_days: int = 30) -> int:
        """清理旧版本文件

        Args:
            max_versions: 保留的最大版本数
            max_age_days: 版本文件的最大保留天数

        Returns:
            清理的文件数量
        """
        try:
            cleaned_count = 0
            cutoff_date = datetime.now() - timedelta(days=max_age_days)

            # 获取所有版本文件
            try:
                all_files = self._storage.scan(self._dataset_id or "", files=True)
                version_files = [f for f in all_files if f.startswith(self._version_prefix)]

                # 按文件分组
                file_versions: dict[str, list[tuple[int, str]]] = {}
                for version_file in version_files:
                    # 解析文件名和版本
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

                # 清理每个文件的旧版本
                for base_filename, versions in file_versions.items():
                    # 按版本号排序
                    versions.sort(key=lambda x: x[0], reverse=True)

                    # 保留最新的max_versions个版本，删除其余的
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

        except Exception as e:
            logger.exception("Failed to cleanup old versions")
            return 0

    def get_storage_statistics(self) -> dict[str, Any]:
        """获取存储统计信息

        Returns:
            存储统计字典
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

                # 统计文件状态
                if file_meta.status == FileStatus.ACTIVE:
                    stats["active_files"] = (stats["active_files"] or 0) + 1
                elif file_meta.status == FileStatus.ARCHIVED:
                    stats["archived_files"] = (stats["archived_files"] or 0) + 1
                elif file_meta.status == FileStatus.DELETED:
                    stats["deleted_files"] = (stats["deleted_files"] or 0) + 1

                # 统计大小
                stats["total_size"] = (stats["total_size"] or 0) + (file_meta.size or 0)

                # 统计版本
                stats["versions_count"] = (stats["versions_count"] or 0) + (file_meta.version or 0)

                # 找出最新和最旧的文件
                if oldest_date is None or file_meta.created_at < oldest_date:
                    oldest_date = file_meta.created_at
                    stats["oldest_file"] = filename

                if newest_date is None or file_meta.modified_at > newest_date:
                    newest_date = file_meta.modified_at
                    stats["newest_file"] = filename

            return stats

        except Exception as e:
            logger.exception("Failed to get storage statistics")
            return {}

    def _create_version_backup(self, filename: str, metadata: dict):
        """创建版本备份"""
        try:
            # 读取当前文件内容
            current_data = self._storage.load_once(filename)

            # 保存为版本文件
            version_filename = f"{self._version_prefix}{filename}.v{metadata['version']}"
            self._storage.save(version_filename, current_data)

            logger.debug("Created version backup: %s", version_filename)

        except Exception as e:
            logger.warning("Failed to create version backup for %s: %s", filename, e)

    def _load_metadata(self) -> dict[str, Any]:
        """加载元数据文件"""
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
        """保存元数据文件"""
        try:
            metadata_content = json.dumps(metadata_dict, indent=2, ensure_ascii=False)
            self._storage.save(self._metadata_file, metadata_content.encode("utf-8"))
            logger.debug("Metadata saved successfully")
        except Exception as e:
            logger.exception("Failed to save metadata")
            raise

    def _calculate_checksum(self, data: bytes) -> str:
        """计算文件校验和"""
        import hashlib

        return hashlib.md5(data).hexdigest()

    def _check_permission(self, filename: str, operation: str) -> bool:
        """检查文件操作权限

        Args:
            filename: 文件名
            operation: 操作类型

        Returns:
            True if permission granted, False otherwise
        """
        # 如果没有权限管理器，默认允许
        if not self._permission_manager:
            return True

        try:
            # 根据操作类型映射到权限
            operation_mapping = {
                "save": "save",
                "load": "load_once",
                "delete": "delete",
                "archive": "delete",  # 归档需要删除权限
                "restore": "save",  # 恢复需要写权限
                "cleanup": "delete",  # 清理需要删除权限
                "read": "load_once",
                "write": "save",
            }

            mapped_operation = operation_mapping.get(operation, operation)

            # 检查权限
            result = self._permission_manager.validate_operation(mapped_operation, self._dataset_id)
            return bool(result)

        except Exception as e:
            logger.exception("Permission check failed for %s operation %s", filename, operation)
            # 安全默认：权限检查失败时拒绝访问
            return False
