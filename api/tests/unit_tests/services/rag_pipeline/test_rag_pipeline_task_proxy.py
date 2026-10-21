from datetime import datetime
from types import SimpleNamespace
from typing import cast
from unittest.mock import Mock

import pytest
from pytest_mock import MockerFixture

from enums import CloudPlan, DeploymentEdition
from extensions.storage.storage_type import StorageType
from models.enums import CreatorUserRole
from models.model import UploadFile
from services.rag_pipeline.entities import RagPipelineInvokeEntity
from services.rag_pipeline.rag_pipeline_task_proxy import RagPipelineTaskProxy
from services.rag_pipeline.tenant_task_queue import (
    RagPipelineTaskClaim,
    RagPipelineTaskTarget,
    RagPipelineTenantTask,
)
from tests.unit_tests.config_override import config_overrides_context


@pytest.fixture
def proxy(mocker: MockerFixture) -> RagPipelineTaskProxy:
    """Create a RagPipelineTaskProxy with mocked dependencies."""
    mocker.patch("services.rag_pipeline.rag_pipeline_task_proxy.RagPipelineTenantTaskQueue")
    entity = RagPipelineInvokeEntity(
        pipeline_id="pipeline-1",
        application_generate_entity={},
        user_id="user-1",
        tenant_id="tenant-1",
        workflow_id="workflow-1",
        streaming=False,
    )
    return RagPipelineTaskProxy(
        dataset_tenant_id="tenant-1",
        user_id="user-1",
        rag_pipeline_invoke_entities=[entity],
    )


# --- delay ---


def test_delay_with_empty_entities_logs_warning_and_returns(mocker: MockerFixture) -> None:
    mocker.patch("services.rag_pipeline.rag_pipeline_task_proxy.RagPipelineTenantTaskQueue")
    proxy = RagPipelineTaskProxy(
        dataset_tenant_id="tenant-1",
        user_id="user-1",
        rag_pipeline_invoke_entities=[],
    )
    dispatch_mock = mocker.patch.object(proxy, "_dispatch")

    proxy.delay()

    dispatch_mock.assert_not_called()


def test_delay_with_entities_calls_dispatch(mocker: MockerFixture, proxy: RagPipelineTaskProxy) -> None:
    dispatch_mock = mocker.patch.object(proxy, "_dispatch")

    proxy.delay()

    dispatch_mock.assert_called_once()


# --- _dispatch ---


@config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
def test_dispatch_billing_sandbox_uses_default_tenant_queue(mocker: MockerFixture, proxy: RagPipelineTaskProxy) -> None:
    upload_mock = mocker.patch.object(proxy, "_upload_invoke_entities", return_value="file-1")
    send_mock = mocker.patch.object(proxy, "_send_to_default_tenant_queue")

    features = SimpleNamespace(billing=SimpleNamespace(subscription=SimpleNamespace(plan=CloudPlan.SANDBOX)))
    mocker.patch.object(type(proxy), "features", new_callable=lambda: property(lambda self: features))

    proxy._dispatch()

    upload_mock.assert_called_once()
    send_mock.assert_called_once_with("file-1")


@config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
def test_dispatch_billing_non_sandbox_uses_priority_tenant_queue(
    mocker: MockerFixture, proxy: RagPipelineTaskProxy
) -> None:
    upload_mock = mocker.patch.object(proxy, "_upload_invoke_entities", return_value="file-1")
    send_mock = mocker.patch.object(proxy, "_send_to_priority_tenant_queue")

    features = SimpleNamespace(billing=SimpleNamespace(subscription=SimpleNamespace(plan=CloudPlan.PROFESSIONAL)))
    mocker.patch.object(type(proxy), "features", new_callable=lambda: property(lambda self: features))

    proxy._dispatch()

    upload_mock.assert_called_once()
    send_mock.assert_called_once_with("file-1")


@config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
def test_dispatch_no_billing_uses_priority_direct_queue(mocker: MockerFixture, proxy: RagPipelineTaskProxy) -> None:
    upload_mock = mocker.patch.object(proxy, "_upload_invoke_entities", return_value="file-1")
    send_mock = mocker.patch.object(proxy, "_send_to_priority_direct_queue")

    features = SimpleNamespace(billing=SimpleNamespace(subscription=SimpleNamespace(plan="free")))
    mocker.patch.object(type(proxy), "features", new_callable=lambda: property(lambda self: features))

    proxy._dispatch()

    upload_mock.assert_called_once()
    send_mock.assert_called_once_with("file-1")


@config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
def test_dispatch_raises_on_empty_upload_file_id(mocker: MockerFixture, proxy: RagPipelineTaskProxy) -> None:
    mocker.patch.object(proxy, "_upload_invoke_entities", return_value="")

    features = SimpleNamespace(billing=SimpleNamespace(subscription=SimpleNamespace(plan="free")))
    mocker.patch.object(type(proxy), "features", new_callable=lambda: property(lambda self: features))

    with pytest.raises(ValueError, match="upload_file_id is empty"):
        proxy._dispatch()


