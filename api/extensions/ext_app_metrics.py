import json
import os
import threading

from flask import Response

from configs import dify_config
from dify_app import DifyApp


def init_app(app: DifyApp):
    @app.after_request
    def after_request(response):  # pyright: ignore[reportUnusedFunction]
        """Add Version headers to the response."""
        response.headers.add("X-Version", dify_config.project.version)
        response.headers.add("X-Env", dify_config.DEPLOY_ENV)
        return response

    @app.route("/health")
    def health():  # pyright: ignore[reportUnusedFunction]
        return Response(
            json.dumps({"pid": os.getpid(), "status": "ok", "version": dify_config.project.version}),
            status=200,
            content_type="application/json",
        )

    @app.route("/threads")
    def threads():  # pyright: ignore[reportUnusedFunction]
        num_threads = threading.active_count()
        threads = threading.enumerate()

        thread_list = []
        for thread in threads:
            thread_name = thread.name
            thread_id = thread.ident
            is_alive = thread.is_alive()

            thread_list.append(
                {
                    "name": thread_name,
                    "id": thread_id,
                    "is_alive": is_alive,
                }
            )

        return {
            "pid": os.getpid(),
            "thread_num": num_threads,
            "threads": thread_list,
        }

    @app.route("/db-pool-stat")
    def pool_stat():  # pyright: ignore[reportUnusedFunction]
        from extensions.ext_database import db

        engine = db.engine
        # TODO: Fix the type error
        # FIXME maybe its sqlalchemy issue
        return {
            "pid": os.getpid(),
            "pool_size": engine.pool.size(),  # type: ignore
            "checked_in_connections": engine.pool.checkedin(),  # type: ignore
            "checked_out_connections": engine.pool.checkedout(),  # type: ignore
            "overflow_connections": engine.pool.overflow(),  # type: ignore
            "connection_timeout": engine.pool.timeout(),  # type: ignore
            "recycle_time": db.engine.pool._recycle,  # type: ignore
        }
