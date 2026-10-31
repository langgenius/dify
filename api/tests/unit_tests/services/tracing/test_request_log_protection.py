"""Real HTTPX/SSRF diagnostics with synthetic credential-bearing destinations."""

import logging
import traceback
from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
from threading import Barrier, Event
from urllib.parse import quote

import httpx
import pytest
from opentelemetry.context import _SUPPRESS_INSTRUMENTATION_KEY, get_value

from core.helper import ssrf_proxy
from core.logging.structured_formatter import StructuredJSONFormatter
from core.ops.exceptions import RetryableTraceDispatchError
from services.tracing.provider_common import request
from services.tracing.provider_dispatch import TraceExportRejectedError, TraceExportUncertainError
from services.tracing.request_log_protection import SAFE_HTTP_LOG_MESSAGE, protect_http_request_logs

SYNTHETIC_KEY = "SYNTHETIC-NOT-A-REAL-LICENSE/+?=测试"
ENCODED_KEY = quote(SYNTHETIC_KEY, safe="")
PRIVATE_URL = f"https://collector.test/prefix/adapt_{ENCODED_KEY}/api/otlp/traces"
type HTTPHandler = Callable[[httpx.Request], httpx.Response]
type InstallClient = Callable[[HTTPHandler], None]


@pytest.fixture(autouse=True)
def enable_http_diagnostics(caplog: pytest.LogCaptureFixture) -> Iterator[None]:
    """Exercise INFO records even if an imported SDK changed HTTPX's level."""
    with caplog.at_level(logging.INFO, logger="httpx"):
        yield


@pytest.fixture
def install_client(monkeypatch: pytest.MonkeyPatch) -> Iterator[InstallClient]:
    with ExitStack() as stack:

        def install(handler: HTTPHandler) -> None:
            client = stack.enter_context(httpx.Client(transport=httpx.MockTransport(handler)))

            def get_client(ssl_verify_enabled: bool) -> httpx.Client:
                assert isinstance(ssl_verify_enabled, bool)
                return client

            monkeypatch.setattr(ssrf_proxy, "_get_ssrf_client", get_client)

        yield install


def evidence(caplog: pytest.LogCaptureFixture) -> str:
    formatter = StructuredJSONFormatter()
    return caplog.text + "".join(repr(record.__dict__) + formatter.format(record) for record in caplog.records)


@pytest.mark.parametrize("outcome", [200, 503, 302, "squid", "timeout", "invalid"])
@pytest.mark.parametrize("scheme", ["http", "https"])
def test_aliyun_keeps_real_wire_url_but_protects_transport_logs_and_exception_chains(
    install_client: InstallClient, caplog: pytest.LogCaptureFixture, outcome: int | str, scheme: str
) -> None:
    caplog.set_level(logging.INFO)
    original_factory = logging.getLogRecordFactory()
    original_make_record = logging.Logger.makeRecord
    previous_suppression = get_value(_SUPPRESS_INSTRUMENTATION_KEY)
    sent: list[httpx.Request] = []
    private_url = PRIVATE_URL.replace("https://", scheme + "://", 1)

    def handler(wire: httpx.Request) -> httpx.Response:
        sent.append(wire)
        assert str(wire.url) == private_url
        assert get_value(_SUPPRESS_INSTRUMENTATION_KEY) is True
        assert set(wire.extensions["timeout"].values()) == {30.0}
        logger = logging.getLogger("core.helper.ssrf_proxy")
        logger.warning(
            "Synthetic URL %s raw %s encoded %s",
            wire.url,
            SYNTHETIC_KEY,
            quote(ENCODED_KEY, safe=""),
            extra={"private_url": str(wire.url), "private_payload": {"license": SYNTHETIC_KEY}},
        )
        assert logging.getLogRecordFactory() is original_factory
        if outcome in {"timeout", "invalid"}:
            try:
                raise ValueError(SYNTHETIC_KEY + ENCODED_KEY)
            except ValueError as cause:
                logger.exception("Synthetic transport exception %s", wire.url)
                if outcome == "invalid":
                    raise ValueError(SYNTHETIC_KEY) from cause
                raise httpx.ReadError("lost acknowledgment " + str(wire.url), request=wire) from cause
        if outcome == "squid":
            return httpx.Response(403, headers={"Server": "squid"})
        assert isinstance(outcome, int)
        return httpx.Response(outcome, headers={"Location": "https://redirect.test/"})

    install_client(handler)
    if outcome == 200:
        result = request("POST", private_url, "aliyun", content=b"synthetic")
        assert result.status_code == 200
        rendered_exception = ""
    else:
        expected = (
            TraceExportUncertainError
            if outcome == "timeout"
            else RetryableTraceDispatchError
            if outcome == 503
            else TraceExportRejectedError
        )
        with pytest.raises(expected) as caught:
            request("POST", private_url, "aliyun", content=b"synthetic")
        assert caught.value.__cause__ is None
        assert caught.value.__context__ is None
        rendered_exception = "".join(traceback.format_exception(caught.value))
    assert len(sent) == 1  # Real SSRF max_retries=0 and no redirects remain in force.
    assert logging.getLogRecordFactory() is original_factory
    assert logging.Logger.makeRecord is original_make_record
    assert get_value(_SUPPRESS_INSTRUMENTATION_KEY) == previous_suppression
    assert any(
        record.name == "core.helper.ssrf_proxy" and record.levelno == logging.WARNING for record in caplog.records
    )
    if outcome in {200, 503, 302, "squid"}:
        assert any(record.name == "httpx" and record.levelno == logging.INFO for record in caplog.records)
    assert all(record.getMessage() == SAFE_HTTP_LOG_MESSAGE for record in caplog.records)
    rendered = evidence(caplog) + rendered_exception
    for private in [SYNTHETIC_KEY, ENCODED_KEY, quote(ENCODED_KEY, safe="")]:
        assert private.casefold() not in rendered.casefold()
    logging.getLogger("httpx").info("AFTER-REQUEST-PUBLIC-LOG")
    assert "AFTER-REQUEST-PUBLIC-LOG" in caplog.text


