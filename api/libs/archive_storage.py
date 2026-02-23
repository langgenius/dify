"""
Archive Storage Client for S3-compatible storage.

This module provides a dedicated storage client for archiving or exporting logs
to S3-compatible object storage.
"""

import base64
import datetime
import hashlib
import logging
from collections.abc import Generator
from typing import Any, cast

import boto3
import orjson
from botocore.client import Config
from botocore.exceptions import ClientError

from configs import dify_config

logger = logging.getLogger(__name__)


class ArchiveStorageError(Exception):
    """Base exception for archive storage operations."""

    pass


class ArchiveStorageNotConfiguredError(ArchiveStorageError):
    """Raised when archive storage is not properly configured."""

    pass


class ArchiveStorage:
    """
    S3-compatible storage client for archiving or exporting.

    This client provides methods for storing and retrieving archived data in JSONL format.
    """

    def __init__(self, bucket: str):
        if not dify_config.ARCHIVE_STORAGE_ENABLED:
            raise ArchiveStorageNotConfiguredError("Archive storage is not enabled")

        if not bucket:
            raise ArchiveStorageNotConfiguredError("Archive storage bucket is not configured")
        if not all(
            [
                dify_config.ARCHIVE_STORAGE_ENDPOINT,
                bucket,
                dify_config.ARCHIVE_STORAGE_ACCESS_KEY,
                dify_config.ARCHIVE_STORAGE_SECRET_KEY,
            ]
        ):
            raise ArchiveStorageNotConfiguredError(
                "Archive storage configuration is incomplete. "
                "Required: ARCHIVE_STORAGE_ENDPOINT, ARCHIVE_STORAGE_ACCESS_KEY, "
                "ARCHIVE_STORAGE_SECRET_KEY, and a bucket name"
            )

        self.bucket = bucket
        self.client = boto3.client(
            "s3",
            endpoint_url=dify_config.ARCHIVE_STORAGE_ENDPOINT,
            aws_access_key_id=dify_config.ARCHIVE_STORAGE_ACCESS_KEY,
            aws_secret_access_key=dify_config.ARCHIVE_STORAGE_SECRET_KEY,
            region_name=dify_config.ARCHIVE_STORAGE_REGION,
            config=Config(
                s3={"addressing_style": "path"},
                max_pool_connections=64,
            ),
        )

        # Verify bucket accessibility
        try:
            self.client.head_bucket(Bucket=self.bucket)
        except ClientError as e:
            error_code = e.response.get("Error", {}).get("Code")
            if error_code == "404":
                raise ArchiveStorageNotConfiguredError(f"Archive bucket '{self.bucket}' does not exist")
            elif error_code == "403":
                raise ArchiveStorageNotConfiguredError(f"Access denied to archive bucket '{self.bucket}'")
            else:
                raise ArchiveStorageError(f"Failed to access archive bucket: {e}")

    def put_object(self, key: str, data: bytes) -> str:
        """
        Upload an object to the archive storage.

        Args:
            key: Object key (path) within the bucket
            data: Binary data to upload

        Returns:
            MD5 checksum of the uploaded data

        Raises:
            ArchiveStorageError: If upload fails
        """
        checksum = hashlib.md5(data).hexdigest()
        try:
            response = self.client.put_object(
                Bucket=self.bucket,
                Key=key,
                Body=data,
                ContentMD5=self._content_md5(data),
            )
            etag = response.get("ETag")
            if not etag:
                raise ArchiveStorageError(f"Missing ETag for '{key}'")
            normalized_etag = etag.strip('"')
            if normalized_etag != checksum:
                raise ArchiveStorageError(f"ETag mismatch for '{key}': expected={checksum}, actual={normalized_etag}")
            logger.debug("Uploaded object: %s (size=%d, checksum=%s)", key, len(data), checksum)
            return checksum
        except ClientError as e:
            raise ArchiveStorageError(f"Failed to upload object '{key}': {e}")

    def get_object(self, key: str) -> bytes:
        """
        Download an object from the archive storage.

        Args:
            key: Object key (path) within the bucket

        Returns:
            Binary data of the object

        Raises:
            ArchiveStorageError: If download fails
            FileNotFoundError: If object does not exist
        """
        try:
            response = self.client.get_object(Bucket=self.bucket, Key=key)
            return response["Body"].read()
        except ClientError as e:
            error_code = e.response.get("Error", {}).get("Code")
            if error_code == "NoSuchKey":
                raise FileNotFoundError(f"Archive object not found: {key}")
            raise ArchiveStorageError(f"Failed to download object '{key}': {e}")

    def get_object_stream(self, key: str) -> Generator[bytes, None, None]:
        """
        Stream an object from the archive storage.

        Args:
            key: Object key (path) within the bucket

        Yields:
            Chunks of binary data

        Raises:
            ArchiveStorageError: If download fails
            FileNotFoundError: If object does not exist
        """
        try:
            response = self.client.get_object(Bucket=self.bucket, Key=key)
            yield from response["Body"].iter_chunks()
        except ClientError as e:
            error_code = e.response.get("Error", {}).get("Code")
            if error_code == "NoSuchKey":
                raise FileNotFoundError(f"Archive object not found: {key}")
            raise ArchiveStorageError(f"Failed to stream object '{key}': {e}")

    def object_exists(self, key: str) -> bool:
        """
        Check if an object exists in the archive storage.

        Args:
            key: Object key (path) within the bucket

        Returns:
            True if object exists, False otherwise
        """
        try:
            self.client.head_object(Bucket=self.bucket, Key=key)
            return True
        except ClientError:
            return False

    def delete_object(self, key: str) -> None:
        """
        Delete an object from the archive storage.

        Args:
            key: Object key (path) within the bucket

        Raises:
            ArchiveStorageError: If deletion fails
        """
        try:
            self.client.delete_object(Bucket=self.bucket, Key=key)
            logger.debug("Deleted object: %s", key)
        except ClientError as e:
            raise ArchiveStorageError(f"Failed to delete object '{key}': {e}")

    def generate_presigned_url(self, key: str, expires_in: int = 3600) -> str:
        """
        Generate a pre-signed URL for downloading an object.

        Args:
            key: Object key (path) within the bucket
            expires_in: URL validity duration in seconds (default: 1 hour)

        Returns:
            Pre-signed URL string.

        Raises:
            ArchiveStorageError: If generation fails
        """
        try:
            return self.client.generate_presigned_url(
                ClientMethod="get_object",
                Params={"Bucket": self.bucket, "Key": key},
                ExpiresIn=expires_in,
            )
        except ClientError as e:
            raise ArchiveStorageError(f"Failed to generate pre-signed URL for '{key}': {e}")

    def list_objects(self, prefix: str) -> list[str]:
        """
        List objects under a given prefix.

        Args:
            prefix: Object key prefix to filter by

        Returns:
            List of object keys matching the prefix
        """
        keys = []
        paginator = self.client.get_paginator("list_objects_v2")

        try:
            for page in paginator.paginate(Bucket=self.bucket, Prefix=prefix):
                for obj in page.get("Contents", []):
                    keys.append(obj["Key"])
        except ClientError as e:
            raise ArchiveStorageError(f"Failed to list objects with prefix '{prefix}': {e}")

        return keys

    @staticmethod
    def _content_md5(data: bytes) -> str:
        """Calculate base64-encoded MD5 for Content-MD5 header."""
        return base64.b64encode(hashlib.md5(data).digest()).decode()

    @staticmethod
    def serialize_to_jsonl(records: list[dict[str, Any]]) -> bytes:
        """
        Serialize records to JSONL format.

        Args:
            records: List of dictionaries to serialize

        Returns:
            JSONL bytes
        """
        lines = []
        for record in records:
            serialized = ArchiveStorage._serialize_record(record)
            lines.append(orjson.dumps(serialized))

        jsonl_content = b"\n".join(lines)
        if jsonl_content:
            jsonl_content += b"\n"

        return jsonl_content

    @staticmethod
    def deserialize_from_jsonl(data: bytes) -> list[dict[str, Any]]:
        """
        Deserialize JSONL data to records.

        Args:
            data: JSONL bytes

        Returns:
            List of dictionaries
        """
        records = []

        for line in data.splitlines():
            if line:
                records.append(orjson.loads(line))

        return records

    @staticmethod
    def _serialize_record(record: dict[str, Any]) -> dict[str, Any]:
        """Serialize a single record, converting special types."""

        def _serialize(item: Any) -> Any:
            if isinstance(item, datetime.datetime):
                return item.isoformat()
            if isinstance(item, dict):
                return {key: _serialize(value) for key, value in item.items()}
            if isinstance(item, list):
                return [_serialize(value) for value in item]
            return item

        return cast(dict[str, Any], _serialize(record))

    @staticmethod
    def compute_checksum(data: bytes) -> str:
        """Compute MD5 checksum of data."""
        return hashlib.md5(data).hexdigest()


