import json
import logging
from collections.abc import Callable
from functools import cached_property

from core.app.entities.rag_pipeline_invoke_entities import RagPipelineInvokeEntity
from core.rag.pipeline.queue import TenantSelfTaskQueue
from extensions.ext_database import db
from services.feature_service import FeatureService
from services.file_service import FileService
from tasks.rag_pipeline.priority_rag_pipeline_run_task import priority_rag_pipeline_run_task
from tasks.rag_pipeline.rag_pipeline_run_task import rag_pipeline_run_task

logger = logging.getLogger(__name__)


class RagPipelineTaskProxy:
    def __init__(
        self, dataset_tenant_id: str, user_id: str, rag_pipeline_invoke_entities: list[RagPipelineInvokeEntity]
    ):
        self.dataset_tenant_id = dataset_tenant_id
        self.user_id = user_id
        self.rag_pipeline_invoke_entities = rag_pipeline_invoke_entities
        self.tenant_self_pipeline_task_queue = TenantSelfTaskQueue(dataset_tenant_id, "pipeline")

    @cached_property
    def features(self):
        return FeatureService.get_features(self.dataset_tenant_id)
    
    def _upload_invoke_entities(self) -> str:
        text = [item.model_dump() for item in self.rag_pipeline_invoke_entities]
        name = "rag_pipeline_invoke_entities.json"
        # Convert list to proper JSON string
        json_text = json.dumps(text)
        upload_file = FileService(db.engine).upload_text(json_text, name, self.user_id, self.dataset_tenant_id)
        return upload_file.id
    
    def _send_to_direct_queue(self, upload_file_id: str, task_func: Callable):
        logger.info("send file %s to direct queue", upload_file_id)
        task_func.delay(  # type: ignore
            rag_pipeline_invoke_entities_file_id=upload_file_id,
            tenant_id=self.dataset_tenant_id,
        )

    def _send_to_tenant_queue(self, upload_file_id: str, task_func: Callable):
        logger.info("send file %s to tenant queue", upload_file_id)
        if self.tenant_self_pipeline_task_queue.get_task_key():
            # Add to waiting queue using List operations (lpush)
            self.tenant_self_pipeline_task_queue.push_tasks([upload_file_id])
            logger.info("push tasks: %s", upload_file_id)
        else:
            # Set flag and execute task
            self.tenant_self_pipeline_task_queue.set_task_waiting_time()
            task_func.delay(  # type: ignore
                rag_pipeline_invoke_entities_file_id=upload_file_id,
                tenant_id=self.dataset_tenant_id,
            )
            logger.info("init tasks: %s", upload_file_id)

    def _send_to_default_tenant_queue(self, upload_file_id: str):
        self._send_to_tenant_queue(upload_file_id, rag_pipeline_run_task)

    def _send_to_priority_tenant_queue(self, upload_file_id: str):
        self._send_to_tenant_queue(upload_file_id, priority_rag_pipeline_run_task)

    def _send_to_priority_direct_queue(self, upload_file_id: str):
        self._send_to_direct_queue(upload_file_id, priority_rag_pipeline_run_task)

    def _dispatch(self):
        upload_file_id = self._upload_invoke_entities()
        if not upload_file_id:
            raise ValueError("upload_file_id is empty")

        logger.info(
            "dispatch args: %s - %s - %s",
            self.dataset_tenant_id,
            self.features.billing.enabled,
            self.features.billing.subscription.plan
        )

        # dispatch to different pipeline queue with tenant isolation when billing enabled
        if self.features.billing.enabled:
            if self.features.billing.subscription.plan == "sandbox":
                # dispatch to normal pipeline queue with tenant isolation for sandbox plan
                self._send_to_default_tenant_queue(upload_file_id)
            else:
                # dispatch to priority pipeline queue with tenant isolation for other plans
                self._send_to_priority_tenant_queue(upload_file_id)
        else:
            # dispatch to priority pipeline queue without tenant isolation for others, e.g.: self-hosted or enterprise
            self._send_to_priority_direct_queue(upload_file_id)

    def delay(self):
        if not self.rag_pipeline_invoke_entities:
            logger.warning(
                "Received empty rag pipeline invoke entities, no tasks delivered: %s %s",
                self.dataset_tenant_id,
                self.user_id
            )
            return
        self._dispatch()