def test_overlapping_private_requests_keep_public_request_logs_and_restore_factory(
    install_client: InstallClient, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO)
    original_factory = logging.getLogRecordFactory()
    original_make_record = logging.Logger.makeRecord
    levels = (logging.root.level, logging.getLogger("httpx").level, logging.getLogger("core.helper.ssrf_proxy").level)
    barrier = Barrier(3)
    first_finished = Event()
    keys = {label: f"SYNTHETIC-PRIVATE-{label}/+?" for label in ["a", "b"]}
    urls = {label: f"https://{label}.test/adapt_{quote(key, safe='')}/api/otlp/traces" for label, key in keys.items()}
    urls["public"] = "https://public.test/PUBLIC-DESTINATION-VISIBLE"

    def handler(wire: httpx.Request) -> httpx.Response:
        label = wire.url.host.split(".")[0]
        barrier.wait(timeout=5)
        if label != "a":
            assert first_finished.wait(timeout=5)
        logging.getLogger("core.helper.ssrf_proxy").warning("diagnostic URL %s", wire.url)
        return httpx.Response(200)

    install_client(handler)

    def run(label: str) -> int:
        result = request("POST", urls[label], "aliyun" if label in keys else "weave")
        if label == "a":
            first_finished.set()
        return result.status_code

    with ThreadPoolExecutor(max_workers=3) as pool:
        assert list(pool.map(run, ["a", "b", "public"])) == [200, 200, 200]
    rendered = evidence(caplog)
    for key in keys.values():
        assert key not in rendered
        assert quote(key, safe="") not in rendered
    assert "PUBLIC-DESTINATION-VISIBLE" in rendered
    assert logging.getLogRecordFactory() is original_factory
    assert logging.Logger.makeRecord is original_make_record
    assert levels == (
        logging.root.level,
        logging.getLogger("httpx").level,
        logging.getLogger("core.helper.ssrf_proxy").level,
    )


def test_nested_scopes_sanitize_before_existing_factory_and_restore_public_logging(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO)
    original = logging.getLogRecordFactory()
    observed: list[str] = []

    def existing_factory(*args: object, **kwargs: object) -> logging.LogRecord:
        record = original(*args, **kwargs)
        observed.append(record.getMessage())
        return record

    logging.setLogRecordFactory(existing_factory)
    try:
        with protect_http_request_logs(True):
            assert logging.getLogRecordFactory() is existing_factory
            logging.getLogger("httpcore.connection").info("outer %s", SYNTHETIC_KEY)
            with protect_http_request_logs(False):
                logging.getLogger("httpx").info("NESTED-PUBLIC-LOG")
            with protect_http_request_logs(True):
                logging.getLogger("httpx").info("inner %s", ENCODED_KEY)
            logging.getLogger("core.helper.ssrf_proxy").info("outer restored %s", SYNTHETIC_KEY)
        assert logging.getLogRecordFactory() is existing_factory
        assert observed == [SAFE_HTTP_LOG_MESSAGE, "NESTED-PUBLIC-LOG", SAFE_HTTP_LOG_MESSAGE, SAFE_HTTP_LOG_MESSAGE]
    finally:
        logging.setLogRecordFactory(original)


