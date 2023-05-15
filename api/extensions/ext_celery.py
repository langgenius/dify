from celery import Task, Celery
from flask import Flask


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
    celery_app.conf.update(
        result_backend=app.config["CELERY_RESULT_BACKEND"],
    )
    celery_app.set_default()
    app.extensions["celery"] = celery_app
    return celery_app
