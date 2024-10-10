import json
import os
import threading

from flask import Flask, Response

from extensions.ext_database import db


def init_app(app: Flask):
    @app.after_request
    def after_request(response):
        """Add Version headers to the response."""
        response.set_cookie("remember_token", "", expires=0)
        response.headers.add("X-Version", app.config["CURRENT_VERSION"])
        response.headers.add("X-Env", app.config["DEPLOY_ENV"])
        return response

    @app.route("/health")
    def health():
        return Response(
            json.dumps({"pid": os.getpid(), "status": "ok", "version": app.config["CURRENT_VERSION"]}),
            status=200,
            content_type="application/json",
        )

    @app.route("/threads")
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
    def pool_stat():
        engine = db.engine
        return {
            "pid": os.getpid(),
            "pool_size": engine.pool.size(),
            "checked_in_connections": engine.pool.checkedin(),
            "checked_out_connections": engine.pool.checkedout(),
            "overflow_connections": engine.pool.overflow(),
            "connection_timeout": engine.pool.timeout(),
            "recycle_time": db.engine.pool._recycle,
        }
