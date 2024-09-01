from datetime import timedelta
from pathlib import Path

from celery import Celery, Task, bootsteps
from celery.signals import beat_init, worker_ready, worker_shutdown
from flask import Flask

# File for validating worker readiness
READINESS_FILE = Path("/tmp/dify_celery_ready")
# File for validating worker liveness
HEARTBEAT_FILE = Path("/tmp/dify_celery_worker_heartbeat")

HEARTBEAT_UPDATE_INTERVAL = 1.0  # seconds


class LivenessProbe(bootsteps.StartStopStep):
    requires = {"celery.worker.components:Timer"}

    def __init__(self, parent, **kwargs):
        super().__init__(parent, **kwargs)
        self.requests = []
        self.tref = None

    def start(self, worker):
        self.tref = worker.timer.call_repeatedly(
            HEARTBEAT_UPDATE_INTERVAL,
            self.update_heartbeat_file,
            (worker,),
            priority=10,
        )
        READINESS_FILE.touch()

    def stop(self, worker):
        HEARTBEAT_FILE.unlink(missing_ok=True)

    def update_heartbeat_file(self, worker):
        HEARTBEAT_FILE.touch()


def init_app(app: Flask) -> Celery:
    class FlaskTask(Task):
        def __call__(self, *args: object, **kwargs: object) -> object:
            with app.app_context():
                return self.run(*args, **kwargs)

    celery_app = Celery(
        app.name,
        task_cls=FlaskTask,
        broker=app.config["CELERY_BROKER_URL"],
        backend=app.config["CELERY_BACKEND"],
        task_ignore_result=True,
    )

    # Add SSL options to the Celery configuration
    ssl_options = {
        "ssl_cert_reqs": None,
        "ssl_ca_certs": None,
        "ssl_certfile": None,
        "ssl_keyfile": None,
    }

    celery_app.conf.update(
        result_backend=app.config["CELERY_RESULT_BACKEND"],
        broker_connection_retry_on_startup=True,
    )

    if app.config["BROKER_USE_SSL"]:
        celery_app.conf.update(
            broker_use_ssl=ssl_options,  # Add the SSL options to the broker configuration
        )

    celery_app.set_default()
    app.extensions["celery"] = celery_app

    imports = [
        "schedule.clean_embedding_cache_task",
        "schedule.clean_unused_datasets_task",
    ]
    day = app.config["CELERY_BEAT_SCHEDULER_TIME"]
    beat_schedule = {
        "clean_embedding_cache_task": {
            "task": "schedule.clean_embedding_cache_task.clean_embedding_cache_task",
            "schedule": timedelta(days=day),
        },
        "clean_unused_datasets_task": {
            "task": "schedule.clean_unused_datasets_task.clean_unused_datasets_task",
            "schedule": timedelta(days=day),
        },
    }
    celery_app.conf.update(beat_schedule=beat_schedule, imports=imports)

    # add LivenessProbe
    celery_app.steps["worker"].add(LivenessProbe)

    # add worker signals
    @worker_ready.connect
    def worker_ready_handler(**_):
        READINESS_FILE.touch()

    @worker_shutdown.connect
    def worker_shutdown_handler(**_):
        READINESS_FILE.unlink(missing_ok=True)
        HEARTBEAT_FILE.unlink(missing_ok=True)

    # add beat signals
    @beat_init.connect
    def beat_init_handler(**_):
        READINESS_FILE.touch()

    return celery_app
