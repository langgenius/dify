import json
import os
import threading

from flask import Response
from prometheus_client import (
    CollectorRegistry,
    Counter,
    Gauge,
    make_wsgi_app,
    multiprocess,
)
from sqlalchemy import text
from werkzeug.middleware.dispatcher import DispatcherMiddleware

from configs import dify_config
from dify_app import DifyApp
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from extensions.ext_storage import storage

health_check_total_counter = Counter(name="health_check_total_counter", documentation="The count of health check")
redis_checked_counter = Counter(
    name="redis_checked_counter", documentation="The count of Redis has been checked as health"
)
db_checked_counter = Counter(name="db_checked_counter", documentation="The count of DB has been checked as health")
storage_checked_counter = Counter(
    name="storage_checked_counter", documentation="The count of storage has been checked as health"
)
redis_used_memory_bytes = Gauge(
    name="redis_used_memory_bytes", documentation="The used bytes of memory in Redis", multiprocess_mode="livesum"
)
redis_total_memory_bytes = Gauge(
    name="redis_total_memory_bytes", documentation="The total bytes of memory in Redis", multiprocess_mode="livesum"
)

db_pool_total_size = Gauge(
    name="db_pool_total_size",
    documentation="The total size of db pool",
    multiprocess_mode="livesum",
)
db_pool_checkout_size = Gauge(
    name="db_pool_checkout_size", documentation="The checkout size of db pool", multiprocess_mode="livesum"
)
db_pool_overflow_size = Gauge(
    name="db_pool_overflow_size", documentation="The overflow size of db pool", multiprocess_mode="livesum"
)


# Using multiprocess collector for registry
def _make_metrics_app():
    if os.getenv("PROMETHEUS_MULTIPROC_DIR", "") != "":
        registry = CollectorRegistry()
        multiprocess.MultiProcessCollector(registry)
        return make_wsgi_app(registry=registry)
    else:
        return make_wsgi_app()


def init_app(app: DifyApp):
    @app.after_request
    def after_request(response):
        """Add Version headers to the response."""
        response.headers.add("X-Version", dify_config.CURRENT_VERSION)
        response.headers.add("X-Env", dify_config.DEPLOY_ENV)
        return response

    @app.route("/health")
    def health():
        try:
            health_check_key = "dify.health_check"
            redis_client.set(health_check_key, 1)
            redis_client.get(health_check_key)
            redis_checked_counter.inc()

            info = redis_client.info()
            redis_used_memory_bytes.set(info["used_memory"])
            redis_total_memory_bytes.set(info["maxmemory"] if info["maxmemory"] != 0 else info["total_system_memory"])

            db.session.execute(text("SELECT 1"))
            db_checked_counter.inc()

            storage.save(health_check_key, b"test")
            storage.load(health_check_key)
            storage_checked_counter.inc()

            return Response(
                json.dumps({"pid": os.getpid(), "status": "ok", "version": dify_config.CURRENT_VERSION}),
                status=200,
                content_type="application/json",
            )
        finally:
            # 最后才增加计数，保证在健康时，也不会出现 health_check_total_counter > *_checked_counter 的情况，
            # 保证 max(*_checked_counter / health_check_total_counter, 1) == 1，以便于监控系统判断是否有异常
            health_check_total_counter.inc()

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
        from extensions.ext_database import db

        engine = db.engine
        stat = {
            "pid": os.getpid(),
            "pool_size": engine.pool.size(),
            "checked_in_connections": engine.pool.checkedin(),
            "checked_out_connections": engine.pool.checkedout(),
            "overflow_connections": engine.pool.overflow(),
            "connection_timeout": engine.pool.timeout(),
            "recycle_time": db.engine.pool._recycle,
        }
        db_pool_total_size.set(stat["pool_size"])
        db_pool_checkout_size.set(stat["checked_out_connections"])
        db_pool_overflow_size.set(stat["overflow_connections"])
        return stat

    app.wsgi_app = DispatcherMiddleware(app.wsgi_app, {"/metrics": _make_metrics_app()})
