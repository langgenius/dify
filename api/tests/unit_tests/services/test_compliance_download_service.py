from unittest.mock import MagicMock

import pytest

from extensions.ext_redis import RedisClientWrapper
from libs.helper import RateLimiter
from machinery.context import RequestContext
from services.compliance_download_service import ComplianceDownloadService
from services.errors.billing import BillingUpstreamUnavailableError, ComplianceRateLimitExceededError


@pytest.fixture
def fetch_link() -> MagicMock:
    return MagicMock()


@pytest.fixture
def rate_limiter(redis_transport: tuple[RedisClientWrapper, MagicMock]) -> RateLimiter:
    redis, _commands = redis_transport
    return RateLimiter("compliance", 10, 60, redis_client=redis)


@pytest.fixture
def request_context() -> RequestContext:
    return RequestContext(
        request_id="request-1",
        trace_id="trace-1",
        account_id="account-1",
        active_workspace_id="workspace-1",
    )


@pytest.fixture
def service(
    fetch_link: MagicMock,
    rate_limiter: RateLimiter,
) -> ComplianceDownloadService:
    return ComplianceDownloadService(
        fetch_link=fetch_link,
        rate_limiter=rate_limiter,
    )


def test_get_link_checks_limit_fetches_and_increments(
    service: ComplianceDownloadService,
    request_context: RequestContext,
    fetch_link: MagicMock,
    redis_transport: tuple[RedisClientWrapper, MagicMock],
) -> None:
    events: list[str] = []
    _, commands = redis_transport

    def execute(command: str, *_args: object, **_kwargs: object) -> int:
        if command == "ZCARD":
            events.append("check")
        elif command == "ZADD":
            events.append("increment")
        return 0

    commands.side_effect = execute
    fetch_link.side_effect = lambda *_args: events.append("fetch") or {"url": "https://example.com/report"}

    result = service.get_link(
        request_context=request_context,
        document_name="SOC2_Type_II",
        ip_address="127.0.0.1",
        device_info="test-agent",
    )

    assert result == {"url": "https://example.com/report"}
    assert events == ["check", "fetch", "increment"]
    assert [call.args[0] for call in commands.call_args_list] == ["ZREMRANGEBYSCORE", "ZCARD", "ZADD", "EXPIRE"]
    assert all(call.args[1] == "compliance:account-1:workspace-1" for call in commands.call_args_list)
    fetch_link.assert_called_once_with(
        "SOC2_Type_II",
        "account-1",
        "workspace-1",
        "127.0.0.1",
        "test-agent",
    )
    assert commands.call_args.args == ("EXPIRE", "compliance:account-1:workspace-1", 120)


def test_get_link_rejects_rate_limited_request(
    service: ComplianceDownloadService,
    request_context: RequestContext,
    fetch_link: MagicMock,
    redis_transport: tuple[RedisClientWrapper, MagicMock],
) -> None:
    _, commands = redis_transport
    commands.return_value = 10

    with pytest.raises(ComplianceRateLimitExceededError):
        service.get_link(
            request_context=request_context,
            document_name="SOC2_Type_II",
            ip_address="127.0.0.1",
            device_info="test-agent",
        )

    fetch_link.assert_not_called()
    assert [call.args[0] for call in commands.call_args_list] == ["ZREMRANGEBYSCORE", "ZCARD"]


def test_get_link_does_not_increment_after_fetch_failure(
    service: ComplianceDownloadService,
    request_context: RequestContext,
    fetch_link: MagicMock,
    redis_transport: tuple[RedisClientWrapper, MagicMock],
) -> None:
    _, commands = redis_transport
    fetch_link.side_effect = BillingUpstreamUnavailableError

    with pytest.raises(BillingUpstreamUnavailableError):
        service.get_link(
            request_context=request_context,
            document_name="SOC2_Type_II",
            ip_address="127.0.0.1",
            device_info="test-agent",
        )

    assert [call.args[0] for call in commands.call_args_list] == ["ZREMRANGEBYSCORE", "ZCARD"]
