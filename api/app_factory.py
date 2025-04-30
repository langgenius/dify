import logging
import time

from flask import request

from configs import dify_config
from contexts.wrapper import RecyclableContextVar
from dify_app import DifyApp


# ----------------------------
# Application Factory Function
# ----------------------------
def create_flask_app_with_configs() -> DifyApp:
    """
    create a raw flask app
    with configs loaded from .env file
    """
    dify_app = DifyApp(__name__)
    dify_app.config.from_mapping(dify_config.model_dump())

    # add before request hook
    @dify_app.before_request
    def before_request():
        # add an unique identifier to each request
        RecyclableContextVar.increment_thread_recycles()

        try:
            if (
                request.method.lower() == "post"
                and "application/json" in request.headers.get("content-type", "").lower()
            ):
                logging.info(
                    f"[before request]| method: "
                    f"{request.method}, url: {request.url}, request_data: {request.get_json()}"
                )
            else:
                logging.info(f"[before request]| method: {request.method}, url: {request.url}")
        except Exception as e:
            logging.info(f"before_request handler err {e}")

    # add extra `request_id` field for every response data
    @dify_app.after_request
    def add_extra_info(resp):
        obj = resp.get_json()
        if obj is not None and isinstance(obj, dict):
            logging.info(f"[finish request]|response: {obj}")
        return resp

    return dify_app


def create_app() -> DifyApp:
    start_time = time.perf_counter()
    app = create_flask_app_with_configs()
    initialize_extensions(app)
    end_time = time.perf_counter()
    if dify_config.DEBUG:
        logging.info(f"Finished create_app ({round((end_time - start_time) * 1000, 2)} ms)")
    return app


def initialize_extensions(app: DifyApp):
    from extensions import (
        ext_app_metrics,
        ext_blueprints,
        ext_celery,
        ext_code_based_extension,
        ext_commands,
        ext_compress,
        ext_database,
        ext_hosting_provider,
        ext_import_modules,
        ext_logging,
        ext_login,
        ext_mail,
        ext_migrate,
        ext_otel,
        ext_otel_patch,
        ext_proxy_fix,
        ext_redis,
        ext_repositories,
        ext_sentry,
        ext_set_secretkey,
        ext_storage,
        ext_timezone,
        ext_warnings,
    )

    extensions = [
        ext_timezone,
        ext_logging,
        ext_warnings,
        ext_import_modules,
        ext_set_secretkey,
        ext_compress,
        ext_code_based_extension,
        ext_database,
        ext_app_metrics,
        ext_migrate,
        ext_redis,
        ext_storage,
        ext_repositories,
        ext_celery,
        ext_login,
        ext_mail,
        ext_hosting_provider,
        ext_sentry,
        ext_proxy_fix,
        ext_blueprints,
        ext_commands,
        ext_otel_patch,  # Apply patch before initializing OpenTelemetry
        ext_otel,
    ]
    for ext in extensions:
        short_name = ext.__name__.split(".")[-1]
        is_enabled = ext.is_enabled() if hasattr(ext, "is_enabled") else True
        if not is_enabled:
            if dify_config.DEBUG:
                logging.info(f"Skipped {short_name}")
            continue

        start_time = time.perf_counter()
        ext.init_app(app)
        end_time = time.perf_counter()
        if dify_config.DEBUG:
            logging.info(f"Loaded {short_name} ({round((end_time - start_time) * 1000, 2)} ms)")


def create_migrations_app():
    app = create_flask_app_with_configs()
    from extensions import ext_database, ext_migrate

    # Initialize only required extensions
    ext_database.init_app(app)
    ext_migrate.init_app(app)

    return app
