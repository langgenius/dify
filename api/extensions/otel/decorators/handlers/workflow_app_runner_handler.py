import logging
from collections.abc import Callable, Mapping
from typing import Any

from opentelemetry.trace import SpanKind, Status, StatusCode
from opentelemetry.util.types import AttributeValue

from extensions.otel.decorators.handler import SpanHandler
from extensions.otel.semconv import DifySpanAttributes, GenAIAttributes

logger = logging.getLogger(__name__)


class WorkflowAppRunnerHandler(SpanHandler):
    """Span handler for ``WorkflowAppRunner.run``."""

    def wrapper(
        self,
        tracer: Any,
        wrapped: Callable[..., Any],
        args: tuple[Any, ...],
        kwargs: Mapping[str, Any],
    ) -> Any:
        try:
            arguments = self._extract_arguments(wrapped, args, kwargs)
            if not arguments:
                return wrapped(*args, **kwargs)

            runner = arguments.get("self")
            if runner is None or not hasattr(runner, "application_generate_entity"):
                return wrapped(*args, **kwargs)

            entity = runner.application_generate_entity
            app_config = getattr(entity, "app_config", None)
            if app_config is None:
                return wrapped(*args, **kwargs)

            user_id: AttributeValue = getattr(entity, "user_id", None) or "unknown"
            app_id: AttributeValue = getattr(app_config, "app_id", None) or "unknown"
            tenant_id: AttributeValue = getattr(app_config, "tenant_id", None) or "unknown"
            workflow_id: AttributeValue = getattr(app_config, "workflow_id", None) or "unknown"
            streaming = getattr(entity, "stream", True)

            attributes: dict[str, AttributeValue] = {
                DifySpanAttributes.APP_ID: app_id,
                DifySpanAttributes.TENANT_ID: tenant_id,
                GenAIAttributes.USER_ID: user_id,
                DifySpanAttributes.STREAMING: streaming,
                DifySpanAttributes.WORKFLOW_ID: workflow_id,
            }

            span_name = self._build_span_name(wrapped)
        except Exception as exc:
            logger.warning("Failed to prepare span attributes for WorkflowAppRunner.run: %s", exc, exc_info=True)
            return wrapped(*args, **kwargs)

        with tracer.start_as_current_span(span_name, kind=SpanKind.INTERNAL, attributes=attributes) as span:
            try:
                result = wrapped(*args, **kwargs)
                span.set_status(Status(StatusCode.OK))
                return result
            except Exception as exc:
                span.record_exception(exc)
                span.set_status(Status(StatusCode.ERROR, str(exc)))
                raise
