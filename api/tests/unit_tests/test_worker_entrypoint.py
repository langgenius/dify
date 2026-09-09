import re
from pathlib import Path

_ENTRYPOINT_PATH = Path(__file__).resolve().parents[2] / "docker" / "entrypoint.sh"
_DEFAULT_QUEUE_ASSIGNMENT = re.compile(r'^\s*DEFAULT_QUEUES="(?P<queues>[^"$]+)"$', re.MULTILINE)
_IM_CONTACT_SYNC_QUEUE = "human_input_contact_sync"


def test_default_worker_queue_sets_consume_im_contact_sync_tasks() -> None:
    entrypoint = _ENTRYPOINT_PATH.read_text()
    default_queue_sets = [match.group("queues").split(",") for match in _DEFAULT_QUEUE_ASSIGNMENT.finditer(entrypoint)]

    assert len(default_queue_sets) == 2
    assert all(_IM_CONTACT_SYNC_QUEUE in queues for queues in default_queue_sets)
