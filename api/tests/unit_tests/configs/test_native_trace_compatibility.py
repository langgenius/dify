import pytest
from pydantic import ValidationError

from configs.feature import OpsTraceConfig


def test_ops_trace_config_rejects_parent_context_ttl_shorter_than_retry_window() -> None:
    with pytest.raises(ValidationError, match="must cover the retry window"):
        OpsTraceConfig(
            OPS_TRACE_UNIFIED_ENABLED=True,
            OPS_TRACE_RETRYABLE_DISPATCH_MAX_RETRIES=4,
            OPS_TRACE_RETRYABLE_DISPATCH_DELAY_SECONDS=5,
            OPS_TRACE_PARENT_CONTEXT_TTL_SECONDS=19,
        )


def test_ops_trace_config_skips_parent_context_validation_when_unified_tracing_is_disabled() -> None:
    OpsTraceConfig(
        OPS_TRACE_UNIFIED_ENABLED=False,
        OPS_TRACE_RETRYABLE_DISPATCH_MAX_RETRIES=4,
        OPS_TRACE_RETRYABLE_DISPATCH_DELAY_SECONDS=5,
        OPS_TRACE_PARENT_CONTEXT_TTL_SECONDS=19,
    )


def test_ops_trace_config_accepts_parent_context_ttl_covering_retry_window() -> None:
    OpsTraceConfig(
        OPS_TRACE_UNIFIED_ENABLED=True,
        OPS_TRACE_RETRYABLE_DISPATCH_MAX_RETRIES=4,
        OPS_TRACE_RETRYABLE_DISPATCH_DELAY_SECONDS=5,
        OPS_TRACE_PARENT_CONTEXT_TTL_SECONDS=20,
    )


def test_native_trace_defaults_retain_deployed_retry_window() -> None:
    config = OpsTraceConfig(_env_file=None)
    assert config.OPS_TRACE_UNIFIED_ENABLED is False
    assert config.OPS_TRACE_RETRYABLE_DISPATCH_MAX_RETRIES == 780
    assert config.OPS_TRACE_RETRYABLE_DISPATCH_DELAY_SECONDS == 5
    assert config.OPS_TRACE_PARENT_CONTEXT_TTL_SECONDS == 3900
    assert config.OPS_TRACE_EXPORT_MAX_ATTEMPTS == 6
