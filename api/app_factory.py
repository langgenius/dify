import logging
import time

from opentelemetry.trace import get_current_span
from opentelemetry.trace.span import INVALID_SPAN_ID, INVALID_TRACE_ID

from configs import dify_config
from contexts.wrapper import RecyclableContextVar
from core.logging.context import init_request_context
from dify_app import DifyApp

logger = logging.getLogger(__name__)


# ----------------------------
# Application Factory Function
# ----------------------------
def create_quart_app_with_configs() -> DifyApp:
    """
    create a raw quart app
    with configs loaded from .env file
    """
    dify_app = DifyApp(__name__)
    dify_app.config.from_mapping(dify_config.model_dump())
    dify_app.config["RESTX_INCLUDE_ALL_MODELS"] = True
    _patch_flask_restx_swagger_ui(dify_app)
    _patch_flask_restx_schema(dify_app)

    # add before request hook
    @dify_app.before_request
    def before_request():
        # Initialize logging context for this request
        init_request_context()
        RecyclableContextVar.increment_thread_recycles()

    # add after request hook for injecting trace headers from OpenTelemetry span context
    # Only adds headers when OTEL is enabled and has valid context
    @dify_app.after_request
    async def add_trace_headers(response):
        try:
            span = get_current_span()
            ctx = span.get_span_context() if span else None

            if not ctx or not ctx.is_valid:
                return response

            # Inject trace headers from OTEL context
            if ctx.trace_id != INVALID_TRACE_ID and "X-Trace-Id" not in response.headers:
                response.headers["X-Trace-Id"] = format(ctx.trace_id, "032x")
            if ctx.span_id != INVALID_SPAN_ID and "X-Span-Id" not in response.headers:
                response.headers["X-Span-Id"] = format(ctx.span_id, "016x")

        except Exception:
            # Never break the response due to tracing header injection
            logger.warning("Failed to add trace headers to response", exc_info=True)
        return response

    # Capture the decorator's return value to avoid pyright reportUnusedFunction
    _ = before_request
    _ = add_trace_headers

    return dify_app


def _patch_flask_restx_swagger_ui(app: DifyApp) -> None:
    """Use Quart's template rendering for Flask-RESTX swagger UI."""
    if getattr(app, "_dify_restx_patched", False):
        return

    try:
        import os

        import flask_restx
        from flask_restx import apidoc
        from jinja2 import ChoiceLoader, PackageLoader
        from quart import Blueprint, render_template, url_for
    except ImportError:
        return

    loaders = []
    if app.jinja_loader is not None:
        loaders.append(app.jinja_loader)
    loaders.append(PackageLoader("flask_restx", "templates"))
    app.jinja_loader = ChoiceLoader(loaders)

    apidoc.render_template = render_template

    static_folder = os.path.join(os.path.dirname(flask_restx.__file__), "static")
    apidoc.apidoc = Blueprint(
        "restx_doc",
        __name__,
        template_folder="templates",
        static_folder=static_folder,
        static_url_path="/swaggerui",
    )

    @apidoc.apidoc.add_app_template_global
    def swagger_static(filename: str) -> str:
        return url_for("restx_doc.static", filename=filename)

    apidoc.swagger_static = swagger_static
    app._dify_restx_patched = True