# --- _send_to_direct_queue ---


def test_send_to_direct_queue_calls_task_func_delay(mocker: MockerFixture, proxy: RagPipelineTaskProxy) -> None:
    task_func = Mock()

    proxy._send_to_direct_queue("file-1", task_func)

    task_func.delay.assert_called_once_with(
        rag_pipeline_invoke_entities_file_id="file-1",
        tenant_id="tenant-1",
    )


# --- _send_to_tenant_queue ---


def test_send_to_tenant_queue_persists_before_dispatch(mocker: MockerFixture, proxy: RagPipelineTaskProxy) -> None:
    task = RagPipelineTenantTask(file_id="file-1", target=RagPipelineTaskTarget.REGULAR)
    claim = RagPipelineTaskClaim(receipt="receipt-1", task=task)
    enqueue = cast("Mock", proxy._tenant_isolated_task_queue.enqueue)
    enqueue.return_value = (claim,)
    dispatch = mocker.patch("services.rag_pipeline.rag_pipeline_task_proxy.dispatch_rag_pipeline_claims")

    proxy._send_to_tenant_queue("file-1", RagPipelineTaskTarget.REGULAR)

    enqueue.assert_called_once_with(
        task,
        concurrency=1,
    )
    dispatch.assert_called_once_with(
        tenant_id="tenant-1",
        queue=proxy._tenant_isolated_task_queue,
        claims=(claim,),
    )


def test_send_to_tenant_queue_accepts_when_capacity_is_full(mocker: MockerFixture, proxy: RagPipelineTaskProxy) -> None:
    enqueue = cast("Mock", proxy._tenant_isolated_task_queue.enqueue)
    enqueue.return_value = ()
    dispatch = mocker.patch("services.rag_pipeline.rag_pipeline_task_proxy.dispatch_rag_pipeline_claims")

    proxy._send_to_tenant_queue("file-1", RagPipelineTaskTarget.PRIORITY)

    enqueue.assert_called_once_with(
        RagPipelineTenantTask(file_id="file-1", target=RagPipelineTaskTarget.PRIORITY),
        concurrency=1,
    )
    dispatch.assert_called_once_with(
        tenant_id="tenant-1",
        queue=proxy._tenant_isolated_task_queue,
        claims=(),
    )


def test_send_to_tenant_queue_persists_exact_document_recovery_owner_chain(mocker: MockerFixture) -> None:
    mocker.patch("services.rag_pipeline.rag_pipeline_task_proxy.RagPipelineTenantTaskQueue")
    entity = RagPipelineInvokeEntity(
        pipeline_id="pipeline-1",
        application_generate_entity={"dataset_id": "dataset-1", "document_id": "document-1"},
        user_id="user-1",
        tenant_id="tenant-1",
        workflow_id="workflow-1",
        streaming=False,
        indexing_generation="generation-1",
    )
    proxy = RagPipelineTaskProxy("tenant-1", "user-1", [entity])
    enqueue = cast("Mock", proxy._tenant_isolated_task_queue.enqueue)
    enqueue.return_value = ()
    mocker.patch("services.rag_pipeline.rag_pipeline_task_proxy.dispatch_rag_pipeline_claims")

    proxy._send_to_tenant_queue("file-1", RagPipelineTaskTarget.REGULAR)

    queued = enqueue.call_args.args[0]
    assert queued.document_recoveries[0].model_dump() == {
        "dataset_id": "dataset-1",
        "document_id": "document-1",
        "indexing_generation": "generation-1",
        "actor_id": "user-1",
    }


# --- _upload_invoke_entities ---


def test_upload_invoke_entities_returns_file_id(mocker: MockerFixture, proxy: RagPipelineTaskProxy) -> None:
    upload_file = UploadFile(
        tenant_id="tenant-1",
        storage_type=StorageType.LOCAL,
        key="rag-pipeline.json",
        name="rag-pipeline.json",
        size=1,
        extension="json",
        mime_type="application/json",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="user-1",
        created_at=datetime(2025, 1, 1),
        used=True,
    )
    upload_file.id = "uploaded-file-1"
    file_service_cls = mocker.patch("services.rag_pipeline.rag_pipeline_task_proxy.FileService")
    file_service_cls.return_value.upload_text.return_value = upload_file
    mocker.patch("services.rag_pipeline.rag_pipeline_task_proxy.db", SimpleNamespace(engine="fake-engine"))

    result = proxy._upload_invoke_entities()

    assert result == "uploaded-file-1"
    file_service_cls.return_value.upload_text.assert_called_once()
