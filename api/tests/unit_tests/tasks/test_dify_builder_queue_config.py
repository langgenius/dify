import re
from pathlib import Path

import pytest

from tasks.dify_builder_advance_task import advance_session

DIFY_BUILDER_QUEUE = "dify_builder"
REPO_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_QUEUE_PATTERN = re.compile(r'^\s*(?:QUEUES|DEFAULT_QUEUES)="([^"]+,.*?)"$', re.MULTILINE)


def test_advance_task_uses_dedicated_queue():
    assert getattr(advance_session, "queue", None) == DIFY_BUILDER_QUEUE


@pytest.mark.parametrize(
    "script_path",
    [
        REPO_ROOT / "api" / "docker" / "entrypoint.sh",
        REPO_ROOT / "dev" / "start-worker",
    ],
)
def test_default_workers_consume_dify_builder_queue(script_path: Path):
    queue_sets = [
        set(queue_list.split(","))
        for queue_list in DEFAULT_QUEUE_PATTERN.findall(script_path.read_text(encoding="utf-8"))
    ]

    assert len(queue_sets) == 2, f"expected Cloud and Community queue defaults in {script_path}"
    assert all(DIFY_BUILDER_QUEUE in queues for queues in queue_sets)
