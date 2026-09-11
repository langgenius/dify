import io
import logging
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
from unittest.mock import Mock, patch

import httpx
import pytest

from dify_app import DifyApp
from extensions import ext_logging


@pytest.mark.parametrize("output_format", ["text", "json"])
def test_startup_handlers_redact_concurrent_httpx_requests(
    output_format: str,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    caplog: pytest.LogCaptureFixture,
) -> None:
    console = io.StringIO()
    log_file = tmp_path / "requests.log"
    config_overrides(
        LOG_FILE=str(log_file),
        LOG_OUTPUT_FORMAT=output_format,
        LOG_FORMAT="%(levelname)s %(name)s %(message)s",
        LOG_LEVEL="INFO",
    )
    monkeypatch.setattr(ext_logging.sys, "stdout", console)
    sqlalchemy_logger = logging.getLogger("sqlalchemy.engine")
    monkeypatch.setattr(sqlalchemy_logger, "propagate", sqlalchemy_logger.propagate)
    with patch.object(ext_logging.logging, "basicConfig") as basic_config:
        ext_logging.init_app(Mock(spec=DifyApp))

    handlers: list[logging.Handler] = basic_config.call_args.kwargs["handlers"]
    assert len(handlers) == 2
    httpx_logger = logging.getLogger("httpx")
    monkeypatch.setattr(httpx_logger, "handlers", handlers)
    monkeypatch.setattr(httpx_logger, "propagate", False)
    caplog.set_level(logging.INFO, logger="httpx")
    barrier = Barrier(2)
    wire_urls: list[str] = []
    urls = [
        f"https://user-{owner}:password-{owner}@collector.example/api/{owner}?signature=secret-{owner}#fragment-{owner}"
        for owner in ("first", "second")
    ]

    def receive(request: httpx.Request) -> httpx.Response:
        wire_urls.append(str(request.url))
        barrier.wait(timeout=5)
        return httpx.Response(202, request=request)

    def send(url: str) -> int:
        with httpx.Client(transport=httpx.MockTransport(receive)) as client:
            return client.post(url).status_code

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            assert list(executor.map(send, urls)) == [202, 202]
        assert httpx_logger.level == logging.INFO
    finally:
        for handler in handlers:
            handler.close()

    assert sorted(wire_urls) == sorted(urls)
    for output in (console.getvalue(), log_file.read_text()):
        assert output.count("HTTP Request: POST") == 2
        assert "https://collector.example/api/first" in output
        assert "https://collector.example/api/second" in output
        assert "202 Accepted" in output
        for secret in ("user-", "password-", "signature", "secret-", "fragment-"):
            assert secret not in output