def _patch_flask_restx_schema(app: DifyApp) -> None:
    """Allow Swagger schema generation when Nested fields are defined with dicts."""
    if getattr(app, "_dify_restx_schema_patched", False):
        return

    try:
        from flask_restx import fields as restx_fields
        from flask_restx import swagger as restx_swagger
        from flask_restx.model import Model, OrderedModel
    except ImportError:
        return

    original_register_field = restx_swagger.Swagger.register_field
    original_register_model = restx_swagger.Swagger.register_model

    def ensure_inline_model(api, model_dict):
        inline_models = getattr(api, "_dify_inline_models", None)
        if inline_models is None:
            inline_models = {}

        model_id = id(model_dict)
        model_name = inline_models.get(model_id)
        if model_name and model_name in api.models:
            return api.models[model_name]

        counter = getattr(api, "_dify_inline_model_counter", 0)
        while True:
            counter += 1
            candidate = f"InlineModel{counter}"
            if candidate not in api.models:
                model_name = candidate
                break
        api._dify_inline_model_counter = counter

        model_cls = OrderedModel if getattr(api, "ordered", False) else Model
        inline_model = model_cls(model_name, model_dict)
        api.models[model_name] = inline_model
        inline_models[model_id] = model_name
        api._dify_inline_models = inline_models
        return inline_model

    def register_field(self, field):
        if isinstance(field, restx_fields.Nested) and isinstance(field.model, dict):
            field.model = ensure_inline_model(self.api, field.model)
        return original_register_field(self, field)

    def register_model(self, model):
        if isinstance(model, dict):
            model = ensure_inline_model(self.api, model)
        return original_register_model(self, model)

    def as_dict(self):
        basepath = self.api.base_path
        if len(basepath) > 1 and basepath.endswith("/"):
            basepath = basepath[:-1]
        infos = {
            "title": restx_swagger._v(self.api.title),
            "version": restx_swagger._v(self.api.version),
        }
        if self.api.description:
            infos["description"] = restx_swagger._v(self.api.description)
        if self.api.terms_url:
            infos["termsOfService"] = restx_swagger._v(self.api.terms_url)
        if self.api.contact and (self.api.contact_email or self.api.contact_url):
            infos["contact"] = {
                "name": restx_swagger._v(self.api.contact),
                "email": restx_swagger._v(self.api.contact_email),
                "url": restx_swagger._v(self.api.contact_url),
            }
        if self.api.license:
            infos["license"] = {"name": restx_swagger._v(self.api.license)}
            if self.api.license_url:
                infos["license"]["url"] = restx_swagger._v(self.api.license_url)

        paths = {}
        tags = self.extract_tags(self.api)

        responses = self.register_errors()

        for ns in self.api.namespaces:
            for resource, urls, route_doc, kwargs in ns.resources:
                for url in self.api.ns_urls(ns, urls):
                    path = restx_swagger.extract_path(url)
                    serialized = self.serialize_resource(ns, resource, url, route_doc=route_doc, **kwargs)
                    paths[path] = serialized

        if restx_swagger.current_app.config["RESTX_INCLUDE_ALL_MODELS"]:
            for m in list(self.api.models):
                self.register_model(m)

        for ns in self.api.namespaces:
            if ns.authorizations:
                if self.api.authorizations is None:
                    self.api.authorizations = {}
                self.api.authorizations = restx_swagger.merge(self.api.authorizations, ns.authorizations)

        specs = {
            "swagger": "2.0",
            "basePath": basepath,
            "paths": restx_swagger.not_none_sorted(paths),
            "info": infos,
            "produces": list(self.api.representations.keys()),
            "consumes": ["application/json"],
            "securityDefinitions": self.api.authorizations or None,
            "security": self.security_requirements(self.api.security) or None,
            "tags": tags,
            "definitions": self.serialize_definitions() or None,
            "responses": responses or None,
            "host": self.get_host(),
        }
        return restx_swagger.not_none(specs)

    restx_swagger.Swagger.register_field = register_field
    restx_swagger.Swagger.register_model = register_model
    restx_swagger.Swagger.as_dict = as_dict
    app._dify_restx_schema_patched = True


def create_app() -> DifyApp:
    start_time = time.perf_counter()
    app = create_quart_app_with_configs()
    initialize_extensions(app)
    end_time = time.perf_counter()
    if dify_config.DEBUG:
        logger.info("Finished create_app (%s ms)", round((end_time - start_time) * 1000, 2))
    return app


def initialize_extensions(app: DifyApp):
    # Initialize Quart context capture for workflow execution
    from context.quart_app_context import init_quart_context
    from extensions import (
        ext_app_metrics,
        ext_blueprints,
        ext_celery,
        ext_code_based_extension,
        ext_commands,
        ext_compress,
        ext_database,
        ext_fastopenapi,
        ext_forward_refs,
        ext_hosting_provider,
        ext_import_modules,
        ext_logging,
        ext_login,
        ext_logstore,
        ext_mail,
        ext_migrate,
        ext_orjson,
        ext_otel,
        ext_proxy_fix,
        ext_redis,
        ext_request_logging,
        ext_sentry,
        ext_session_factory,
        ext_set_secretkey,
        ext_storage,
        ext_timezone,
        ext_warnings,
    )

    init_quart_context()

    extensions = [
        ext_timezone,
        ext_logging,
        ext_warnings,
        ext_import_modules,
        ext_orjson,
        ext_forward_refs,
        ext_set_secretkey,
        ext_compress,
        ext_code_based_extension,
        ext_database,
        ext_app_metrics,
        ext_migrate,
        ext_redis,
        ext_storage,
        ext_logstore,  # Initialize logstore after storage, before celery
        ext_celery,
        ext_login,
        ext_mail,
        ext_hosting_provider,
        ext_sentry,
        ext_proxy_fix,
        ext_blueprints,
        ext_commands,
        ext_fastopenapi,
        ext_otel,
        ext_request_logging,
        ext_session_factory,
    ]
    for ext in extensions:
        short_name = ext.__name__.split(".")[-1]
        is_enabled = ext.is_enabled() if hasattr(ext, "is_enabled") else True
        if not is_enabled:
            if dify_config.DEBUG:
                logger.info("Skipped %s", short_name)
            continue

        start_time = time.perf_counter()
        ext.init_app(app)
        end_time = time.perf_counter()
        if dify_config.DEBUG:
            logger.info("Loaded %s (%s ms)", short_name, round((end_time - start_time) * 1000, 2))


def create_migrations_app() -> DifyApp:
    app = create_quart_app_with_configs()
    from extensions import ext_database, ext_migrate

    # Initialize only required extensions
    ext_database.init_app(app)
    ext_migrate.init_app(app)

    return app
