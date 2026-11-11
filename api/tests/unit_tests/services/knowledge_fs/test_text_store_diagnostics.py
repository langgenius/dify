import json

import gevent
import httpx
import pymysql
import pytest
import requests
from gevent.event import Event

from core.logging.structured_formatter import StructuredJSONFormatter
from services.knowledge_fs.text_store import TextPayload
from services.knowledge_fs.text_store_diagnostics import text_backend_diagnostics, text_backend_stage


@pytest.fixture
def payload() -> TextPayload:
    return TextPayload.model_validate(
        {
            "operation": "search",
            "scope": {
                "tenant_id": "018f0d60-7a49-7cc2-9c1b-5b36f18f0001",
                "knowledge_space_id": "018f0d60-7a49-7cc2-9c1b-5b36f18f0002",
                "index_version": "private-index",
            },
            "ids": ["018f0d60-7a49-7cc2-9c1b-5b36f18f0004"],
            "query": "private-content",
        }
    )


def test_http_dependency_status_and_wrapped_database_cause_survive_without_payloads(
    payload: TextPayload, caplog: pytest.LogCaptureFixture
) -> None:
    response = requests.Response()
    response.status_code = 401
    failures = [
        requests.HTTPError("private-password", response=response),
        httpx.HTTPStatusError(
            "private-password",
            request=httpx.Request("GET", "https://private-host"),
            response=httpx.Response(429),
        ),
        pymysql.err.OperationalError(2013, "private-sql"),
    ]
    for error in failures:
        with text_backend_diagnostics("test-request", payload, "tidb_on_qdrant") as diagnostics:
            try:
                with text_backend_stage("endpoint_lookup"):
                    try:
                        raise error
                    except Exception as cause:
                        raise RuntimeError("private-wrapper-message") from cause
            except RuntimeError as failure:
                diagnostics.log_failure(failure, outcome="failed")
    attributes = [json.loads(StructuredJSONFormatter().format(record))["attributes"] for record in caplog.records]
    assert len(attributes) == 3
    assert attributes[0]["errors"][1]["http_status"] == 401
    assert attributes[1]["errors"][1]["http_status"] == 429
    assert attributes[2]["errors"][1]["db_error_code"] == 2013
    assert attributes[2]["errors"][1]["db_error_name"] == "CR_SERVER_LOST"
    assert all(event["stage"] == "endpoint_lookup" for event in attributes)
    assert "private-" not in json.dumps(attributes) + caplog.text


def test_overlapping_gevent_requests_keep_failure_stages_and_ids_isolated(
    payload: TextPayload, caplog: pytest.LogCaptureFixture
) -> None:
    first_entered, second_done = Event(), Event()

    def first_request() -> None:
        with text_backend_diagnostics("request-one", payload, "tidb_on_qdrant") as diagnostics:
            try:
                with text_backend_stage("connect"):
                    first_entered.set()
                    assert second_done.wait(timeout=1)
                    raise pymysql.err.OperationalError(1045, "secret")
            except Exception as error:
                diagnostics.log_failure(error, outcome="failed")

    def second_request() -> None:
        assert first_entered.wait(timeout=1)
        with text_backend_diagnostics("request-two", payload, "tidb_on_qdrant") as diagnostics:
            try:
                with text_backend_stage("search"):
                    raise pymysql.err.OperationalError(2013, "secret")
            except Exception as error:
                diagnostics.log_failure(error, outcome="failed")
        second_done.set()

    workers = [gevent.spawn(first_request), gevent.spawn(second_request)]
    gevent.joinall(workers, timeout=2, raise_error=True)
    assert all(worker.ready() for worker in workers)
    events = {record.__dict__["attributes"]["request_id"]: record.__dict__["attributes"] for record in caplog.records}
    assert events["request-one"]["stage"] == "connect"
    assert events["request-one"]["errors"][0]["db_error_code"] == 1045
    assert events["request-two"]["stage"] == "search"
    assert events["request-two"]["errors"][0]["db_error_code"] == 2013


def test_diagnostics_context_is_reset_even_after_failure(payload: TextPayload) -> None:
    with text_backend_diagnostics("request", payload, "qdrant") as diagnostics, text_backend_stage("successful-step"):
        pass
    with pytest.raises(RuntimeError), text_backend_stage("outside-request"):
        raise RuntimeError("private-message")
    assert diagnostics.failure_stage is None


@pytest.mark.parametrize("error", [pymysql.err.Error(), pymysql.err.Error(True), pymysql.err.Error("secret")])
def test_only_integer_driver_codes_are_recorded(
    payload: TextPayload, caplog: pytest.LogCaptureFixture, error: Exception
) -> None:
    with text_backend_diagnostics("request", payload, "tidb_on_qdrant") as diagnostics:
        diagnostics.log_failure(error, outcome="failed")
    assert "db_error_code" not in caplog.records[0].__dict__["attributes"]["errors"][0]
    assert "secret" not in caplog.text


def test_unknown_driver_codes_are_preserved_and_exception_chains_are_bounded(
    payload: TextPayload, caplog: pytest.LogCaptureFixture
) -> None:
    error = pymysql.err.OperationalError(9999, "private-message")
    error.__cause__ = error
    with text_backend_diagnostics("request", payload, "tidb_on_qdrant") as diagnostics:
        diagnostics.log_failure(error, outcome="failed")
    errors = caplog.records[0].__dict__["attributes"]["errors"]
    assert len(errors) == 1
    assert errors[0]["db_error_code"] == 9999
    assert errors[0]["db_error_name"] == "UNKNOWN"

    def nested_failures(depth: int) -> None:
        try:
            if depth > 0:
                nested_failures(depth - 1)
            raise ValueError("private-deep-cause")
        except Exception as cause:
            raise RuntimeError("private-wrapper") from cause

    with text_backend_diagnostics("request", payload, "tidb_on_qdrant") as diagnostics:
        try:
            nested_failures(12)
        except Exception as failure:
            diagnostics.log_failure(failure, outcome="failed")
    errors = caplog.records[-1].__dict__["attributes"]["errors"]
    assert len(errors) == 4
    assert all(len(error["frames"]) <= 8 for error in errors)
    assert "private-" not in caplog.text


def test_explicitly_suppressed_context_is_not_resurrected(
    payload: TextPayload, caplog: pytest.LogCaptureFixture
) -> None:
    with text_backend_diagnostics("request", payload, "tidb_on_qdrant") as diagnostics:
        try:
            try:
                raise pymysql.err.OperationalError(1045, "private-password")
            except Exception:
                raise RuntimeError("safe") from None
        except Exception as failure:
            diagnostics.log_failure(failure, outcome="failed")
    assert len(caplog.records[0].__dict__["attributes"]["errors"]) == 1
