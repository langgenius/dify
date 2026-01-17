"""
Structured logging utilities for Workflow Generator.

Provides consistent log formatting with context for debugging
and monitoring.
"""

import logging
import time
from collections.abc import Generator
from contextlib import contextmanager

logger = logging.getLogger(__name__)

# Type alias for metric values (int, float, str, bool, or None)
MetricValue = int | float | str | bool | None


class GenerationLogger:
    """
    Structured logger for workflow generation.

    Captures timing, context, and metrics for each generation.
    """

    tenant_id: str
    instruction_preview: str
    start_time: float
    metrics: dict[str, MetricValue]

    def __init__(self, tenant_id: str, instruction: str) -> None:
        self.tenant_id = tenant_id
        self.instruction_preview = instruction[:100] + "..." if len(instruction) > 100 else instruction
        self.start_time = time.time()
        self.metrics = {
            "tenant_id": tenant_id,
            "instruction_length": len(instruction),
        }

    def log_phase_start(self, phase: str) -> None:
        """Log the start of a generation phase."""
        self.metrics[f"{phase}_start"] = time.time()
        logger.info(
            "workflow_generation_phase_start",
            extra={
                "phase": phase,
                **self.metrics,
            },
        )

    def log_phase_end(self, phase: str, success: bool = True, **extra: MetricValue) -> None:
        """Log the end of a generation phase."""
        phase_start = self.metrics.get(f"{phase}_start", self.start_time)
        start_time = phase_start if isinstance(phase_start, (int, float)) else self.start_time
        duration_ms = int((time.time() - start_time) * 1000)
        self.metrics[f"{phase}_duration_ms"] = duration_ms
        self.metrics[f"{phase}_success"] = success

        logger.info(
            "workflow_generation_phase_end",
            extra={
                "phase": phase,
                "duration_ms": duration_ms,
                "success": success,
                **extra,
                **self.metrics,
            },
        )

    def log_retry(self, attempt: int, reason: str, **extra: MetricValue) -> None:
        """Log a retry attempt."""
        self.metrics["retry_count"] = attempt
        logger.warning(
            "workflow_generation_retry",
            extra={
                "attempt": attempt,
                "reason": reason,
                **extra,
                **self.metrics,
            },
        )

    def log_completion(self, success: bool, **extra: MetricValue) -> None:
        """Log generation completion."""
        total_duration_ms = int((time.time() - self.start_time) * 1000)
        self.metrics["total_duration_ms"] = total_duration_ms
        self.metrics["success"] = success

        log_fn = logger.info if success else logger.error
        log_fn(
            "workflow_generation_complete",
            extra={
                "total_duration_ms": total_duration_ms,
                "success": success,
                **extra,
                **self.metrics,
            },
        )

    def log_error(self, error_code: str, message: str, **extra: MetricValue) -> None:
        """Log an error."""
        logger.error(
            "workflow_generation_error",
            extra={
                "error_code": error_code,
                "error_message": message,
                **extra,
                **self.metrics,
            },
        )


@contextmanager
def log_phase(gen_logger: GenerationLogger, phase: str) -> Generator[None, None, None]:
    """Context manager for logging a generation phase."""
    gen_logger.log_phase_start(phase)
    try:
        yield
        gen_logger.log_phase_end(phase, success=True)
    except Exception as e:
        gen_logger.log_phase_end(phase, success=False, error=str(e))
        raise
