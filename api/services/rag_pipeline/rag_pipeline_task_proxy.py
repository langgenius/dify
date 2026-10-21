import json
import logging
from collections.abc import Sequence
from functools import cached_property

from celery import signature
from celery.canvas import Signature

from configs import dify_config
from enums import CloudPlan, DeploymentEdition
from extensions.ext_database import db
from services.feature_service import FeatureService
from services.file_service import FileService
from services.rag_pipeline.entities import (
    RagPipelineInvokeBatch,
    RagPipelineInvokeEntity,
    RagPipelineWorkflowSnapshot,
    collect_pipeline_document_recoveries,
)
from services.rag_pipeline.tenant_task_queue import (
    RagPipelineTaskProtocol,
    RagPipelineTaskTarget,
    RagPipelineTenantTask,
    RagPipelineTenantTaskQueue,
    dispatch_rag_pipeline_claims,
)

logger = logging.getLogger(__name__)


class RagPipelineTaskProxy:
    # Default uploaded file name for rag pipeline invoke entities
    _RAG_PIPELINE_INVOKE_ENTITIES_FILE_NAME = "rag_pipeline_invoke_entities.json"

    def __init__(
        self,
        dataset_tenant_id: str,
        user_id: str,
        rag_pipeline_invoke_entities: Sequence[RagPipelineInvokeEntity],
        *,
        workflow_snapshot: RagPipelineWorkflowSnapshot | None = None,
    ):
        self._dataset_tenant_id = dataset_tenant_id
        self._user_id = user_id
        self._rag_pipeline_invoke_entities = rag_pipeline_invoke_entities
        self._workflow_snapshot = workflow_snapshot
        self._tenant_isolated_task_queue = RagPipelineTenantTaskQueue(dataset_tenant_id)

    @cached_property
    def features(self):
        return FeatureService.get_features(self._dataset_tenant_id, exclude_vector_space=True)

    def _upload_invoke_entities(self) -> str:
        if self._workflow_snapshot is None:
            payload: object = [item.model_dump(mode="json") for item in self._rag_pipeline_invoke_entities]
        else:
            payload = RagPipelineInvokeBatch(
                workflow_snapshot=self._workflow_snapshot,
                invoke_entities=list(self._rag_pipeline_invoke_entities),
            ).model_dump(mode="json", exclude_none=True)
        json_text = json.dumps(payload)
        upload_file = FileService(db.engine).upload_text(
            json_text, self._RAG_PIPELINE_INVOKE_ENTITIES_FILE_NAME, self._user_id, self._dataset_tenant_id
        )
        logger.info(
            "tenant %s upload %d invoke entities", self._dataset_tenant_id, len(self._rag_pipeline_invoke_entities)
        )
        return upload_file.id

    @property
    def _task_protocol(self) -> RagPipelineTaskProtocol:
        if self._workflow_snapshot is None:
            return RagPipelineTaskProtocol.LEGACY_LIST
        return RagPipelineTaskProtocol.SNAPSHOT_BATCH_V2

    def _send_to_direct_queue(self, upload_file_id: str, task_func: Signature):
        logger.info("tenant %s send file %s to direct queue", self._dataset_tenant_id, upload_file_id)
        task_func.delay(
            rag_pipeline_invoke_entities_file_id=upload_file_id,
            tenant_id=self._dataset_tenant_id,
        )

    def _send_to_tenant_queue(self, upload_file_id: str, target: RagPipelineTaskTarget) -> None:
        logger.info("tenant %s send file %s to tenant queue", self._dataset_tenant_id, upload_file_id)
        document_recoveries = collect_pipeline_document_recoveries(
            self._rag_pipeline_invoke_entities,
            tenant_id=self._dataset_tenant_id,
        )
        claims = self._tenant_isolated_task_queue.enqueue(
            RagPipelineTenantTask(
                file_id=upload_file_id,
                target=target,
                protocol=self._task_protocol,
                document_recoveries=document_recoveries,
            ),
            concurrency=dify_config.TENANT_ISOLATED_TASK_CONCURRENCY,
        )
        dispatched = dispatch_rag_pipeline_claims(
            tenant_id=self._dataset_tenant_id,
            queue=self._tenant_isolated_task_queue,
            claims=claims,
        )
        logger.info(
            "tenant %s accepted file %s and dispatched %d task(s)",
            self._dataset_tenant_id,
            upload_file_id,
            dispatched,
        )

    def _send_to_default_tenant_queue(self, upload_file_id: str):
        self._send_to_tenant_queue(upload_file_id, RagPipelineTaskTarget.REGULAR)

    def _send_to_priority_tenant_queue(self, upload_file_id: str):
        self._send_to_tenant_queue(upload_file_id, RagPipelineTaskTarget.PRIORITY)

    def _send_to_priority_direct_queue(self, upload_file_id: str):
        task = RagPipelineTenantTask(
            file_id=upload_file_id,
            target=RagPipelineTaskTarget.PRIORITY,
            protocol=self._task_protocol,
        )
        self._send_to_direct_queue(
            upload_file_id,
            signature(
                task.task_name,
                queue=task.queue_name,
            ),
        )

    def _dispatch(self):
        upload_file_id = self._upload_invoke_entities()
        if not upload_file_id:
            raise ValueError("upload_file_id is empty")

        logger.info("Dispatching tenant %s in %s", self._dataset_tenant_id, dify_config.DEPLOYMENT_EDITION)

        # Cloud queues isolate tenants and prioritize paid plans.
        if dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD:
            if self.features.billing.subscription.plan == CloudPlan.SANDBOX:
                # dispatch to normal pipeline queue with tenant isolation for sandbox plan
                self._send_to_default_tenant_queue(upload_file_id)
            else:
                # dispatch to priority pipeline queue with tenant isolation for other plans
                self._send_to_priority_tenant_queue(upload_file_id)
        else:
            # dispatch to priority pipeline queue without tenant isolation for others, e.g.: self-hosted or enterprise
            self._send_to_priority_direct_queue(upload_file_id)

    def delay(self):
        if not self._rag_pipeline_invoke_entities:
            logger.warning(
                "Received empty rag pipeline invoke entities, no tasks delivered: %s %s",
                self._dataset_tenant_id,
                self._user_id,
            )
            return
        self._dispatch()
