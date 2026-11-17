import pytest

from tests.helpers.unit.worker_entrypoint import worker_configuration


@pytest.mark.parametrize("edition", ["COMMUNITY", "ENTERPRISE", "CLOUD"])
def test_default_worker_queue_sets_consume_im_contact_sync_tasks(edition: str) -> None:
    selected = worker_configuration({"DEPLOYMENT_EDITION": edition})
    assert selected.returncode == 0, selected.stderr
    assert "human_input_contact_sync" in selected.stdout.splitlines()[-1].split(",")


@pytest.mark.parametrize("edition", ["COMMUNITY", "ENTERPRISE", "CLOUD"])
@pytest.mark.parametrize("queue", [None, "ops_trace", "tracing-upgrade"])
def test_default_worker_consumes_configured_trace_queue_without_legacy_queue(edition: str, queue: str | None) -> None:
    environment = {"DEPLOYMENT_EDITION": edition}
    if queue is not None:
        environment["OPS_TRACE_QUEUE"] = queue
    selected = worker_configuration(environment)
    assert selected.returncode == 0, selected.stderr
    queues = selected.stdout.splitlines()[-1].split(",")
    expected = queue or "ops_trace_v2"
    assert expected in queues
    if expected != "ops_trace":
        assert "ops_trace" not in queues
