import json
import os
import threading
from typing import cast

from flask import Response
from sqlalchemy.pool import QueuePool

from configs import dify_config
from controllers.console.admin import admin_required
from dify_app import DifyApp


def init_app(app: DifyApp):
    @app.after_request
    def after_request(response):
        """Add Version headers to the response."""
        response.headers.add("X-Version", dify_config.project.version)
        response.headers.add("X-Env", dify_config.DEPLOY_ENV)
        return response

    @app.route("/health")
    def health():
        return Response(
            json.dumps({"pid": os.getpid(), "status": "ok", "version": dify_config.project.version}),
            status=200,
            content_type="application/json",
        )

    @app.route("/threads")
    @admin_required
    def threads():
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
    @admin_required
    def pool_stat():
        from extensions.ext_database import db

        engine = db.engine
        pool = cast(QueuePool, engine.pool)
        return {
            "pid": os.getpid(),
            "pool_size": pool.size(),
            "checked_in_connections": pool.checkedin(),
            "checked_out_connections": pool.checkedout(),
            "overflow_connections": pool.overflow(),
            "connection_timeout": pool.timeout(),
            "recycle_time": pool._recycle,
        }
