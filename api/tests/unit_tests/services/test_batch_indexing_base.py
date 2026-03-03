from dataclasses import asdict
from typing import Any, ClassVar, cast
from unittest.mock import MagicMock, patch

import pytest

from core.entities.document_task import DocumentTask
from enums.cloud_plan import CloudPlan
from services.document_indexing_proxy.batch_indexing_base import BatchDocumentIndexingProxy

# ---------------------------------------------------------------------------
# Concrete subclass for testing (the base class is abstract)
# ---------------------------------------------------------------------------


class ConcreteBatchProxy(BatchDocumentIndexingProxy):
    """Minimal concrete implementation that provides the required class-level vars."""

    QUEUE_NAME: ClassVar[str] = "test_queue"
    NORMAL_TASK_FUNC: ClassVar[Any] = MagicMock(name="NORMAL_TASK_FUNC")
    PRIORITY_TASK_FUNC: ClassVar[Any] = MagicMock(name="PRIORITY_TASK_FUNC")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

TENANT_ID = "tenant-abc"
DATASET_ID = "dataset-xyz"
DOC_IDS: list[str] = ["doc-1", "doc-2", "doc-3"]


def make_proxy(**kwargs: Any) -> ConcreteBatchProxy:
    """Factory: returns a ConcreteBatchProxy with TenantIsolatedTaskQueue mocked out."""
    with patch("services.document_indexing_proxy.batch_indexing_base.TenantIsolatedTaskQueue") as MockQueue:
        proxy = ConcreteBatchProxy(
            tenant_id=kwargs.get("tenant_id", TENANT_ID),
            dataset_id=kwargs.get("dataset_id", DATASET_ID),
            document_ids=kwargs.get("document_ids", DOC_IDS),
        )
        # Expose the mock queue on the proxy so tests can assert on it
        proxy._tenant_isolated_task_queue = MockQueue.return_value
    return proxy


# ---------------------------------------------------------------------------
# Test suite
# ---------------------------------------------------------------------------


class TestBatchDocumentIndexingProxyInit:
    """Tests for __init__ of BatchDocumentIndexingProxy."""

    def test_should_store_document_ids_when_initialized(self) -> None:
        """Verify that document_ids are stored on the proxy instance."""
        # Arrange
        doc_ids: list[str] = ["doc-a", "doc-b"]

        # Act
        with patch("services.document_indexing_proxy.batch_indexing_base.TenantIsolatedTaskQueue"):
            proxy = ConcreteBatchProxy(TENANT_ID, DATASET_ID, doc_ids)

        # Assert
        assert proxy._document_ids == doc_ids

    def test_should_propagate_tenant_and_dataset_to_base_when_initialized(self) -> None:
        """Verify that tenant_id and dataset_id are forwarded to the parent class."""
        # Arrange / Act
        with patch("services.document_indexing_proxy.batch_indexing_base.TenantIsolatedTaskQueue"):
            proxy = ConcreteBatchProxy(TENANT_ID, DATASET_ID, DOC_IDS)

        # Assert
        assert proxy._tenant_id == TENANT_ID
        assert proxy._dataset_id == DATASET_ID

    def test_should_create_tenant_isolated_queue_with_correct_args_when_initialized(self) -> None:
        """Verify that TenantIsolatedTaskQueue is constructed with (tenant_id, QUEUE_NAME)."""
        # Arrange / Act
        with patch("services.document_indexing_proxy.batch_indexing_base.TenantIsolatedTaskQueue") as MockQueue:
            ConcreteBatchProxy(TENANT_ID, DATASET_ID, DOC_IDS)

        # Assert
        MockQueue.assert_called_once_with(TENANT_ID, ConcreteBatchProxy.QUEUE_NAME)

    @pytest.mark.parametrize("doc_ids", [[], ["single-doc"], ["d1", "d2", "d3", "d4"]])
    def test_should_accept_any_length_document_ids_when_initialized(self, doc_ids: list[str]) -> None:
        """Verify that empty, single, and multiple document IDs are all accepted."""
        # Arrange / Act
        with patch("services.document_indexing_proxy.batch_indexing_base.TenantIsolatedTaskQueue"):
            proxy = ConcreteBatchProxy(TENANT_ID, DATASET_ID, doc_ids)

        # Assert
        assert list(proxy._document_ids) == doc_ids


