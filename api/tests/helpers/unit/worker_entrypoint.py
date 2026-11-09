"""Run the shipped worker queue selection without starting a worker."""

import subprocess
from pathlib import Path

_ENTRYPOINT = Path(__file__).resolve().parents[3] / "docker" / "entrypoint.sh"


def worker_configuration(
    environment: dict[str, str], *, include_worker_environment: bool = False
) -> subprocess.CompletedProcess[str]:
    script = _ENTRYPOINT.read_text()
    # Run the queue/pool selection and its admission guards, without starting a worker.
    start = script.index("  # Configure queues")
    end = script.index('  echo "Starting Celery worker with queues:')
    mode_setup = script[: script.index("# Set UTF-8 encoding")]
    report = '\nprintf "%s\\n" "$DEFAULT_QUEUES"'
    if include_worker_environment:
        report = (
            '\nprintf "%s\\n" "$MODE" "$EXTERNAL_AGENTS_ENABLED" "$WORKER_POOL" '
            '"$CELERY_PREFETCH_MULTIPLIER" "$DEFAULT_QUEUES"'
        )
    return subprocess.run(
        ["bash", "-c", mode_setup + script[start:end] + report],
        env={"PATH": "/usr/bin:/bin", **environment},
        capture_output=True,
        text=True,
        check=False,
    )
