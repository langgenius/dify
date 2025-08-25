import base64
import hashlib
import json
import logging
import os
import uuid as uuid_module
from datetime import UTC, datetime, time
from typing import Any, Optional

from flask import g

from configs import dify_config
from configs.scheduler_config import upload_scheduler_config
from core.file import helpers as file_helpers
from extensions.ext_redis import redis_client
from extensions.ext_storage import storage
from models.enums import CreatorUserRole
from models.model import UploadFile
from services.errors.file import UploadQueueFullError

logger = logging.getLogger(__name__)


class UploadSchedulerService:
    """Service for managing document upload scheduling."""

    QUEUE_KEY_PREFIX = "document_upload_queue:"
    PROCESSING_SET_PREFIX = "document_upload_processing:"
    RATE_COUNTER_PREFIX = "document_upload_rate:"

    @classmethod
    def get_scheduler_config(cls):
        """Get scheduler configuration."""
        return upload_scheduler_config

    @classmethod
    def _encode_file_data(cls, file_data: dict[str, Any], tenant_id: str) -> dict[str, Any]:
        """Encode file data for JSON serialization."""
        encoded_data = file_data.copy()

        encoded_data["tenant_id"] = tenant_id

        if "content" in encoded_data and isinstance(encoded_data["content"], bytes):
            encoded_data["content"] = base64.b64encode(encoded_data["content"]).decode("utf-8")
            encoded_data["_content_encoded"] = True
        if "user" in encoded_data and hasattr(encoded_data["user"], "id"):
            encoded_data["user_id"] = encoded_data["user"].id
            del encoded_data["user"]
            encoded_data["_user_encoded"] = True
        return encoded_data

    @classmethod
    def _decode_file_data(cls, file_data: dict[str, Any], tenant_id: str) -> dict[str, Any]:
        """Decode file data from JSON."""
        from extensions.ext_database import db
        from models.account import Account

        decoded_data = file_data.copy()

        # Decode base64 content back to bytes
        if decoded_data.get("_content_encoded") and "content" in decoded_data:
            decoded_data["content"] = base64.b64decode(decoded_data["content"].encode("utf-8"))
            del decoded_data["_content_encoded"]

        # Reconstruct user object from user_id
        if decoded_data.get("_user_encoded") and "user_id" in decoded_data:
            user = db.session.query(Account).where(Account.id == decoded_data["user_id"]).first()
            if user:
                user.set_tenant_id(tenant_id)
                g.current_user = user
                decoded_data["user"] = user
            del decoded_data["user_id"]
            del decoded_data["_user_encoded"]

        return decoded_data

    @classmethod
    def enqueue_upload(
        cls,
        tenant_id: str,
        dataset_id: str,
        file_data: dict[str, Any],
        upload_args: Optional[dict[str, Any]] = None,
        priority: int = 0,
    ) -> str:
        # If scheduler is disabled, process immediately
        if not upload_scheduler_config.enabled:
            return cls._process_upload(tenant_id, dataset_id, file_data, upload_args or {})

        config = cls.get_scheduler_config()
        queue_key = f"{cls.QUEUE_KEY_PREFIX}{tenant_id}"

        queue_size = redis_client.zcard(queue_key)
        if queue_size >= config.max_queue_size:
            raise UploadQueueFullError()

        # Check rate limits
        # if cls._check_rate_limit(tenant_id, config): (only to test)
        if not cls._check_rate_limit(tenant_id, config):
            # If rate limit exceeded, add to queue
            task_id = cls._generate_task_id()
            score = datetime.now(UTC).replace(tzinfo=None).timestamp() + (-priority)

            encoded_file_data = cls._encode_file_data(file_data, tenant_id)
            redis_client.zadd(
                queue_key,
                {
                    json.dumps(
                        {
                            "task_id": task_id,
                            "dataset_id": dataset_id,
                            "file_data": encoded_file_data,
                            "upload_args": upload_args or {},
                            "tenant_id": tenant_id,
                        }
                    ): score
                },
            )

            return task_id

        # If within rate limits, process immediately
        return cls._process_upload(tenant_id, dataset_id, file_data, upload_args or {})

    @classmethod
    def _check_rate_limit(cls, tenant_id: str, config) -> bool:
        """Check if current upload rate is within limits."""
        now = datetime.now(UTC).replace(tzinfo=None)
        counter_key = f"{cls.RATE_COUNTER_PREFIX}{tenant_id}"
        current_rate_limit = cls._get_current_rate_limit(now.time(), config)
        window_start = now.timestamp() - (config.time_window_minutes * 60)
        upload_count = redis_client.zcount(counter_key, window_start, float("inf"))
        return bool(upload_count < current_rate_limit)

    @classmethod
    def _get_current_rate_limit(cls, current_time: time, config) -> int:
        """Get rate limit based on current time."""
        if not config.peak_hours_start or not config.peak_hours_end:
            return int(config.off_peak_rate_limit)
        if config.peak_hours_start <= current_time <= config.peak_hours_end:
            return int(config.peak_rate_limit)
        return int(config.off_peak_rate_limit)

    @classmethod
    def _generate_task_id(cls) -> str:
        """Generate unique task ID."""
        from uuid import uuid4

        return str(uuid4())

    @classmethod
    def _process_upload(
        cls, tenant_id: str, dataset_id: str, file_data: dict[str, Any], upload_args: dict[str, Any]
    ) -> str:
        """Process an upload immediately with full document creation."""
        from extensions.ext_database import db
        from models.dataset import Dataset
        from services.dataset_service import DocumentService
        from services.entities.knowledge_entities.knowledge_entities import KnowledgeConfig

        counter_key = f"{cls.RATE_COUNTER_PREFIX}{tenant_id}"
        current_timestamp = datetime.now(UTC).replace(tzinfo=None).timestamp()
        redis_client.zadd(counter_key, {str(current_timestamp): current_timestamp})

        time_window_minutes = upload_scheduler_config.time_window_minutes or 60
        window_start = current_timestamp - (time_window_minutes * 60)
        redis_client.zremrangebyscore(counter_key, 0, window_start)

        dataset = db.session.query(Dataset).filter(Dataset.tenant_id == tenant_id, Dataset.id == dataset_id).first()
        if not dataset:
            raise ValueError("Dataset does not exist.")
        if dataset.provider == "external":
            raise ValueError("External datasets are not supported.")
        args = {
            "doc_form": "text_model",
            "doc_language": "English",
            "indexing_technique": dataset.indexing_technique,
            **upload_args,
        }
        file_uuid = str(uuid_module.uuid4())
        extension = os.path.splitext(file_data["filename"])[1].lstrip(".").lower()
        file_size = len(file_data["content"])
        file_key = f"upload_files/{tenant_id}/{file_uuid}.{extension}"
        storage.save(file_key, file_data["content"])

        upload_file = UploadFile(
            tenant_id=tenant_id,
            storage_type=dify_config.STORAGE_TYPE,
            key=file_key,
            name=file_data["filename"],
            size=file_size,
            extension=extension,
            mime_type=file_data["mimetype"],
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=file_data["user"].id,
            created_at=datetime.now(UTC).replace(tzinfo=None),
            used=False,
            hash=hashlib.sha3_256(file_data["content"]).hexdigest(),
            source_url=file_data.get("source_url", ""),
        )

        db.session.add(upload_file)
        db.session.commit()

        if not upload_file.source_url:
            upload_file.source_url = file_helpers.get_signed_file_url(upload_file_id=upload_file.id)
            db.session.commit()

        data_source = {
            "type": "upload_file",
            "info_list": {"data_source_type": "upload_file", "file_info_list": {"file_ids": [upload_file.id]}},
        }
        args["data_source"] = data_source

        knowledge_config = KnowledgeConfig(**args)
        DocumentService.document_create_args_validate(knowledge_config)

        dataset_process_rule = dataset.latest_process_rule if "process_rule" not in args else None

        try:
            documents, _ = DocumentService.save_document_with_dataset_id(
                dataset=dataset,
                knowledge_config=knowledge_config,
                account=file_data["user"],
                dataset_process_rule=dataset_process_rule,
                created_from="api",
            )

            document = documents[0]
            return str(document.id)

        except Exception as e:
            try:
                db.session.delete(upload_file)
                db.session.commit()
            except Exception:
                pass
            raise e

    @classmethod
    def process_queue(cls, tenant_id: str) -> list[str]:
        """
        Process pending uploads in queue.

        Returns:
            List[str]: List of processed task IDs
        """
        if not upload_scheduler_config.enabled:
            return []

        config = cls.get_scheduler_config()
        queue_key = f"{cls.QUEUE_KEY_PREFIX}{tenant_id}"
        processing_key = f"{cls.PROCESSING_SET_PREFIX}{tenant_id}"

        processed_tasks = []

        batch_size = config.queue_processing_batch_size

        for _ in range(batch_size):
            # Atomically pop the highest priority task
            task_result = redis_client.zpopmin(queue_key, count=1)
            if not task_result:
                break  # No more tasks in queue

            task_data_json, score = task_result[0]
            task_data = json.loads(task_data_json)

            try:
                # Add in processing set
                redis_client.sadd(processing_key, task_data["task_id"])

                decoded_file_data = cls._decode_file_data(task_data["file_data"], task_data["tenant_id"])
                cls._process_upload(
                    task_data["tenant_id"], task_data["dataset_id"], decoded_file_data, task_data["upload_args"]
                )

                # Remove from processing set
                redis_client.srem(processing_key, task_data["task_id"])

                processed_tasks.append(task_data["task_id"])

            except Exception as e:
                redis_client.srem(processing_key, task_data["task_id"])
                logger.exception("Error processing task %s: %s", task_data["task_id"], str(e))
                continue

        return processed_tasks