# Singleton instance (lazy initialization)
_archive_storage: ArchiveStorage | None = None
_export_storage: ArchiveStorage | None = None


def get_archive_storage() -> ArchiveStorage:
    """
    Get the archive storage singleton instance.

    Returns:
        ArchiveStorage instance

    Raises:
        ArchiveStorageNotConfiguredError: If archive storage is not configured
    """
    global _archive_storage
    if _archive_storage is None:
        archive_bucket = dify_config.ARCHIVE_STORAGE_ARCHIVE_BUCKET
        if not archive_bucket:
            raise ArchiveStorageNotConfiguredError(
                "Archive storage bucket is not configured. Required: ARCHIVE_STORAGE_ARCHIVE_BUCKET"
            )
        _archive_storage = ArchiveStorage(bucket=archive_bucket)
    return _archive_storage


def get_export_storage() -> ArchiveStorage:
    """
    Get the export storage singleton instance.

    Returns:
        ArchiveStorage instance
    """
    global _export_storage
    if _export_storage is None:
        export_bucket = dify_config.ARCHIVE_STORAGE_EXPORT_BUCKET
        if not export_bucket:
            raise ArchiveStorageNotConfiguredError(
                "Archive export bucket is not configured. Required: ARCHIVE_STORAGE_EXPORT_BUCKET"
            )
        _export_storage = ArchiveStorage(bucket=export_bucket)
    return _export_storage
