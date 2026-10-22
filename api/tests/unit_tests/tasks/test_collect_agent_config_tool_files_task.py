"""Tests for Agent config ToolFile collection dispatch."""

from tasks.collect_agent_config_tool_files_task import enqueue_agent_config_tool_file_collection


def test_enqueue_deduplicates_candidates_and_applies_grace_period(monkeypatch) -> None:
    calls: list[dict[str, object]] = []

    def apply_async(**kwargs) -> None:
        calls.append(kwargs)

    monkeypatch.setattr(
        "tasks.collect_agent_config_tool_files_task.collect_agent_config_tool_files.apply_async",
        apply_async,
    )

    enqueue_agent_config_tool_file_collection(
        tenant_id="tenant-1",
        candidate_ids=["file-2", "", "file-1", "file-2"],
    )

    assert calls == [
        {
            "kwargs": {"tenant_id": "tenant-1", "candidate_ids": ["file-1", "file-2"]},
            "countdown": 60,
        }
    ]


def test_enqueue_skips_empty_candidate_batches(monkeypatch) -> None:
    calls: list[dict[str, object]] = []
    monkeypatch.setattr(
        "tasks.collect_agent_config_tool_files_task.collect_agent_config_tool_files.apply_async",
        lambda **kwargs: calls.append(kwargs),
    )

    enqueue_agent_config_tool_file_collection(tenant_id="tenant-1", candidate_ids=[])

    assert calls == []
