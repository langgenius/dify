import logging
import sys
from typing import Union

from celery.signals import worker_init
from flask_login import user_loaded_from_request, user_logged_in
from opentelemetry import trace
from opentelemetry.propagate import set_global_textmap
from opentelemetry.propagators.b3 import B3Format
from opentelemetry.propagators.composite import CompositePropagator
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator

from configs import dify_config
from libs.helper import extract_tenant_id
from models import Account, EndUser

logger = logging.getLogger(__name__)


def setup_context_propagation() -> None:
    set_global_textmap(
        CompositePropagator(
            [
                TraceContextTextMapPropagator(),
                B3Format(),
            ]
        )
    )


def shutdown_tracer() -> None:
    provider = trace.get_tracer_provider()
    if hasattr(provider, "force_flush"):
        provider.force_flush()


def is_celery_worker():
    return "celery" in sys.argv[0].lower()


@user_logged_in.connect
@user_loaded_from_request.connect
def on_user_loaded(_sender, user: Union["Account", "EndUser"]):
    if dify_config.ENABLE_OTEL:
        from opentelemetry.trace import get_current_span

        if user:
            try:
                current_span = get_current_span()
                tenant_id = extract_tenant_id(user)
                if not tenant_id:
                    return
                if current_span:
                    current_span.set_attribute("service.tenant.id", tenant_id)
                    current_span.set_attribute("service.user.id", user.id)
            except Exception:
                logger.exception("Error setting tenant and user attributes")
                pass


@worker_init.connect(weak=False)
def init_celery_worker(*args, **kwargs):
    if dify_config.ENABLE_OTEL:
        from opentelemetry.instrumentation.celery import CeleryInstrumentor
        from opentelemetry.metrics import get_meter_provider
        from opentelemetry.trace import get_tracer_provider

        tracer_provider = get_tracer_provider()
        metric_provider = get_meter_provider()
        if dify_config.DEBUG:
            logger.info("Initializing OpenTelemetry for Celery worker")
        CeleryInstrumentor(tracer_provider=tracer_provider, meter_provider=metric_provider).instrument()