class TestSendToDirectQueue:
    """Tests for _send_to_direct_queue."""

    def test_should_call_task_func_delay_with_correct_args_when_sent_to_direct_queue(
        self,
    ) -> None:
        """Verify that task_func.delay is called with the right kwargs."""
        # Arrange
        proxy = make_proxy()
        task_func = MagicMock()

        # Act
        proxy._send_to_direct_queue(task_func)

        # Assert
        task_func.delay.assert_called_once_with(
            tenant_id=TENANT_ID,
            dataset_id=DATASET_ID,
            document_ids=DOC_IDS,
        )

    def test_should_not_interact_with_tenant_queue_when_sent_to_direct_queue(self) -> None:
        """Direct queue path must never touch the tenant-isolated queue."""
        # Arrange
        proxy = make_proxy()
        task_func = MagicMock()

        # Act
        proxy._send_to_direct_queue(task_func)

        # Assert
        mock_queue = cast(MagicMock, proxy._tenant_isolated_task_queue)
        mock_queue.push_tasks.assert_not_called()
        mock_queue.set_task_waiting_time.assert_not_called()

    def test_should_forward_any_callable_when_sent_to_direct_queue(self) -> None:
        """Verify that different task functions are each called correctly."""
        # Arrange
        proxy = make_proxy()
        task_a, task_b = MagicMock(), MagicMock()

        # Act
        proxy._send_to_direct_queue(task_a)
        proxy._send_to_direct_queue(task_b)

        # Assert
        task_a.delay.assert_called_once()
        task_b.delay.assert_called_once()


