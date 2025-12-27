"""
Archive Storage Client for S3-compatible storage.

This module provides a dedicated storage client for archiving workflow run logs
to S3-compatible object storage.
"""

import datetime
import gzip
import hashlib
import json
import logging
from collections.abc import Generator
from typing import Any

import boto3
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
    S3-compatible storage client for archiving workflow logs.

    This client provides methods for storing and retrieving archived workflow
    run data in JSONL+gzip format.
    """

    def __init__(self):
        if not dify_config.ARCHIVE_STORAGE_ENABLED:
            raise ArchiveStorageNotConfiguredError("Archive storage is not enabled")

        if not all(
            [
                dify_config.ARCHIVE_STORAGE_ENDPOINT,
                dify_config.ARCHIVE_STORAGE_BUCKET,
                dify_config.ARCHIVE_STORAGE_ACCESS_KEY,
                dify_config.ARCHIVE_STORAGE_SECRET_KEY,
            ]
        ):
            raise ArchiveStorageNotConfiguredError(
                "Archive storage configuration is incomplete. "
                "Required: ARCHIVE_STORAGE_ENDPOINT, ARCHIVE_STORAGE_BUCKET, "
                "ARCHIVE_STORAGE_ACCESS_KEY, ARCHIVE_STORAGE_SECRET_KEY"
            )

        self.bucket = dify_config.ARCHIVE_STORAGE_BUCKET
        self.client = boto3.client(
            "s3",
            endpoint_url=dify_config.ARCHIVE_STORAGE_ENDPOINT,
            aws_access_key_id=dify_config.ARCHIVE_STORAGE_ACCESS_KEY,
            aws_secret_access_key=dify_config.ARCHIVE_STORAGE_SECRET_KEY,
            region_name=dify_config.ARCHIVE_STORAGE_REGION,
            config=Config(s3={"addressing_style": "path"}),
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
            self.client.put_object(
                Bucket=self.bucket,
                Key=key,
                Body=data,
                ContentMD5=self._content_md5(data),
            )
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
        import base64

        return base64.b64encode(hashlib.md5(data).digest()).decode()

    @staticmethod
    def serialize_to_jsonl_gz(records: list[dict[str, Any]]) -> bytes:
        """
        Serialize records to gzipped JSONL format.

        Args:
            records: List of dictionaries to serialize

        Returns:
            Gzipped JSONL bytes
        """
        lines = []
        for record in records:
            # Convert datetime objects to ISO format strings
            serialized = ArchiveStorage._serialize_record(record)
            lines.append(json.dumps(serialized, ensure_ascii=False, default=str))

        jsonl_content = "\n".join(lines)
        if jsonl_content:
            jsonl_content += "\n"

        return gzip.compress(jsonl_content.encode("utf-8"))

    @staticmethod
    def deserialize_from_jsonl_gz(data: bytes) -> list[dict[str, Any]]:
        """
        Deserialize gzipped JSONL data to records.

        Args:
            data: Gzipped JSONL bytes

        Returns:
            List of dictionaries
        """
        jsonl_content = gzip.decompress(data).decode("utf-8")
        records = []

        for line in jsonl_content.strip().split("\n"):
            if line:
                records.append(json.loads(line))

        return records

    @staticmethod
    def _serialize_record(record: dict[str, Any]) -> dict[str, Any]:
        """Serialize a single record, converting special types."""
        from datetime import datetime

        result = {}
        for key, value in record.items():
            if isinstance(value, datetime):
                result[key] = value.isoformat()
            elif isinstance(value, dict):
                result[key] = ArchiveStorage._serialize_record(value)
            elif isinstance(value, list):
                result[key] = [
                    ArchiveStorage._serialize_record(v) if isinstance(v, dict) else v for v in value
                ]
            else:
                result[key] = value
        return result

    @staticmethod
    def compute_checksum(data: bytes) -> str:
        """Compute MD5 checksum of data."""
        return hashlib.md5(data).hexdigest()


# Singleton instance (lazy initialization)
_archive_storage: ArchiveStorage | None = None


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
        _archive_storage = ArchiveStorage()
    return _archive_storage


def build_workflow_run_prefix(
    *,
    tenant_id: str,
    app_id: str,
    created_at: datetime.datetime | None,
    run_id: str,
) -> str:
    archive_time = created_at or datetime.datetime.now(datetime.UTC)
    year = archive_time.strftime("%Y")
    month = archive_time.strftime("%m")
    return (
        f"{tenant_id}/app_id={app_id}/year={year}/month={month}/workflow_run_id={run_id}"
    )
