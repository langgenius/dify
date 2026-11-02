import pytest

from tests.unit_tests.worker_entrypoint import worker_configuration


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


@pytest.mark.parametrize(
    ("overrides", "expected"),
    [
        ({"CELERY_QUEUES": "dataset,mail"}, "dataset,mail"),
        ({"CELERY_WORKER_QUEUES": "dataset,mail"}, "dataset,mail"),
        (
            {"CELERY_QUEUES": "dataset", "CELERY_WORKER_QUEUES": "mail"},
            "mail",
        ),
    ],
)
def test_operator_queue_overrides_take_precedence_over_configured_trace_queue(
    overrides: dict[str, str], expected: str
) -> None:
    selected = worker_configuration({"OPS_TRACE_QUEUE": "tracing-upgrade", **overrides})
    assert selected.returncode == 0, selected.stderr
    assert selected.stdout.splitlines()[-1] == expected
