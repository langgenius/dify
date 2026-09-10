import datetime
import time
from collections.abc import Generator

import pytest

from extensions.logstore.repositories.logstore_api_workflow_run_repository import _dict_to_workflow_run

_START = datetime.datetime(2026, 8, 18, 2, 0, 0, tzinfo=datetime.UTC)
_FINISH = _START + datetime.timedelta(seconds=30)
_EXPECTED_CREATED_AT = _START.replace(tzinfo=None)
_EXPECTED_FINISHED_AT = _FINISH.replace(tzinfo=None)

_BASE: dict[str, object] = {"id": "run-1", "tenant_id": "tenant-1", "app_id": "app-1", "workflow_id": "workflow-1"}


@pytest.fixture
def non_utc_host_timezone(monkeypatch: pytest.MonkeyPatch) -> Generator[None, None, None]:
    """Run the host clock in UTC+05:30 so local-time conversions become observable."""
    monkeypatch.setenv("TZ", "Asia/Kolkata")
    time.tzset()
    yield
    monkeypatch.undo()
    time.tzset()


@pytest.mark.parametrize(
    ("case", "payload"),
    [
        ("both epoch", {"started_at": _START.timestamp(), "finished_at": _FINISH.timestamp()}),
        ("aware iso and epoch", {"started_at": _START.isoformat(), "finished_at": _FINISH.timestamp()}),
        (
            "naive iso and epoch",
            {"started_at": _START.replace(tzinfo=None).isoformat(), "finished_at": _FINISH.timestamp()},
        ),
        ("both datetime", {"started_at": _START, "finished_at": _FINISH}),
    ],
)
@pytest.mark.usefixtures("non_utc_host_timezone")
def test_dict_to_workflow_run_normalizes_timestamps_to_naive_utc(case: str, payload: dict[str, object]) -> None:
    model = _dict_to_workflow_run({**_BASE, **payload})

    assert model.created_at == _EXPECTED_CREATED_AT, case
    assert model.finished_at == _EXPECTED_FINISHED_AT, case
    assert model.elapsed_time == 30.0, case


@pytest.mark.usefixtures("non_utc_host_timezone")
def test_dict_to_workflow_run_defaults_missing_started_at_to_naive_utc_now() -> None:
    model = _dict_to_workflow_run({**_BASE, "finished_at": _FINISH.timestamp()})

    assert model.created_at.tzinfo is None
    # A naive local-time default would sit 5h30m ahead of UTC and drive elapsed_time negative.
    assert abs((model.created_at - datetime.datetime.now(tz=datetime.UTC).replace(tzinfo=None)).total_seconds()) < 60
