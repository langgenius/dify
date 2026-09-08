from unittest.mock import patch

import pytest
from celery.app.task import Context
from celery.exceptions import Reject, Retry

from tasks.knowledge_fs_background_tasks import execute_delivery, execute_operation

JOB: dict[str, object] = {
    "id": "018f0d60-7a49-7cc2-9c1b-5b36f18f8a01",
    "type": "document.compile",
    "payload": {"attemptId": "018f0d60-7a49-7cc2-9c1b-5b36f18f8a02"},
    "attempts": 1,
}


def test_delivery_uses_late_ack_and_passes_broker_retry_count_to_engine() -> None:
    assert execute_delivery.acks_late is True
    assert execute_delivery.reject_on_worker_lost is True
    execute_delivery.request_stack.push(Context(id=JOB["id"], retries=2))
    try:
        with patch(
            "tasks.knowledge_fs_background_tasks.background_engine.execute", return_value={"outcome": "completed"}
        ) as engine:
            assert execute_delivery.run(delivery=JOB) == {"outcome": "completed"}
            engine.assert_called_once_with("delivery", {**JOB, "attempts": 3})
    finally:
        execute_delivery.request_stack.pop()


def test_bad_delivery_identity_never_enters_engine() -> None:
    execute_delivery.request_stack.push(Context(id="different"))
    try:
        with patch("tasks.knowledge_fs_background_tasks.background_engine.execute") as engine:
            with pytest.raises(Reject):
                execute_delivery.run(delivery=JOB)
            engine.assert_not_called()
    finally:
        execute_delivery.request_stack.pop()


@pytest.mark.parametrize("response", [{"outcome": "retry", "runAfter": 0}, OSError("engine died")])
def test_early_delivery_and_engine_loss_retry_without_acknowledging(response: object) -> None:
    execute_delivery.request_stack.push(Context(id=JOB["id"], retries=0))
    try:
        with (
            patch("tasks.knowledge_fs_background_tasks.background_engine.execute") as engine,
            patch.object(execute_delivery, "retry", side_effect=Retry()) as retry,
        ):
            if isinstance(response, Exception):
                engine.side_effect = response
            else:
                engine.return_value = response
            with pytest.raises(Retry):
                execute_delivery.run(delivery=JOB)
            retry.assert_called_once()
            assert 1 <= retry.call_args.kwargs["countdown"] <= 300
    finally:
        execute_delivery.request_stack.pop()


def test_unknown_operation_is_not_executable() -> None:
    with patch("tasks.knowledge_fs_background_tasks.background_engine.execute") as engine:
        with pytest.raises(Reject):
            execute_operation.run(operation="shell")
        engine.assert_not_called()
