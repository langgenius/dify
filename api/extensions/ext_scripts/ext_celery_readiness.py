import sys
from pathlib import Path

# File for validating worker readiness
READINESS_FILE = Path("/tmp/dify_celery_ready")


def check_celery_readiness():
    if not READINESS_FILE.is_file():
        return False, "Celery readiness file NOT found."

    return True, "Celery readiness file found."


is_alive, message = check_celery_readiness()
print(message)
sys.exit(0 if is_alive else 1)
