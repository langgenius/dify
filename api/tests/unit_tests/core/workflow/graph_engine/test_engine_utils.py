from __future__ import annotations

from core.workflow.graph_engine._engine_utils import get_timestamp


def test_get_timestamp_rounds_wall_clock_seconds(monkeypatch) -> None:
    monkeypatch.setattr("core.workflow.graph_engine._engine_utils.time.time", lambda: 1_700_000_000.6)

    assert get_timestamp() == 1_700_000_001