class TestSendToTenantQueue:
    """Tests for _send_to_tenant_queue — both branches."""

    # ------------------------------------------------------------------
    # Branch 1: get_task_key() is truthy → push to waiting queue
    # ------------------------------------------------------------------

    def test_should_push_task_to_queue_when_task_key_exists(self) -> None:
        """When get_task_key() is truthy, tasks must be pushed via push_tasks()."""
        # Arrange
        proxy = make_proxy()
        proxy._tenant_isolated_task_queue.get_task_key.return_value = "existing-key"
        task_func = MagicMock()

        # Act
        proxy._send_to_tenant_queue(task_func)

        # Assert
        mock_queue = cast(MagicMock, proxy._tenant_isolated_task_queue)
        expected_payload = [asdict(DocumentTask(tenant_id=TENANT_ID, dataset_id=DATASET_ID, document_ids=DOC_IDS))]
        mock_queue.push_tasks.assert_called_once_with(expected_payload)

    def test_should_not_call_task_func_delay_when_task_key_exists(self) -> None:
        """When a key already exists, task_func.delay must never be called."""
        # Arrange
        proxy = make_proxy()
        proxy._tenant_isolated_task_queue.get_task_key.return_value = "existing-key"
        task_func = MagicMock()

        # Act
        proxy._send_to_tenant_queue(task_func)

        # Assert
        cast(MagicMock, task_func.delay).assert_not_called()

    def test_should_not_set_waiting_time_when_task_key_exists(self) -> None:
        """When a key already exists, set_task_waiting_time must never be called."""
        # Arrange
        proxy = make_proxy()
        proxy._tenant_isolated_task_queue.get_task_key.return_value = "existing-key"
        task_func = MagicMock()

        # Act
        proxy._send_to_tenant_queue(task_func)

        # Assert
        mock_queue = cast(MagicMock, proxy._tenant_isolated_task_queue)
        mock_queue.set_task_waiting_time.assert_not_called()

    def test_should_serialize_document_task_correctly_when_pushing_to_queue(self) -> None:
        """Verify the serialised payload matches asdict(DocumentTask(...))."""
        # Arrange
        proxy = make_proxy(document_ids=["doc-x"])
        proxy._tenant_isolated_task_queue.get_task_key.return_value = "k"
        task_func = MagicMock()

        # Act
        proxy._send_to_tenant_queue(task_func)

        # Assert — inspect the payload passed to push_tasks
        mock_queue = cast(MagicMock, proxy._tenant_isolated_task_queue)
        call_args = mock_queue.push_tasks.call_args
        pushed_list = call_args[0][0]  # first positional arg
        assert len(pushed_list) == 1
        assert pushed_list[0]["tenant_id"] == TENANT_ID
        assert pushed_list[0]["dataset_id"] == DATASET_ID
        assert pushed_list[0]["document_ids"] == ["doc-x"]

    # ------------------------------------------------------------------
    # Branch 2: get_task_key() is falsy → set flag + dispatch via delay
    # ------------------------------------------------------------------

    def test_should_set_waiting_time_and_call_delay_when_no_task_key(self) -> None:
        """When get_task_key() is falsy, set_task_waiting_time and task_func.delay are invoked."""
        # Arrange
        proxy = make_proxy()
        proxy._tenant_isolated_task_queue.get_task_key.return_value = None
        task_func = MagicMock()

        # Act
        proxy._send_to_tenant_queue(task_func)

        # Assert
        mock_queue = cast(MagicMock, proxy._tenant_isolated_task_queue)
        mock_queue.set_task_waiting_time.assert_called_once()
        cast(MagicMock, task_func.delay).assert_called_once_with(
            tenant_id=TENANT_ID,
            dataset_id=DATASET_ID,
            document_ids=DOC_IDS,
        )

    def test_should_not_push_tasks_when_no_task_key(self) -> None:
        """When get_task_key() is falsy, push_tasks must never be called."""
        # Arrange
        proxy = make_proxy()
        proxy._tenant_isolated_task_queue.get_task_key.return_value = None
        task_func = MagicMock()

        # Act
        proxy._send_to_tenant_queue(task_func)

        # Assert
        mock_queue = cast(MagicMock, proxy._tenant_isolated_task_queue)
        mock_queue.push_tasks.assert_not_called()

    @pytest.mark.parametrize("falsy_key", [None, "", 0, False])
    def test_should_init_task_when_key_is_any_falsy_value(self, falsy_key: Any) -> None:
        """Verify that any falsy return from get_task_key() triggers the init branch."""
        # Arrange
        proxy = make_proxy()
        proxy._tenant_isolated_task_queue.get_task_key.return_value = falsy_key
        task_func = MagicMock()

        # Act
        proxy._send_to_tenant_queue(task_func)

        # Assert
        mock_queue = cast(MagicMock, proxy._tenant_isolated_task_queue)
        mock_queue.set_task_waiting_time.assert_called_once()
        cast(MagicMock, task_func.delay).assert_called_once()


