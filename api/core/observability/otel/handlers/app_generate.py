import logging
from collections.abc import Callable, Mapping
from typing import Any

from opentelemetry.trace import SpanKind, Status, StatusCode
from opentelemetry.util.types import AttributeValue

from core.observability.otel.core.handler import SpanHandler
from core.observability.otel.semconv import AppSpanAttributes
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
            invoke_from_args = arguments.get("args", {})
            invoke_from = arguments.get("invoke_from")
            streaming = arguments.get("streaming", True)

            if not app_model or not user or not isinstance(invoke_from_args, dict):
                return wrapped(*args, **kwargs)
            app_id = getattr(app_model, "id", None)
            tenant_id = getattr(app_model, "tenant_id", None)
            user_id = getattr(user, "id", None)

            if not app_id or not tenant_id or not user_id:
                return wrapped(*args, **kwargs)

            attributes: dict[str, AttributeValue] = {
                AppSpanAttributes.APP_ID: app_id,
                AppSpanAttributes.TENANT_ID: tenant_id,
                AppSpanAttributes.USER_ID: user_id,
                AppSpanAttributes.USER_TYPE: "Account" if isinstance(user, Account) else "EndUser",
                AppSpanAttributes.STREAMING: streaming,
            }

            workflow_id = invoke_from_args.get("workflow_id")
            if workflow_id:
                attributes[AppSpanAttributes.WORKFLOW_ID] = workflow_id

            if invoke_from:
                attributes[AppSpanAttributes.INVOKE_FROM] = (
                    invoke_from.value if hasattr(invoke_from, "value") else str(invoke_from)
                )

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
