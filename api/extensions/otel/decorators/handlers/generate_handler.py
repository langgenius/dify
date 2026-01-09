import logging
from collections.abc import Callable, Mapping
from typing import Any

from opentelemetry.trace import SpanKind, Status, StatusCode
from opentelemetry.util.types import AttributeValue

from extensions.otel.decorators.handler import SpanHandler
from extensions.otel.semconv import DifySpanAttributes, GenAIAttributes
from models.model import Account

logger = logging.getLogger(__name__)


class AppGenerateHandler(SpanHandler):
    """Span handler for ``AppGenerateService.generate``."""

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

            app_model = arguments.get("app_model")
            user = arguments.get("user")
            args_dict = arguments.get("args", {})
            streaming = arguments.get("streaming", True)

            if not app_model or not user or not isinstance(args_dict, dict):
                return wrapped(*args, **kwargs)
            app_id = getattr(app_model, "id", None) or "unknown"
            tenant_id = getattr(app_model, "tenant_id", None) or "unknown"
            user_id = getattr(user, "id", None) or "unknown"
            workflow_id = args_dict.get("workflow_id") or "unknown"

            attributes: dict[str, AttributeValue] = {
                DifySpanAttributes.APP_ID: app_id,
                DifySpanAttributes.TENANT_ID: tenant_id,
                GenAIAttributes.USER_ID: user_id,
                DifySpanAttributes.USER_TYPE: "Account" if isinstance(user, Account) else "EndUser",
                DifySpanAttributes.STREAMING: streaming,
                DifySpanAttributes.WORKFLOW_ID: workflow_id,
            }

            span_name = self._build_span_name(wrapped)
        except Exception as exc:
            logger.warning("Failed to prepare span attributes for AppGenerateService.generate: %s", exc, exc_info=True)
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
