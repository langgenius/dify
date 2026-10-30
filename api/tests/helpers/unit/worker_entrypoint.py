"""Run the shipped worker queue selection without starting a worker."""

import subprocess
from pathlib import Path

_ENTRYPOINT = Path(__file__).resolve().parents[3] / "docker" / "entrypoint.sh"


def worker_configuration(environment: dict[str, str]) -> subprocess.CompletedProcess[str]:
    script = _ENTRYPOINT.read_text()
    # Run the queue/pool selection and its admission guards, without starting a worker.
    start = script.index("  # Configure queues")
    end = script.index('  echo "Starting Celery worker with queues:')
    return subprocess.run(
        ["bash", "-c", script[start:end] + '\nprintf "%s\\n" "$DEFAULT_QUEUES"'],
        env={"PATH": "/usr/bin:/bin", **environment},
        capture_output=True,
        text=True,
        check=False,
    )
