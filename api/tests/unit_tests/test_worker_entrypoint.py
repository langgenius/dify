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


@pytest.mark.parametrize("enabled", ["false", "true"])
@pytest.mark.parametrize("queue", [None, "workspace-a.external-agents"])
def test_external_worker_uses_container_queue_and_preserves_shared_admission_flag(
    enabled: str,
    queue: str | None,
) -> None:
    environment = {
        "MODE": "external_agent_worker",
        "EXTERNAL_AGENTS_ENABLED": enabled,
        "CELERY_QUEUES": "generic-default",
        "CELERY_WORKER_QUEUES": "generic-override",
        "CELERY_WORKER_POOL": "gevent",
        "CELERY_PREFETCH_MULTIPLIER": "8",
    }
    if queue is not None:
        environment["EXTERNAL_AGENTS_QUEUE"] = queue
    selected = worker_configuration(environment, include_worker_environment=True)
    assert selected.returncode == 0, selected.stderr
    assert selected.stdout.splitlines()[-5:] == ["worker", enabled, "prefork", "1", queue or "external_agents"]
