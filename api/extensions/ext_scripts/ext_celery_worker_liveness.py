import sys
import time
from pathlib import Path

# File for validating worker liveness
HEARTBEAT_FILE = Path("/tmp/dify_celery_worker_heartbeat")
LIVENESS_TIMEOUT = 10  # seconds


def check_celery_liveness():
    if not HEARTBEAT_FILE.is_file():
        return False, "Celery liveness file NOT found."

    stats = HEARTBEAT_FILE.stat()
    heartbeat_timestamp = stats.st_mtime
    current_timestamp = time.time()
    time_diff = current_timestamp - heartbeat_timestamp

    if time_diff > LIVENESS_TIMEOUT:
        return False, "Celery Worker liveness file timestamp DOES NOT match the given constraint."

    return True, "Celery Worker liveness file found and timestamp matches the given constraint."


is_alive, message = check_celery_liveness()
print(message)
sys.exit(0 if is_alive else 1)
