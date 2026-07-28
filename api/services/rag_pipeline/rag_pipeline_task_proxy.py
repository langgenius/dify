import json
import logging
from collections.abc import Sequence
from functools import cached_property
from typing import Any, Protocol

from core.app.entities.rag_pipeline_invoke_entities import RagPipelineInvokeEntity
from core.rag.pipeline.queue import TenantIsolatedTaskQueue
from enums.cloud_plan import CloudPlan
from extensions.ext_database import db
from services.feature_service import FeatureService
from services.file_service import FileService
from tasks.rag_pipeline.priority_rag_pipeline_run_task import priority_rag_pipeline_run_task
from tasks.rag_pipeline.rag_pipeline_run_task import rag_pipeline_run_task

logger = logging.getLogger(__name__)


class _CeleryTask(Protocol):
    def delay(self, *args: Any, **kwargs: Any) -> Any: ...


class RagPipelineTaskProxy:
    # Default uploaded file name for rag pipeline invoke entities
    _RAG_PIPELINE_INVOKE_ENTITIES_FILE_NAME = "rag_pipeline_invoke_entities.json"

    def __init__(
        self, dataset_tenant_id: str, user_id: str, rag_pipeline_invoke_entities: Sequence[RagPipelineInvokeEntity]
    ):
        self._dataset_tenant_id = dataset_tenant_id
        self._user_id = user_id
        self._rag_pipeline_invoke_entities = rag_pipeline_invoke_entities
        self._tenant_isolated_task_queue = TenantIsolatedTaskQueue(dataset_tenant_id, "pipeline")

    @cached_property
    def features(self):
        return FeatureService.get_features(self._dataset_tenant_id, exclude_vector_space=True)

    def _upload_invoke_entities(self, *, tenant_isolated: bool | None = None) -> str:
        text = []
        for item in self._rag_pipeline_invoke_entities:
            payload = item.model_dump()
            if tenant_isolated is not None:
                payload["tenant_isolated"] = tenant_isolated
            text.append(payload)
        # Convert list to proper JSON string
        json_text = json.dumps(text)
        upload_file = FileService(db.engine).upload_text(
            json_text, self._RAG_PIPELINE_INVOKE_ENTITIES_FILE_NAME, self._user_id, self._dataset_tenant_id
        )
        logger.info(
            "tenant %s upload %d invoke entities", self._dataset_tenant_id, len(self._rag_pipeline_invoke_entities)
        )
        return upload_file.id

    def _send_to_direct_queue(self, upload_file_id: str, task_func: _CeleryTask):
        logger.info("tenant %s send file %s to direct queue", self._dataset_tenant_id, upload_file_id)
        task_func.delay(
            rag_pipeline_invoke_entities_file_id=upload_file_id,
            tenant_id=self._dataset_tenant_id,
        )

    def _send_to_tenant_queue(self, upload_file_id: str, task_func: _CeleryTask):
        logger.info("tenant %s send file %s to tenant queue", self._dataset_tenant_id, upload_file_id)
        if not self._tenant_isolated_task_queue.enqueue_or_acquire(upload_file_id):
            logger.info("tenant %s push tasks: %s", self._dataset_tenant_id, upload_file_id)
        else:
            task_func.delay(
                rag_pipeline_invoke_entities_file_id=upload_file_id,
                tenant_id=self._dataset_tenant_id,
            )
            logger.info("tenant %s init tasks: %s", self._dataset_tenant_id, upload_file_id)

    def _send_to_default_tenant_queue(self, upload_file_id: str):
        self._send_to_tenant_queue(upload_file_id, rag_pipeline_run_task)

    def _send_to_priority_tenant_queue(self, upload_file_id: str):
        self._send_to_tenant_queue(upload_file_id, priority_rag_pipeline_run_task)

    def _send_to_priority_direct_queue(self, upload_file_id: str):
        self._send_to_direct_queue(upload_file_id, priority_rag_pipeline_run_task)

    def _dispatch(self):
        if self.features.billing.enabled:
            tenant_isolated = True
            send = (
                self._send_to_default_tenant_queue
                if self.features.billing.subscription.plan == CloudPlan.SANDBOX
                else self._send_to_priority_tenant_queue
            )
        else:
            tenant_isolated = False
            send = self._send_to_priority_direct_queue

        upload_file_id = self._upload_invoke_entities(tenant_isolated=tenant_isolated)
        if not upload_file_id:
            raise ValueError("upload_file_id is empty")

        logger.info(
            "dispatch args: %s - %s - %s",
            self._dataset_tenant_id,
            self.features.billing.enabled,
            self.features.billing.subscription.plan,
        )

        send(upload_file_id)

    def delay(self):
        if not self._rag_pipeline_invoke_entities:
            logger.warning(
                "Received empty rag pipeline invoke entities, no tasks delivered: %s %s",
                self._dataset_tenant_id,
                self._user_id,
            )
            return
        self._dispatch()
