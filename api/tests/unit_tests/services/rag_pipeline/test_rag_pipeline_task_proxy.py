from datetime import datetime
from types import SimpleNamespace
from typing import cast
from unittest.mock import MagicMock, Mock, create_autospec

import pytest
from celery.canvas import Signature
from pytest_mock import MockerFixture

from enums import CloudPlan, DeploymentEdition
from enums.creator import CreatorUserRole
from services.entities.upload_file import FileUploadActor, UploadFileRecord
from services.file_service import FileService
from services.rag_pipeline.rag_pipeline_task_proxy import RagPipelineTaskProxy
from tests.helpers.unit.config_override import config_overrides_context


@pytest.fixture
def file_service() -> MagicMock:
    return create_autospec(FileService, instance=True, spec_set=True)


@pytest.fixture
def proxy(mocker: MockerFixture, file_service: MagicMock) -> RagPipelineTaskProxy:
    """Create a proxy with its file and queue adapters supplied explicitly."""
    mocker.patch("services.rag_pipeline.rag_pipeline_task_proxy.TenantIsolatedTaskQueue")
    entity = Mock()
    entity.model_dump.return_value = {"doc": "data"}
    return RagPipelineTaskProxy(
        dataset_tenant_id="tenant-1",
        user_id="user-1",
        rag_pipeline_invoke_entities=[entity],
        files=cast(FileService, file_service),
    )


def test_delay_with_empty_entities_logs_warning_and_returns(
    mocker: MockerFixture,
    file_service: MagicMock,
) -> None:
    mocker.patch("services.rag_pipeline.rag_pipeline_task_proxy.TenantIsolatedTaskQueue")
    proxy = RagPipelineTaskProxy(
        dataset_tenant_id="tenant-1",
        user_id="user-1",
        rag_pipeline_invoke_entities=[],
        files=cast(FileService, file_service),
    )
    dispatch_mock = mocker.patch.object(proxy, "_dispatch")

    proxy.delay()

    dispatch_mock.assert_not_called()


def test_delay_with_entities_calls_dispatch(mocker: MockerFixture, proxy: RagPipelineTaskProxy) -> None:
    dispatch_mock = mocker.patch.object(proxy, "_dispatch")

    proxy.delay()

    dispatch_mock.assert_called_once()


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


def test_send_to_direct_queue_calls_task_func_delay(proxy: RagPipelineTaskProxy) -> None:
    task_func = Mock()

    proxy._send_to_direct_queue("file-1", cast(Signature[object], task_func))

    task_func.delay.assert_called_once_with(
        rag_pipeline_invoke_entities_file_id="file-1",
        tenant_id="tenant-1",
    )


def test_send_to_tenant_queue_pushes_when_task_key_exists(proxy: RagPipelineTaskProxy) -> None:
    queue = cast(MagicMock, proxy._tenant_isolated_task_queue)
    queue.get_task_key.return_value = "existing-key"
    task_func = create_autospec(Signature, instance=True, spec_set=True)

    proxy._send_to_tenant_queue("file-1", cast(Signature[object], task_func))

    queue.push_tasks.assert_called_once_with(["file-1"])
    task_func.delay.assert_not_called()


def test_send_to_tenant_queue_sets_waiting_time_and_calls_delay(proxy: RagPipelineTaskProxy) -> None:
    queue = cast(MagicMock, proxy._tenant_isolated_task_queue)
    queue.get_task_key.return_value = None
    task_func = create_autospec(Signature, instance=True, spec_set=True)

    proxy._send_to_tenant_queue("file-1", cast(Signature[object], task_func))

    queue.set_task_waiting_time.assert_called_once()
    task_func.delay.assert_called_once_with(
        rag_pipeline_invoke_entities_file_id="file-1",
        tenant_id="tenant-1",
    )


def test_upload_invoke_entities_returns_file_id(
    proxy: RagPipelineTaskProxy,
    file_service: MagicMock,
) -> None:
    file_service.upload_text.return_value = UploadFileRecord(
        id="uploaded-file-1",
        tenant_id="tenant-1",
        storage_type="local",
        key="rag_pipeline_invoke_entities.json",
        name="rag_pipeline_invoke_entities.json",
        size=17,
        extension="json",
        mime_type="application/json",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="user-1",
        created_at=datetime(2026, 1, 1),
        hash=None,
        source_url="",
        used=True,
        used_by="user-1",
    )

    result = proxy._upload_invoke_entities()

    assert result == "uploaded-file-1"
    file_service.upload_text.assert_called_once_with(
        actor=FileUploadActor(id="user-1", creator_role=CreatorUserRole.ACCOUNT),
        tenant_id="tenant-1",
        text='[{"doc": "data"}]',
        text_name="rag_pipeline_invoke_entities.json",
    )
