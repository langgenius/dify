from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from pytest_mock import MockerFixture

from services.rag_pipeline.rag_pipeline_task_proxy import RagPipelineTaskProxy


@pytest.fixture
def proxy(mocker: MockerFixture):
    """Create a RagPipelineTaskProxy with mocked dependencies."""
    mocker.patch("services.rag_pipeline.rag_pipeline_task_proxy.TenantIsolatedTaskQueue")
    entity = Mock()
    entity.model_dump.return_value = {"doc": "data"}
    return RagPipelineTaskProxy(
        dataset_tenant_id="tenant-1",
        user_id="user-1",
        rag_pipeline_invoke_entities=[entity],
    )


# --- delay ---


def test_delay_with_empty_entities_logs_warning_and_returns(mocker) -> None:
    mocker.patch("services.rag_pipeline.rag_pipeline_task_proxy.TenantIsolatedTaskQueue")
    proxy = RagPipelineTaskProxy(
        dataset_tenant_id="tenant-1",
        user_id="user-1",
        rag_pipeline_invoke_entities=[],
    )
    dispatch_mock = mocker.patch.object(proxy, "_dispatch")

    proxy.delay()

    dispatch_mock.assert_not_called()


def test_delay_with_entities_calls_dispatch(mocker, proxy) -> None:
    dispatch_mock = mocker.patch.object(proxy, "_dispatch")

    proxy.delay()

    dispatch_mock.assert_called_once()


# --- _dispatch ---


def test_dispatch_billing_sandbox_uses_default_tenant_queue(mocker, proxy) -> None:
    upload_mock = mocker.patch.object(proxy, "_upload_invoke_entities", return_value="file-1")
    send_mock = mocker.patch.object(proxy, "_send_to_default_tenant_queue")

    from enums.cloud_plan import CloudPlan

    features = SimpleNamespace(
        billing=SimpleNamespace(enabled=True, subscription=SimpleNamespace(plan=CloudPlan.SANDBOX))
    )
    mocker.patch.object(type(proxy), "features", new_callable=lambda: property(lambda self: features))

    proxy._dispatch()

    upload_mock.assert_called_once()
    send_mock.assert_called_once_with("file-1")


def test_dispatch_billing_non_sandbox_uses_priority_tenant_queue(mocker, proxy) -> None:
    upload_mock = mocker.patch.object(proxy, "_upload_invoke_entities", return_value="file-1")
    send_mock = mocker.patch.object(proxy, "_send_to_priority_tenant_queue")

    from enums.cloud_plan import CloudPlan

    features = SimpleNamespace(
        billing=SimpleNamespace(enabled=True, subscription=SimpleNamespace(plan=CloudPlan.PROFESSIONAL))
    )
    mocker.patch.object(type(proxy), "features", new_callable=lambda: property(lambda self: features))

    proxy._dispatch()

    upload_mock.assert_called_once()
    send_mock.assert_called_once_with("file-1")


def test_dispatch_no_billing_uses_priority_direct_queue(mocker, proxy) -> None:
    upload_mock = mocker.patch.object(proxy, "_upload_invoke_entities", return_value="file-1")
    send_mock = mocker.patch.object(proxy, "_send_to_priority_direct_queue")

    features = SimpleNamespace(billing=SimpleNamespace(enabled=False, subscription=SimpleNamespace(plan="free")))
    mocker.patch.object(type(proxy), "features", new_callable=lambda: property(lambda self: features))

    proxy._dispatch()

    upload_mock.assert_called_once()
    send_mock.assert_called_once_with("file-1")


def test_dispatch_raises_on_empty_upload_file_id(mocker, proxy) -> None:
    mocker.patch.object(proxy, "_upload_invoke_entities", return_value="")

    features = SimpleNamespace(billing=SimpleNamespace(enabled=False, subscription=SimpleNamespace(plan="free")))
    mocker.patch.object(type(proxy), "features", new_callable=lambda: property(lambda self: features))

    with pytest.raises(ValueError, match="upload_file_id is empty"):
        proxy._dispatch()


# --- _send_to_direct_queue ---


def test_send_to_direct_queue_calls_task_func_delay(mocker, proxy) -> None:
    task_func = Mock()

    proxy._send_to_direct_queue("file-1", task_func)

    task_func.delay.assert_called_once_with(
        rag_pipeline_invoke_entities_file_id="file-1",
        tenant_id="tenant-1",
    )


# --- _send_to_tenant_queue ---


def test_send_to_tenant_queue_pushes_when_task_key_exists(mocker, proxy) -> None:
    proxy._tenant_isolated_task_queue.get_task_key.return_value = "existing-key"
    task_func = Mock()

    proxy._send_to_tenant_queue("file-1", task_func)

    proxy._tenant_isolated_task_queue.push_tasks.assert_called_once_with(["file-1"])
    task_func.delay.assert_not_called()


def test_send_to_tenant_queue_sets_waiting_time_and_calls_delay(mocker, proxy) -> None:
    proxy._tenant_isolated_task_queue.get_task_key.return_value = None
    task_func = Mock()

    proxy._send_to_tenant_queue("file-1", task_func)

    proxy._tenant_isolated_task_queue.set_task_waiting_time.assert_called_once()
    task_func.delay.assert_called_once_with(
        rag_pipeline_invoke_entities_file_id="file-1",
        tenant_id="tenant-1",
    )


# --- _upload_invoke_entities ---


def test_upload_invoke_entities_returns_file_id(mocker, proxy) -> None:
    upload_file = SimpleNamespace(id="uploaded-file-1")
    file_service_cls = mocker.patch("services.rag_pipeline.rag_pipeline_task_proxy.FileService")
    file_service_cls.return_value.upload_text.return_value = upload_file
    mocker.patch("services.rag_pipeline.rag_pipeline_task_proxy.db", mocker.Mock(engine="fake-engine"))

    result = proxy._upload_invoke_entities()

    assert result == "uploaded-file-1"
    file_service_cls.return_value.upload_text.assert_called_once()