def test_non_chaining_factory_replacement_during_request_receives_no_private_fields(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO)
    original = logging.getLogRecordFactory()
    observed: list[tuple[object, ...]] = []
    try:
        with protect_http_request_logs(True):
            assert logging.getLogRecordFactory() is original

            def externally_installed(*args: object, **kwargs: object) -> logging.LogRecord:
                observed.append((args[4], args[5], args[6], args[8]))
                return original(*args, **kwargs)

            logging.setLogRecordFactory(externally_installed)
            logging.getLogger("httpx").info(
                "private %s", SYNTHETIC_KEY, extra={"url": PRIVATE_URL, "license": ENCODED_KEY}
            )
        assert logging.getLogRecordFactory() is externally_installed
        assert observed == [(SAFE_HTTP_LOG_MESSAGE, (), None, None)]
        assert "url" not in caplog.records[0].__dict__
        assert "license" not in caplog.records[0].__dict__
        logging.getLogger("httpx").info("EXTERNAL-FACTORY-PUBLIC-LOG")
        assert SYNTHETIC_KEY not in evidence(caplog)
        assert "EXTERNAL-FACTORY-PUBLIC-LOG" in caplog.text
    finally:
        logging.setLogRecordFactory(original)


def test_protection_never_sets_the_record_factory(monkeypatch: pytest.MonkeyPatch) -> None:
    original = logging.getLogRecordFactory()

    def forbidden(_factory: object) -> None:
        pytest.fail("Request protection must not configure the LogRecordFactory")

    monkeypatch.setattr(logging, "setLogRecordFactory", forbidden)
    with protect_http_request_logs(True):
        logging.getLogger("httpx").warning("private %s", SYNTHETIC_KEY)
        assert logging.getLogRecordFactory() is original
    assert logging.getLogRecordFactory() is original


def test_public_make_record_signature_preserves_public_fields_and_redacts_private_fields() -> None:
    logger = logging.getLogger("httpx")
    error_info = (ValueError, ValueError(SYNTHETIC_KEY), None)
    original_factory = logging.getLogRecordFactory()
    for sensitive in [True, False]:
        with protect_http_request_logs(sensitive):
            record = logger.makeRecord(
                name="httpx",
                level=logging.WARNING,
                fn="fixture.py",
                lno=42,
                msg="message %s",
                args=(SYNTHETIC_KEY,),
                exc_info=error_info,
                func="request",
                extra={"license": ENCODED_KEY},
                sinfo=SYNTHETIC_KEY,
            )
        assert logging.getLogRecordFactory() is original_factory
        assert record.name == "httpx"
        assert record.levelno == logging.WARNING
        if sensitive:
            assert record.getMessage() == SAFE_HTTP_LOG_MESSAGE
            assert record.exc_info is None
            assert record.stack_info is None
            assert "license" not in record.__dict__
        else:
            assert record.getMessage() == "message " + SYNTHETIC_KEY
            assert record.exc_info is error_info
            assert record.stack_info == SYNTHETIC_KEY
            assert record.__dict__["license"] == ENCODED_KEY


def test_exit_does_not_overwrite_a_foreign_make_record_method() -> None:
    original_method: Callable[..., logging.LogRecord] = logging.Logger.makeRecord
    original_factory = logging.getLogRecordFactory()
    with pytest.MonkeyPatch.context() as monkeypatch:
        # Save the unprotected method before the request installs its wrapper.
        monkeypatch.setattr(logging.Logger, "makeRecord", original_method)
        with protect_http_request_logs(True):

            def externally_installed(*args: object, **kwargs: object) -> logging.LogRecord:
                return original_method(*args, **kwargs)

            monkeypatch.setattr(logging.Logger, "makeRecord", externally_installed)
        assert logging.Logger.makeRecord is externally_installed
        assert logging.getLogRecordFactory() is original_factory