class TestDispatchRouting:
    """Tests for the _dispatch / delay routing logic inherited from the base class."""

    def _mock_features(self, enabled: bool, plan: CloudPlan) -> MagicMock:
        features = MagicMock()
        features.billing.enabled = enabled
        features.billing.subscription.plan = plan
        return features

    def test_should_send_to_normal_tenant_queue_when_billing_enabled_and_sandbox_plan(self) -> None:
        """Sandbox plan routes to normal priority queue with tenant isolation."""
        # Arrange
        proxy = make_proxy()
        proxy._tenant_isolated_task_queue.get_task_key.return_value = None

        with patch("services.document_indexing_proxy.base.FeatureService.get_features") as mock_features:
            mock_features.return_value = self._mock_features(enabled=True, plan=CloudPlan.SANDBOX)

            # Act
            with patch.object(proxy, "_send_to_default_tenant_queue") as mock_method:
                proxy._dispatch()

        # Assert
        mock_method.assert_called_once()

    def test_should_send_to_priority_tenant_queue_when_billing_enabled_and_paid_plan(self) -> None:
        """Non-sandbox paid plan routes to priority queue with tenant isolation."""
        # Arrange
        proxy = make_proxy()

        with patch("services.document_indexing_proxy.base.FeatureService.get_features") as mock_features:
            mock_features.return_value = self._mock_features(enabled=True, plan=CloudPlan.PROFESSIONAL)

            # Act
            with patch.object(proxy, "_send_to_priority_tenant_queue") as mock_method:
                proxy._dispatch()

        # Assert
        mock_method.assert_called_once()

    def test_should_send_to_priority_direct_queue_when_billing_not_enabled(self) -> None:
        """Self-hosted / no billing → priority direct queue (no tenant isolation)."""
        # Arrange
        proxy = make_proxy()

        with patch("services.document_indexing_proxy.base.FeatureService.get_features") as mock_features:
            mock_features.return_value = self._mock_features(enabled=False, plan=CloudPlan.SANDBOX)

            # Act
            with patch.object(proxy, "_send_to_priority_direct_queue") as mock_method:
                proxy._dispatch()

        # Assert
        mock_method.assert_called_once()

    def test_should_call_dispatch_when_delay_is_invoked(self) -> None:
        """Calling delay() must invoke _dispatch() exactly once."""
        # Arrange
        proxy = make_proxy()

        # Act
        with patch.object(proxy, "_dispatch") as mock_dispatch:
            proxy.delay()

        # Assert
        mock_dispatch.assert_called_once()

    def test_should_use_feature_service_for_billing_info(self) -> None:
        """Verify that FeatureService.get_features is consulted during dispatch."""
        # Arrange
        proxy = make_proxy()

        with patch("services.document_indexing_proxy.base.FeatureService.get_features") as mock_features:
            mock_features.return_value = self._mock_features(enabled=False, plan=CloudPlan.SANDBOX)
            with patch.object(proxy, "_send_to_priority_direct_queue"):
                # Act
                proxy._dispatch()

        # Assert
        mock_features.assert_called_once_with(TENANT_ID)


class TestBaseRouterHelpers:
    """Tests for the three routing helper methods from the base class."""

    def test_should_call_send_to_tenant_queue_with_normal_func_when_default_tenant_queue(self) -> None:
        """_send_to_default_tenant_queue must forward NORMAL_TASK_FUNC."""
        # Arrange
        proxy = make_proxy()

        # Act
        with patch.object(proxy, "_send_to_tenant_queue") as mock_method:
            proxy._send_to_default_tenant_queue()

        # Assert
        mock_method.assert_called_once_with(ConcreteBatchProxy.NORMAL_TASK_FUNC)

    def test_should_call_send_to_tenant_queue_with_priority_func_when_priority_tenant_queue(self) -> None:
        """_send_to_priority_tenant_queue must forward PRIORITY_TASK_FUNC."""
        # Arrange
        proxy = make_proxy()

        # Act
        with patch.object(proxy, "_send_to_tenant_queue") as mock_method:
            proxy._send_to_priority_tenant_queue()

        # Assert
        mock_method.assert_called_once_with(ConcreteBatchProxy.PRIORITY_TASK_FUNC)

    def test_should_call_send_to_direct_queue_with_priority_func_when_priority_direct_queue(self) -> None:
        """_send_to_priority_direct_queue must forward PRIORITY_TASK_FUNC."""
        # Arrange
        proxy = make_proxy()

        # Act
        with patch.object(proxy, "_send_to_direct_queue") as mock_method:
            proxy._send_to_priority_direct_queue()

        # Assert
        mock_method.assert_called_once_with(ConcreteBatchProxy.PRIORITY_TASK_FUNC)
